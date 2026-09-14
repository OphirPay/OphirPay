// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { buildTestWebhookPayload } from "@/lib/webhook-test";
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
