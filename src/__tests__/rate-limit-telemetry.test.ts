// SPDX-License-Identifier: MIT

import { NextRequest } from "next/server";
import { afterEach,describe, expect, it, vi } from "vitest";

import * as ratelimit from "@/lib/ratelimit";

describe("Rate Limit Telemetry & Headers (#1958)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("exports rate limit utilities via src/lib/ratelimit barrel module", () => {
    expect(ratelimit.getRateLimitHeaders).toBeDefined();
    expect(ratelimit.getRateLimitExceededHeaders).toBeDefined();
    expect(ratelimit.rateLimitInfoFromResult).toBeDefined();
    expect(ratelimit.InMemoryRateLimitStore).toBeDefined();
  });

  it("includes X-RateLimit-Limit, X-RateLimit-Remaining, and X-RateLimit-Reset on normal API responses", async () => {
    vi.stubEnv("RATE_LIMIT_RPM", "10");
    vi.resetModules();

    const { proxy } = await import("@/proxy");
    const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
    const req = new NextRequest("http://localhost/api/payments", {
      headers: { "x-forwarded-for": ip },
    });

    const res = await proxy(req);
    expect(res.headers.get("X-RateLimit-Limit")).toBe("10");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("9");
    expect(res.headers.get("X-RateLimit-Reset")).toMatch(/^\d+$/);
    expect(res.headers.get("Retry-After")).toBeNull();
  });

  it("decrements remaining count on successive requests and transitions to 429 when quota is exhausted", async () => {
    vi.stubEnv("RATE_LIMIT_RPM", "3");
    vi.resetModules();

    const { proxy } = await import("@/proxy");
    const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
    const makeReq = () =>
      new NextRequest("http://localhost/api/payments", {
        headers: { "x-forwarded-for": ip },
      });

    // Request 1: remaining 2
    const res1 = await proxy(makeReq());
    expect(res1.status).toBe(200);
    expect(res1.headers.get("X-RateLimit-Limit")).toBe("3");
    expect(res1.headers.get("X-RateLimit-Remaining")).toBe("2");

    // Request 2: remaining 1
    const res2 = await proxy(makeReq());
    expect(res2.status).toBe(200);
    expect(res2.headers.get("X-RateLimit-Remaining")).toBe("1");

    // Request 3: remaining 0
    const res3 = await proxy(makeReq());
    expect(res3.status).toBe(200);
    expect(res3.headers.get("X-RateLimit-Remaining")).toBe("0");

    // Request 4: 429 Too Many Requests
    const res4 = await proxy(makeReq());
    expect(res4.status).toBe(429);
    expect(res4.headers.get("X-RateLimit-Limit")).toBe("3");
    expect(res4.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(Number(res4.headers.get("X-RateLimit-Reset"))).toBeGreaterThan(
      Math.floor(Date.now() / 1000)
    );
    expect(Number(res4.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("advertises default rate limit telemetry headers on exempt monitoring endpoints", async () => {
    const { proxy } = await import("@/proxy");
    const req = new NextRequest("http://localhost/api/health");

    const res = await proxy(req);
    expect(res.headers.get("X-RateLimit-Limit")).toBeDefined();
    expect(res.headers.get("X-RateLimit-Remaining")).toBeDefined();
    expect(res.headers.get("X-RateLimit-Reset")).toBeDefined();
  });

  it("attaches rate-limit headers to early auth rejection responses (invalid API key format)", async () => {
    const { proxy } = await import("@/proxy");
    const req = new NextRequest("http://localhost/api/payments", {
      headers: {
        authorization: "Bearer invalid_key_format",
        "x-forwarded-for": "203.0.113.88",
      },
    });

    const res = await proxy(req);
    expect(res.status).toBe(401);
    expect(res.headers.get("X-RateLimit-Limit")).toBeDefined();
    expect(res.headers.get("X-RateLimit-Remaining")).toBeDefined();
    expect(res.headers.get("X-RateLimit-Reset")).toBeDefined();
  });
});
