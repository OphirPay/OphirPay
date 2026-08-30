// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  InMemoryRateLimitStore,
  setRateLimitStore,
} from "@/lib/rate-limit";
import {
  enforceLookupRateLimit,
} from "@/lib/lookup-rate-limit";
import { GET as RbacGET } from "@/app/api/rbac/route";
import { GET as CollectorGET } from "@/app/api/fee-config/collector/route";

const ADDR_A = "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U";
const ADDR_B = "GBD2G5AG4QXLQL5GXGBH7Z4LQO2W3XHOKQQSWH4F6Z5VR2P4B7XM3S2A";

function makeRequest(ip = "198.51.100.25", url = "http://localhost/api/rbac?addr=" + ADDR_A): Request {
  return new Request(url, {
    headers: {
      "x-forwarded-for": ip,
      "authorization": "Bearer ophir_test_key_123",
    },
  });
}

beforeEach(() => {
  setRateLimitStore(new InMemoryRateLimitStore());
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ─── enforceLookupRateLimit — bucket semantics ──────────────────

describe("enforceLookupRateLimit", () => {
  it("allows lookup requests within configured limits", async () => {
    const res = await enforceLookupRateLimit(makeRequest(), {
      address: ADDR_A,
      ipLimit: 5,
      addressLimit: 5,
    });
    expect(res).toBeNull();
  });

  it("isolates per-IP lookup buckets across different client IPs", async () => {
    const ip1Req = makeRequest("198.51.100.1");
    for (let i = 0; i < 2; i++) {
      expect(
        await enforceLookupRateLimit(ip1Req, { ipLimit: 2, addressLimit: 100 })
      ).toBeNull();
    }
    // ip1 is exhausted
    const blocked = await enforceLookupRateLimit(ip1Req, { ipLimit: 2, addressLimit: 100 });
    expect(blocked?.status).toBe(429);

    // Different IP is allowed
    const ip2Req = makeRequest("198.51.100.2");
    expect(
      await enforceLookupRateLimit(ip2Req, { ipLimit: 2, addressLimit: 100 })
    ).toBeNull();
  });

  it("isolates per-address buckets when querying different addresses from the same IP", async () => {
    for (let i = 0; i < 2; i++) {
      expect(
        await enforceLookupRateLimit(makeRequest(), {
          address: ADDR_A,
          ipLimit: 100,
          addressLimit: 2,
        })
      ).toBeNull();
    }
    // Target address A bucket exhausted
    const blocked = await enforceLookupRateLimit(makeRequest(), {
      address: ADDR_A,
      ipLimit: 100,
      addressLimit: 2,
    });
    expect(blocked?.status).toBe(429);

    // Target address B from same IP is allowed
    expect(
      await enforceLookupRateLimit(makeRequest(), {
        address: ADDR_B,
        ipLimit: 100,
        addressLimit: 2,
      })
    ).toBeNull();
  });

  it("returns 429 with required Retry-After and RateLimit headers on IP exhaustion", async () => {
    const req = makeRequest();
    for (let i = 0; i < 2; i++) {
      await enforceLookupRateLimit(req, { ipLimit: 2, addressLimit: 100 });
    }
    const res = await enforceLookupRateLimit(req, { ipLimit: 2, addressLimit: 100 });
    expect(res).not.toBeNull();
    expect(res!.status).toBe(429);

    const body = await res!.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("RATE_LIMIT_IP");
    expect(Number(res!.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(res!.headers.get("X-RateLimit-Limit")).toBe("2");
    expect(res!.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(Number(res!.headers.get("X-RateLimit-Reset"))).toBeGreaterThan(0);
  });

  it("returns RATE_LIMIT_WALLET when target address bucket is exhausted", async () => {
    const req = makeRequest();
    for (let i = 0; i < 2; i++) {
      await enforceLookupRateLimit(req, { address: ADDR_A, ipLimit: 100, addressLimit: 2 });
    }
    const res = await enforceLookupRateLimit(req, { address: ADDR_A, ipLimit: 100, addressLimit: 2 });
    expect(res?.status).toBe(429);

    const body = await res!.json();
    expect(body.error.code).toBe("RATE_LIMIT_WALLET");
    expect(Number(res!.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("respects LOOKUP_RATE_LIMIT_IP_RPM and LOOKUP_RATE_LIMIT_ADDR_RPM env vars", async () => {
    vi.stubEnv("LOOKUP_RATE_LIMIT_IP_RPM", "2");
    vi.stubEnv("LOOKUP_RATE_LIMIT_ADDR_RPM", "50");

    expect(await enforceLookupRateLimit(makeRequest(), { address: ADDR_A })).toBeNull();
    expect(await enforceLookupRateLimit(makeRequest(), { address: ADDR_A })).toBeNull();
    const third = await enforceLookupRateLimit(makeRequest(), { address: ADDR_A });
    expect(third?.status).toBe(429);
    const body = await third!.json();
    expect(body.error.code).toBe("RATE_LIMIT_IP");
  });
});
