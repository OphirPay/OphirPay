// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import {
  OphirPayClient,
  OphirPayApiError,
  parsePaymentCsv,
  verifyWebhookSignature,
} from "../../packages/client/src/index.js";

const execFileAsync = promisify(execFile);
const CLI_PATH = path.resolve(__dirname, "../../bin/ophirpay.mjs");

describe("OphirPay Client, CLI, and Action Test Suite", () => {
  let server: http.Server;
  let baseUrl: string;
  const mockApiKey = "sk_test_ci_pipeline_secret_key_12345";
  const mockWebhookSecret = "whsec_test_secret_abc123";

  // In-memory server state for tests
  const paymentsDb = new Map<string, Record<string, unknown>>();
  const batchesDb = new Map<string, Record<string, unknown>>();

  beforeAll(async () => {
    server = http.createServer(async (req, res) => {
      const url = new URL(req.url || "/", `http://${req.headers.host}`);
      const authHeader = req.headers["authorization"] || req.headers["x-api-key"];

      // Read request body
      let bodyText = "";
      for await (const chunk of req) {
        bodyText += chunk;
      }
      let bodyJson: Record<string, unknown> = {};
      if (bodyText) {
        try {
          bodyJson = JSON.parse(bodyText);
        } catch {
          bodyJson = {};
        }
      }

      const sendJson = (status: number, data: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(data));
      };

      // ── Health ──
      if (url.pathname === "/api/health" && req.method === "GET") {
        return sendJson(200, { status: "OK", version: "0.1.0", timestamp: new Date().toISOString() });
      }

      // Check Authentication for protected routes
      if (!authHeader || (!authHeader.includes(mockApiKey) && authHeader !== mockApiKey)) {
        return sendJson(401, {
          success: false,
          error: { code: "UNAUTHORIZED", message: "Invalid or missing API key" },
        });
      }

      // ── Payments ──
      if (url.pathname === "/api/payments" && req.method === "POST") {
        const id = `p_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        const record = {
          id,
          amount: bodyJson.amount,
          destAddress: bodyJson.destAddress,
          sourceAccountId: bodyJson.sourceAccountId,
          assetCode: bodyJson.assetCode || "XLM",
          memo: bodyJson.memo,
          description: bodyJson.description,
          status: "COMPLETED",
          txHash: "0xabcdef1234567890",
          createdAt: new Date().toISOString(),
        };
        paymentsDb.set(id, record);
        return sendJson(201, { success: true, data: record });
      }

      if (url.pathname.startsWith("/api/payments/") && req.method === "GET") {
        const id = decodeURIComponent(url.pathname.replace("/api/payments/", ""));
        const record = paymentsDb.get(id) || {
          id,
          amount: 100,
          destAddress: "GA2C5RFPE6GCKMY3US5PAB6UZLKIGSPIUKSLRB6ZN7BMQTUM2QXQWXYZ",
          sourceAccountId: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLABGD",
          assetCode: "XLM",
          status: "COMPLETED",
          txHash: "0xhash_recorded",
        };
        return sendJson(200, { success: true, data: record });
      }

      // ── Batches ──
      if (url.pathname === "/api/batches" && req.method === "POST") {
        const recipients = (bodyJson.recipients as Array<Record<string, unknown>>) || [];
        const id = `b_${Date.now()}`;
        const hasFailedRecipient = recipients.some(
          (r) => typeof r.address === "string" && (r.address.includes("FAIL") || r.address.includes("REJECT"))
        );

        const items = recipients.map((r, idx) => ({
          id: `item_${idx + 1}`,
          amount: Number(r.amount),
          assetCode: (r.assetCode as string) || "XLM",
          status: typeof r.address === "string" && r.address.includes("FAIL") ? "failed" : "sent",
          memo: (r.memo as string) || undefined,
        }));

        const failedCount = items.filter((i) => i.status === "failed").length;
        const sentCount = items.length - failedCount;

        const batch = {
          id,
          name: bodyJson.name,
          description: bodyJson.description,
          sourceAccountId: bodyJson.sourceAccountId,
          status: hasFailedRecipient ? "FAILED" : "COMPLETED",
          items,
          progress: {
            total: recipients.length,
            sent: sentCount,
            failed: failedCount,
            pending: 0,
            percentage: recipients.length > 0 ? (sentCount / recipients.length) * 100 : 100,
          },
        };
        batchesDb.set(id, batch);
        return sendJson(201, { success: true, data: batch });
      }

      if (url.pathname.startsWith("/api/batches/") && req.method === "GET") {
        const id = decodeURIComponent(url.pathname.replace("/api/batches/", ""));
        const batch = batchesDb.get(id) || {
          id,
          name: "Test-Batch",
          status: "COMPLETED",
          progress: { total: 2, sent: 2, failed: 0, pending: 0, percentage: 100 },
        };
        return sendJson(200, { success: true, data: batch });
      }

      return sendJson(404, { success: false, error: { code: "NOT_FOUND", message: "Route not found" } });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (addr && typeof addr === "object") {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  describe("Typed OphirPayClient", () => {
    it("creates a single payment with API key authentication", async () => {
      const client = new OphirPayClient({
        baseUrl,
        apiKey: mockApiKey,
      });

      const payment = await client.payments.create({
        amount: 50.25,
        destAddress: "GA2C5RFPE6GCKMY3US5PAB6UZLKIGSPIUKSLRB6ZN7BMQTUM2QXQWXYZ",
        sourceAccountId: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLABGD",
        memo: "Test-Payment",
      });

      expect(payment).toBeDefined();
      expect(payment.id).toMatch(/^p_/);
      expect(payment.amount).toBe(50.25);
      expect(payment.status).toBe("COMPLETED");
      expect(payment.txHash).toBe("0xabcdef1234567890");
    });

    it("retrieves payment details by ID", async () => {
      const client = new OphirPayClient({ baseUrl, apiKey: mockApiKey });
      const payment = await client.payments.get("p_existing_123");

      expect(payment.id).toBe("p_existing_123");
      expect(payment.status).toBe("COMPLETED");
    });

    it("throws OphirPayApiError on 401 unauthorized", async () => {
      const client = new OphirPayClient({
        baseUrl,
        apiKey: "invalid_key",
      });

      await expect(
        client.payments.create({
          amount: 10,
          destAddress: "GA2C5RFPE6GCKMY3US5PAB6UZLKIGSPIUKSLRB6ZN7BMQTUM2QXQWXYZ",
          sourceAccountId: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLABGD",
        })
      ).rejects.toThrow(OphirPayApiError);
    });

    it("creates a batch payout from CSV content", async () => {
      const client = new OphirPayClient({ baseUrl, apiKey: mockApiKey });
      const csv = `address,amount,assetCode,memo
GA2C5RFPE6GCKMY3US5PAB6UZLKIGSPIUKSLRB6ZN7BMQTUM2QXQWXYZ,100,XLM,Bonus1
GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLABGD,200,XLM,Bonus2`;

      const batch = await client.batches.createFromCsv(csv, {
        name: "Q3-Bonuses",
        sourceAccountId: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLABGD",
      });

      expect(batch.id).toMatch(/^b_/);
      expect(batch.name).toBe("Q3-Bonuses");
      expect(batch.progress?.total).toBe(2);
      expect(batch.progress?.sent).toBe(2);
      expect(batch.status).toBe("COMPLETED");
    });

    it("checks system health", async () => {
      const client = new OphirPayClient({ baseUrl });
      const health = await client.system.health();

      expect(health.status).toBe("OK");
      expect(health.version).toBe("0.1.0");
    });
  });

  describe("CSV Parser", () => {
    it("parses valid CSV rows with header", () => {
      const csv = `address,amount,assetCode,memo
GA2C5RFPE6GCKMY3US5PAB6UZLKIGSPIUKSLRB6ZN7BMQTUM2QXQWXYZ,12.5,XLM,Inv1
GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLABGD,50.0,XLM,Inv2`;

      const recipients = parsePaymentCsv(csv);
      expect(recipients).toHaveLength(2);
      expect(recipients[0].address).toBe("GA2C5RFPE6GCKMY3US5PAB6UZLKIGSPIUKSLRB6ZN7BMQTUM2QXQWXYZ");
      expect(recipients[0].amount).toBe(12.5);
      expect(recipients[0].memo).toBe("Inv1");
    });

    it("rejects invalid Stellar address with informative error", () => {
      const invalidCsv = `address,amount
INVALID_ADDR_123,10`;

      expect(() => parsePaymentCsv(invalidCsv)).toThrow(/Invalid Stellar address/);
    });

    it("rejects non-positive amount", () => {
      const invalidAmountCsv = `address,amount
GA2C5RFPE6GCKMY3US5PAB6UZLKIGSPIUKSLRB6ZN7BMQTUM2QXQWXYZ,-5`;

      expect(() => parsePaymentCsv(invalidAmountCsv)).toThrow(/Invalid payment amount/);
    });
  });

  describe("Webhook Signature Verification", () => {
    it("validates authentic webhook payload against HMAC signature", () => {
      const payload = {
        event: "payment.completed",
        timestamp: new Date().toISOString(),
        data: { id: "p_123", amount: 100 },
        signature: "",
      };

      const canonical = JSON.stringify({ ...payload, signature: "" });
      const signature = crypto
        .createHmac("sha256", mockWebhookSecret)
        .update(canonical)
        .digest("hex");

      const result = verifyWebhookSignature(payload, signature, mockWebhookSecret);
      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("rejects tampered webhook payload", () => {
      const payload = {
        event: "payment.completed",
        timestamp: new Date().toISOString(),
        data: { id: "p_123", amount: 100 },
      };

      const canonical = JSON.stringify({ ...payload, signature: "" });
      const signature = crypto
        .createHmac("sha256", mockWebhookSecret)
        .update(canonical)
        .digest("hex");

      // Tamper amount
      const tampered = { ...payload, data: { id: "p_123", amount: 99999 } };

      const result = verifyWebhookSignature(tampered, signature, mockWebhookSecret);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("HMAC digest mismatch");
    });

    it("rejects incorrect secret", () => {
      const payload = {
        event: "payment.created",
        timestamp: new Date().toISOString(),
        data: { id: "p_123" },
      };
      const canonical = JSON.stringify({ ...payload, signature: "" });
      const signature = crypto
        .createHmac("sha256", "correct_secret")
        .update(canonical)
        .digest("hex");

      const result = verifyWebhookSignature(payload, signature, "wrong_secret");
      expect(result.valid).toBe(false);
    });
  });

  describe("OphirPay CLI Execution", () => {
    it("runs 'health' command successfully", async () => {
      const { stdout } = await execFileAsync("node", [
        CLI_PATH,
        "health",
        "--base-url",
        baseUrl,
      ]);

      expect(stdout).toContain("OphirPay API is healthy");
    });

    it("creates single payment via CLI", async () => {
      const { stdout } = await execFileAsync("node", [
        CLI_PATH,
        "payment",
        "create",
        "--amount",
        "75",
        "--dest",
        "GA2C5RFPE6GCKMY3US5PAB6UZLKIGSPIUKSLRB6ZN7BMQTUM2QXQWXYZ",
        "--source",
        "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLABGD",
        "--api-key",
        mockApiKey,
        "--base-url",
        baseUrl,
      ]);

      expect(stdout).toContain("Payment created successfully");
      expect(stdout).toContain("75 XLM");
    });

    it("retrieves status via CLI", async () => {
      const { stdout } = await execFileAsync("node", [
        CLI_PATH,
        "status",
        "p_999",
        "--api-key",
        mockApiKey,
        "--base-url",
        baseUrl,
      ]);

      expect(stdout).toContain("Payment status");
      expect(stdout).toContain("COMPLETED");
    });

    it("submits valid CSV batch via CLI", async () => {
      const tempCsv = path.resolve(__dirname, "../../scratch_test_batch.csv");
      fs.writeFileSync(
        tempCsv,
        `address,amount,assetCode\nGA2C5RFPE6GCKMY3US5PAB6UZLKIGSPIUKSLRB6ZN7BMQTUM2QXQWXYZ,25,XLM\nGBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLABGD,35,XLM`
      );

      try {
        const { stdout } = await execFileAsync("node", [
          CLI_PATH,
          "batch",
          "create",
          "--csv",
          tempCsv,
          "--name",
          "CLI-Test-Batch",
          "--source",
          "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLABGD",
          "--api-key",
          mockApiKey,
          "--base-url",
          baseUrl,
        ]);

        expect(stdout).toContain("Batch payout registered");
        expect(stdout).toContain("COMPLETED");
      } finally {
        if (fs.existsSync(tempCsv)) fs.unlinkSync(tempCsv);
      }
    });

    it("fails with non-zero exit code when batch contains rejected/failed payments", async () => {
      const tempCsv = path.resolve(__dirname, "../../scratch_failed_batch.csv");
      // Address containing 'FAIL' triggers failed item in our mock server
      fs.writeFileSync(
        tempCsv,
        `address,amount,assetCode\nGA2C5RFPE6GCKMY3US5PAB6UZLKIGSPIUKSLRB6ZN7BMQTUM2QXQWXYZ,25,XLM\nGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAIL,10,XLM`
      );

      try {
        let errorThrown = false;
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
        } catch (err: unknown) {
          errorThrown = true;
          const execError = err as { code?: number; stderr?: string };
          expect(execError.code).toBe(1);
          expect(execError.stderr).toContain("Batch completed with rejected/failed payments");
        }
        expect(errorThrown).toBe(true);
      } finally {
        if (fs.existsSync(tempCsv)) fs.unlinkSync(tempCsv);
      }
    });

    it("verifies webhook signature via CLI", async () => {
      const payload = {
        event: "payment.created",
        timestamp: "2026-09-24T00:00:00Z",
        data: { id: "p_test_cli" },
      };
      const canonical = JSON.stringify({ ...payload, signature: "" });
      const signature = crypto
        .createHmac("sha256", mockWebhookSecret)
        .update(canonical)
        .digest("hex");

      const { stdout } = await execFileAsync("node", [
        CLI_PATH,
        "webhook",
        "verify",
        "--payload",
        JSON.stringify(payload),
        "--signature",
        signature,
        "--secret",
        mockWebhookSecret,
      ]);

      expect(stdout).toContain("Webhook signature is VALID");
    });
  });
});
