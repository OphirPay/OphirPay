// SPDX-License-Identifier: MIT

import { describe, it, expect, vi } from "vitest";
import {
  RedisRateLimitStore,
} from "@/lib/rate-limit";

describe("RedisRateLimitStore — graceful fallback (#1962)", () => {
  function createMockRedis() {
    return {
      incr: vi.fn(),
      expire: vi.fn(),
      del: vi.fn(),
    };
  }

  it("uses Redis when available", async () => {
    const redis = createMockRedis();
    redis.incr.mockResolvedValue(1);
    redis.expire.mockResolvedValue("OK");
    const store = new RedisRateLimitStore(redis);

    const result = await store.increment("key", 60_000, 10);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9);
    expect(redis.incr).toHaveBeenCalledWith("key");
    expect(redis.expire).toHaveBeenCalledWith("key", 60);
  });

  it("falls back to in-memory store when Redis throws", async () => {
    const redis = createMockRedis();
    redis.incr.mockRejectedValue(new Error("ECONNREFUSED"));
    const store = new RedisRateLimitStore(redis);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await store.increment("key", 60_000, 10);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Redis unavailable"),
      expect.any(String)
    );

    warn.mockRestore();
  });

  it("logs only once per fallback episode", async () => {
    const redis = createMockRedis();
    redis.incr.mockRejectedValue(new Error("ECONNREFUSED"));
    const store = new RedisRateLimitStore(redis);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await store.increment("k1", 60_000, 10);
    await store.increment("k2", 60_000, 10);
    await store.increment("k3", 60_000, 10);

    // Should only warn once, not on every call
    expect(warn).toHaveBeenCalledTimes(1);

    warn.mockRestore();
  });

  it("resumes using Redis once it recovers", async () => {
    const redis = createMockRedis();
    redis.incr
      .mockRejectedValueOnce(new Error("ECONNREFUSED")) // first call fails
      .mockResolvedValue(1); // subsequent calls succeed
    redis.expire.mockResolvedValue("OK");
    const store = new RedisRateLimitStore(redis);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    // First call → fallback
    await store.increment("key", 60_000, 10);
    expect(warn).toHaveBeenCalledTimes(1);

    // Second call → Redis is back
    await store.increment("key2", 60_000, 10);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("Redis connection restored")
    );

    warn.mockRestore();
    log.mockRestore();
  });

  it("fallback correctly enforces rate limits", async () => {
    const redis = createMockRedis();
    redis.incr.mockRejectedValue(new Error("ECONNREFUSED"));
    const store = new RedisRateLimitStore(redis);

    vi.spyOn(console, "warn").mockImplementation(() => {});

    // Exhaust the limit (maxRequests = 2)
    const r1 = await store.increment("key", 60_000, 2);
    const r2 = await store.increment("key", 60_000, 2);
    const r3 = await store.increment("key", 60_000, 2);

    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    expect(r3.allowed).toBe(false);
    expect(r3.remaining).toBe(0);
  });

  it("reset silently ignores Redis errors", async () => {
    const redis = createMockRedis();
    redis.del.mockRejectedValue(new Error("ECONNREFUSED"));
    const store = new RedisRateLimitStore(redis);

    // Should not throw
    await expect(store.reset("key")).resolves.toBeUndefined();
  });
});
