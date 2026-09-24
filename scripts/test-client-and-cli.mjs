// SPDX-License-Identifier: MIT

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execFileAsync = promisify(execFile);
const CLI_PATH = path.resolve(__dirname, "../bin/ophirpay.mjs");

import {
  parsePaymentCsv,
  verifyWebhook,
} from "../bin/ophirpay.mjs";

test("OphirPay Client & CLI Direct Verification", async (t) => {
  let server;
  let baseUrl;
  const mockApiKey = "sk_test_ci_pipeline_secret_key_12345";
  const mockWebhookSecret = "whsec_test_secret_abc123";

  // Start in-memory mock server
  await new Promise((resolve) => {
    server = http.createServer(async (req, res) => {
      const url = new URL(req.url || "/", `http://${req.headers.host}`);
      const authHeader = req.headers["authorization"] || req.headers["x-api-key"];

      let bodyText = "";
      for await (const chunk of req) {
        bodyText += chunk;
      }
      let bodyJson = {};
      if (bodyText) {
        try {
          bodyJson = JSON.parse(bodyText);
        } catch {
          bodyJson = {};
        }
      }

      const sendJson = (status, data) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(data));
      };

      if (url.pathname === "/api/health" && req.method === "GET") {
        return sendJson(200, { status: "OK", version: "0.1.0" });
      }

      if (!authHeader || (!authHeader.includes(mockApiKey) && authHeader !== mockApiKey)) {
        return sendJson(401, {
          success: false,
          error: { code: "UNAUTHORIZED", message: "Invalid or missing API key" },
        });
      }

      if (url.pathname === "/api/payments" && req.method === "POST") {
        return sendJson(201, {
          success: true,
          data: {
            id: "p_123456",
            amount: bodyJson.amount,
            destAddress: bodyJson.destAddress,
            sourceAccountId: bodyJson.sourceAccountId,
            assetCode: bodyJson.assetCode || "XLM",
            status: "COMPLETED",
            txHash: "0xabcdef1234567890",
          },
        });
      }

      if (url.pathname.startsWith("/api/payments/") && req.method === "GET") {
        return sendJson(200, {
          success: true,
          data: {
            id: "p_123456",
            amount: 100,
            destAddress: "GA2C5RFPE6GCKMY3US5PAB6UZLKIGSPIUKSLRB6ZN7BMQTUM2QXQWXYZ",
            status: "COMPLETED",
            txHash: "0xhash_recorded",
          },
        });
      }

      if (url.pathname === "/api/batches" && req.method === "POST") {
        const recipients = bodyJson.recipients || [];
        const hasFailed = recipients.some((r) => r.address && r.address.includes("FAIL"));
        const items = recipients.map((r, idx) => ({
          id: `item_${idx + 1}`,
          amount: Number(r.amount),
          status: r.address && r.address.includes("FAIL") ? "failed" : "sent",
        }));
        const failedCount = items.filter((i) => i.status === "failed").length;
        const sentCount = items.length - failedCount;

        return sendJson(201, {
          success: true,
          data: {
            id: "b_789101",
            name: bodyJson.name,
            status: hasFailed ? "FAILED" : "COMPLETED",
            items,
            progress: {
              total: recipients.length,
              sent: sentCount,
              failed: failedCount,
              pending: 0,
            },
          },
        });
      }

      if (url.pathname.startsWith("/api/batches/") && req.method === "GET") {
        return sendJson(200, {
          success: true,
          data: {
            id: "b_789101",
            name: "Test-Batch",
            status: "COMPLETED",
            progress: { total: 2, sent: 2, failed: 0, pending: 0 },
          },
        });
      }

      return sendJson(404, { error: { message: "Not found" } });
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });

  t.after(() => {
    server.close();
  });

  await t.test("CSV parsing and validation", () => {
    const csv = `address,amount,assetCode,memo\nGA2C5RFPE6GCKMY3US5PAB6UZLKIGSPIUKSLRB6ZN7BMQTUM2QXQWXYZ,10.5,XLM,Test`;
    const recipients = parsePaymentCsv(csv);
    assert.equal(recipients.length, 1);
    assert.equal(recipients[0].amount, 10.5);
    assert.equal(recipients[0].address, "GA2C5RFPE6GCKMY3US5PAB6UZLKIGSPIUKSLRB6ZN7BMQTUM2QXQWXYZ");

    assert.throws(() => parsePaymentCsv("INVALID_ADDR,10"), /Invalid Stellar address/);
    assert.throws(() => parsePaymentCsv("GA2C5RFPE6GCKMY3US5PAB6UZLKIGSPIUKSLRB6ZN7BMQTUM2QXQWXYZ,-1"), /Invalid payment amount/);
  });

  await t.test("Webhook signature verification", () => {
    const payload = {
      event: "payment.created",
      timestamp: "2026-09-24T00:00:00Z",
      data: { id: "p_123" },
    };
    const canonical = JSON.stringify({ ...payload, signature: "" });
    const sig = crypto.createHmac("sha256", mockWebhookSecret).update(canonical).digest("hex");

    const validResult = verifyWebhook(payload, sig, mockWebhookSecret);
    assert.equal(validResult.valid, true);

    const invalidResult = verifyWebhook(payload, "invalid_sig", mockWebhookSecret);
    assert.equal(invalidResult.valid, false);
  });

  await t.test("CLI health check", async () => {
    const { stdout } = await execFileAsync("node", [CLI_PATH, "health", "--base-url", baseUrl]);
    assert.match(stdout, /OphirPay API is healthy/);
  });

  await t.test("CLI payment create and get", async () => {
    const { stdout } = await execFileAsync("node", [
      CLI_PATH,
      "payment",
      "create",
      "--amount",
      "100",
      "--dest",
      "GA2C5RFPE6GCKMY3US5PAB6UZLKIGSPIUKSLRB6ZN7BMQTUM2QXQWXYZ",
      "--source",
      "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLABGD",
      "--api-key",
      mockApiKey,
      "--base-url",
      baseUrl,
    ]);
    assert.match(stdout, /Payment created successfully/);

    const { stdout: getStdout } = await execFileAsync("node", [
      CLI_PATH,
      "status",
      "p_123456",
      "--api-key",
      mockApiKey,
      "--base-url",
      baseUrl,
    ]);
    assert.match(getStdout, /COMPLETED/);
  });

  await t.test("CLI batch create from CSV", async () => {
    const tempCsv = path.resolve(__dirname, "temp_recipients.csv");
    fs.writeFileSync(
      tempCsv,
      `address,amount,assetCode\nGA2C5RFPE6GCKMY3US5PAB6UZLKIGSPIUKSLRB6ZN7BMQTUM2QXQWXYZ,50,XLM`
    );

    try {
      const { stdout } = await execFileAsync("node", [
        CLI_PATH,
        "batch",
        "create",
        "--csv",
        tempCsv,
        "--name",
        "Test-Batch",
        "--source",
        "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLABGD",
        "--api-key",
        mockApiKey,
        "--base-url",
        baseUrl,
      ]);
      assert.match(stdout, /Batch payout registered/);
    } finally {
      if (fs.existsSync(tempCsv)) fs.unlinkSync(tempCsv);
    }
  });

  await t.test("CLI batch fails job on rejected payment", async () => {
    const tempCsv = path.resolve(__dirname, "temp_failed.csv");
    fs.writeFileSync(
      tempCsv,
      `address,amount,assetCode\nGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAIL,10,XLM`
    );

    try {
      let failed = false;
      try {
        await execFileAsync("node", [
          CLI_PATH,
          "batch",
          "create",
          "--csv",
          tempCsv,
          "--name",
          "Failing-Batch",
          "--source",
          "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLABGD",
          "--api-key",
          mockApiKey,
          "--base-url",
          baseUrl,
        ]);
      } catch (err) {
        failed = true;
        assert.equal(err.code, 1);
        assert.match(err.stderr, /Batch completed with rejected\/failed payments/);
      }
      assert.equal(failed, true);
    } finally {
      if (fs.existsSync(tempCsv)) fs.unlinkSync(tempCsv);
    }
  });
});
