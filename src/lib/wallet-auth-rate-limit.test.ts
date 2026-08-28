import { describe, expect, it, beforeEach } from "vitest";

import {
  checkWalletAuthRateLimit,
  getClientIp,
} from "./wallet-auth-rate-limit";
import { InMemoryRateLimitStore, setRateLimitStore } from "./rate-limit";

const PK1 = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const PK2 = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

function createMockRequest(ip = "192.168.1.1"): Request {
  return new Request("https://api.ophirpay.com/api/auth/challenge", {
    headers: {
      "x-forwarded-for": ip,
    },
  });
}

describe("Wallet Auth Rate Limiting (Per-IP & Per-Account)", () => {
  beforeEach(() => {
    // Reset rate limit store before each test
    setRateLimitStore(new InMemoryRateLimitStore());
  });

  describe("getClientIp", () => {
    it("extracts client IP from x-forwarded-for header", () => {
      const req = new Request("https://example.com", {
        headers: { "x-forwarded-for": "203.0.113.195, 70.41.3.18" },
      });
      expect(getClientIp(req)).toBe("203.0.113.195");
    });

    it("falls back to x-real-ip or 127.0.0.1", () => {
      const reqReal = new Request("https://example.com", {
        headers: { "x-real-ip": "10.0.0.1" },
      });
      expect(getClientIp(reqReal)).toBe("10.0.0.1");

      const reqEmpty = new Request("https://example.com");
      expect(getClientIp(reqEmpty)).toBe("127.0.0.1");
    });
  });

  describe("IP Bucket Isolation & Rate Limiting", () => {
    it("allows requests under the IP limit and rejects with 429 when exceeded", async () => {
      const req = createMockRequest("1.2.3.4");
      const config = { ipMaxRequests: 3, ipWindowMs: 60000 };

      expect(await checkWalletAuthRateLimit(req, undefined, config)).toBeNull();
      expect(await checkWalletAuthRateLimit(req, undefined, config)).toBeNull();
      expect(await checkWalletAuthRateLimit(req, undefined, config)).toBeNull();

      // 4th request exceeds limit
      const blocked = await checkWalletAuthRateLimit(req, undefined, config);
      expect(blocked).not.toBeNull();
      expect(blocked?.status).toBe(429);
      expect(blocked?.headers.get("Retry-After")).toBeDefined();
      expect(blocked?.headers.get("X-RateLimit-Limit")).toBe("3");
      expect(blocked?.headers.get("X-RateLimit-Remaining")).toBe("0");

      const body = await blocked?.json();
      expect(body.error).toContain("Too many authentication requests from this IP");
    });

    it("isolates different IPs into independent buckets", async () => {
      const req1 = createMockRequest("10.0.0.1");
      const req2 = createMockRequest("10.0.0.2");
      const config = { ipMaxRequests: 2, ipWindowMs: 60000 };

      // Exhaust IP 1
      await checkWalletAuthRateLimit(req1, undefined, config);
      await checkWalletAuthRateLimit(req1, undefined, config);
      expect(await checkWalletAuthRateLimit(req1, undefined, config)).not.toBeNull();

      // IP 2 is fresh and allowed
      expect(await checkWalletAuthRateLimit(req2, undefined, config)).toBeNull();
    });
  });

  describe("Account Bucket Isolation & Rate Limiting", () => {
    it("rate-limits specific accounts regardless of IP rotation", async () => {
      const config = {
        ipMaxRequests: 100, // high IP limit
        accountMaxRequests: 2, // low account limit
        accountWindowMs: 60000,
      };

      const req1 = createMockRequest("10.0.0.1");
      const req2 = createMockRequest("10.0.0.2");

      expect(await checkWalletAuthRateLimit(req1, PK1, config)).toBeNull();
      expect(await checkWalletAuthRateLimit(req2, PK1, config)).toBeNull();

      // 3rd attempt targeting PK1 from a new IP is blocked by account bucket
      const req3 = createMockRequest("10.0.0.3");
      const blocked = await checkWalletAuthRateLimit(req3, PK1, config);
      expect(blocked).not.toBeNull();
      expect(blocked?.status).toBe(429);

      const body = await blocked?.json();
      expect(body.error).toContain(`Too many authentication attempts for account ${PK1}`);

      // PK2 is unaffected and allowed
      expect(await checkWalletAuthRateLimit(req3, PK2, config)).toBeNull();
    });
  });
});
