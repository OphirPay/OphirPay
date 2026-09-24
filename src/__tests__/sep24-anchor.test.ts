// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import http from "http";
import { discoverAnchor, clearAnchorCache } from "@/lib/sep24/discovery";
import {
  initiateInteractiveDeposit,
  initiateInteractiveWithdrawal,
  getAnchorTransaction,
  pollTransactionStatus,
} from "@/lib/sep24/client";
import { recordCompletedAnchorDeposit } from "@/lib/sep24/record";
import prisma from "@/lib/prisma";

// Mock prisma for recording payments
vi.mock("@/lib/prisma", () => {
  const mockPayments = new Map<string, Record<string, unknown>>();
  return {
    default: {
      payment: {
        findFirst: vi.fn(async ({ where }) => {
          for (const payment of mockPayments.values()) {
            if (
              where.transactionHash &&
              payment.transactionHash === where.transactionHash
            ) {
              return payment;
            }
            if (
              where.metadata?.contains &&
              typeof payment.metadata === "string" &&
              payment.metadata.includes(where.metadata.contains)
            ) {
              return payment;
            }
          }
          return null;
        }),
        create: vi.fn(async ({ data }) => {
          const id = `p_sep24_${Date.now()}`;
          const record = { id, ...data };
          mockPayments.set(id, record);
          return record;
        }),
      },
    },
  };
});

describe("SEP-24 Anchor Integration (Fiat On & Off-Ramp)", () => {
  let mockServer: http.Server;
  let anchorDomain: string;
  let transferServerUrl: string;

  // Track transaction call counts to simulate lifecycle state transitions
  const pollCounts = new Map<string, number>();

  beforeAll(async () => {
    mockServer = http.createServer((req, res) => {
      const url = new URL(req.url || "/", `http://${req.headers.host}`);

      const send = (status: number, data: unknown, contentType = "application/json") => {
        res.writeHead(status, { "Content-Type": contentType });
        res.end(typeof data === "string" ? data : JSON.stringify(data));
      };

      // 1. SEP-1 stellar.toml
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

      // 2. SEP-24 /info
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

      // 3. SEP-24 /transactions/deposit/interactive
      if (url.pathname === "/sep24/transactions/deposit/interactive" && req.method === "POST") {
        return send(200, {
          type: "interactive_customer_info_needed",
          id: "tx_dep_12345",
          url: `${transferServerUrl}/interactive/deposit?id=tx_dep_12345`,
        });
      }

      // 4. SEP-24 /transactions/withdraw/interactive
      if (url.pathname === "/sep24/transactions/withdraw/interactive" && req.method === "POST") {
        return send(200, {
          type: "interactive_customer_info_needed",
          id: "tx_with_67890",
          url: `${transferServerUrl}/interactive/withdraw?id=tx_with_67890`,
        });
      }

      // 5. SEP-24 /transaction?id=...
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

        // State progression: pending_user_transfer_start -> pending_anchor -> completed
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
            message: status === "completed" ? "Funds delivered" : "Awaiting bank settlement",
            more_info_url: `${transferServerUrl}/receipt?id=${id}`,
          },
        });
      }

      return send(404, { error: "Not found" });
    });

    await new Promise<void>((resolve) => {
      mockServer.listen(0, "127.0.0.1", () => {
        const addr = mockServer.address();
        if (addr && typeof addr === "object") {
          anchorDomain = `127.0.0.1:${addr.port}`;
          transferServerUrl = `http://${anchorDomain}/sep24`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    clearAnchorCache();
    await new Promise<void>((resolve) => {
      mockServer.close(() => resolve());
    });
  });

  it("dynamically discovers anchor configuration via SEP-1 stellar.toml", async () => {
    clearAnchorCache();
    const config = await discoverAnchor(anchorDomain, true);

    expect(config.domain).toBe(anchorDomain);
    expect(config.orgName).toBe("OphirPay Testnet Anchor");
    expect(config.transferServerSep24).toBe(transferServerUrl);
    expect(config.assets["USDC"]).toBeDefined();
    expect(config.assets["USDC"].deposit.enabled).toBe(true);
    expect(config.assets["USDC"].deposit.minAmount).toBe(5);
    expect(config.assets["USDC"].withdraw.enabled).toBe(true);
    expect(config.assets["XLM"]).toBeDefined();
  });

  it("initiates an interactive deposit session and retrieves interactive URL", async () => {
    const config = await discoverAnchor(anchorDomain, true);
    const session = await initiateInteractiveDeposit(config, {
      assetCode: "USDC",
      account: "GA2C5RFPE6GCKMY3US5PAB6UZLKIGSPIUKSLRB6ZN7BMQTUM2QXQWXYZ",
      amount: 100,
    });

    expect(session.id).toBe("tx_dep_12345");
    expect(session.type).toBe("interactive_customer_info_needed");
    expect(session.url).toContain("/interactive/deposit?id=tx_dep_12345");
  });

  it("initiates an interactive withdrawal session", async () => {
    const config = await discoverAnchor(anchorDomain, true);
    const session = await initiateInteractiveWithdrawal(config, {
      assetCode: "USDC",
      account: "GA2C5RFPE6GCKMY3US5PAB6UZLKIGSPIUKSLRB6ZN7BMQTUM2QXQWXYZ",
      amount: 50,
    });

    expect(session.id).toBe("tx_with_67890");
    expect(session.url).toContain("/interactive/withdraw?id=tx_with_67890");
  });

  it("polls transaction status through state progression until completion", async () => {
    const config = await discoverAnchor(anchorDomain, true);
    const finalTx = await pollTransactionStatus(config, "tx_dep_12345", {
      intervalMs: 10,
      maxWaitMs: 2000,
    });

    expect(finalTx.id).toBe("tx_dep_12345");
    expect(finalTx.status).toBe("completed");
    expect(finalTx.amountOut).toBe("99.00");
    expect(finalTx.stellarTransactionId).toBe("0x3389e9f0f1a65f19736cacf544c2e825313e");
  });

  it("records completed anchor deposit in the payment ledger state", async () => {
    const config = await discoverAnchor(anchorDomain, true);
    const tx = await getAnchorTransaction(config, "tx_dep_12345");
    expect(tx.status).toBe("completed");

    const payment = await recordCompletedAnchorDeposit(
      "user_12345",
      tx,
      anchorDomain,
      "USDC"
    );

    expect(payment).toBeDefined();
    expect(payment?.amount).toBe(99);
    expect(payment?.status).toBe("COMPLETED");
    expect(payment?.assetCode).toBe("USDC");
    expect(payment?.transactionHash).toBe("0x3389e9f0f1a65f19736cacf544c2e825313e");

    // Re-recording is idempotent
    const duplicate = await recordCompletedAnchorDeposit(
      "user_12345",
      tx,
      anchorDomain,
      "USDC"
    );
    expect(duplicate?.id).toBe(payment?.id);
  });

  it("handles anchor error / KYC rejection states", async () => {
    const config = await discoverAnchor(anchorDomain, true);
    const failedTx = await getAnchorTransaction(config, "tx_failed_999");

    expect(failedTx.status).toBe("error");
    expect(failedTx.message).toContain("KYC verification rejected");
  });
});
