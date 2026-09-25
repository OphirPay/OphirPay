// SPDX-License-Identifier: MIT

// Dead-letter flow for exhausted webhook deliveries (issue #806):
// distinct timeout failure reason, explicit dead-letter transition with
// metrics, and bulk redelivery limited to dead-lettered rows.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/webhook-url-guard", () => ({
  isSafeWebhookUrlAtDelivery: vi.fn(async () => true),
}));

const updateMock = vi.fn();
const findUniqueMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  default: {
    webhookDelivery: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      update: (...args: unknown[]) => updateMock(...args),
    },
  },
}));

import { deliverWebhook } from "@/lib/webhook-deliver";
import { moveToDeadLetter } from "@/lib/webhook-delivery-service";
import {
  getMetricsSnapshot,
  resetMetricsForTest,
} from "@/lib/metrics-counters";

const payload = {
  event: "payment.created",
  timestamp: "2026-09-24T00:00:00Z",
  data: { id: "p_1" },
};

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.restoreAllMocks();
  resetMetricsForTest();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("deliverWebhook failure reasons", () => {
  it("reports a distinct timeout reason when the receiver hangs", async () => {
    globalThis.fetch = vi.fn().mockImplementation(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          const onAbort = () => {
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
          };
          if (init?.signal?.aborted) onAbort();
          else init?.signal?.addEventListener("abort", onAbort, { once: true });
        }),
    ) as unknown as typeof fetch;

    const result = await deliverWebhook(
      "https://example.com/hook",
      "secret",
      payload,
      1,
      { timeoutMs: 30 },
    );

    expect(result.success).toBe(false);
    expect(result.failureReason).toBe("timeout");
    expect(result.errorMessage).toMatch(/timed out after 30ms/);
  });

  it("reports http reason for provider rejections", async () => {
    const fetchStub = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 400 });
    globalThis.fetch = fetchStub as unknown as typeof fetch;

    const result = await deliverWebhook(
      "https://example.com/hook",
      "secret",
      payload,
      1,
      { timeoutMs: 1000 },
    );

    expect(result.success).toBe(false);
    expect(result.failureReason).toBe("http");
    expect(result.statusCode).toBe(400);
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });
});

describe("moveToDeadLetter", () => {
  it("transitions a FAILED row and records the metric", async () => {
    findUniqueMock.mockResolvedValue({ id: "d1", status: "FAILED" });
    updateMock.mockResolvedValue({});

    await moveToDeadLetter("d1", "Delivery timed out on all 3 attempts");

    expect(updateMock).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: {
        status: "DEAD_LETTERED",
        deadLetterReason: "Delivery timed out on all 3 attempts",
        deadLetteredAt: expect.any(Date),
      },
    });
    expect(getMetricsSnapshot().webhooks_dead_lettered_total).toBe(1);
  });

  it("is idempotent for already dead-lettered rows", async () => {
    findUniqueMock.mockResolvedValue({ id: "d1", status: "DEAD_LETTERED" });
    updateMock.mockClear();

    await moveToDeadLetter("d1", "again");

    expect(updateMock).not.toHaveBeenCalled();
    expect(getMetricsSnapshot().webhooks_dead_lettered_total).toBe(0);
  });

  it("ignores unknown delivery ids", async () => {
    findUniqueMock.mockResolvedValue(null);
    updateMock.mockClear();

    await moveToDeadLetter("nope", "reason");

    expect(updateMock).not.toHaveBeenCalled();
  });
});
