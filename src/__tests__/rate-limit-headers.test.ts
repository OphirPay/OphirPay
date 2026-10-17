// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach } from "vitest";
import {
  InMemoryRateLimitStore,
  setRateLimitStore,
  type RateLimitResult,
} from "@/lib/rate-limit";
import {
  buildRateLimitHeaders,
  applyRateLimitHeaders,
  createRateLimitedResponse,
  withRateLimitHeaders,
} from "@/lib/rate-limit-headers";

describe("rate-limit telemetry headers (#1290)", () => {
  beforeEach(() => {
    setRateLimitStore(new InMemoryRateLimitStore());
  });

  it("includes X-RateLimit-Limit, X-RateLimit-Remaining, and X-RateLimit-Reset on allowed requests", () => {
    const now = 1_700_000_000_000;
    const result: RateLimitResult = {
      allowed: true,
      remaining: 99,
      resetAt: now + 60_000,
    };

    const headers = buildRateLimitHeaders(result, 100, { now });
    expect(headers["X-RateLimit-Limit"]).toBe("100");
    expect(headers["X-RateLimit-Remaining"]).toBe("99");
    expect(headers["X-RateLimit-Reset"]).toBe(String(Math.ceil((now + 60_000) / 1000)));
    expect(headers["Retry-After"]).toBeUndefined();
  });

  it("includes Retry-After and X-RateLimit-Remaining: 0 when rate-limited", () => {
    const now = 1_700_000_000_000;
    const result: RateLimitResult = {
      allowed: false,
      remaining: 0,
      resetAt: now + 45_200,
    };

    const headers = buildRateLimitHeaders(result, 60, { now });
    expect(headers["X-RateLimit-Limit"]).toBe("60");
    expect(headers["X-RateLimit-Remaining"]).toBe("0");
    expect(headers["X-RateLimit-Reset"]).toBe(String(Math.ceil((now + 45_200) / 1000)));
    expect(headers["Retry-After"]).toBe("46");
  });

  it("attaches headers to 2xx responses and decrements X-RateLimit-Remaining across requests", async () => {
    const now = 1_700_000_000_000;
    const makeReq = () =>
      new Request("https://ophirpay.test/api/payments", {
        headers: { "x-forwarded-for": "203.0.113.10" },
      });

    const res1 = await withRateLimitHeaders(
      makeReq(),
      () => Response.json({ success: true, data: [] }, { status: 200 }),
      { limit: 2, windowMs: 60_000, now }
    );
    expect(res1.status).toBe(200);
    expect(res1.headers.get("X-RateLimit-Limit")).toBe("2");
    expect(res1.headers.get("X-RateLimit-Remaining")).toBe("1");
    expect(res1.headers.get("X-RateLimit-Reset")).toBeTruthy();

    const res2 = await withRateLimitHeaders(
      makeReq(),
      () => Response.json({ success: true, data: [] }, { status: 200 }),
      { limit: 2, windowMs: 60_000, now }
    );
    expect(res2.status).toBe(200);
    expect(res2.headers.get("X-RateLimit-Limit")).toBe("2");
    expect(res2.headers.get("X-RateLimit-Remaining")).toBe("0");

    const res3 = await withRateLimitHeaders(
      makeReq(),
      () => Response.json({ success: true, data: [] }, { status: 200 }),
      { limit: 2, windowMs: 60_000, now }
    );
    expect(res3.status).toBe(429);
    expect(res3.headers.get("X-RateLimit-Limit")).toBe("2");
    expect(res3.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(Number(res3.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
    expect(Number(res3.headers.get("X-RateLimit-Reset"))).toBeGreaterThan(0);

    const body = (await res3.json()) as {
      success: boolean;
      error: { code: string; message: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("RATE_LIMITED");
  });

  it("applyRateLimitHeaders and createRateLimitedResponse populate standard headers", () => {
    const now = 1_700_000_000_000;
    const baseResponse = new Response(JSON.stringify({ ok: true }), { status: 200 });
    const decorated = applyRateLimitHeaders(
      baseResponse,
      { allowed: true, remaining: 14, resetAt: now + 30_000 },
      15,
      { now }
    );
    expect(decorated.headers.get("X-RateLimit-Limit")).toBe("15");
    expect(decorated.headers.get("X-RateLimit-Remaining")).toBe("14");

    const throttled = createRateLimitedResponse(
      { allowed: false, remaining: 0, resetAt: now + 10_000 },
      15,
      { now }
    );
    expect(throttled.status).toBe(429);
    expect(throttled.headers.get("Retry-After")).toBe("10");
    expect(throttled.headers.get("X-RateLimit-Remaining")).toBe("0");
  });
});
