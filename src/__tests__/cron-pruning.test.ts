import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  pruneExpiredCronLogs,
  CRON_LOG_RETENTION_DAYS,
  PRUNE_BATCH_SIZE,
} from "@/app/api/cron/route";
import {
  getCronLogsPrunedTotal,
  resetMetricsForTest,
} from "@/lib/metrics-counters";

interface MockCronRecord {
  id: string;
  createdAt: Date;
}

describe("cron-pruning (Issue #1420)", () => {
  beforeEach(() => {
    resetMetricsForTest();
    vi.restoreAllMocks();
  });

  it("exports correct default retention window and batch size constants", () => {
    expect(CRON_LOG_RETENTION_DAYS).toBe(90);
    expect(PRUNE_BATCH_SIZE).toBe(1000);
  });

  it("prunes logs older than 90 days in batches of 1,000 inside a transaction", async () => {
    const now = Date.now();
    const oldDate = new Date(now - 95 * 24 * 60 * 60 * 1000);
    const recentDate = new Date(now - 10 * 24 * 60 * 60 * 1000);

    // Mock store containing 1,500 old records and 200 recent records
    const records: MockCronRecord[] = [];
    for (let i = 1; i <= 1500; i++) {
      records.push({ id: `old-log-${i}`, createdAt: oldDate });
    }
    for (let i = 1; i <= 200; i++) {
      records.push({ id: `recent-log-${i}`, createdAt: recentDate });
    }

    const deleteCalls: string[][] = [];

    const mockPrisma = {
      cronRunLog: {
        findMany: vi.fn().mockImplementation(({ where, take }: {
          where: { createdAt: { lt: Date } };
          take: number;
        }) => {
          const eligible = records.filter((r) => r.createdAt < where.createdAt.lt);
          return Promise.resolve(eligible.slice(0, take).map((r) => ({ id: r.id })));
        }),
        deleteMany: vi.fn().mockImplementation(({ where }: { where: { id: { in: string[] } } }) => {
          deleteCalls.push(where.id.in);
          // Remove deleted from records
          const set = new Set(where.id.in);
          for (let i = records.length - 1; i >= 0; i--) {
            if (set.has(records[i].id)) {
              records.splice(i, 1);
            }
          }
          return Promise.resolve({ count: where.id.in.length });
        }),
      },
      scheduledPayment: {
        delete: vi.fn(),
        deleteMany: vi.fn(),
      },
      recurrence: {
        delete: vi.fn(),
        deleteMany: vi.fn(),
      },
      $transaction: vi.fn().mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
        return cb(mockPrisma);
      }),
    };

    const initialCounter = getCronLogsPrunedTotal();
    const result = await pruneExpiredCronLogs(mockPrisma, { batchSize: 1000 });

    expect(result.prunedCount).toBe(1500);
    expect(result.batchesExecuted).toBe(2); // 1000 in first batch, 500 in second
    expect(deleteCalls).toHaveLength(2);
    expect(deleteCalls[0]).toHaveLength(1000);
    expect(deleteCalls[1]).toHaveLength(500);

    // Ensure recent records were NOT deleted
    expect(records).toHaveLength(200);
    expect(records.every((r) => r.createdAt >= result.cutoffDate)).toBe(true);

    // Ensure core schedules and payment entities were NEVER touched
    expect(mockPrisma.scheduledPayment.delete).not.toHaveBeenCalled();
    expect(mockPrisma.scheduledPayment.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.recurrence.delete).not.toHaveBeenCalled();
    expect(mockPrisma.recurrence.deleteMany).not.toHaveBeenCalled();

    // Verify Prometheus metric incremented
    expect(getCronLogsPrunedTotal()).toBe(initialCounter + 1500);
  });

  it("respects dryRun flag and skips deletion", async () => {
    const mockPrisma = {
      cronRunLog: {
        findMany: vi.fn().mockResolvedValue([{ id: "old-1" }, { id: "old-2" }]),
        deleteMany: vi.fn(),
      },
      $transaction: vi.fn(),
    };

    const result = await pruneExpiredCronLogs(mockPrisma, { dryRun: true });
    expect(result.prunedCount).toBe(2);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.cronRunLog.deleteMany).not.toHaveBeenCalled();
    expect(getCronLogsPrunedTotal()).toBe(0);
  });

  it("handles empty database gracefully without throwing", async () => {
    const mockPrisma = {
      cronRunLog: {
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn(),
      },
      $transaction: vi.fn(),
    };

    const result = await pruneExpiredCronLogs(mockPrisma);
    expect(result.prunedCount).toBe(0);
    expect(result.batchesExecuted).toBe(0);
    expect(mockPrisma.cronRunLog.deleteMany).not.toHaveBeenCalled();
  });
});
