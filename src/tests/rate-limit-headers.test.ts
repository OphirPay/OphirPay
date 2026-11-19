// SPDX-License-Identifier: MIT
/**
 * @vitest-environment node
 *
 * RFC-style rate-limit headers: every response advertises Limit/Remaining (and
 * Reset), while a 429 additionally carries an accurate Retry-After countdown.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { InMemoryRateLimitStore } from "@/lib/rate-limit";
import {
  getRateLimitExceededHeaders,
  getRateLimitHeaders,
  getRetryAfterHeaderValue,
  rateLimitInfoFromResult,
} from "@/lib/rate-limit-headers";

const NOW_MS = Date.parse("2026-10-20T00:00:00.000Z");

describe("getRateLimitHeaders", () => {
  it("advertises limit, remaining and reset on successful responses", () => {
    const headers = getRateLimitHeaders({
      limit: 100,
      remaining: 42,
      reset: Math.ceil((NOW_MS + 60_000) / 1000),
    });

    expect(headers).toEqual({
      "X-RateLimit-Limit": "100",
      "X-RateLimit-Remaining": "42",
      "X-RateLimit-Reset": String(Math.ceil((NOW_MS + 60_000) / 1000)),
    });
    // Retry-After has no meaning when the request was not throttled.
    expect(headers["Retry-After"]).toBeUndefined();
  });

  it("never emits a negative remaining value", () => {
    const headers = getRateLimitHeaders({ limit: 5, remaining: -3, reset: 0 });
    expect(headers["X-RateLimit-Remaining"]).toBe("0");
  });
});

describe("getRateLimitExceededHeaders", () => {
  it("adds Retry-After as seconds until the window resets", () => {
    const reset = Math.ceil((NOW_MS + 30_000) / 1000);
    const headers = getRateLimitExceededHeaders(
      { limit: 100, remaining: 0, reset },
      NOW_MS
    );

    expect(headers["X-RateLimit-Limit"]).toBe("100");
    expect(headers["X-RateLimit-Remaining"]).toBe("0");
    expect(headers["X-RateLimit-Reset"]).toBe(String(reset));
    expect(headers["Retry-After"]).toBe("30");
  });

  it("rounds the countdown up so clients never retry early", () => {
    expect(
      getRetryAfterHeaderValue(
        { limit: 1, remaining: 0, reset: NOW_MS / 1000 + 1.2 },
        NOW_MS
      )
    ).toBe(2);
  });

  it("clamps Retry-After to zero once the window has passed", () => {
    const headers = getRateLimitExceededHeaders(
      { limit: 1, remaining: 0, reset: NOW_MS / 1000 - 5 },
      NOW_MS
    );
    expect(headers["Retry-After"]).toBe("0");
  });
});

describe("API proxy responses", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("attaches quota headers to 2xx and Retry-After to 429 responses", async () => {
    vi.stubEnv("RATE_LIMIT_RPM", "1");
    vi.resetModules();

    const { proxy } = await import("@/proxy");
    const { NextRequest } = await import("next/server");

    const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
    const request = () =>
      new NextRequest("http://localhost/api/payments", {
        headers: { "x-forwarded-for": ip },
      });

    const ok = await proxy(request());
    expect(ok.status).toBe(200);
    expect(ok.headers.get("X-RateLimit-Limit")).toBe("1");
    expect(ok.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(ok.headers.get("X-RateLimit-Reset")).toMatch(/^\d+$/);
    expect(ok.headers.get("Retry-After")).toBeNull();

    const limited = await proxy(request());
    expect(limited.status).toBe(429);
    expect(limited.headers.get("X-RateLimit-Limit")).toBe("1");
    expect(limited.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(Number(limited.headers.get("X-RateLimit-Reset"))).toBeGreaterThan(
      Math.floor(Date.now() / 1000)
    );
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
});

describe("rateLimitInfoFromResult / store countdown", () => {
  it("maps a store result to epoch-second headers", () => {
    const info = rateLimitInfoFromResult({
      allowed: true,
      limit: 10,
      remaining: 7,
      resetAt: NOW_MS + 15_000,
    });

    expect(info).toEqual({
      limit: 10,
      remaining: 7,
      reset: Math.ceil((NOW_MS + 15_000) / 1000),
    });
  });

  it("decrements Remaining across requests and then reports a 429 header set", async () => {
    const store = new InMemoryRateLimitStore();
    const windowMs = 60_000;
    const limit = 3;
    const seen: number[] = [];

    for (let i = 0; i < limit; i++) {
      const result = await store.increment("client-1", windowMs, limit);
      const headers = getRateLimitHeaders(rateLimitInfoFromResult(result));
      seen.push(Number(headers["X-RateLimit-Remaining"]));
      expect(headers["X-RateLimit-Limit"]).toBe(String(limit));
      expect(headers["Retry-After"]).toBeUndefined();
    }

    expect(seen).toEqual([2, 1, 0]);

    const throttled = await store.increment("client-1", windowMs, limit);
    expect(throttled.allowed).toBe(false);

    const headers = getRateLimitExceededHeaders(
      rateLimitInfoFromResult(throttled)
    );
    expect(headers["X-RateLimit-Remaining"]).toBe("0");
    expect(Number(headers["X-RateLimit-Reset"])).toBeGreaterThan(
      Math.floor(Date.now() / 1000)
    );
    expect(Number(headers["Retry-After"])).toBeGreaterThan(0);
    // The reset instant is rounded up to a whole epoch second, so the
    // countdown never exceeds the window by more than that rounding.
    expect(Number(headers["Retry-After"])).toBeLessThanOrEqual(
      Math.ceil(windowMs / 1000) + 1
    );
  });

  it("keeps separate buckets per key", async () => {
    const store = new InMemoryRateLimitStore();
    await store.increment("a", 60_000, 2);
    await store.increment("a", 60_000, 2);

    const other = await store.increment("b", 60_000, 2);
    expect(other.remaining).toBe(1);
  });
});
