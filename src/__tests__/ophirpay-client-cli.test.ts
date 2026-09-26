// SPDX-License-Identifier: MIT
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import {
  OphirPayClient,
  OphirPayApiError,
  parseBatchCsv,
  verifyWebhookSignature,
} from "../lib/client/index";
import { buildSignedPayload } from "../lib/webhook-deliver";

const MOCK_API_KEY = "test_key_abc123";
const MOCK_BASE_URL = "http://localhost:3000";
const SECRET = "secret-test-webhook-98765";

describe("parseBatchCsv", () => {
  it("parses valid CSV with headers", () => {
    const csv = `address,amount,assetCode,memo\nGBQMIN7KLT4R473IGGFBGUYM2UNPGKZRTX2LZ4M2KQIY2ASYJL6ACBMZ,50,XLM,salary-1\nGBQMIN7KLT4R473IGGFBGUYM2UNPGKZRTX2LZ4M2KQIY2ASYJL6ACBMZ,100,USDC,salary-2`;
    const recipients = parseBatchCsv(csv);
    expect(recipients).toHaveLength(2);
    expect(recipients[0]).toEqual({
      address: "GBQMIN7KLT4R473IGGFBGUYM2UNPGKZRTX2LZ4M2KQIY2ASYJL6ACBMZ",
      amount: 50,
      assetCode: "XLM",
      memo: "salary-1",
    });
    expect(recipients[1].amount).toBe(100);
    expect(recipients[1].assetCode).toBe("USDC");
  });

  it("throws on empty CSV", () => {
    expect(() => parseBatchCsv("")).toThrow("CSV file is empty");
  });

  it("throws on non-numeric amount", () => {
    const csv = `GBQMIN7KLT4R473IGGFBGUYM2UNPGKZRTX2LZ4M2KQIY2ASYJL6ACBMZ,invalid_amount`;
    expect(() => parseBatchCsv(csv)).toThrow("Invalid payment amount");
  });

  it("throws on invalid Stellar address", () => {
    const csv = `BAD_ADDRESS,50`;
    expect(() => parseBatchCsv(csv)).toThrow("Invalid Stellar address");
  });
});

describe("verifyWebhookSignature", () => {
  const payload = {
    event: "payment.completed",
    timestamp: new Date().toISOString(),
    data: { id: "pay_123", amount: 250, asset: "USDC" },
  };

  it("verifies genuine webhook payload from buildSignedPayload", () => {
    const { body, signature, timestamp } = buildSignedPayload(payload, SECRET);
    const isValid = verifyWebhookSignature({
      body,
      signature,
      secret: SECRET,
      timestamp,
    });
    expect(isValid).toBe(true);
  });

  it("rejects tampered payload body", () => {
    const { body, signature, timestamp } = buildSignedPayload(payload, SECRET);
    const tampered = body.replace('"amount":250', '"amount":9999');
    const isValid = verifyWebhookSignature({
      body: tampered,
      signature,
      secret: SECRET,
      timestamp,
    });
    expect(isValid).toBe(false);
  });

  it("rejects incorrect secret", () => {
    const { body, signature, timestamp } = buildSignedPayload(payload, SECRET);
    const isValid = verifyWebhookSignature({
      body,
      signature,
      secret: "wrong-secret",
      timestamp,
    });
    expect(isValid).toBe(false);
  });

  it("rejects expired timestamps outside maxAgeSeconds", () => {
    const oldTimestamp = new Date(Date.now() - 400 * 1000).toISOString();
    const { body, signature } = buildSignedPayload(
      { ...payload, timestamp: oldTimestamp },
      SECRET
    );
    const isValid = verifyWebhookSignature({
      body,
      signature,
      secret: SECRET,
      timestamp: oldTimestamp,
      maxAgeSeconds: 300,
    });
    expect(isValid).toBe(false);
  });
});

