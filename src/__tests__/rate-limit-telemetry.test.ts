// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import {
  createRateLimitHeaders,
  applyRateLimitHeaders,
  getRateLimitHeaders,
  isRateLimited,
} from "@/lib/rate-limit-headers";
import {
  buildRateLimitTelemetryHeaders,
  getRetryAfterSeconds,
  InMemoryRateLimitStore,
  setRateLimitStore,
} from "@/lib/rate-limit";
import { proxy } from "@/proxy";

describe("Rate Limit Telemetry Headers (Issue #1290)", () => {
  describe("createRateLimitHeaders", () => {
    it("generates correct headers for successful (2xx) request with capacity remaining", () => {
      const now = Date.now();
      const resetAt = now + 60_000;
      const headers = createRateLimitHeaders({
        limit: 100,
        remaining: 75,
        resetAt,
        allowed: true,
      });

      expect(headers["X-RateLimit-Limit"]).toBe("100");
      expect(headers["X-RateLimit-Remaining"]).toBe("75");
      expect(headers["X-RateLimit-Reset"]).toBe(String(Math.ceil(resetAt / 1000)));
      expect(headers["Retry-After"]).toBeUndefined();
    });

    it("generates correct headers and includes Retry-After when rate-limited (429)", () => {
      const now = Date.now();
      const resetAt = now + 30_000;
      const headers = createRateLimitHeaders({
        limit: 100,
        remaining: 0,
        resetAt,
        allowed: false,
      });

      expect(headers["X-RateLimit-Limit"]).toBe("100");
      expect(headers["X-RateLimit-Remaining"]).toBe("0");
      expect(headers["X-RateLimit-Reset"]).toBe(String(Math.ceil(resetAt / 1000)));
      expect(headers["Retry-After"]).toBeDefined();
      expect(Number(headers["Retry-After"])).toBeGreaterThanOrEqual(1);
    });

    it("supports seconds-based reset timestamps seamlessly", () => {
      const resetInSeconds = Math.floor(Date.now() / 1000) + 45;
      const headers = createRateLimitHeaders({
        limit: 50,
        remaining: 0,
        resetAt: resetInSeconds,
        allowed: false,
      });

      expect(headers["X-RateLimit-Limit"]).toBe("50");
      expect(headers["X-RateLimit-Remaining"]).toBe("0");
      expect(headers["X-RateLimit-Reset"]).toBe(String(resetInSeconds));
      expect(Number(headers["Retry-After"])).toBeGreaterThanOrEqual(1);
    });

    it("clamps negative remaining values to zero", () => {
      const headers = createRateLimitHeaders({
        limit: 10,
        remaining: -5,
        resetAt: Date.now() + 10_000,
        allowed: false,
      });

      expect(headers["X-RateLimit-Remaining"]).toBe("0");
      expect(headers["Retry-After"]).toBeDefined();
    });
  });

  describe("applyRateLimitHeaders", () => {
    it("applies telemetry headers onto a Headers instance", () => {
      const headers = new Headers();
      applyRateLimitHeaders(headers, {
        limit: 60,
        remaining: 59,
        resetAt: Date.now() + 60_000,
        allowed: true,
      });

      expect(headers.get("X-RateLimit-Limit")).toBe("60");
      expect(headers.get("X-RateLimit-Remaining")).toBe("59");
      expect(headers.get("X-RateLimit-Reset")).toBeDefined();
      expect(headers.get("Retry-After")).toBeNull();
    });
  });

  describe("buildRateLimitTelemetryHeaders (rate-limit.ts)", () => {
    it("converts RateLimitResult to telemetry headers", () => {
      const resetAt = Date.now() + 15_000;
      const result = {
        allowed: true,
        remaining: 42,
        resetAt,
      };

      const headers = buildRateLimitTelemetryHeaders(result, 100);
      expect(headers["X-RateLimit-Limit"]).toBe("100");
      expect(headers["X-RateLimit-Remaining"]).toBe("42");
      expect(headers["X-RateLimit-Reset"]).toBe(String(Math.ceil(resetAt / 1000)));
      expect(headers["Retry-After"]).toBeUndefined();
    });

    it("computes retryAfterSeconds correctly", () => {
      const resetAt = Date.now() + 5_000;
      const seconds = getRetryAfterSeconds({
        allowed: false,
        remaining: 0,
        resetAt,
      });
      expect(seconds).toBeGreaterThanOrEqual(1);
      expect(seconds).toBeLessThanOrEqual(6);
    });
  });

  describe("Legacy rate-limit-headers helpers", () => {
    it("getRateLimitHeaders maintains backward compatibility", () => {
      const h = getRateLimitHeaders({ limit: 10, remaining: 5, reset: 2000000000 });
      expect(h["X-RateLimit-Limit"]).toBe("10");
      expect(h["X-RateLimit-Remaining"]).toBe("5");
      expect(h["X-RateLimit-Reset"]).toBe("2000000000");
      expect(h["Retry-After"]).toBe("0");
    });

    it("isRateLimited evaluates exhaustion accurately", () => {
      const future = Math.floor(Date.now() / 1000) + 300;
      expect(isRateLimited({ limit: 10, remaining: 0, reset: future })).toBe(true);
      expect(isRateLimited({ limit: 10, remaining: 1, reset: future })).toBe(false);
    });
  });

  describe("Proxy integration & countdown verification", () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      // Set test environment with low RPM for verification
      process.env.RATE_LIMIT_RPM = "3";
      setRateLimitStore(new InMemoryRateLimitStore());
    });

    afterEach(() => {
      process.env = { ...originalEnv };
      setRateLimitStore(new InMemoryRateLimitStore());
    });

    it("includes X-RateLimit-Limit and decrements X-RateLimit-Remaining across requests", async () => {
      const clientIp = "192.168.1.101";

      const makeReq = () =>
        new NextRequest("http://localhost/api/test-route", {
          method: "GET",
          headers: {
            "x-forwarded-for": clientIp,
          },
        });

      // Request 1: remaining should be 2
      const res1 = await proxy(makeReq());
      expect(res1.status).toBe(200);
      expect(res1.headers.get("X-RateLimit-Limit")).toBe("3");
      expect(res1.headers.get("X-RateLimit-Remaining")).toBe("2");
      expect(res1.headers.get("X-RateLimit-Reset")).toBeDefined();
      expect(res1.headers.get("Retry-After")).toBeNull();

      // Request 2: remaining should be 1
      const res2 = await proxy(makeReq());
      expect(res2.status).toBe(200);
      expect(res2.headers.get("X-RateLimit-Limit")).toBe("3");
      expect(res2.headers.get("X-RateLimit-Remaining")).toBe("1");

      // Request 3: remaining should be 0 (still allowed as the 3rd request)
      const res3 = await proxy(makeReq());
      expect(res3.status).toBe(200);
      expect(res3.headers.get("X-RateLimit-Limit")).toBe("3");
      expect(res3.headers.get("X-RateLimit-Remaining")).toBe("0");

      // Request 4: limit exceeded! Returns 429
      const res4 = await proxy(makeReq());
      expect(res4.status).toBe(429);
      expect(res4.headers.get("X-RateLimit-Limit")).toBe("3");
      expect(res4.headers.get("X-RateLimit-Remaining")).toBe("0");
      expect(res4.headers.get("X-RateLimit-Reset")).toBeDefined();
      expect(res4.headers.get("Retry-After")).toBeDefined();
      expect(Number(res4.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);

      const json4 = await res4.json();
      expect(json4.error.code).toBe("RATE_LIMITED");
    });
  });
});
