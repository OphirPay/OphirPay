// SPDX-License-Identifier: MIT
//
// Sliding-window rate limiting against an in-memory Redis mock.
//
// `RedisRateLimitStore` only needs `incr` / `expire` / `del`, so a small
// in-memory fake that honours TTLs against the (fake) clock is enough to
// exercise the counter math without a real Redis — these tests run unchanged
// in CI. Time is driven with vitest fake timers so every offset is exact.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getRetryAfterSeconds,
  InMemoryRateLimitStore,
  type RateLimitResult,
  RedisRateLimitStore,
} from "@/lib/ratelimit";

const LIMIT = 5;
const WINDOW_MS = 60_000;

/** Minimal in-memory Redis: INCR / EXPIRE / DEL with TTLs on the fake clock. */
function createRedisMock() {
  const values = new Map<string, number>();
  const expiresAt = new Map<string, number>();

  const sweep = (key: string) => {
    const at = expiresAt.get(key);
    if (at !== undefined && at <= Date.now()) {
      values.delete(key);
      expiresAt.delete(key);
    }
  };

  return {
    values,
    expiresAt,
    incr: vi.fn(async (key: string) => {
      sweep(key);
      const next = (values.get(key) ?? 0) + 1;
      values.set(key, next);
      return next;
    }),
    expire: vi.fn(async (key: string, seconds: number) => {
      expiresAt.set(key, Date.now() + seconds * 1000);
      return 1;
    }),
    del: vi.fn(async (key: string) => {
      values.delete(key);
      expiresAt.delete(key);
      return 1;
    }),
  };
}

/** The HTTP status a route would return for a limiter result. */
function statusFor(result: RateLimitResult): 200 | 429 {
  return result.allowed ? 200 : 429;
}

