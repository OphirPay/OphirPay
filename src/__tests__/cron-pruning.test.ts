// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "@/lib/prisma";
import {
  pruneCronExecutionLogs,
  CRON_LOG_RETENTION_DAYS,
  CRON_LOG_PRUNE_BATCH_SIZE,
} from "@/app/api/cron/route";
import { getMetricsSnapshot, resetMetricsForTest } from "@/lib/metrics-counters";

describe("Cron Job Log Pruning (Issue #1420)", () => {
  beforeEach(() => {
    resetMetricsForTest();
    vi.clearAllMocks();
  });

  it("configures a 90-day retention window and batch size of 1,000", () => {
    expect(CRON_LOG_RETENTION_DAYS).toBe(90);
    expect(CRON_LOG_PRUNE_BATCH_SIZE).toBe(1000);
  });

  it("prunes logs older than 90 days in bounded batches and increments Prometheus metric", async () => {
    const now = new Date("2026-10-20T12:00:00Z");
    const ninetyOneDaysAgo = new Date("2026-07-20T12:00:00Z");

    const mockOldLogs = [
      { id: "log-1", createdAt: ninetyOneDaysAgo },
      { id: "log-2", createdAt: ninetyOneDaysAgo },
      { id: "log-3", createdAt: ninetyOneDaysAgo },
    ];

    let findManyCalls = 0;
    vi.spyOn(prisma.cronExecutionLog, "findMany").mockImplementation((async (args?: { take?: number }) => {
      findManyCalls += 1;
      // First call returns logs, second call returns empty (all pruned)
      if (findManyCalls === 1) {
        expect(args?.take).toBe(2);
        return mockOldLogs.slice(0, 2);
      }
      if (findManyCalls === 2) {
        return mockOldLogs.slice(2, 3);
      }
      return [];
    }) as unknown as typeof prisma.cronExecutionLog.findMany);

    const deletedIds: string[] = [];
    vi.spyOn(prisma, "$transaction").mockImplementation((async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        cronExecutionLog: {
          deleteMany: async (args: { where: { id: { in: string[] } } }) => {
            const inIds = args.where.id.in;
            deletedIds.push(...inIds);
            return { count: inIds.length };
          },
        },
      };
      return fn(tx);
    }) as unknown as typeof prisma.$transaction);

    const result = await pruneCronExecutionLogs({
      retentionDays: 90,
      batchSize: 2,
      now,
    });

    expect(result.prunedCount).toBe(3);
    expect(result.batches).toBe(2);
    expect(deletedIds).toEqual(["log-1", "log-2", "log-3"]);

    // Verify Prometheus counter was incremented
    const metrics = getMetricsSnapshot();
    expect(metrics.cron_logs_pruned_total).toBe(3);
  });

  it("returns zero and does not execute delete when no logs are older than 90 days", async () => {
    const now = new Date("2026-10-20T12:00:00Z");

    vi.spyOn(prisma.cronExecutionLog, "findMany").mockResolvedValue([]);
    const deleteManySpy = vi.spyOn(prisma.cronExecutionLog, "deleteMany");

    const result = await pruneCronExecutionLogs({ now });

    expect(result.prunedCount).toBe(0);
    expect(result.batches).toBe(0);
    expect(deleteManySpy).not.toHaveBeenCalled();

    const metrics = getMetricsSnapshot();
    expect(metrics.cron_logs_pruned_total).toBe(0);
  });

  it("ensures ScheduledPayment and Recurrence records are never queried or deleted by pruning", async () => {
    const scheduledPaymentDeleteSpy = vi.spyOn(prisma.scheduledPayment, "deleteMany");
    const recurrenceDeleteSpy = vi.spyOn(prisma.recurrence, "deleteMany");

    vi.spyOn(prisma.cronExecutionLog, "findMany").mockResolvedValue([]);

    await pruneCronExecutionLogs();

    expect(scheduledPaymentDeleteSpy).not.toHaveBeenCalled();
    expect(recurrenceDeleteSpy).not.toHaveBeenCalled();
  });
});
