// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  pruneCronExecutionLogs,
  recordCronExecution,
  CRON_LOG_RETENTION_DAYS,
  PRUNE_BATCH_SIZE,
} from "@/lib/cron-pruner";
import { getMetricsSnapshot, resetMetricsForTest } from "@/lib/metrics-counters";

const mockFindMany = vi.fn();
const mockDeleteMany = vi.fn();
const mockCreate = vi.fn();
const mockTransaction = vi.fn((operations) => Promise.all(operations));

const mockRecurrenceDeleteMany = vi.fn();
const mockScheduledPaymentDeleteMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  default: {
    cronExecutionLog: {
      findMany: (...args: any[]) => mockFindMany(...args),
      deleteMany: (...args: any[]) => mockDeleteMany(...args),
      create: (...args: any[]) => mockCreate(...args),
    },
    recurrence: {
      deleteMany: (...args: any[]) => mockRecurrenceDeleteMany(...args),
    },
    scheduledPayment: {
      deleteMany: (...args: any[]) => mockScheduledPaymentDeleteMany(...args),
    },
    $transaction: (operations: any) => mockTransaction(operations),
  },
}));

describe("Cron Execution Log Retention & Pruning (Issue #1420)", () => {
  const BASE_TIME = new Date("2026-10-16T12:00:00.000Z");

  beforeEach(() => {
    vi.clearAllMocks();
    resetMetricsForTest();
  });

  it("calculates the correct 90-day retention cutoff date", async () => {
    mockFindMany.mockResolvedValueOnce([]);

    const result = await pruneCronExecutionLogs({ now: BASE_TIME });

    expect(mockFindMany).toHaveBeenCalledTimes(1);
    const expectedCutoff = new Date(
      BASE_TIME.getTime() - CRON_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000
    );
    expect(result.cutoff.getTime()).toBe(expectedCutoff.getTime());
    expect(result.prunedCount).toBe(0);
    expect(result.batchesExecuted).toBe(0);
  });

  it("prunes stale logs in batches of 1,000 inside a transaction", async () => {
    const batch1 = Array.from({ length: 1_000 }, (_, i) => ({ id: `log-${i}` }));
    const batch2 = Array.from({ length: 350 }, (_, i) => ({ id: `log-${1000 + i}` }));

    mockFindMany
      .mockResolvedValueOnce(batch1)
      .mockResolvedValueOnce(batch2);

    mockDeleteMany.mockResolvedValue({ count: 1 });

    const result = await pruneCronExecutionLogs({ now: BASE_TIME, batchSize: 1_000 });

    expect(mockFindMany).toHaveBeenCalledTimes(2);
    expect(mockFindMany).toHaveBeenNthCalledWith(1, {
      where: { createdAt: { lt: expect.any(Date) } },
      select: { id: true },
      take: 1_000,
    });

    expect(mockTransaction).toHaveBeenCalledTimes(2);
    expect(result.prunedCount).toBe(1_350);
    expect(result.batchesExecuted).toBe(2);

    // Verify Prometheus metric incremented accurately
    const metrics = getMetricsSnapshot();
    expect(metrics.cron_logs_pruned_total).toBe(1_350);
  });

  it("never deletes or touches active payment schedules (Recurrence or ScheduledPayment)", async () => {
    mockFindMany.mockResolvedValueOnce([{ id: "stale-1" }]);
    mockDeleteMany.mockResolvedValue({ count: 1 });

    await pruneCronExecutionLogs({ now: BASE_TIME });

    expect(mockRecurrenceDeleteMany).not.toHaveBeenCalled();
    expect(mockScheduledPaymentDeleteMany).not.toHaveBeenCalled();
  });

  it("records cron execution cycles via recordCronExecution", async () => {
    mockCreate.mockResolvedValueOnce({ id: "new-cuid" });

    await recordCronExecution({
      runId: "run-abc-123",
      picked: 5,
      executed: 4,
      failed: 1,
      skipped: 0,
      durationMs: 42,
    });

    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        runId: "run-abc-123",
        picked: 5,
        executed: 4,
        failed: 1,
        skipped: 0,
        durationMs: 42,
        error: undefined,
        createdAt: expect.any(Date),
      },
    });
  });

  it("handles empty database without throwing or incrementing metric", async () => {
    mockFindMany.mockResolvedValueOnce([]);

    const result = await pruneCronExecutionLogs({ now: BASE_TIME });

    expect(result.prunedCount).toBe(0);
    expect(mockDeleteMany).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(getMetricsSnapshot().cron_logs_pruned_total).toBe(0);
  });
});
