// SPDX-License-Identifier: MIT
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  DEFAULT_CRON_LOG_RETENTION_DAYS,
  CRON_LOG_PRUNE_BATCH_SIZE,
  PRUNABLE_CRON_STATUSES,
  resolveCronLogRetentionDays,
  cronLogPruneCutoff,
  pruneExpiredCronLogs,
} from "@/lib/scheduler";
import {
  getMetricsSnapshot,
  resetMetricsForTest,
} from "@/lib/metrics-counters";

const {
  mockFindMany,
  mockUpdateMany,
  mockUpdate,
  mockDeleteMany,
  mockSyncFindMany,
  mockSyncDeleteMany,
  mockSubmitPaymentFromSecret,
  mockPublicKeyFromSecret,
} = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockUpdateMany: vi.fn(),
  mockUpdate: vi.fn(),
  mockDeleteMany: vi.fn(),
  mockSyncFindMany: vi.fn(),
  mockSyncDeleteMany: vi.fn(),
  mockSubmitPaymentFromSecret: vi.fn(),
  mockPublicKeyFromSecret: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    scheduledPayment: {
      findMany: mockFindMany,
      updateMany: mockUpdateMany,
      update: mockUpdate,
      deleteMany: mockDeleteMany,
    },
    paymentSyncRun: {
      findMany: mockSyncFindMany,
      deleteMany: mockSyncDeleteMany,
    },
  },
}));

vi.mock("@/lib/stellar", () => ({
  submitPaymentFromSecret: mockSubmitPaymentFromSecret,
  publicKeyFromSecret: mockPublicKeyFromSecret,
}));

vi.mock("@/lib/api-auth", () => ({
  authenticateRequest: vi.fn(async () => null),
}));

import { GET as runCron } from "@/app/api/cron/route";
import { GET as getMetrics } from "@/app/api/metrics/route";

const NOW = new Date("2026-10-17T12:00:00.000Z");
const CRON_SECRET = "test-cron-secret-0123456789";
const SOURCE_SECRET = "SBTESTSECRETKEYFORSCHEDULEDPAYMENTSXXXXXXXXXXXXXXXXX";
const SOURCE_PUBLIC = "GBTESTOPERATORACCOUNTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
const METRICS_TOKEN = "test-metrics-token-0123456789abcdef";

describe("Automated cron job log pruning (#1420)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    resetMetricsForTest();

    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    vi.stubEnv("SCHEDULED_PAYMENTS_SOURCE_SECRET", SOURCE_SECRET);
    vi.stubEnv("METRICS_TOKEN", METRICS_TOKEN);

    mockPublicKeyFromSecret.mockReturnValue(SOURCE_PUBLIC);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("resolves CRON_LOG_RETENTION_DAYS with 90-day default and validates custom values", () => {
    expect(resolveCronLogRetentionDays(undefined)).toBe(90);
    expect(resolveCronLogRetentionDays("")).toBe(90);
    expect(resolveCronLogRetentionDays("-10")).toBe(90);
    expect(resolveCronLogRetentionDays("invalid")).toBe(90);
    expect(resolveCronLogRetentionDays("30")).toBe(30);
    expect(DEFAULT_CRON_LOG_RETENTION_DAYS).toBe(90);
    expect(CRON_LOG_PRUNE_BATCH_SIZE).toBe(1000);
  });

  it("never includes SCHEDULED, PROCESSING, or FAILED statuses in PRUNABLE_CRON_STATUSES", () => {
    expect(PRUNABLE_CRON_STATUSES).toEqual(["EXECUTED", "CANCELLED"]);
    expect(PRUNABLE_CRON_STATUSES).not.toContain("SCHEDULED");
    expect(PRUNABLE_CRON_STATUSES).not.toContain("PROCESSING");
    expect(PRUNABLE_CRON_STATUSES).not.toContain("FAILED");
  });

  it("prunes completed logs older than cutoff in bounded batches of 1000", async () => {
    const mockDb = {
      scheduledPayment: {
        findMany: vi.fn().mockResolvedValue([{ id: "old-exec-1" }, { id: "old-exec-2" }]),
        deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
      paymentSyncRun: {
        findMany: vi.fn().mockResolvedValue([{ id: "old-sync-1" }]),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    const result = await pruneExpiredCronLogs(mockDb, {
      now: NOW,
      retentionDays: 90,
      batchSize: 1000,
    });

    const expectedCutoff = cronLogPruneCutoff(NOW, 90);
    expect(mockDb.scheduledPayment.findMany).toHaveBeenCalledWith({
      where: {
        status: { in: ["EXECUTED", "CANCELLED"] },
        updatedAt: { lt: expectedCutoff },
      },
      select: { id: true },
      orderBy: { updatedAt: "asc" },
      take: 1000,
    });
    expect(mockDb.scheduledPayment.deleteMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["old-exec-1", "old-exec-2"] },
        status: { in: ["EXECUTED", "CANCELLED"] },
      },
    });
    expect(mockDb.paymentSyncRun.findMany).toHaveBeenCalledWith({
      where: {
        status: "success",
        completedAt: { lt: expectedCutoff },
      },
      select: { id: true },
      orderBy: { completedAt: "asc" },
      take: 998,
    });
    expect(result).toEqual({
      prunedCount: 3,
      scheduledPaymentsPruned: 2,
      syncRunsPruned: 1,
      retentionDays: 90,
      cutoff: expectedCutoff.toISOString(),
    });
  });

  it("emits cron_logs_pruned_total counter and reports prunedLogs on GET /api/cron", async () => {
    // First call: candidateWhere (no due payments); second call: pruneExpiredCronLogs
    mockFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "hist-1" }, { id: "hist-2" }, { id: "hist-3" }]);
    mockDeleteMany.mockResolvedValueOnce({ count: 3 });
    mockSyncFindMany.mockResolvedValueOnce([{ id: "sync-1" }]);
    mockSyncDeleteMany.mockResolvedValueOnce({ count: 1 });

    const res = await runCron(
      new Request("https://ophirpay.test/api/cron", {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.prunedLogs).toBe(4);

    // Verify Prometheus counter incremented and exposed on /api/metrics
    expect(getMetricsSnapshot().cron_logs_pruned_total).toBe(4);

    const metricsRes = await getMetrics(
      new Request("http://localhost/api/metrics", {
        headers: { authorization: `Bearer ${METRICS_TOKEN}` },
      })
    );
    const metricsText = await metricsRes.text();
    expect(metricsText).toContain("# TYPE cron_logs_pruned_total counter");
    expect(metricsText).toContain("cron_logs_pruned_total 4");
  });
});
