// SPDX-License-Identifier: MIT
/**
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  deliveryFindMany: vi.fn(),
  deliveryUpdate: vi.fn(),
  deliveryCreate: vi.fn(),
  deliverWebhook: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    webhookDelivery: {
      findMany: mocks.deliveryFindMany,
      update: mocks.deliveryUpdate,
      create: mocks.deliveryCreate,
    },
  },
}));

vi.mock("@/lib/webhook-deliver", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/webhook-deliver")>();
  return {
    ...actual,
    deliverWebhook: mocks.deliverWebhook,
  };
});

import {
  WEBHOOK_RETRY_SCHEDULE_MS,
  MAX_WEBHOOK_RETRIES,
  computeNextRetryDelayMs,
  computeNextAttemptAt,
} from "@/lib/webhook-deliver";
import {
  persistDeliveryResult,
  processWebhookRetryQueue,
} from "@/lib/webhook-delivery-service";
import { GET as cronGET, POST as cronPOST } from "@/app/api/cron/route";
import { GET as webhookCronGET } from "@/app/api/cron/webhooks/route";

const CRON_SECRET = "test-cron-secret-12345";
const NOW = new Date("2026-10-19T10:00:00.000Z");

describe("Exponential Backoff Calculation", () => {
  it("matches the required schedule: 1m -> 5m -> 15m -> 1h -> 4h", () => {
    expect(WEBHOOK_RETRY_SCHEDULE_MS).toEqual([
      60_000,
      300_000,
      900_000,
      3_600_000,
      14_400_000,
    ]);
    expect(MAX_WEBHOOK_RETRIES).toBe(5);

    expect(computeNextRetryDelayMs(1)).toBe(60_000); // 1m
    expect(computeNextRetryDelayMs(2)).toBe(300_000); // 5m
    expect(computeNextRetryDelayMs(3)).toBe(900_000); // 15m
    expect(computeNextRetryDelayMs(4)).toBe(3_600_000); // 1h
    expect(computeNextRetryDelayMs(5)).toBe(14_400_000); // 4h
  });

  it("returns null when attempts are out of bounds or exhausted", () => {
    expect(computeNextRetryDelayMs(0)).toBeNull();
    expect(computeNextRetryDelayMs(-1)).toBeNull();
    expect(computeNextRetryDelayMs(6)).toBeNull();
    expect(computeNextRetryDelayMs(10)).toBeNull();
  });

  it("computes nextAttemptAt properly from a given reference date", () => {
    const base = new Date("2026-10-19T10:00:00.000Z");
    const next1 = computeNextAttemptAt(1, base);
    expect(next1).toEqual(new Date("2026-10-19T10:01:00.000Z"));

    const next3 = computeNextAttemptAt(3, base);
    expect(next3).toEqual(new Date("2026-10-19T10:15:00.000Z"));

    const next5 = computeNextAttemptAt(5, base);
    expect(next5).toEqual(new Date("2026-10-19T14:00:00.000Z"));

    const next6 = computeNextAttemptAt(6, base);
    expect(next6).toBeNull();
  });
});

describe("persistDeliveryResult with Backoff Status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deliveryCreate.mockImplementation(async ({ data }) => ({
      id: "del_created",
      ...data,
    }));
  });

  it("records SUCCESS and null nextAttemptAt on successful delivery", async () => {
    await persistDeliveryResult("wh_1", "evt_1", {
      success: true,
      statusCode: 200,
      latencyMs: 15,
      attempts: 1,
    });

    expect(mocks.deliveryCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        webhookId: "wh_1",
        eventId: "evt_1",
        status: "SUCCESS",
        attempts: 1,
        responseCode: 200,
        nextAttemptAt: null,
      }),
    });
  });

  it("records RETRYING and nextAttemptAt when delivery fails under max retries", async () => {
    const before = Date.now();
    await persistDeliveryResult("wh_1", "evt_1", {
      success: false,
      statusCode: 503,
      latencyMs: 100,
      attempts: 1,
      errorMessage: "Service Unavailable",
    });
    const after = Date.now();

    expect(mocks.deliveryCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        webhookId: "wh_1",
        eventId: "evt_1",
        status: "RETRYING",
        attempts: 1,
        responseCode: 503,
        errorMessage: "Service Unavailable",
      }),
    });

    const callArg = mocks.deliveryCreate.mock.calls[0][0].data;
    expect(callArg.nextAttemptAt).toBeInstanceOf(Date);
    const scheduledTime = callArg.nextAttemptAt.getTime();
    expect(scheduledTime).toBeGreaterThanOrEqual(before + 60_000);
    expect(scheduledTime).toBeLessThanOrEqual(after + 60_000);
  });

  it("records DEAD_LETTER when failure happens at or above MAX_WEBHOOK_RETRIES", async () => {
    await persistDeliveryResult(
      "wh_1",
      "evt_1",
      {
        success: false,
        statusCode: 502,
        latencyMs: 120,
        attempts: 5,
        errorMessage: "Bad Gateway",
      },
      { attempts: 5 }
    );

    expect(mocks.deliveryCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        webhookId: "wh_1",
        eventId: "evt_1",
        status: "DEAD_LETTER",
        attempts: 5,
        responseCode: 502,
        nextAttemptAt: null,
      }),
    });
  });
});

describe("processWebhookRetryQueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sweeps through eligible RETRYING items and marks succeeded deliveries as SUCCESS", async () => {
    const mockDelivery = {
      id: "del_1",
      webhookId: "wh_1",
      eventId: "evt_1",
      attempts: 1,
      status: "RETRYING",
      webhook: {
        id: "wh_1",
        url: "https://example.com/webhook",
        secret: "whsec_test",
        isActive: true,
      },
      event: {
        id: "evt_1",
        event: "payment.created",
        timestamp: NOW,
        data: JSON.stringify({ amount: "100.00" }),
      },
    };

    mocks.deliveryFindMany.mockResolvedValue([mockDelivery]);
    mocks.deliverWebhook.mockResolvedValue({
      success: true,
      statusCode: 200,
      latencyMs: 45,
      attempts: 1,
    });
    mocks.deliveryUpdate.mockResolvedValue({ id: "del_1" });

    const summary = await processWebhookRetryQueue({ now: NOW });

    expect(summary.picked).toBe(1);
    expect(summary.succeeded).toBe(1);
    expect(summary.retried).toBe(0);
    expect(summary.deadLettered).toBe(0);

    expect(mocks.deliverWebhook).toHaveBeenCalledWith(
      "https://example.com/webhook",
      "whsec_test",
      expect.objectContaining({
        event: "payment.created",
      })
    );

    expect(mocks.deliveryUpdate).toHaveBeenCalledWith({
      where: { id: "del_1" },
      data: expect.objectContaining({
        status: "SUCCESS",
        attempts: 2,
        responseCode: 200,
        nextAttemptAt: null,
      }),
    });
  });

  it("updates RETRYING status with new backoff nextAttemptAt when retry fails but attempts remain", async () => {
    const mockDelivery = {
      id: "del_2",
      webhookId: "wh_2",
      eventId: "evt_2",
      attempts: 2, // Next will be attempt 3 -> 15m delay
      status: "RETRYING",
      webhook: {
        id: "wh_2",
        url: "https://example.com/fail-hook",
        secret: "whsec_test2",
        isActive: true,
      },
      event: {
        id: "evt_2",
        event: "payment.failed",
        timestamp: NOW,
        data: JSON.stringify({ error: "insufficient_funds" }),
      },
    };

    mocks.deliveryFindMany.mockResolvedValue([mockDelivery]);
    mocks.deliverWebhook.mockResolvedValue({
      success: false,
      statusCode: 500,
      latencyMs: 80,
      attempts: 1,
      errorMessage: "Internal Server Error",
    });
    mocks.deliveryUpdate.mockResolvedValue({ id: "del_2" });

    const summary = await processWebhookRetryQueue({ now: NOW });

    expect(summary.picked).toBe(1);
    expect(summary.succeeded).toBe(0);
    expect(summary.retried).toBe(1);
    expect(summary.deadLettered).toBe(0);

    expect(mocks.deliveryUpdate).toHaveBeenCalledWith({
      where: { id: "del_2" },
      data: expect.objectContaining({
        status: "RETRYING",
        attempts: 3,
        responseCode: 500,
        errorMessage: "Internal Server Error",
        nextAttemptAt: new Date(NOW.getTime() + 900_000), // 15m
      }),
    });
  });

  it("transitions to DEAD_LETTER when maximum attempts (5) are exhausted", async () => {
    const mockDelivery = {
      id: "del_3",
      webhookId: "wh_3",
      eventId: "evt_3",
      attempts: 4, // Next attempt will be 5 -> max reached
      status: "RETRYING",
      webhook: {
        id: "wh_3",
        url: "https://example.com/fail-hook-exhaust",
        secret: "whsec_test3",
        isActive: true,
      },
      event: {
        id: "evt_3",
        event: "payment.created",
        timestamp: NOW,
        data: JSON.stringify({}),
      },
    };

    mocks.deliveryFindMany.mockResolvedValue([mockDelivery]);
    mocks.deliverWebhook.mockResolvedValue({
      success: false,
      statusCode: 503,
      latencyMs: 90,
      attempts: 1,
      errorMessage: "Gateway Timeout",
    });
    mocks.deliveryUpdate.mockResolvedValue({ id: "del_3" });

    const summary = await processWebhookRetryQueue({ now: NOW });

    expect(summary.picked).toBe(1);
    expect(summary.succeeded).toBe(0);
    expect(summary.retried).toBe(0);
    expect(summary.deadLettered).toBe(1);

    expect(mocks.deliveryUpdate).toHaveBeenCalledWith({
      where: { id: "del_3" },
      data: expect.objectContaining({
        status: "DEAD_LETTER",
        attempts: 5,
        responseCode: 503,
        nextAttemptAt: null,
      }),
    });
  });

  it("marks as DEAD_LETTER when the destination webhook is disabled", async () => {
    const mockDelivery = {
      id: "del_4",
      webhookId: "wh_4",
      eventId: "evt_4",
      attempts: 1,
      status: "RETRYING",
      webhook: {
        id: "wh_4",
        url: "https://example.com/inactive",
        secret: "whsec_test4",
        isActive: false, // Inactive!
      },
      event: {
        id: "evt_4",
        event: "payment.created",
        timestamp: NOW,
        data: JSON.stringify({}),
      },
    };

    mocks.deliveryFindMany.mockResolvedValue([mockDelivery]);
    mocks.deliveryUpdate.mockResolvedValue({ id: "del_4" });

    const summary = await processWebhookRetryQueue({ now: NOW });

    expect(summary.picked).toBe(1);
    expect(summary.deadLettered).toBe(1);
    expect(mocks.deliverWebhook).not.toHaveBeenCalled();
    expect(mocks.deliveryUpdate).toHaveBeenCalledWith({
      where: { id: "del_4" },
      data: expect.objectContaining({
        status: "DEAD_LETTER",
        nextAttemptAt: null,
        errorMessage: "Webhook configuration is disabled",
      }),
    });
  });
});

describe("Cron Triggering for Webhook Retry Queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    mocks.deliveryFindMany.mockResolvedValue([]);
  });

  it("rejects unauthorized requests with 401", async () => {
    const req = new Request("https://ophirpay.test/api/cron?job=webhooks", {
      headers: { authorization: "Bearer wrong-secret" },
    });
    const res = await cronGET(req);
    expect(res.status).toBe(401);
  });

  it("triggers webhook retry queue via /api/cron?job=webhooks", async () => {
    const req = new Request("https://ophirpay.test/api/cron?job=webhooks", {
      headers: { "x-cron-secret": CRON_SECRET },
    });
    const res = await cronGET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data).toMatchObject({
      picked: 0,
      succeeded: 0,
      retried: 0,
      deadLettered: 0,
    });
    expect(mocks.deliveryFindMany).toHaveBeenCalled();
  });

  it("triggers webhook retry queue via POST /api/cron?job=webhooks", async () => {
    const req = new Request("https://ophirpay.test/api/cron?job=webhooks", {
      method: "POST",
      headers: { "x-cron-secret": CRON_SECRET },
    });
    const res = await cronPOST(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data).toMatchObject({
      picked: 0,
      succeeded: 0,
      retried: 0,
      deadLettered: 0,
    });
    expect(mocks.deliveryFindMany).toHaveBeenCalled();
  });


  it("triggers webhook retry queue via dedicated /api/cron/webhooks", async () => {
    const req = new Request("https://ophirpay.test/api/cron/webhooks", {
      headers: { "x-cron-secret": CRON_SECRET },
    });
    const res = await webhookCronGET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data).toMatchObject({
      picked: 0,
      succeeded: 0,
      retried: 0,
      deadLettered: 0,
    });
    expect(mocks.deliveryFindMany).toHaveBeenCalled();
  });
});