async function hit(
  store: RedisRateLimitStore | InMemoryRateLimitStore,
  key = "client-1",
  count = 1
): Promise<RateLimitResult[]> {
  const results: RateLimitResult[] = [];
  for (let i = 0; i < count; i++) {
    results.push(await store.increment(key, WINDOW_MS, LIMIT));
  }
  return results;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("sliding-window counter (Redis mock)", () => {
  describe("requests below the limit", () => {
    it("succeeds with 200 for every request up to the limit", async () => {
      const store = new RedisRateLimitStore(createRedisMock());

      const results = await hit(store, "client-1", LIMIT);

      expect(results.map(statusFor)).toEqual(Array(LIMIT).fill(200));
      expect(results.every((r) => r.allowed)).toBe(true);
    });

    it("reports a decreasing remaining quota", async () => {
      const store = new RedisRateLimitStore(createRedisMock());

      const results = await hit(store, "client-1", LIMIT);

      expect(results.map((r) => r.remaining)).toEqual([4, 3, 2, 1, 0]);
      expect(results.every((r) => r.limit === LIMIT)).toBe(true);
    });

    it("starts the expiry only on the first request in a window", async () => {
      const redis = createRedisMock();
      const store = new RedisRateLimitStore(redis);

      await hit(store, "client-1", 3);

      expect(redis.expire).toHaveBeenCalledTimes(1);
      expect(redis.expire).toHaveBeenCalledWith(expect.any(String), 60);
    });
  });

  describe("rapid burst above the limit", () => {
    it("returns 429 for every request past the limit", async () => {
      const store = new RedisRateLimitStore(createRedisMock());

      const results = await hit(store, "client-1", LIMIT + 3);

      expect(results.slice(0, LIMIT).map(statusFor)).toEqual(Array(LIMIT).fill(200));
      expect(results.slice(LIMIT).map(statusFor)).toEqual([429, 429, 429]);
    });

    it("never reports a negative remaining quota", async () => {
      const store = new RedisRateLimitStore(createRedisMock());

      const results = await hit(store, "client-1", LIMIT + 10);

      expect(results.every((r) => r.remaining >= 0)).toBe(true);
      expect(results.at(-1)?.remaining).toBe(0);
    });

    it("keeps counters independent per client key", async () => {
      const store = new RedisRateLimitStore(createRedisMock());

      await hit(store, "client-a", LIMIT + 1);
      const [other] = await hit(store, "client-b");

      expect(statusFor(other!)).toBe(200);
      expect(other!.remaining).toBe(LIMIT - 1);
    });

    it("exposes a non-negative Retry-After for a blocked request", async () => {
      const store = new RedisRateLimitStore(createRedisMock());
      await hit(store, "client-1", LIMIT);

      vi.advanceTimersByTime(20_000);
      const [blocked] = await hit(store, "client-1");

      expect(statusFor(blocked!)).toBe(429);
      expect(getRetryAfterSeconds(blocked!)).toBeGreaterThan(0);
      expect(getRetryAfterSeconds(blocked!)).toBeLessThanOrEqual(60);
    });
  });

  describe("window expiration resets the counter", () => {
    it.each([
      ["just before the window ends", WINDOW_MS - 1, 429],
      ["exactly at the window boundary", WINDOW_MS, 200],
      ["just after the window ends", WINDOW_MS + 1, 200],
      ["several windows later", WINDOW_MS * 5, 200],
    ] as const)("%s (+%ims) -> %i", async (_label, offsetMs, expected) => {
      const store = new RedisRateLimitStore(createRedisMock());
      await hit(store, "client-1", LIMIT + 1); // exhausted and blocked

      vi.advanceTimersByTime(offsetMs);
      const [next] = await hit(store, "client-1");

      expect(statusFor(next!)).toBe(expected);
    });

    it("restores the full quota after expiry", async () => {
      const store = new RedisRateLimitStore(createRedisMock());
      await hit(store, "client-1", LIMIT + 1);

      vi.advanceTimersByTime(WINDOW_MS + 1);
      const results = await hit(store, "client-1", LIMIT + 1);

      expect(results.slice(0, LIMIT).every((r) => r.allowed)).toBe(true);
      expect(results[LIMIT]!.allowed).toBe(false);
      expect(results[0]!.remaining).toBe(LIMIT - 1);
    });

    it("counts requests spread across a window cumulatively", async () => {
      const store = new RedisRateLimitStore(createRedisMock());

      // One request every 10s: 5 land inside the first 60s window.
      const results: RateLimitResult[] = [];
      for (let i = 0; i < LIMIT; i++) {
        results.push(...(await hit(store)));
        vi.advanceTimersByTime(10_000);
      }
      expect(results.every((r) => r.allowed)).toBe(true);

      // t = 50s: still inside the window, so the 6th request is blocked.
      const [sixth] = await hit(store);
      expect(statusFor(sixth!)).toBe(429);

      // t = 60s+: the window has rolled over.
      vi.advanceTimersByTime(10_001);
      const [fresh] = await hit(store);
      expect(statusFor(fresh!)).toBe(200);
    });

    it("rounds the Redis TTL up to whole seconds", async () => {
      const redis = createRedisMock();
      const store = new RedisRateLimitStore(redis);

      await store.increment("client-1", 90_500, LIMIT);

      expect(redis.expire).toHaveBeenCalledWith(expect.any(String), 91);
    });
  });

  describe("reset", () => {
    it("clears the counter so the client can send again", async () => {
      const store = new RedisRateLimitStore(createRedisMock());
      await hit(store, "client-1", LIMIT + 1);

      await store.reset("client-1");
      const [next] = await hit(store, "client-1");

      expect(statusFor(next!)).toBe(200);
      expect(next!.remaining).toBe(LIMIT - 1);
    });
  });

  describe("Redis outage", () => {
    it("falls back to the in-memory counter and still enforces the limit", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const broken = {
        incr: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
        expire: vi.fn(),
        del: vi.fn(),
      };
      const store = new RedisRateLimitStore(broken);

      const results = await hit(store, "client-1", LIMIT + 1);

      expect(results.slice(0, LIMIT).map(statusFor)).toEqual(Array(LIMIT).fill(200));
      expect(statusFor(results[LIMIT]!)).toBe(429);
    });
  });
});

describe("in-memory store parity", () => {
  it("applies the same window math as the Redis-backed store", async () => {
    const memory = new InMemoryRateLimitStore();
    const redis = new RedisRateLimitStore(createRedisMock());

    for (const offsetMs of [0, 15_000, 44_999, 1, 60_000]) {
      vi.advanceTimersByTime(offsetMs);
      const m = (await hit(memory, `k-${offsetMs}`, LIMIT + 1)).at(-1)!;
      const r = (await hit(redis, `k-${offsetMs}`, LIMIT + 1)).at(-1)!;
      expect(statusFor(m)).toBe(statusFor(r));
    }
  });

  it("allows again once the window has elapsed", async () => {
    const store = new InMemoryRateLimitStore();
    await hit(store, "client-1", LIMIT + 1);

    vi.advanceTimersByTime(WINDOW_MS + 1);
    const [next] = await hit(store);

    expect(statusFor(next!)).toBe(200);
  });
});
