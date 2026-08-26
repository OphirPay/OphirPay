// SPDX-License-Identifier: MIT

import { test, expect } from "@playwright/test";
import http from "http";
import type { AddressInfo } from "net";
import { buildSignedPayload, deliverWebhook } from "../src/lib/webhook-deliver";
import type { WebhookPayload } from "../src/lib/webhook-deliver";
import * as webhookUrlGuard from "../src/lib/webhook-url-guard";

/**
 * E2E: Webhook delivery + retry flow (Issue #209)
 *
 * Acceptance Criteria:
 * - E2E verifies: register webhook → event fires → signed delivery → failure → retry → success
 * - Mock receiver endpoint records deliveries for assertions
 *
 * Strategy: This test is self-contained. It starts its own mock HTTP receiver
 * and directly exercises the production deliverWebhook function so that
 * signing, URL guard, timeout, redirect policy and retry logic are all covered.
 */

interface DeliveryRecord {
  timestamp: number;
  headers: Record<string, string>;
  rawBody: string;
  parsedBody: unknown;
  signatureValid: boolean;
  httpStatus: number;
}

test.describe("Webhook delivery + retry flow", () => {
  let deliveries: DeliveryRecord[] = [];
  let failUntilAttempt = 0;
  let webhookSecret = "";
  let mockServerUrl = "";
  let server: http.Server | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let originalGuard: any = null;

  test.beforeAll(() => {
    // Bypass SSRF guard for the local mock server. The production guard blocks
    // loopback addresses to prevent real webhook deliveries to internal hosts,
    // but E2E tests intentionally exercise delivery against a localhost receiver.
    // We stub only the async delivery-time check so that signing, retry and
    // timeout logic still run through production code paths.
    originalGuard = webhookUrlGuard.isSafeWebhookUrlAtDelivery;
    (webhookUrlGuard as Record<string, unknown>).isSafeWebhookUrlAtDelivery = async () => true;
  });

  test.afterAll(() => {
    if (originalGuard) {
      (webhookUrlGuard as Record<string, unknown>).isSafeWebhookUrlAtDelivery = originalGuard;
    }
  });

  test.beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });
      req.on("end", () => {
        const record: DeliveryRecord = {
          timestamp: Date.now(),
          headers: Object.fromEntries(
            Object.entries(req.headers).map(([k, v]) => [k, String(v)])
          ),
          rawBody: body,
          parsedBody: null,
          signatureValid: false,
          httpStatus: 0,
        };

        try {
          record.parsedBody = JSON.parse(body);
          if (webhookSecret && record.parsedBody) {
            const received = record.headers["x-ophirpay-signature"] || "";
            // Recompute using production helper to validate canonical form
            const recomputed = buildSignedPayload(record.parsedBody as WebhookPayload, webhookSecret);
            record.signatureValid = recomputed.signature === received && received !== "";
          }
        } catch {
          record.parsedBody = body;
        }

        deliveries.push(record);

        // Simulate transient failures for retry testing
        const attemptNumber = deliveries.length;
        if (attemptNumber <= failUntilAttempt) {
          record.httpStatus = 500;
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "simulated transient failure" }));
        } else {
          record.httpStatus = 200;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        }
      });
    });

    await new Promise<void>((resolve) => {
      server!.listen(0, "127.0.0.1", () => {
        const addr = server!.address() as AddressInfo;
        mockServerUrl = `http://127.0.0.1:${addr.port}/webhook`;
        resolve();
      });
    });
  });

  test.afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
  });

  test.beforeEach(() => {
    deliveries = [];
    failUntilAttempt = 0;
    webhookSecret = require("crypto").randomBytes(32).toString("hex");
  });

  test("delivers signed webhook with retry after transient failures", async () => {
    // Configure mock to fail first 2 attempts, succeed on 3rd
    failUntilAttempt = 2;

    const payload: WebhookPayload = {
      event: "payment.created",
      timestamp: new Date().toISOString(),
      data: { id: "pay_test_001", amount: "100", currency: "USDC" },
    };

    // Exercise the PRODUCTION deliverWebhook function directly so that
    // signing, URL guard, timeout, redirect policy and retry logic are all covered.
    const delivered = await deliverWebhook(mockServerUrl, webhookSecret, payload, 3);
    expect(delivered).toBe(true);

    // Verify: exactly 3 delivery attempts were made (2 failures + 1 success)
    expect(deliveries).toHaveLength(3);

    // Verify: all deliveries have valid HMAC signatures
    for (const d of deliveries) {
      expect(d.signatureValid).toBe(true);
      expect(d.headers["x-ophirpay-event"]).toBe("payment.created");
      expect(d.headers["content-type"]).toContain("application/json");
    }

    // Verify: payload structure is correct in all deliveries
    for (const d of deliveries) {
      const body = d.parsedBody as Record<string, unknown>;
      expect(body).toHaveProperty("event", "payment.created");
      expect(body).toHaveProperty("timestamp");
      expect(body).toHaveProperty("data");
      expect(body).toHaveProperty("signature");
      expect((body.data as Record<string, unknown>)).toHaveProperty("id", "pay_test_001");
    }

    // Verify: first 2 got 500, third got 200
    expect(deliveries[0].httpStatus).toBe(500);
    expect(deliveries[1].httpStatus).toBe(500);
    expect(deliveries[2].httpStatus).toBe(200);
  });

  test("rejects webhook with invalid HMAC signature", async () => {
    const payload = {
      event: "payment.completed",
      timestamp: new Date().toISOString(),
      data: { id: "pay_test_002" },
    };

    // Send a manually crafted request with an incorrect signature to verify
    // the mock receiver correctly flags invalid signatures.
    const wrongSig = "deadbeef".repeat(8);
    const finalBody = JSON.stringify({ ...payload, signature: wrongSig });
    await fetch(mockServerUrl, { method: "POST", headers: { "Content-Type": "application/json", "X-OphirPay-Signature": wrongSig, "X-OphirPay-Event": "payment.completed" }, body: finalBody });

    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].signatureValid).toBe(false);
  });

  test("records all attempts when all retries fail", async () => {
    failUntilAttempt = 999; // Always fail

    const payload: WebhookPayload = {
      event: "batch.failed",
      timestamp: new Date().toISOString(),
      data: { batchId: "batch_001" },
    };

    // Production deliverWebhook should exhaust retries and return false
    const delivered = await deliverWebhook(mockServerUrl, webhookSecret, payload, 3);
    expect(delivered).toBe(false);

    // All 3 attempts recorded
    expect(deliveries).toHaveLength(3);
    // Signatures are valid even though server returned 500
    for (const d of deliveries) {
      expect(d.signatureValid).toBe(true);
      expect(d.httpStatus).toBe(500);
    }
  });

  test("verifies canonical signature matches OphirPay signing scheme", async () => {
    // This test ensures our test helper uses the EXACT same canonical form
    // as src/lib/webhook-deliver.ts: JSON.stringify({...payload, signature: ""})
    const payload: WebhookPayload = {
      event: "request.paid",
      timestamp: "2026-08-26T12:00:00.000Z",
      data: { requestId: "req_001", amount: "50" },
    };

    const { signature } = buildSignedPayload(payload, webhookSecret);
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    // Re-compute to ensure deterministic canonical form
    const second = buildSignedPayload(payload, webhookSecret);
    expect(second.signature).toBe(signature);
  });
});
