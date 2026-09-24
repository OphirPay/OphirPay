// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import crypto from "crypto";
import {
  buildTestWebhookPayload,
  buildWebhookPreview,
} from "@/lib/webhook-test";
import { buildSignedPayload } from "@/lib/webhook-deliver";
import { WEBHOOK_EVENTS, ALL_WEBHOOK_EVENTS } from "@/app/api/webhooks/event-types";

describe("buildTestWebhookPayload", () => {
  it("is clearly marked as a test on both the envelope and the data", () => {
    const payload = buildTestWebhookPayload();
    expect(payload.test).toBe(true);
    expect((payload.data as { test?: boolean }).test).toBe(true);
  });

  it("defaults to a payment.completed event that is a valid webhook event", () => {
    const payload = buildTestWebhookPayload();
    expect(payload.event).toBe(WEBHOOK_EVENTS.PAYMENT_COMPLETED);
    expect(ALL_WEBHOOK_EVENTS).toContain(payload.event);
  });

  it("accepts an explicit event type and still marks it as a test", () => {
    const payload = buildTestWebhookPayload(WEBHOOK_EVENTS.BATCH_FAILED);
    expect(payload.event).toBe(WEBHOOK_EVENTS.BATCH_FAILED);
    expect(payload.test).toBe(true);
  });

  it("carries a timestamp and a data payload suitable for HMAC signing", () => {
    const payload = buildTestWebhookPayload();
    expect(() => new Date(payload.timestamp).toISOString()).not.toThrow();
    expect(payload.data).toMatchObject({
      paymentId: expect.any(String),
      amount: expect.any(String),
      assetCode: expect.any(String),
      status: expect.any(String),
    });
  });

  it("never creates a real-looking payment (marked test, no live fields)", () => {
    const payload = buildTestWebhookPayload();
    expect((payload.data as Record<string, unknown>).test).toBe(true);
    expect(payload.data).not.toHaveProperty("transactionHash");
  });
});

describe("buildWebhookPreview", () => {
  const secret = "test-secret-123456";
  const url = "https://example.com/webhook";
  const fixedTs = "2026-09-24T12:00:00.000Z";

  it("produces an outgoingBody that matches buildSignedPayload byte for byte", () => {
    const preview = buildWebhookPreview(url, secret, WEBHOOK_EVENTS.PAYMENT_COMPLETED, fixedTs);
    const expectedPayload = buildTestWebhookPayload(WEBHOOK_EVENTS.PAYMENT_COMPLETED, fixedTs);
    const { body: expectedBody, signature: expectedSig } = buildSignedPayload(expectedPayload, secret);

    expect(preview.outgoingBody).toBe(expectedBody);
    expect(preview.signature).toBe(expectedSig);
    expect(preview.headers["X-OphirPay-Signature"]).toBe(expectedSig);
    expect(preview.headers["X-OphirPay-Event"]).toBe(WEBHOOK_EVENTS.PAYMENT_COMPLETED);
    expect(preview.headers["Content-Type"]).toBe("application/json");
  });

  it("includes canonical payload with signature emptied for HMAC verification", () => {
    const preview = buildWebhookPreview(url, secret, WEBHOOK_EVENTS.PAYMENT_COMPLETED, fixedTs);

    // Canonical payload has empty signature
    expect(preview.canonicalPayload.signature).toBe("");
    expect(preview.canonicalJson).toContain('"signature": ""');

    // Verification by receiver:
    // Receiver parses outgoingBody, sets signature = "", stringifies, and computes HMAC
    const received = JSON.parse(preview.outgoingBody);
    const canonicalFromReceived = JSON.stringify({ ...received, signature: "" });
    const computedHmac = crypto
      .createHmac("sha256", secret)
      .update(canonicalFromReceived)
      .digest("hex");

    expect(computedHmac).toBe(preview.signature);
    expect(preview.signature).toBe(preview.headers["X-OphirPay-Signature"]);
  });

  it("validates target URL using SSRF guard", () => {
    const safePreview = buildWebhookPreview("https://api.merchant.com/webhook", secret);
    expect(safePreview.urlGuard.safe).toBe(true);

    const blockedPreview = buildWebhookPreview("http://localhost:8000/webhook", secret);
    expect(blockedPreview.urlGuard.safe).toBe(false);
    expect(blockedPreview.urlGuard.reason).toMatch(/reserved\/internal domain/i);

    const privateIpPreview = buildWebhookPreview("http://192.168.1.1/webhook", secret);
    expect(privateIpPreview.urlGuard.safe).toBe(false);
    expect(privateIpPreview.urlGuard.reason).toMatch(/private\/internal IPv4/i);
  });
});
