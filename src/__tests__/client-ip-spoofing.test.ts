// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  extractClientIp,
  normalizeIpCandidate,
  resolveTrustedProxyDepth,
  isValidIpv4,
  isValidIpv6,
  isIpInCidr,
  FALLBACK_CLIENT_IP,
} from "@/lib/client-ip";
import {
  InMemoryRateLimitStore,
  setRateLimitStore,
} from "@/lib/rate-limit";
import { enforceAuthRateLimit } from "@/lib/auth-rate-limit";
import { enforceLookupRateLimit } from "@/lib/lookup-rate-limit";

describe("Hardened client IP extraction against X-Forwarded-For spoofing (#1387)", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    setRateLimitStore(new InMemoryRateLimitStore());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("multi-hop X-Forwarded-For right-to-left parsing", () => {
    it("ignores attacker-prepended X-Forwarded-For entries at index 0 (default depth = 1)", () => {
      // Attacker sends `X-Forwarded-For: 1.1.1.1, 8.8.8.8`; edge proxy appends
      // real client IP `203.0.113.5` and internal LB appends `198.51.100.2`.
      const req = new Request("https://ophirpay.test/api/payments", {
        headers: {
          "x-forwarded-for": "1.1.1.1, 8.8.8.8, 203.0.113.5, 198.51.100.2",
        },
      });

      expect(extractClientIp(req)).toBe("203.0.113.5");
    });

    it("respects configurable TRUSTED_PROXY_DEPTH from environment or options", () => {
      vi.stubEnv("TRUSTED_PROXY_DEPTH", "2");
      expect(resolveTrustedProxyDepth()).toBe(2);

      const req = new Request("https://ophirpay.test/api/payments", {
        headers: {
          "x-forwarded-for":
            "9.9.9.9, 203.0.113.42, 198.51.100.10, 10.0.0.5",
        },
      });

      expect(extractClientIp(req)).toBe("203.0.113.42");
      expect(extractClientIp(req, { trustedProxyDepth: 1 })).toBe(
        "198.51.100.10"
      );
      expect(extractClientIp(req, { trustedProxyDepth: 0 })).toBe("10.0.0.5");
    });

    it("supports trusted proxy CIDR list stripping from right to left", () => {
      const headers = new Headers({
        "x-forwarded-for": "1.2.3.4, 203.0.113.99, 198.51.100.7, 10.12.0.4",
      });

      const ip = extractClientIp(headers, {
        trustedProxyDepth: 3,
        trustedProxyCidrs: ["10.0.0.0/8", "198.51.100.0/24"],
      });
      expect(ip).toBe("203.0.113.99");
      expect(isIpInCidr("10.12.0.4", "10.0.0.0/8")).toBe(true);
      expect(isIpInCidr("203.0.113.99", "10.0.0.0/8")).toBe(false);
    });
  });

  describe("IPv4 and IPv6 validation and normalization", () => {
    it("extracts and normalizes standard, compressed, bracketed, and IPv4-mapped IPv6 addresses", () => {
      expect(
        extractClientIp(
          new Headers({
            "x-forwarded-for": "2001:DB8::1, 2001:db8::2",
          })
        )
      ).toBe("2001:db8::1");

      expect(
        extractClientIp(
          new Headers({
            "x-forwarded-for": "[2001:db8:85a3::8a2e:370:7334]:443, 198.51.100.1",
          })
        )
      ).toBe("2001:db8:85a3::8a2e:370:7334");

      expect(normalizeIpCandidate("::ffff:203.0.113.5")).toBe("203.0.113.5");
      expect(normalizeIpCandidate("203.0.113.5:54321")).toBe("203.0.113.5");
      expect(normalizeIpCandidate("fe80::1%eth0")).toBe("fe80::1");
    });

    it("rejects malformed IPs and falls back safely to x-real-ip, cf-connecting-ip, or unknown", () => {
      expect(isValidIpv4("999.999.999.999")).toBe(false);
      expect(isValidIpv4("256.0.0.1")).toBe(false);
      expect(isValidIpv4("01.2.3.4")).toBe(false);
      expect(isValidIpv6("2001::db8::1")).toBe(false);
      expect(isValidIpv6("not-an-ip")).toBe(false);

      // Malformed XFF falls back to valid x-real-ip
      expect(
        extractClientIp(
          new Headers({
            "x-forwarded-for": "not-an-ip, 999.999.999.999",
            "x-real-ip": "192.0.2.55",
          })
        )
      ).toBe("192.0.2.55");

      // Malformed XFF + malformed x-real-ip falls back to cf-connecting-ip
      expect(
        extractClientIp(
          new Headers({
            "x-forwarded-for": "<script>alert(1)</script>",
            "x-real-ip": "bad_ip",
            "cf-connecting-ip": "2001:db8::abcd",
          })
        )
      ).toBe("2001:db8::abcd");

      // Missing or all-invalid headers fall back to "unknown"
      expect(extractClientIp(new Headers())).toBe(FALLBACK_CLIENT_IP);
      expect(
        extractClientIp(
          new Headers({
            "x-forwarded-for": "invalid-ip",
            "x-real-ip": "also-invalid",
          })
        )
      ).toBe("unknown");
    });
  });

  describe("rate limiter resistance to X-Forwarded-For header rotation", () => {
    it("throttles a client rotating spoofed X-Forwarded-For prefixes across auth and lookup rate limiters", async () => {
      for (let i = 1; i <= 2; i++) {
        const res = await enforceAuthRateLimit(
          new Request("https://ophirpay.test/api/auth/challenge", {
            headers: {
              "x-forwarded-for": `10.99.0.${i}, 203.0.113.77, 198.51.100.1`,
            },
          }),
          { ipLimit: 2, windowMs: 60_000 }
        );
        expect(res).toBeNull();
      }

      // 3rd request with a brand-new spoofed prefix is still blocked because
      // the rightmost-N real IP (203.0.113.77) is unchanged
      const blockedAuth = await enforceAuthRateLimit(
        new Request("https://ophirpay.test/api/auth/challenge", {
          headers: {
            "x-forwarded-for": "10.99.0.99, 203.0.113.77, 198.51.100.1",
          },
        }),
        { ipLimit: 2, windowMs: 60_000 }
      );
      expect(blockedAuth?.status).toBe(429);

      // Verify lookup rate limiter also blocks spoofed prefix rotation
      const firstLookup = await enforceLookupRateLimit(
        new Request("https://ophirpay.test/api/rbac", {
          headers: {
            "x-forwarded-for": "172.16.0.1, 203.0.113.88, 198.51.100.1",
          },
        }),
        { ipLimit: 1, windowMs: 60_000 }
      );
      expect(firstLookup).toBeNull();

      const blockedLookup = await enforceLookupRateLimit(
        new Request("https://ophirpay.test/api/rbac", {
          headers: {
            "x-forwarded-for": "172.16.0.2, 203.0.113.88, 198.51.100.1",
          },
        }),
        { ipLimit: 1, windowMs: 60_000 }
      );
      expect(blockedLookup?.status).toBe(429);
    });
  });
});
