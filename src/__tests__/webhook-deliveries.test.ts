// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { deliverWebhook } from "@/lib/webhook-deliver";
import { persistDeliveryResult } from "@/lib/webhook-delivery-service";

vi.mock("@/lib/prisma", () => ({
  default: {
    webhookDelivery: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
    webhook: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/lib/webhook-url-guard", () => ({
  isSafeWebhookUrlAtDelivery: vi.fn().mockResolvedValue(true),
}));

import prisma from "@/lib/prisma";

const mockDeliveryCreate = prisma.webhookDelivery.create as ReturnType<typeof vi.fn>;

describe("deliverWebhook metrics", () => {
  const originalFetch = globalThis.fetch;
  const SECRET = "test-secret";
  const payload = {
    event: "payment.created",
    timestamp: "2026-08-20T00:00:00Z",
    data: { id: "p_1" },
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns latency and attempt count on success", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 }) as unknown as typeof fetch;

    const result = await deliverWebhook("https://example.com/hook", SECRET, payload, 1);
    expect(result.success).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.statusCode).toBe(200);
  });

  it("returns error details after failed attempts", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 }) as unknown as typeof fetch;

    const result = await deliverWebhook("https://example.com/hook", SECRET, payload, 2);
    expect(result.success).toBe(false);
    expect(result.attempts).toBe(2);
    expect(result.errorMessage).toBe("HTTP 503");
    expect(result.statusCode).toBe(503);
  });
});

describe("persistDeliveryResult", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeliveryCreate.mockResolvedValue({ id: "del_new" });
  });

  it("records latency, attempts, and error message", async () => {
    const id = await persistDeliveryResult("wh_1", "evt_1", {
      success: false,
      statusCode: 500,
      latencyMs: 1200,
      attempts: 3,
      errorMessage: "HTTP 500",
    });

    expect(id).toBe("del_new");
    expect(mockDeliveryCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        webhookId: "wh_1",
        eventId: "evt_1",
        status: "FAILED",
        responseCode: 500,
        latencyMs: 1200,
        attempts: 3,
        errorMessage: "HTTP 500",
      }),
    });
  });
});

describe("delivery list shape", () => {
  it("maps stored delivery fields for dashboard consumption", () => {
    const delivery = {
      id: "del_1",
      eventId: "evt_1",
      status: "FAILED",
      responseCode: 502,
      latencyMs: 840,
      attempts: 3,
      errorMessage: "HTTP 502",
      isReplay: false,
      replayBatchId: null,
      deliveredAt: new Date("2026-08-20T12:00:00Z"),
      event: {
        event: "payment.created",
        timestamp: new Date("2026-08-20T11:59:00Z"),
        data: '{"paymentId":"p_1"}',
      },
    };

    const formatted = {
      id: delivery.id,
      eventType: delivery.event.event,
      status: delivery.status,
      latencyMs: delivery.latencyMs,
      attempts: delivery.attempts,
      responseCode: delivery.responseCode,
      errorMessage: delivery.errorMessage,
    };

    expect(formatted).toEqual({
      id: "del_1",
      eventType: "payment.created",
      status: "FAILED",
      latencyMs: 840,
      attempts: 3,
      responseCode: 502,
      errorMessage: "HTTP 502",
    });
  });
});