describe("OphirPayClient", () => {
  let client: OphirPayClient;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    client = new OphirPayClient({
      apiKey: MOCK_API_KEY,
      baseUrl: MOCK_BASE_URL,
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("creates a payment with Authorization header", async () => {
    const mockPayment = {
      id: "pay_mock1",
      amount: 100,
      assetCode: "XLM",
      sourceAccountId: "GBQMIN7KLT4R473IGGFBGUYM2UNPGKZRTX2LZ4M2KQIY2ASYJL6ACBMZ",
      destAddress: "GBQMIN7KLT4R473IGGFBGUYM2UNPGKZRTX2LZ4M2KQIY2ASYJL6ACBMZ",
      status: "COMPLETED",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: mockPayment }),
    } as Response);

    const payment = await client.createPayment({
      amount: 100,
      sourceAccountId: "GBQMIN7KLT4R473IGGFBGUYM2UNPGKZRTX2LZ4M2KQIY2ASYJL6ACBMZ",
      destAddress: "GBQMIN7KLT4R473IGGFBGUYM2UNPGKZRTX2LZ4M2KQIY2ASYJL6ACBMZ",
    });

    expect(payment.id).toBe("pay_mock1");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/payments",
      expect.objectContaining({
        method: "POST",
        headers: expect.any(Headers),
      })
    );
  });

  it("submits batch from CSV", async () => {
    const mockBatch = {
      id: "batch_mock1",
      name: "Payroll",
      sourceAccountId: "GBQMIN7KLT4R473IGGFBGUYM2UNPGKZRTX2LZ4M2KQIY2ASYJL6ACBMZ",
      status: "PROCESSING",
      totalRecipients: 1,
      totalAmount: 50,
      createdAt: new Date().toISOString(),
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: mockBatch }),
    } as Response);

    const csv = `GBQMIN7KLT4R473IGGFBGUYM2UNPGKZRTX2LZ4M2KQIY2ASYJL6ACBMZ,50,XLM,bonus`;
    const batch = await client.createBatchFromCsv(csv, {
      name: "Payroll",
      sourceAccountId: "GBQMIN7KLT4R473IGGFBGUYM2UNPGKZRTX2LZ4M2KQIY2ASYJL6ACBMZ",
    });

    expect(batch.id).toBe("batch_mock1");
    expect(batch.totalAmount).toBe(50);
  });

  it("throws OphirPayApiError on 401 Unauthorized", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "Invalid API key" }),
    } as Response);

    await expect(client.getPayment("pay_unknown")).rejects.toThrow(OphirPayApiError);
  });
});

describe("OphirPay CLI (bin/ophirpay.mjs)", () => {
  const cliPath = resolve(process.cwd(), "bin/ophirpay.mjs");

  it("verifies webhook signatures from CLI", () => {
    const payload = {
      event: "payment.completed",
      timestamp: new Date().toISOString(),
      data: { id: "pay_test" },
    };
    const { body, signature, timestamp } = buildSignedPayload(payload, SECRET);

    const res = spawnSync(
      "node",
      [
        cliPath,
        "webhook",
        "verify",
        "--secret",
        SECRET,
        "--signature",
        signature,
        "--body",
        body,
        "--timestamp",
        timestamp,
      ],
      { encoding: "utf8" }
    );

    expect(res.status).toBe(0);
    expect(res.stdout).toContain("VALID");
  });

  it("exits with code 1 on invalid signature", () => {
    const res = spawnSync(
      "node",
      [
        cliPath,
        "webhook",
        "verify",
        "--secret",
        SECRET,
        "--signature",
        "deadbeefdeadbeef",
        "--body",
        '{"foo":"bar"}',
      ],
      { encoding: "utf8" }
    );

    expect(res.status).toBe(1);
    expect(res.stdout).toContain("INVALID");
  });

  it("exits with code 1 when required parameters are missing", () => {
    const res = spawnSync(
      "node",
      [cliPath, "payment", "create"],
      { encoding: "utf8" }
    );
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Missing required parameters");
  });

  it("displays help when invoked with --help", () => {
    const res = spawnSync(
      "node",
      [cliPath, "--help"],
      { encoding: "utf8" }
    );
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("OphirPay CLI");
  });
});
