// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const {
  mockDeliveryCreate,
  mockDeliveryFindMany,
  mockDeliveryUpdate,
  mockDeliverWebhook,
} = vi.hoisted(() => ({
  mockDeliveryCreate: vi.fn(),
  mockDeliveryFindMany: vi.fn(),
  mockDeliveryUpdate: vi.fn(),
  mockDeliverWebhook: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    webhookDelivery: {
      create: mockDeliveryCreate,
      findMany: mockDeliveryFindMany,
      update: mockDeliveryUpdate,
    },
  },
}));

vi.mock("@/lib/webhook-deliver", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/webhook-deliver")>();
  return {
    ...actual,
    deliverWebhook: mockDeliverWebhook,
  };
});

import {
  WEBHOOK_BACKOFF_SCHEDULE_MS,
  MAX_WEBHOOK_RETRY_ATTEMPTS,
  getNextWebhookRetryDelayMs,
  computeNextWebhookRetryAt,
  enqueueWebhookRetry,
  processWebhookRetryQueue,
} from "@/lib/webhook-delivery-service";
import { GET } from "@/app/api/cron/route";

const NOW = new Date("2026-08-28T12:00:00.000Z");

describe("webhook exponential backoff retry queue (#1288)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeliveryCreate.mockResolvedValue({ id: "del_retry_1" });
    mockDeliveryFindMany.mockResolvedValue([]);
    mockDeliveryUpdate.mockImplementation(async ({ where }) => ({ id: where.id }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("enforces the 1m -> 5m -> 15m -> 1h -> 4h exponential backoff schedule", () => {
    expect(WEBHOOK_BACKOFF_SCHEDULE_MS).toEqual([
      60_000,
      300_000,
      900_000,
      3_600_000,
      14_400_000,
    ]);
    expect(getNextWebhookRetryDelayMs(1)).toBe(60_000);
    expect(getNextWebhookRetryDelayMs(2)).toBe(300_000);
    expect(getNextWebhookRetryDelayMs(3)).toBe(900_000);
    expect(getNextWebhookRetryDelayMs(4)).toBe(3_600_000);
    expect(getNextWebhookRetryDelayMs(MAX_WEBHOOK_RETRY_ATTEMPTS)).toBeNull();
    expect(computeNextWebhookRetryAt(1, NOW)?.toISOString()).toBe("2026-08-28T12:01:00.000Z");
    expect(computeNextWebhookRetryAt(MAX_WEBHOOK_RETRY_ATTEMPTS, NOW)).toBeNull();
  });

  it("schedules failed deliveries for retry and marks DEAD_LETTER when max attempts are reached", async () => {
    const firstFailure = await enqueueWebhookRetry(
      "wh_1",
      "evt_1",
      {
        success: false,
        statusCode: 503,
        latencyMs: 250,
        attempts: 1,
        errorMessage: "HTTP 503",
      },
      { now: NOW }
    );

    expect(firstFailure.status).toBe("FAILED");
    expect(firstFailure.retryState).toBe("RETRYING");
    expect(firstFailure.attempts).toBe(1);
    expect(firstFailure.nextAttemptAt?.toISOString()).toBe("2026-08-28T12:01:00.000Z");

    const exhaustedFailure = await enqueueWebhookRetry(
      "wh_1",
      "evt_1",
      {
        success: false,
        statusCode: 502,
        latencyMs: 300,
        attempts: MAX_WEBHOOK_RETRY_ATTEMPTS,
        errorMessage: "HTTP 502",
      },
      { now: NOW }
    );

    expect(exhaustedFailure.status).toBe("DEAD_LETTER");
    expect(exhaustedFailure.retryState).toBe("DEAD_LETTER");
    expect(exhaustedFailure.nextAttemptAt).toBeNull();
  });

  it("processes due retries and transitions to SUCCESS, RETRYING, or DEAD_LETTER", async () => {
    mockDeliveryFindMany.mockResolvedValue([
      {
        id: "del_due_ok",
        webhookId: "wh_1",
        eventId: "evt_1",
        status: "FAILED",
        attempts: 1,
        deliveredAt: new Date(NOW.getTime() - 120_000), // 2m ago (due after 1m)
        createdAt: new Date(NOW.getTime() - 120_000),
        webhook: { id: "wh_1", url: "https://example.com/hook", secret: "sec", isActive: true },
        event: {
          id: "evt_1",
          event: "payment.completed",
          timestamp: NOW,
          data: '{"id":"pay_1"}',
        },
      },
      {
        id: "del_due_dead",
        webhookId: "wh_1",
        eventId: "evt_2",
        status: "FAILED",
        attempts: MAX_WEBHOOK_RETRY_ATTEMPTS - 1, // attempt 4 -> nextAttempt = 5 (exhausted)
        deliveredAt: new Date(NOW.getTime() - 4 * 3_600_000),
        createdAt: new Date(NOW.getTime() - 4 * 3_600_000),
        webhook: { id: "wh_1", url: "https://example.com/hook", secret: "sec", isActive: true },
        event: {
          id: "evt_2",
          event: "payment.failed",
          timestamp: NOW,
          data: '{"id":"pay_2"}',
        },
      },
    ]);

    mockDeliverWebhook
      .mockResolvedValueOnce({
        success: true,
        statusCode: 200,
        latencyMs: 45,
        attempts: 1,
      })
      .mockResolvedValueOnce({
        success: false,
        statusCode: 500,
        latencyMs: 120,
        attempts: 1,
        errorMessage: "HTTP 500",
      });

    const summary = await processWebhookRetryQueue({ now: NOW });

    expect(summary.picked).toBe(2);
    expect(summary.succeeded).toBe(1);
    expect(summary.deadLettered).toBe(1);
    expect(mockDeliveryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "del_due_ok" },
        data: expect.objectContaining({
          status: "SUCCESS",
          attempts: 2,
        }),
      })
    );
    expect(mockDeliveryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "del_due_dead" },
        data: expect.objectContaining({
          status: "DEAD_LETTER",
          attempts: MAX_WEBHOOK_RETRY_ATTEMPTS,
        }),
      })
    );
  });

  it("can be triggered via GET /api/cron?task=webhook-retries", async () => {
    vi.stubEnv("CRON_SECRET", "cron_secret_1288");
    mockDeliveryFindMany.mockResolvedValue([]);

    const res = await GET(
      new Request("https://ophirpay.test/api/cron?task=webhook-retries", {
        headers: { authorization: "Bearer cron_secret_1288" },
      })
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { picked: number; succeeded: number; retried: number; deadLettered: number };
    };
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      picked: 0,
      succeeded: 0,
      retried: 0,
      deadLettered: 0,
    });
  });
});
