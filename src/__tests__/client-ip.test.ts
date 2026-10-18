// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isValidIp,
  isValidIPv4,
  isValidIPv6,
  stripPort,
  extractClientIp,
  sanitizeRateLimitKey,
} from "@/lib/client-ip";
import { getClientIp } from "@/lib/proxy-config";
import { InMemoryRateLimitStore } from "@/lib/rate-limit";

describe("Client IP extraction & spoofing defense (#1387)", () => {
  describe("IP syntax validation", () => {
    it("validates standard IPv4 addresses", () => {
      expect(isValidIPv4("192.0.2.1")).toBe(true);
      expect(isValidIPv4("10.0.0.1")).toBe(true);
      expect(isValidIPv4("255.255.255.255")).toBe(true);
      expect(isValidIPv4("0.0.0.0")).toBe(true);

      // Out of bounds or malformed
      expect(isValidIPv4("256.0.0.1")).toBe(false);
      expect(isValidIPv4("192.0.2")).toBe(false);
      expect(isValidIPv4("192.0.2.1.5")).toBe(false);
      expect(isValidIPv4("abc.def.ghi.jkl")).toBe(false);
      expect(isValidIPv4("192.0.2.1/24")).toBe(false);
    });

    it("validates standard and compressed IPv6 addresses", () => {
      expect(isValidIPv6("2001:0db8:85a3:0000:0000:8a2e:0370:7334")).toBe(true);
      expect(isValidIPv6("2001:db8::1")).toBe(true);
      expect(isValidIPv6("::1")).toBe(true);
      expect(isValidIPv6("::ffff:192.0.2.1")).toBe(true);

      // Malformed IPv6
      expect(isValidIPv6("2001:xyz::1")).toBe(false);
      expect(isValidIPv6(":::1")).toBe(false);
      expect(isValidIPv6("1:2:3:4:5:6:7:8:9")).toBe(false);
    });

    it("rejects malicious or injection payloads", () => {
      expect(isValidIp("192.0.2.1\r\nSET bad_key 1")).toBe(false);
      expect(isValidIp("192.0.2.1; DROP TABLE payments;")).toBe(false);
      expect(isValidIp("<script>alert(1)</script>")).toBe(false);
      expect(isValidIp("a".repeat(100))).toBe(false);
      expect(isValidIp("")).toBe(false);
    });

    it("strips ports correctly for IPv4 and bracketed IPv6", () => {
      expect(stripPort("192.0.2.1:8080")).toBe("192.0.2.1");
      expect(stripPort("[2001:db8::1]:443")).toBe("2001:db8::1");
      expect(stripPort("203.0.113.195")).toBe("203.0.113.195");
      expect(stripPort("2001:db8::1")).toBe("2001:db8::1");
    });
  });

  describe("extractClientIp with trusted proxy depth", () => {
    beforeEach(() => {
      delete process.env.TRUSTED_PROXY_DEPTH;
      delete process.env.TRUST_CLOUDFLARE_PROXY;
    });

    afterEach(() => {
      delete process.env.TRUSTED_PROXY_DEPTH;
      delete process.env.TRUST_CLOUDFLARE_PROXY;
    });

    it("ignores spoofed leftmost IP when trusted proxy depth is configured", () => {
      // Attacker sends `X-Forwarded-For: 1.1.1.1`, reverse proxy appends real IP `203.0.113.195`
      const headers = new Headers({
        "x-forwarded-for": "1.1.1.1, 203.0.113.195",
      });

      // With depth = 1 (single reverse proxy), selects the rightmost entry
      const extracted = extractClientIp(headers, { trustedProxyDepth: 1 });
      expect(extracted).toBe("203.0.113.195");
    });

    it("extracts from multiple proxy layers accurately", () => {
      // Chain: attacker spoofed IP, real client IP, internal gateway
      const headers = new Headers({
        "x-forwarded-for": "10.0.0.99, 198.51.100.25, 172.16.0.1",
      });

      // depth = 2 selects the real client IP (198.51.100.25)
      const extracted = extractClientIp(headers, { trustedProxyDepth: 2 });
      expect(extracted).toBe("198.51.100.25");
    });

    it("honors TRUSTED_PROXY_DEPTH environment variable", () => {
      process.env.TRUSTED_PROXY_DEPTH = "1";

      const headers = new Headers({
        "x-forwarded-for": "1.2.3.4, 203.0.113.50",
      });

      expect(extractClientIp(headers)).toBe("203.0.113.50");
    });

    it("trusts Cloudflare CF-Connecting-IP when configured", () => {
      const headers = new Headers({
        "cf-connecting-ip": "198.51.100.77",
        "x-forwarded-for": "10.0.0.1, 10.0.0.2",
      });

      expect(extractClientIp(headers, { trustCloudflare: true })).toBe("198.51.100.77");
    });

    it("falls back to x-real-ip when X-Forwarded-For is missing or invalid", () => {
      const headers = new Headers({
        "x-real-ip": "192.0.2.88",
      });

      expect(extractClientIp(headers)).toBe("192.0.2.88");
    });

    it("falls back to unknown when all headers are missing or malformed", () => {
      expect(extractClientIp(new Headers())).toBe("unknown");

      const malformedHeaders = new Headers({
        "x-forwarded-for": "invalid-ip-string, another-bad-one",
      });
      expect(extractClientIp(malformedHeaders)).toBe("unknown");
    });

    it("maintains backward compatibility in getClientIp when no depth is set", () => {
      const headers = new Headers({
        "x-forwarded-for": " 203.0.113.5, 198.51.100.2",
      });

      expect(getClientIp(headers)).toBe("203.0.113.5");
    });
  });

  describe("Redis key sanitization and rate limiter protection", () => {
    it("sanitizes keys to prevent command injection and corrupt characters", () => {
      expect(sanitizeRateLimitKey("192.0.2.1")).toBe("192.0.2.1");
      expect(sanitizeRateLimitKey("2001:db8::1")).toBe("2001:db8::1");
      expect(sanitizeRateLimitKey("malicious\r\nINCR pwned")).toBe("malicious__INCR_pwned");
      expect(sanitizeRateLimitKey("")).toBe("rl:unknown");
    });

    it("InMemoryRateLimitStore handles sanitized keys without crashing", async () => {
      const store = new InMemoryRateLimitStore();

      const result1 = await store.increment("bad\nkey:123", 60_000, 10);
      expect(result1.allowed).toBe(true);
      expect(result1.remaining).toBe(9);

      const result2 = await store.increment("bad\nkey:123", 60_000, 10);
      expect(result2.remaining).toBe(8);

      await store.reset("bad\nkey:123");
      const result3 = await store.increment("bad\nkey:123", 60_000, 10);
      expect(result3.remaining).toBe(9);
    });
  });
});
