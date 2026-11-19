// SPDX-License-Identifier: MIT
/**
 * @vitest-environment node
 *
 * Webhook delivery retries: persisted RETRYING rows are drained by the cron
 * processor on the documented 1m → 5m → 15m → 1h → 4h schedule, and the fifth
 * failed retry dead-letters the delivery.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    webhookDelivery: {
      findMany: mocks.findMany,
      update: mocks.update,
    },
  },
}));

import {
  deliveryStatusAfterFailure,
  nextWebhookAttemptAt,
  webhookRetryDelayMs,
  WEBHOOK_MAX_RETRIES,
  WEBHOOK_RETRY_BACKOFF_MS,
} from "@/lib/webhook-deliver";
import { processWebhookRetryQueue } from "@/lib/webhook-delivery-service";

const NOW = new Date("2026-10-20T00:00:00.000Z");

function dueRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "del_1",
    webhookId: "wh_1",
    eventId: "evt_1",
    status: "RETRYING",
    retryCount: 0,
    nextAttemptAt: NOW,
    attempts: 3,
    webhook: { id: "wh_1", url: "https://example.com/hook", secret: "s3cret" },
    event: {
      id: "evt_1",
      event: "payment.created",
      timestamp: new Date("2026-10-19T23:59:00.000Z"),
      data: JSON.stringify({ paymentId: "p_1" }),
    },
    ...overrides,
  };
}

const failed = {
  success: false,
  statusCode: 503,
  latencyMs: 12,
  attempts: 1,
  errorMessage: "HTTP 503",
};

beforeEach(() => {
  mocks.findMany.mockReset();
  mocks.update.mockReset();
  mocks.update.mockResolvedValue({});
});

describe("webhook retry schedule", () => {
  it("uses 1m → 5m → 15m → 1h → 4h", () => {
    expect([...WEBHOOK_RETRY_BACKOFF_MS]).toEqual([
      60_000,
      300_000,
      900_000,
      3_600_000,
      14_400_000,
    ]);
    expect(WEBHOOK_MAX_RETRIES).toBe(5);
  });

  it("returns the delay for each completed retry and null when exhausted", () => {
    expect(webhookRetryDelayMs(0)).toBe(60_000);
    expect(webhookRetryDelayMs(1)).toBe(300_000);
    expect(webhookRetryDelayMs(2)).toBe(900_000);
    expect(webhookRetryDelayMs(3)).toBe(3_600_000);
    expect(webhookRetryDelayMs(4)).toBe(14_400_000);
    expect(webhookRetryDelayMs(5)).toBeNull();
  });

  it("computes the absolute next attempt time from the schedule", () => {
    expect(nextWebhookAttemptAt(0, NOW)?.toISOString()).toBe(
      "2026-10-20T00:01:00.000Z"
    );
    expect(nextWebhookAttemptAt(4, NOW)?.toISOString()).toBe(
      "2026-10-20T04:00:00.000Z"
    );
    expect(nextWebhookAttemptAt(5, NOW)).toBeNull();
  });

  it("dead-letters only once the schedule is exhausted", () => {
    expect(deliveryStatusAfterFailure(0)).toBe("RETRYING");
    expect(deliveryStatusAfterFailure(4)).toBe("RETRYING");
    expect(deliveryStatusAfterFailure(5)).toBe("DEAD_LETTER");
  });
});

describe("processWebhookRetryQueue", () => {
  it("selects only due RETRYING rows, oldest first", async () => {
    mocks.findMany.mockResolvedValue([]);

    const summary = await processWebhookRetryQueue({ now: NOW, deliver: vi.fn() });

    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: "RETRYING",
          nextAttemptAt: { lte: NOW },
        },
        orderBy: { nextAttemptAt: "asc" },
      })
    );
    expect(summary.scanned).toBe(0);
  });

  it("reschedules a failure on the next backoff step", async () => {
    mocks.findMany.mockResolvedValue([dueRow({ retryCount: 0 })]);
    const deliver = vi.fn().mockResolvedValue(failed);

    const summary = await processWebhookRetryQueue({ now: NOW, deliver });

    expect(deliver).toHaveBeenCalledWith(
      "https://example.com/hook",
      "s3cret",
      expect.objectContaining({ event: "payment.created" }),
      1
    );
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "del_1" },
      data: expect.objectContaining({
        status: "RETRYING",
        retryCount: 1,
        // Retry #1 just failed → the next wait is 5 minutes.
        nextAttemptAt: new Date("2026-10-20T00:05:00.000Z"),
        lastAttemptAt: NOW,
        attempts: 1,
        responseCode: 503,
        errorMessage: "HTTP 503",
      }),
    });
    expect(summary.rescheduled).toBe(1);
    expect(summary.deadLettered).toBe(0);
  });

  it("progresses through the full schedule across runs", async () => {
    const deliver = vi.fn().mockResolvedValue(failed);
    let row = dueRow({ retryCount: 0 });
    mocks.findMany.mockImplementation(async () => [row]);

    for (let i = 0; i < 5; i++) {
      await processWebhookRetryQueue({ now: NOW, deliver });
      const data = mocks.update.mock.calls.at(-1)![0].data as {
        retryCount: number;
        status: string;
        nextAttemptAt: Date | null;
      };
      row = dueRow({
        retryCount: data.retryCount,
        nextAttemptAt: data.nextAttemptAt,
      });
      expect(data.retryCount).toBe(i + 1);
      expect(data.status).toBe(i === 4 ? "DEAD_LETTER" : "RETRYING");
    }

    const last = mocks.update.mock.calls.at(-1)![0].data as {
      nextAttemptAt: Date | null;
    };
    expect(last.nextAttemptAt).toBeNull();
  });

  it("marks a successful retry SUCCESS and clears the queue fields", async () => {
    mocks.findMany.mockResolvedValue([dueRow({ retryCount: 2 })]);
    const deliver = vi.fn().mockResolvedValue({
      success: true,
      statusCode: 200,
      latencyMs: 8,
      attempts: 1,
    });

    const summary = await processWebhookRetryQueue({ now: NOW, deliver });

    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "del_1" },
      data: expect.objectContaining({
        status: "SUCCESS",
        retryCount: 3,
        nextAttemptAt: null,
      }),
    });
    expect(summary.delivered).toBe(1);
  });

  it("counts an errored row and keeps processing the batch", async () => {
    mocks.findMany.mockResolvedValue([
      dueRow({ id: "del_boom" }),
      dueRow({ id: "del_ok" }),
    ]);
    const deliver = vi
      .fn()
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockResolvedValueOnce(failed);

    const summary = await processWebhookRetryQueue({ now: NOW, deliver });

    expect(summary.scanned).toBe(2);
    expect(summary.errors).toBe(1);
    expect(summary.rescheduled).toBe(1);
  });

  it("returns an empty summary instead of throwing when the queue read fails", async () => {
    mocks.findMany.mockRejectedValue(new Error("db down"));

    const summary = await processWebhookRetryQueue({ now: NOW, deliver: vi.fn() });

    expect(summary).toEqual({
      scanned: 0,
      delivered: 0,
      rescheduled: 0,
      deadLettered: 0,
      errors: 1,
    });
  });
});
