// SPDX-License-Identifier: MIT

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { discoverAnchor, clearAnchorCache } from "../src/lib/sep24/discovery.ts";
import {
  initiateInteractiveDeposit,
  initiateInteractiveWithdrawal,
  getAnchorTransaction,
  pollTransactionStatus,
} from "../src/lib/sep24/client.ts";

test("SEP-24 Anchor Full Verification Flow", async (t) => {
  let mockServer;
  let anchorDomain;
  let transferServerUrl;
  const pollCounts = new Map();

  await new Promise((resolve) => {
    mockServer = http.createServer((req, res) => {
      const url = new URL(req.url || "/", `http://${req.headers.host}`);

      const send = (status, data, contentType = "application/json") => {
        res.writeHead(status, { "Content-Type": contentType });
        res.end(typeof data === "string" ? data : JSON.stringify(data));
      };

      if (url.pathname === "/.well-known/stellar.toml") {
        const toml = `
VERSION = "2.0.0"
TRANSFER_SERVER_SEP0024 = "${transferServerUrl}"
ORG_NAME = "OphirPay Testnet Anchor"
SIGNING_KEY = "GACNKEDGJYLLVQDXWYEEPB47Y3JEV5JNZ3RQANTJIVKKEOXX4NC4YWHU"

[[CURRENCIES]]
code = "USDC"
issuer = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLABGD"

[[CURRENCIES]]
code = "XLM"
`;
        return send(200, toml, "text/plain");
      }

      if (url.pathname === "/sep24/info") {
        return send(200, {
          deposit: {
            USDC: { enabled: true, min_amount: 5, max_amount: 5000, fee_fixed: 1 },
            XLM: { enabled: true, min_amount: 1, max_amount: 10000, fee_fixed: 0 },
          },
          withdraw: {
            USDC: { enabled: true, min_amount: 10, max_amount: 5000, fee_fixed: 2 },
          },
        });
      }

      if (url.pathname === "/sep24/transactions/deposit/interactive" && req.method === "POST") {
        return send(200, {
          type: "interactive_customer_info_needed",
          id: "tx_dep_12345",
          url: `${transferServerUrl}/interactive/deposit?id=tx_dep_12345`,
        });
      }

      if (url.pathname === "/sep24/transactions/withdraw/interactive" && req.method === "POST") {
        return send(200, {
          type: "interactive_customer_info_needed",
          id: "tx_with_67890",
          url: `${transferServerUrl}/interactive/withdraw?id=tx_with_67890`,
        });
      }

      if (url.pathname === "/sep24/transaction" && req.method === "GET") {
        const id = url.searchParams.get("id");
        if (!id) return send(400, { error: "Missing id" });

        if (id === "tx_failed_999") {
          return send(200, {
            transaction: {
              id,
              kind: "deposit",
              status: "error",
              message: "KYC verification rejected by anchor compliance",
            },
          });
        }

        const count = (pollCounts.get(id) || 0) + 1;
        pollCounts.set(id, count);

        let status = "pending_user_transfer_start";
        if (count >= 3) {
          status = "completed";
        } else if (count === 2) {
          status = "pending_anchor";
        }

        return send(200, {
          transaction: {
            id,
            kind: "deposit",
            status,
            amount_in: "100.00",
            amount_out: "99.00",
            amount_fee: "1.00",
            stellar_transaction_id: status === "completed" ? "0x3389e9f0f1a65f19736cacf544c2e825313e" : undefined,
          },
        });
      }

      return send(404, { error: "Not found" });
    });

    mockServer.listen(0, "127.0.0.1", () => {
      const addr = mockServer.address();
      anchorDomain = `127.0.0.1:${addr.port}`;
      transferServerUrl = `http://${anchorDomain}/sep24`;
      resolve();
    });
  });

  t.after(() => {
    clearAnchorCache();
    mockServer.close();
  });

  await t.test("Dynamic SEP-1 discovery", async () => {
    clearAnchorCache();
    const config = await discoverAnchor(anchorDomain, true);
    assert.equal(config.domain, anchorDomain);
    assert.equal(config.orgName, "OphirPay Testnet Anchor");
    assert.equal(config.transferServerSep24, transferServerUrl);
    assert.equal(config.assets["USDC"]?.deposit.enabled, true);
    assert.equal(config.assets["USDC"]?.deposit.minAmount, 5);
  });

  await t.test("Interactive deposit initiation", async () => {
    const config = await discoverAnchor(anchorDomain, true);
    const session = await initiateInteractiveDeposit(config, {
      assetCode: "USDC",
      account: "GA2C5RFPE6GCKMY3US5PAB6UZLKIGSPIUKSLRB6ZN7BMQTUM2QXQWXYZ",
      amount: 100,
    });
    assert.equal(session.id, "tx_dep_12345");
    assert.match(session.url, /\/interactive\/deposit\?id=tx_dep_12345/);
  });

  await t.test("Interactive withdrawal initiation", async () => {
    const config = await discoverAnchor(anchorDomain, true);
    const session = await initiateInteractiveWithdrawal(config, {
      assetCode: "USDC",
      account: "GA2C5RFPE6GCKMY3US5PAB6UZLKIGSPIUKSLRB6ZN7BMQTUM2QXQWXYZ",
      amount: 50,
    });
    assert.equal(session.id, "tx_with_67890");
    assert.match(session.url, /\/interactive\/withdraw\?id=tx_with_67890/);
  });

  await t.test("Status polling lifecycle progression", async () => {
    const config = await discoverAnchor(anchorDomain, true);
    const finalTx = await pollTransactionStatus(config, "tx_dep_12345", {
      intervalMs: 10,
      maxWaitMs: 2000,
    });
    assert.equal(finalTx.status, "completed");
    assert.equal(finalTx.amountOut, "99.00");
    assert.equal(finalTx.stellarTransactionId, "0x3389e9f0f1a65f19736cacf544c2e825313e");
  });

  await t.test("Rejection and error state handling", async () => {
    const config = await discoverAnchor(anchorDomain, true);
    const failedTx = await getAnchorTransaction(config, "tx_failed_999");
    assert.equal(failedTx.status, "error");
    assert.match(failedTx.message, /KYC verification rejected/);
  });
});
