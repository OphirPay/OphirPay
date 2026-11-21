// SPDX-License-Identifier: MIT

import { beforeEach,describe, expect, it, vi } from "vitest";

const { mockIdempotencyKey } = vi.hoisted(() => {
  const mockIdempotencyKey = {
    deleteMany: vi.fn(),
    findMany: vi.fn(),
  };
  return { mockIdempotencyKey };
});

vi.mock("@/lib/prisma", () => ({
  default: {
    idempotencyKey: mockIdempotencyKey,
  },
}));

import {
  cleanupExpiredIdempotencyKeys,
  IDEMPOTENCY_CLEANUP_BATCH_SIZE,
  IDEMPOTENCY_RETENTION_DAYS,
} from "@/lib/db/cleanup";
import { getMetricsSnapshot, resetMetricsForTest } from "@/lib/metrics-counters";

describe("Idempotency Key Cleanup Routine (Issue #2025)", () => {
  beforeEach(() => {
    resetMetricsForTest();
    vi.clearAllMocks();
  });

  it("defines default retention of 7 days and batch size of 1000", () => {
    expect(IDEMPOTENCY_RETENTION_DAYS).toBe(7);
    expect(IDEMPOTENCY_CLEANUP_BATCH_SIZE).toBe(1000);
  });

  it("deletes expired idempotency keys where expiresAt < now and increments metric", async () => {
    const now = new Date("2026-11-18T12:00:00Z");

    mockIdempotencyKey.deleteMany.mockResolvedValueOnce({ count: 42 });

    const result = await cleanupExpiredIdempotencyKeys({ now });

    expect(mockIdempotencyKey.deleteMany).toHaveBeenCalledTimes(1);
    expect(mockIdempotencyKey.deleteMany).toHaveBeenCalledWith({
      where: {
        expiresAt: {
          lt: now,
        },
      },
    });

    expect(result.deletedCount).toBe(42);
    expect(result.batches).toBe(1);
    expect(result.cutoff).toEqual(now);

    const metrics = getMetricsSnapshot();
    expect(metrics.idempotency_keys_pruned_total).toBe(42);
  });

  it("preserves active keys and returns zero deletions when no keys are expired", async () => {
    const now = new Date("2026-11-18T12:00:00Z");

    mockIdempotencyKey.deleteMany.mockResolvedValueOnce({ count: 0 });

    const result = await cleanupExpiredIdempotencyKeys({ now });

    expect(result.deletedCount).toBe(0);
    expect(result.batches).toBe(0);

    const metrics = getMetricsSnapshot();
    expect(metrics.idempotency_keys_pruned_total).toBe(0);
  });

  it("uses current time as default cutoff when now is not provided", async () => {
    mockIdempotencyKey.deleteMany.mockResolvedValueOnce({ count: 5 });

    const before = new Date();
    const result = await cleanupExpiredIdempotencyKeys();
    const after = new Date();

    expect(mockIdempotencyKey.deleteMany).toHaveBeenCalledTimes(1);
    expect(result.cutoff.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(result.cutoff.getTime()).toBeLessThanOrEqual(after.getTime());
    expect(result.deletedCount).toBe(5);
  });
});
