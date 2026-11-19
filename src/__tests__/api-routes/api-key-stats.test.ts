// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/prisma";
import { GET as getStats } from "@/app/api/keys/stats/route";
import { getAuthContext } from "@/lib/auth-session";
import {
  pruneApiKeyRequestLogs,
  API_KEY_LOG_RETENTION_DAYS,
  API_KEY_LOG_PRUNE_BATCH_SIZE,
} from "@/app/api/cron/route";
import {
  getMetricsSnapshot,
  resetMetricsForTest,
} from "@/lib/metrics-counters";

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: vi.fn(),
}));

describe("ApiKeyRequestLog Stats and Retention Pruning (Issue #1830)", () => {
  beforeEach(() => {
    resetMetricsForTest();
    vi.clearAllMocks();
  });

  describe("GET /api/keys/stats Windowed Query", () => {
    it("returns 401 when authentication is missing", async () => {
      vi.mocked(getAuthContext).mockResolvedValue(null);
      const req = new Request("http://localhost/api/keys/stats?window=30d");
      const res = await getStats(req);
      expect(res.status).toBe(401);
    });

    it("rejects invalid window values with 400", async () => {
      vi.mocked(getAuthContext).mockResolvedValue({
        userId: "user-1",
        email: "test@example.com",
      } as unknown as Awaited<ReturnType<typeof getAuthContext>>);

      const req = new Request("http://localhost/api/keys/stats?window=invalid");
      const res = await getStats(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain("Window must be 24h, 7d, or 30d");
    });

    it("constrains request logs query to createdAt >= since for requested window", async () => {
      vi.mocked(getAuthContext).mockResolvedValue({
        userId: "user-1",
        email: "test@example.com",
      } as unknown as Awaited<ReturnType<typeof getAuthContext>>);

      const mockKeys = [
        {
          id: "key-1",
          name: "Production Key",
          prefix: "oph_prod",
          lastUsed: new Date("2026-10-20T10:00:00Z"),
          createdAt: new Date("2026-09-01T00:00:00Z"),
          expiresAt: null,
        },
      ];

      vi.spyOn(prisma.apiKey, "findMany").mockResolvedValue(mockKeys as unknown as Awaited<ReturnType<typeof prisma.apiKey.findMany>>);

      let capturedWhere: Record<string, unknown> | undefined;
      vi.spyOn(prisma.apiKeyRequestLog, "findMany").mockImplementation((async (args?: { where?: Record<string, unknown> }) => {
        capturedWhere = args?.where;
        return [
          { keyId: "key-1", createdAt: new Date() },
        ];
      }) as unknown as typeof prisma.apiKeyRequestLog.findMany);

      const req = new Request("http://localhost/api/keys/stats?window=7d");
      const res = await getStats(req);
      expect(res.status).toBe(200);

      expect(capturedWhere).toBeDefined();
      expect(capturedWhere?.key).toEqual({ userId: "user-1" });
      expect(capturedWhere?.createdAt).toBeDefined();
      expect((capturedWhere?.createdAt as { gte: Date }).gte).toBeInstanceOf(Date);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.window).toBe("7d");
      expect(body.data.keys[0].id).toBe("key-1");
      expect(body.data.keys[0].window).toBe(1);
    });
  });

  describe("pruneApiKeyRequestLogs Retention Pruning", () => {
    it("configures a 90-day retention window and batch size of 1,000", () => {
      expect(API_KEY_LOG_RETENTION_DAYS).toBe(90);
      expect(API_KEY_LOG_PRUNE_BATCH_SIZE).toBe(1000);
    });

    it("prunes logs older than 90 days in bounded batches and increments api_key_logs_pruned_total", async () => {
      const now = new Date("2026-10-21T12:00:00Z");
      const ninetyOneDaysAgo = new Date("2026-07-21T12:00:00Z");

      const mockOldLogs = [
        { id: "req-log-1", createdAt: ninetyOneDaysAgo },
        { id: "req-log-2", createdAt: ninetyOneDaysAgo },
        { id: "req-log-3", createdAt: ninetyOneDaysAgo },
      ];

      let findManyCalls = 0;
      vi.spyOn(prisma.apiKeyRequestLog, "findMany").mockImplementation((async (args?: { take?: number }) => {
        findManyCalls += 1;
        if (findManyCalls === 1) {
          expect(args?.take).toBe(2);
          return mockOldLogs.slice(0, 2);
        }
        if (findManyCalls === 2) {
          return mockOldLogs.slice(2, 3);
        }
        return [];
      }) as unknown as typeof prisma.apiKeyRequestLog.findMany);

      const deletedIds: string[] = [];
      vi.spyOn(prisma, "$transaction").mockImplementation((async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          apiKeyRequestLog: {
            deleteMany: async (args: { where: { id: { in: string[] } } }) => {
              const inIds = args.where.id.in;
              deletedIds.push(...inIds);
              return { count: inIds.length };
            },
          },
        };
        return fn(tx);
      }) as unknown as typeof prisma.$transaction);

      const result = await pruneApiKeyRequestLogs({
        retentionDays: 90,
        batchSize: 2,
        now,
      });

      expect(result.prunedCount).toBe(3);
      expect(result.batches).toBe(2);
      expect(deletedIds).toEqual(["req-log-1", "req-log-2", "req-log-3"]);

      // Verify Prometheus counter was incremented
      const metrics = getMetricsSnapshot();
      expect(metrics.api_key_logs_pruned_total).toBe(3);
    });

    it("returns zero when no records are older than retention cutoff", async () => {
      const now = new Date("2026-10-21T12:00:00Z");

      vi.spyOn(prisma.apiKeyRequestLog, "findMany").mockResolvedValue([]);
      const deleteManySpy = vi.spyOn(prisma.apiKeyRequestLog, "deleteMany");

      const result = await pruneApiKeyRequestLogs({ now });

      expect(result.prunedCount).toBe(0);
      expect(result.batches).toBe(0);
      expect(deleteManySpy).not.toHaveBeenCalled();

      const metrics = getMetricsSnapshot();
      expect(metrics.api_key_logs_pruned_total).toBe(0);
    });

    it("never queries or deletes ApiKey records", async () => {
      const apiKeyDeleteSpy = vi.spyOn(prisma.apiKey, "deleteMany");
      vi.spyOn(prisma.apiKeyRequestLog, "findMany").mockResolvedValue([]);

      await pruneApiKeyRequestLogs();

      expect(apiKeyDeleteSpy).not.toHaveBeenCalled();
    });
  });
});
