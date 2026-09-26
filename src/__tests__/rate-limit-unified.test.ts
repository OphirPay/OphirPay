// SPDX-License-Identifier: MIT
/**
 * @vitest-environment node
 *
 * Issue #759 — the four rate-limit modules were merged into one component.
 * These tests pin the two acceptance criteria that must hold regardless of
 * which caller rejected the request:
 *
 *   1. the store interface, bucket keys and header writer are shared, and
 *   2. every caller formats the 429 headers identically.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AUTH_RATE_LIMIT_POLICY,
  GLOBAL_RATE_LIMIT_POLICY,
  InMemoryRateLimitStore,
  LOOKUP_RATE_LIMIT_POLICY,
  buildRateLimitKey,
  formatRateLimitHeaders,
  setRateLimitStore,
} from "@/lib/rate-limit";
import { enforceAuthRateLimit } from "@/lib/auth-rate-limit";
import { enforceLookupRateLimit } from "@/lib/lookup-rate-limit";
import { getRateLimitHeaders } from "@/lib/rate-limit-headers";

const REQUEST = (ip: string, target: string) => {
  return new Request(`http://localhost/api/test?target=${target}`, {
    headers: { "x-forwarded-for": ip },
  });
};

const PK = "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U";

beforeEach(() => {
  setRateLimitStore(new InMemoryRateLimitStore());
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function stableHeaders(res: Response): Record<string, string> {
  return {
    "X-RateLimit-Limit": res.headers.get("X-RateLimit-Limit") ?? "",
    "X-RateLimit-Remaining": res.headers.get("X-RateLimit-Remaining") ?? "",
    "X-RateLimit-Reset": res.headers.get("X-RateLimit-Reset") ?? "",
    "X-Content-Type-Options": res.headers.get("X-Content-Type-Options") ?? "",
  };
}

describe("rate-limit policies are data (#759)", () => {
  it("exposes the auth, lookup and global policies with namespaced bucket scopes", () => {
    expect(AUTH_RATE_LIMIT_POLICY.name).toBe("auth");
    expect(AUTH_RATE_LIMIT_POLICY.ip.scope).toBe("auth:ip");
    expect(AUTH_RATE_LIMIT_POLICY.target?.scope).toBe("auth:wallet");

    expect(LOOKUP_RATE_LIMIT_POLICY.name).toBe("lookup");
    expect(LOOKUP_RATE_LIMIT_POLICY.ip.scope).toBe("lookup:ip");
    expect(LOOKUP_RATE_LIMIT_POLICY.target?.scope).toBe("lookup:addr");

    expect(GLOBAL_RATE_LIMIT_POLICY.name).toBe("global");
    expect(GLOBAL_RATE_LIMIT_POLICY.ip.scope).toBe("global");
  });

  it("builds namespaced bucket keys in one place", () => {
    expect(buildRateLimitKey("auth:ip", "203.0.113.1")).toBe("auth:ip:203.0.113.1");
    expect(buildRateLimitKey("lookup:addr", PK)).toBe(`lookup:addr:${PK}`);
  });
});

describe("identical header formatting across all callers (#759)", () => {
  it("auth and lookup 429s emit byte-identical header values for the same limit", async () => {
    // Exhaust both limiters for the same IP with a limit of 1.
    await enforceAuthRateLimit(REQUEST("203.0.113.9", PK), {
      publicKey: PK,
      ipLimit: 1,
      walletLimit: 100,
    });
    const authRes = (await enforceAuthRateLimit(REQUEST("203.0.113.9", PK), {
      publicKey: PK,
      ipLimit: 1,
      walletLimit: 100,
    }))!;

    await enforceLookupRateLimit(REQUEST("203.0.113.9", PK), {
      address: PK,
      ipLimit: 1,
      addressLimit: 100,
    });
    const lookupRes = (await enforceLookupRateLimit(REQUEST("203.0.113.9", PK), {
      address: PK,
      ipLimit: 1,
      addressLimit: 100,
    }))!;

    expect(authRes.status).toBe(429);
    expect(lookupRes.status).toBe(429);

    // Formatting is identical across the two callers.
    expect(stableHeaders(authRes)).toEqual(stableHeaders(lookupRes));
    expect(Number(authRes.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(Number(lookupRes.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("auth/lookup 429 headers match the shared header writer exactly", async () => {
    await enforceAuthRateLimit(REQUEST("203.0.113.11", PK), {
      publicKey: PK,
      ipLimit: 1,
      walletLimit: 100,
    });
    const res = (await enforceAuthRateLimit(REQUEST("203.0.113.11", PK), {
      publicKey: PK,
      ipLimit: 1,
      walletLimit: 100,
    }))!;

    const expected = formatRateLimitHeaders({
      limit: 1,
      remaining: 0,
      resetAt: Number(res.headers.get("X-RateLimit-Reset")) * 1000,
    });
    expect(stableHeaders(res)).toEqual({
      "X-RateLimit-Limit": expected["X-RateLimit-Limit"],
      "X-RateLimit-Remaining": expected["X-RateLimit-Remaining"],
      "X-RateLimit-Reset": expected["X-RateLimit-Reset"],
      "X-Content-Type-Options": expected["X-Content-Type-Options"],
    });
  });

  it("rate-limit-headers mirrors the shared writer", () => {
    const info = { limit: 100, remaining: 0, reset: Math.floor(Date.now() / 1000) + 60 };
    const viaAdapter = getRateLimitHeaders(info);
    const viaCore = formatRateLimitHeaders({
      limit: info.limit,
      remaining: info.remaining,
      resetAt: info.reset * 1000,
    });
    expect(viaAdapter).toEqual(viaCore);
  });

  it("the proxy imports the shared key builder and header writer", () => {
    const proxy = readFileSync(join(process.cwd(), "src/proxy.ts"), "utf8");
    expect(proxy).toContain("buildRateLimitKey");
    expect(proxy).toContain("formatRateLimitHeaders");
  });

  it("rate-limit-headers is a thin adapter over the shared writer", () => {
    const adapter = readFileSync(
      join(process.cwd(), "src/lib/rate-limit-headers.ts"),
      "utf8",
    );
    expect(adapter).toContain('from "@/lib/rate-limit"');
    expect(adapter).toContain("formatRateLimitHeaders");
  });
});
