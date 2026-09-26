// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  InMemoryRateLimitStore,
  getRateLimitStore,
  setRateLimitStore,
  buildBucketKey,
  writeRateLimitHeaders,
  getRateLimitHeaders,
  isRateLimited,
  RATE_LIMIT_POLICIES,
  enforceRateLimit,
  enforceAuthRateLimit,
  enforceLookupRateLimit,
  type RateLimitInfo,
  type RateLimitStore,
} from "@/lib/rate-limit";
import { proxy } from "@/proxy";
import { NextRequest } from "next/server";

describe("Rate Limiting Consolidation (Issue #759)", () => {
  let store: InMemoryRateLimitStore;

  beforeEach(() => {
    store = new InMemoryRateLimitStore();
    setRateLimitStore(store);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // ── 1. Policies as Data & Key Construction ───────────────────
  describe("Policies as data and bucket keys", () => {
    it("RATE_LIMIT_POLICIES defines configuration data for proxy, auth, and lookup", () => {
      expect(RATE_LIMIT_POLICIES.PROXY).toMatchObject({
        name: "proxy",
        windowMs: 60_000,
        ipLimit: 120,
        ipErrorCode: "RATE_LIMITED",
      });

      expect(RATE_LIMIT_POLICIES.AUTH).toMatchObject({
        name: "auth",
        windowMs: 60_000,
        ipLimit: 30,
        targetLimit: 10,
        targetType: "wallet",
        ipErrorCode: "RATE_LIMIT_IP",
        targetErrorCode: "RATE_LIMIT_WALLET",
      });

      expect(RATE_LIMIT_POLICIES.LOOKUP).toMatchObject({
        name: "lookup",
        windowMs: 60_000,
        ipLimit: 60,
        targetLimit: 30,
        targetType: "addr",
        ipErrorCode: "RATE_LIMIT_IP",
        targetErrorCode: "RATE_LIMIT_WALLET",
      });
    });

    it("buildBucketKey constructs collision-free namespaced keys", () => {
      expect(buildBucketKey("proxy", "ip", "192.168.1.1")).toBe("proxy:ip:192.168.1.1");
      expect(buildBucketKey("auth", "wallet", "G12345")).toBe("auth:wallet:G12345");
      expect(buildBucketKey("lookup", "addr", "G67890")).toBe("lookup:addr:G67890");
      expect(buildBucketKey("custom", "key")).toBe("custom:key");
    });
  });

  // ── 2. Shared Store Interface ─────────────────────────────────
  describe("Shared store interface", () => {
    it("getRateLimitStore returns the shared singleton used by proxy and handlers", () => {
      const current = getRateLimitStore();
      expect(current).toBe(store);
    });

    it("setRateLimitStore updates the store used by all enforcement points", async () => {
      let customIncrementCalled = false;
      const customStore: RateLimitStore = {
        async increment() {
          customIncrementCalled = true;
          return { allowed: true, remaining: 10, resetAt: Date.now() + 60_000 };
        },
        async reset() {},
      };

      setRateLimitStore(customStore);

      const req = new Request("http://localhost/api/test", {
        headers: { "x-forwarded-for": "10.0.0.1" },
      });
      await enforceRateLimit(req, RATE_LIMIT_POLICIES.PROXY);

      expect(customIncrementCalled).toBe(true);
    });
  });

  // ── 3. Identical Header Formatting Across All Callers ─────────
  describe("Identical header formatting across all callers", () => {
    const REQUIRED_RATE_LIMIT_HEADERS = [
      "X-RateLimit-Limit",
      "X-RateLimit-Remaining",
      "X-RateLimit-Reset",
      "Retry-After",
      "X-Content-Type-Options",
    ] as const;

    function assertStandardRateLimitHeaders(
      headers: Headers,
      expectedLimit: number,
      expectedRemaining = 0
    ) {
      for (const headerName of REQUIRED_RATE_LIMIT_HEADERS) {
        expect(headers.has(headerName), `Missing header: ${headerName}`).toBe(true);
      }

      expect(headers.get("X-RateLimit-Limit")).toBe(String(expectedLimit));
      expect(headers.get("X-RateLimit-Remaining")).toBe(String(expectedRemaining));
      expect(headers.get("X-Content-Type-Options")).toBe("nosniff");

      const reset = Number(headers.get("X-RateLimit-Reset"));
      expect(Number.isInteger(reset)).toBe(true);
      expect(reset).toBeGreaterThan(0);

      const retryAfter = Number(headers.get("Retry-After"));
      expect(Number.isInteger(retryAfter)).toBe(true);
      if (expectedRemaining === 0) {
        expect(retryAfter).toBeGreaterThanOrEqual(1);
      }
    }

    it("direct writeRateLimitHeaders formats standard headers", () => {
      const info: RateLimitInfo = {
        limit: 100,
        remaining: 0,
        reset: Math.floor(Date.now() / 1000) + 45,
      };
      const headerObj = writeRateLimitHeaders(info);
      const headers = new Headers(headerObj);
      assertStandardRateLimitHeaders(headers, 100, 0);
    });

    it("Edge Proxy emits identical rate limit headers on 429", async () => {
      vi.stubEnv("RATE_LIMIT_RPM", "1");
      const nextReq = new NextRequest("http://localhost/api/test", {
        headers: { "x-forwarded-for": "198.51.100.99" },
      });

      // Request 1: allowed
      const allowedRes = await proxy(nextReq);
      expect(allowedRes.status).toBe(200);
      expect(allowedRes.headers.get("X-RateLimit-Limit")).toBe("1");
      expect(allowedRes.headers.get("X-RateLimit-Remaining")).toBe("0");

      // Request 2: blocked (429)
      const blockedRes = await proxy(nextReq);
      expect(blockedRes.status).toBe(429);
      assertStandardRateLimitHeaders(blockedRes.headers, 1, 0);
      expect(blockedRes.headers.has("X-Request-Id")).toBe(true);
    });

    it("Auth IP rate limiter emits identical rate limit headers on 429", async () => {
      const req = new Request("http://localhost/api/auth/challenge", {
        headers: { "x-forwarded-for": "198.51.100.101" },
      });

      // Exhaust limit of 1
      await enforceAuthRateLimit(req, { ipLimit: 1 });
      const blocked = await enforceAuthRateLimit(req, { ipLimit: 1 });

      expect(blocked).not.toBeNull();
      expect(blocked!.status).toBe(429);
      assertStandardRateLimitHeaders(blocked!.headers, 1, 0);
    });

    it("Auth Wallet rate limiter emits identical rate limit headers on 429", async () => {
      const pk = "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U";
      const req = new Request("http://localhost/api/auth/challenge", {
        headers: { "x-forwarded-for": "198.51.100.102" },
      });

      // Exhaust wallet limit of 1
      await enforceAuthRateLimit(req, { publicKey: pk, ipLimit: 100, walletLimit: 1 });
      const blocked = await enforceAuthRateLimit(req, { publicKey: pk, ipLimit: 100, walletLimit: 1 });

      expect(blocked).not.toBeNull();
      expect(blocked!.status).toBe(429);
      assertStandardRateLimitHeaders(blocked!.headers, 1, 0);
    });

    it("Lookup IP rate limiter emits identical rate limit headers on 429", async () => {
      const req = new Request("http://localhost/api/rbac", {
        headers: { "x-forwarded-for": "198.51.100.103" },
      });

      await enforceLookupRateLimit(req, { ipLimit: 1, addressLimit: 100 });
      const blocked = await enforceLookupRateLimit(req, { ipLimit: 1, addressLimit: 100 });

      expect(blocked).not.toBeNull();
      expect(blocked!.status).toBe(429);
      assertStandardRateLimitHeaders(blocked!.headers, 1, 0);
    });

    it("Lookup Address rate limiter emits identical rate limit headers on 429", async () => {
      const addr = "GBD2G5AG4QXLQL5GXGBH7Z4LQO2W3XHOKQQSWH4F6Z5VR2P4B7XM3S2A";
      const req = new Request("http://localhost/api/rbac", {
        headers: { "x-forwarded-for": "198.51.100.104" },
      });

      await enforceLookupRateLimit(req, { address: addr, ipLimit: 100, addressLimit: 1 });
      const blocked = await enforceLookupRateLimit(req, { address: addr, ipLimit: 100, addressLimit: 1 });

      expect(blocked).not.toBeNull();
      expect(blocked!.status).toBe(429);
      assertStandardRateLimitHeaders(blocked!.headers, 1, 0);
    });
  });

  // ── 4. Backward Compatibility ─────────────────────────────────
  describe("Legacy helpers and headers compatibility", () => {
    it("getRateLimitHeaders formats headers matching legacy tests", () => {
      const headers = getRateLimitHeaders({ limit: 60, remaining: 30, reset: 1800000000 });
      expect(headers["X-RateLimit-Limit"]).toBe("60");
      expect(headers["X-RateLimit-Remaining"]).toBe("30");
      expect(headers["X-RateLimit-Reset"]).toBe("1800000000");
      expect(headers["Retry-After"]).toBe("0");
    });

    it("isRateLimited checks whether capacity is exhausted before reset", () => {
      const future = Math.floor(Date.now() / 1000) + 120;
      expect(isRateLimited({ limit: 60, remaining: 0, reset: future })).toBe(true);
      expect(isRateLimited({ limit: 60, remaining: 5, reset: future })).toBe(false);
    });
  });
});
