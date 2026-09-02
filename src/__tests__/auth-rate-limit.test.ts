// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  InMemoryRateLimitStore,
  setRateLimitStore,
} from "@/lib/rate-limit";
import {
  enforceAuthRateLimit,
} from "@/lib/auth-rate-limit";
import { GET as ChallengeGET } from "@/app/api/auth/challenge/route";
import { POST as SessionPOST } from "@/app/api/auth/session/route";
import { generateCsrfToken, csrfCookieHeader } from "@/lib/csrf";

const PK_A = "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U";
const PK_B = "GBD2G5AG4QXLQL5GXGBH7Z4LQO2W3XHOKQQSWH4F6Z5VR2P4B7XM3S2A";
const PK_C = "GC2FGVPLW3ZKZJNGSZMBDJ5M3GVV5QTYQYXYHTZFTVFCI4S3W2Y6O4CJ";

function makeRequest(ip = "203.0.113.7", extra: Record<string, string> = {}): Request {
  const headers: Record<string, string> = { "x-forwarded-for": ip, ...extra };
  return new Request("http://localhost/api/auth/challenge?publicKey=" + PK_A, {
    headers,
  });
}

const TEST_SECRET = "test-auth-secret-123456789012345678901234567890";

beforeEach(() => {
  // Isolated store per test — route handlers resolve the store lazily via
  // getRateLimitStore(), so swapping the singleton is sufficient.
  setRateLimitStore(new InMemoryRateLimitStore());
  vi.stubEnv("AUTH_SECRET", TEST_SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ─── enforceAuthRateLimit — bucket semantics ───────────────────

describe("enforceAuthRateLimit", () => {
  it("allows requests within every limit", async () => {
    const res = await enforceAuthRateLimit(makeRequest(), {
      publicKey: PK_A,
      ipLimit: 5,
      walletLimit: 5,
    });
    expect(res).toBeNull();
  });

  it("isolates per-IP buckets across different IPs", async () => {
    const ip1 = makeRequest("198.51.100.1");
    for (let i = 0; i < 2; i++) {
      expect(
        await enforceAuthRateLimit(ip1, { ipLimit: 2, walletLimit: 100 })
      ).toBeNull();
    }
    // ip1 is exhausted…
    expect(
      (await enforceAuthRateLimit(ip1, { ipLimit: 2, walletLimit: 100 }))?.status
    ).toBe(429);
    // …but a different IP is untouched.
    expect(
      await enforceAuthRateLimit(makeRequest("198.51.100.2"), {
        ipLimit: 2,
        walletLimit: 100,
      })
    ).toBeNull();
  });

  it("isolates per-account buckets between wallets on the same IP", async () => {
    for (let i = 0; i < 2; i++) {
      expect(
        await enforceAuthRateLimit(makeRequest(), {
          publicKey: PK_A,
          ipLimit: 100,
          walletLimit: 2,
        })
      ).toBeNull();
    }
    // Wallet A is exhausted…
    const blocked = await enforceAuthRateLimit(makeRequest(), {
      publicKey: PK_A,
      ipLimit: 100,
      walletLimit: 2,
    });
    expect(blocked?.status).toBe(429);
    // …but wallet B on the same IP is still allowed.
    expect(
      await enforceAuthRateLimit(makeRequest(), {
        publicKey: PK_B,
        ipLimit: 100,
        walletLimit: 2,
      })
    ).toBeNull();
  });

  it("charges the per-account bucket regardless of source IP", async () => {
    // Same wallet hitting from two IPs shares one account bucket.
    for (const ip of ["198.51.100.1", "198.51.100.2"]) {
      expect(
        await enforceAuthRateLimit(makeRequest(ip), {
          publicKey: PK_C,
          ipLimit: 100,
          walletLimit: 2,
        })
      ).toBeNull();
    }
    const blocked = await enforceAuthRateLimit(makeRequest("198.51.100.3"), {
      publicKey: PK_C,
      ipLimit: 100,
      walletLimit: 2,
    });
    expect(blocked?.status).toBe(429);
  });

  it("returns RATE_LIMIT_IP with Retry-After when the IP bucket is exhausted", async () => {
    for (let i = 0; i < 2; i++) {
      await enforceAuthRateLimit(makeRequest(), {
        publicKey: PK_A,
        ipLimit: 2,
        walletLimit: 100,
      });
    }
    const res = await enforceAuthRateLimit(makeRequest(), {
      publicKey: PK_A,
      ipLimit: 2,
      walletLimit: 100,
    });
    expect(res).not.toBeNull();
    const body = await res!.json();
    expect(res!.status).toBe(429);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("RATE_LIMIT_IP");
    expect(Number(res!.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(res!.headers.get("X-RateLimit-Limit")).toBe("2");
    expect(res!.headers.get("X-RateLimit-Remaining")).toBe("0");
  });

  it("returns RATE_LIMIT_WALLET when the account bucket is exhausted", async () => {
    for (let i = 0; i < 2; i++) {
      await enforceAuthRateLimit(makeRequest(), {
        publicKey: PK_A,
        ipLimit: 100,
        walletLimit: 2,
      });
    }
    const res = await enforceAuthRateLimit(makeRequest(), {
      publicKey: PK_A,
      ipLimit: 100,
      walletLimit: 2,
    });
    expect(res?.status).toBe(429);
    const body = await res!.json();
    expect(body.error.code).toBe("RATE_LIMIT_WALLET");
    expect(Number(res!.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("reads limits from environment variables", async () => {
    vi.stubEnv("AUTH_RATE_LIMIT_IP_RPM", "2");
    vi.stubEnv("AUTH_RATE_LIMIT_WALLET_RPM", "50");
    expect(await enforceAuthRateLimit(makeRequest(), { publicKey: PK_A })).toBeNull();
    expect(await enforceAuthRateLimit(makeRequest(), { publicKey: PK_A })).toBeNull();
    const third = await enforceAuthRateLimit(makeRequest(), { publicKey: PK_A });
    expect(third?.status).toBe(429);
    const body = await third!.json();
    expect(body.error.code).toBe("RATE_LIMIT_IP");
  });
});

// ── Route integration: GET /api/auth/challenge ─────────────────

describe("GET /api/auth/challenge rate limiting", () => {
  it("returns 429 RATE_LIMIT_IP after the per-IP limit is exceeded", async () => {
    vi.stubEnv("AUTH_RATE_LIMIT_IP_RPM", "2");
    vi.stubEnv("AUTH_RATE_LIMIT_WALLET_RPM", "100");

    const req = () =>
      new Request(
        "http://localhost/api/auth/challenge?publicKey=" + PK_A,
        { headers: { "x-forwarded-for": "203.0.113.9" } }
      );

    expect((await ChallengeGET(req())).status).toBe(200);
    expect((await ChallengeGET(req())).status).toBe(200);
    const third = await ChallengeGET(req());
    expect(third.status).toBe(429);
    const body = await third.json();
    expect(body.error.code).toBe("RATE_LIMIT_IP");
    expect(Number(third.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("returns 429 RATE_LIMIT_WALLET per wallet without blocking other wallets", async () => {
    vi.stubEnv("AUTH_RATE_LIMIT_IP_RPM", "100");
    vi.stubEnv("AUTH_RATE_LIMIT_WALLET_RPM", "2");

    const req = (pk: string) =>
      new Request(`http://localhost/api/auth/challenge?publicKey=${pk}`, {
        headers: { "x-forwarded-for": "203.0.113.10" },
      });

    expect((await ChallengeGET(req(PK_A))).status).toBe(200);
    expect((await ChallengeGET(req(PK_A))).status).toBe(200);
    const blocked = await ChallengeGET(req(PK_A));
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).error.code).toBe("RATE_LIMIT_WALLET");

    // Bucket isolation: wallet B behind the same IP is not blocked.
    expect((await ChallengeGET(req(PK_B))).status).toBe(200);
  });
});

// ── Route integration: POST /api/auth/session ──────────────────

describe("POST /api/auth/session rate limiting", () => {
  function csrfHeaders(): Record<string, string> {
    const token = generateCsrfToken();
    return {
      cookie: csrfCookieHeader(token, false),
      "x-csrf-token": token,
      "Content-Type": "application/json",
    };
  }

  function sessionRequest(publicKey: string): Request {
    return new Request("http://localhost/api/auth/session", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.11", ...csrfHeaders() },
      body: JSON.stringify({ publicKey }),
    });
  }

  it("enforces the per-IP limit before any signature verification", async () => {
    vi.stubEnv("AUTH_RATE_LIMIT_IP_RPM", "2");
    vi.stubEnv("AUTH_RATE_LIMIT_WALLET_RPM", "100");

    // First two land inside the limit → they reach the proof-of-ownership
    // gate and fail with UNAUTHORIZED (no challenge/signature provided),
    // which proves the handler ran past the rate limiter.
    expect((await SessionPOST(sessionRequest(PK_A))).status).toBe(401);
    expect((await SessionPOST(sessionRequest(PK_A))).status).toBe(401);

    // Third is throttled before any proof handling.
    const third = await SessionPOST(sessionRequest(PK_A));
    expect(third.status).toBe(429);
    expect((await third.json()).error.code).toBe("RATE_LIMIT_IP");
    expect(Number(third.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("enforces the per-wallet limit independently of other wallets", async () => {
    vi.stubEnv("AUTH_RATE_LIMIT_IP_RPM", "100");
    vi.stubEnv("AUTH_RATE_LIMIT_WALLET_RPM", "1");

    expect((await SessionPOST(sessionRequest(PK_A))).status).toBe(401);
    const blocked = await SessionPOST(sessionRequest(PK_A));
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).error.code).toBe("RATE_LIMIT_WALLET");

    // Another wallet on the same IP is unaffected.
    expect((await SessionPOST(sessionRequest(PK_B))).status).toBe(401);
  });
});
