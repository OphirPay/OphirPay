// SPDX-License-Identifier: MIT

/**
 * Issue #741 — read-only endpoints served from the cache layer.
 *
 * Covers the three acceptance criteria that are testable without a live
 * Soroban RPC / Postgres:
 *   1. a repeated read is served from the cache (the loader runs once);
 *   2. invalidating a scope makes the next read fresh (the loader runs again);
 *   3. the app works with `REDIS_URL` unset, and degrades safely when it points
 *      at something unreachable instead of failing the request.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  cachedRead,
  cacheClear,
  cacheStats,
  invalidateCache,
  invalidateCaches,
  readCacheKey,
  resetReadCache,
  READ_TTL_MS,
} from "@/lib/api-cache";

vi.mock("@/lib/prisma", () => ({
  default: {
    payment: {
      count: vi.fn(),
      aggregate: vi.fn(),
      groupBy: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: vi.fn(),
}));

import prisma from "@/lib/prisma";
import * as authSession from "@/lib/auth-session";
import { GET as getAnalytics } from "@/app/api/analytics/route";

const MOCK_AUTH = {
  userId: "user_cache_test",
  publicKey: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
};

function mockAnalyticsQueries(total: number) {
  vi.mocked(prisma.payment.count)
    .mockResolvedValueOnce(total)
    .mockResolvedValueOnce(total)
    .mockResolvedValueOnce(0);
  vi.mocked(prisma.payment.aggregate).mockResolvedValueOnce({
    _sum: { amount: total * 10 },
    _avg: { amount: 10 },
  } as never);
  vi.mocked(prisma.payment.groupBy).mockResolvedValueOnce([]);
}

describe("read cache (#741)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await resetReadCache();
    delete process.env.REDIS_URL;
  });

  afterEach(() => {
    delete process.env.REDIS_URL;
  });

  describe("cachedRead", () => {
    it("runs the loader once and serves the second read from the cache", async () => {
      const loader = vi.fn().mockResolvedValue({ payments: 42 });
      const key = readCacheKey("stats", "contract-a");

      const first = await cachedRead(key, loader, 5_000);
      const second = await cachedRead(key, loader, 5_000);

      expect(first.status).toBe("MISS");
      expect(second.status).toBe("HIT");
      expect(loader).toHaveBeenCalledTimes(1);
      expect(second.value).toEqual({ payments: 42 });
    });

    it("re-runs the loader once the TTL has elapsed", async () => {
      const loader = vi.fn().mockResolvedValue("v1");
      const key = readCacheKey("contracts", "contract-b");

      await cachedRead(key, loader, -1); // already expired
      const second = await cachedRead(key, loader, 5_000);

      expect(second.status).toBe("MISS");
      expect(loader).toHaveBeenCalledTimes(2);
    });

    it("never caches a rejected loader, so an outage is not pinned for the TTL", async () => {
      const loader = vi
        .fn()
        .mockRejectedValueOnce(new Error("RPC down"))
        .mockResolvedValueOnce("recovered");
      const key = readCacheKey("stats", "contract-c");

      await expect(cachedRead(key, loader, 5_000)).rejects.toThrow("RPC down");
      const next = await cachedRead(key, loader, 5_000);

      expect(next.value).toBe("recovered");
      expect(loader).toHaveBeenCalledTimes(2);
    });
  });

  describe("invalidation", () => {
    it("a mutation makes the next read fresh (acceptance criterion)", async () => {
      const loader = vi.fn().mockResolvedValueOnce("before").mockResolvedValueOnce("after");
      const key = readCacheKey("analytics", MOCK_AUTH.userId);

      const before = await cachedRead(key, loader, 30_000);
      await cachedRead(key, loader, 30_000); // served from cache

      // What POST /api/payments does when it writes.
      await invalidateCache("analytics", MOCK_AUTH.userId);

      const after = await cachedRead(key, loader, 30_000);

      expect(before.value).toBe("before");
      expect(after.value).toBe("after");
      expect(after.status).toBe("MISS");
      expect(loader).toHaveBeenCalledTimes(2);
    });

    it("invalidating a subject leaves other subjects in the scope cached", async () => {
      const loaderA = vi.fn().mockResolvedValue("a");
      const loaderB = vi.fn().mockResolvedValue("b");

      await cachedRead(readCacheKey("analytics", "user-a"), loaderA, 30_000);
      await cachedRead(readCacheKey("analytics", "user-b"), loaderB, 30_000);

      await invalidateCache("analytics", "user-a");

      const a = await cachedRead(readCacheKey("analytics", "user-a"), loaderA, 30_000);
      const b = await cachedRead(readCacheKey("analytics", "user-b"), loaderB, 30_000);

      expect(a.status).toBe("MISS");
      expect(loaderA).toHaveBeenCalledTimes(2);
      // Another tenant's cached entry must survive — no cross-user flush.
      expect(b.status).toBe("HIT");
      expect(loaderB).toHaveBeenCalledTimes(1);
    });

    it("a scope-wide invalidation drops every entry in that scope only", async () => {
      const auditLoader = vi.fn().mockResolvedValue(1);
      const statsLoader = vi.fn().mockResolvedValue(2);

      await cachedRead(readCacheKey("audit-log", "count:abc"), auditLoader, 5_000);
      await cachedRead(readCacheKey("stats", "abc"), statsLoader, 15_000);

      await invalidateCache("audit-log");

      expect(cacheStats().keys).toEqual([readCacheKey("stats", "abc")]);

      await cachedRead(readCacheKey("audit-log", "count:abc"), auditLoader, 5_000);
      await cachedRead(readCacheKey("stats", "abc"), statsLoader, 15_000);

      expect(auditLoader).toHaveBeenCalledTimes(2); // refetched
      expect(statsLoader).toHaveBeenCalledTimes(1); // untouched
    });

    it("invalidates several scopes in one call", async () => {
      const loaders = {
        stats: vi.fn().mockResolvedValue("s"),
        analytics: vi.fn().mockResolvedValue("a"),
        audit: vi.fn().mockResolvedValue("l"),
      };

      await cachedRead(readCacheKey("stats"), loaders.stats, 1_000);
      await cachedRead(readCacheKey("analytics", "u1"), loaders.analytics, 1_000);
      await cachedRead(readCacheKey("audit-log", "count:x"), loaders.audit, 1_000);

      await invalidateCaches([
        { scope: "stats" },
        { scope: "analytics", subject: "u1" },
        { scope: "audit-log" },
      ]);

      expect(cacheStats().size).toBe(0);
    });
  });

  describe("degradation", () => {
    it("works with REDIS_URL unset and reports the memory backend", async () => {
      delete process.env.REDIS_URL;
      const loader = vi.fn().mockResolvedValue("no-redis");

      const result = await cachedRead(readCacheKey("stats"), loader, 1_000);

      expect(result.value).toBe("no-redis");
      expect(cacheStats().backend).toBe("memory");
      expect(cacheStats().redisConfigured).toBe(false);
    });

    it("falls back to the loader when REDIS_URL points at an unreachable server", async () => {
      process.env.REDIS_URL = "redis://127.0.0.1:1"; // nothing listens here
      await resetReadCache();

      const loader = vi.fn().mockResolvedValue("still-works");
      const result = await cachedRead(readCacheKey("stats", "unreachable"), loader, 1_000);

      expect(result.value).toBe("still-works");
      expect(cacheStats().backend).toBe("memory");
      expect(cacheStats().redisConfigured).toBe(false);
    }, 15_000);
  });

  describe("route integration", () => {
    it("GET /api/analytics serves the second request from the cache and flags it", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValue(MOCK_AUTH);
      mockAnalyticsQueries(7);

      const first = await getAnalytics(new Request("http://localhost/api/analytics"));
      const second = await getAnalytics(new Request("http://localhost/api/analytics"));

      expect(first.status).toBe(200);
      expect(first.headers.get("X-Cache-Status")).toBe("MISS");
      expect(first.headers.get("Cache-Control")).toBe(
        "private, no-cache, no-store, must-revalidate"
      );

      expect(second.status).toBe(200);
      expect(second.headers.get("X-Cache-Status")).toBe("HIT");

      // The cache is the only reason the aggregates were computed once: the
      // second request ran no queries at all.
      expect(prisma.payment.count).toHaveBeenCalledTimes(3);
      expect(prisma.payment.aggregate).toHaveBeenCalledTimes(1);

      const body = await second.json();
      expect(body.data.totalPayments).toBe(7);
    });

    it("after invalidation the route recomputes and the payload is fresh", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValue(MOCK_AUTH);
      mockAnalyticsQueries(7);
      mockAnalyticsQueries(0);

      const first = await getAnalytics(new Request("http://localhost/api/analytics"));
      expect((await first.json()).data.totalPayments).toBe(7);

      await invalidateCache("analytics", MOCK_AUTH.userId);

      const second = await getAnalytics(new Request("http://localhost/api/analytics"));
      expect(second.headers.get("X-Cache-Status")).toBe("MISS");
      expect((await second.json()).data.totalPayments).toBe(0);
    });

    it("uses the per-scope TTL configured for analytics", () => {
      expect(READ_TTL_MS.analytics).toBeGreaterThan(0);
      expect(READ_TTL_MS.stats).toBeLessThanOrEqual(READ_TTL_MS.contracts);
    });
  });

  describe("management helpers", () => {
    it("cacheClear empties L1 without touching other state", async () => {
      await cachedRead(readCacheKey("stats"), async () => 1, 5_000);
      expect(cacheStats().size).toBe(1);

      cacheClear();
      expect(cacheStats().size).toBe(0);
    });
  });
});
