// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import {
  getClientIp,
  isValidIp,
  isValidIpv4,
  isValidIpv6,
  stripPort,
  sanitizeRateLimitKey,
  getTrustedProxyDepth,
} from "@/lib/client-ip";
import { InMemoryRateLimitStore } from "@/lib/rate-limit";

describe("client-ip extraction and validation (#1387)", () => {
  describe("IPv4 validation", () => {
    it("accepts valid IPv4 addresses", () => {
      expect(isValidIpv4("127.0.0.1")).toBe(true);
      expect(isValidIpv4("192.168.1.1")).toBe(true);
      expect(isValidIpv4("203.0.113.195")).toBe(true);
      expect(isValidIpv4("0.0.0.0")).toBe(true);
      expect(isValidIpv4("255.255.255.255")).toBe(true);
    });

    it("rejects invalid IPv4 addresses", () => {
      expect(isValidIpv4("256.0.0.1")).toBe(false);
      expect(isValidIpv4("192.168.1")).toBe(false);
      expect(isValidIpv4("192.168.1.1.1")).toBe(false);
      expect(isValidIpv4("01.02.03.04")).toBe(false); // leading zeroes
      expect(isValidIpv4("192.168.1.abc")).toBe(false);
      expect(isValidIpv4("1.2.3.4<script>")).toBe(false);
      expect(isValidIpv4("")).toBe(false);
      expect(isValidIpv4("localhost")).toBe(false);
    });
  });

  describe("IPv6 validation", () => {
    it("accepts valid IPv6 addresses", () => {
      expect(isValidIpv6("2001:0db8:85a3:0000:0000:8a2e:0370:7334")).toBe(true);
      expect(isValidIpv6("2001:db8::1")).toBe(true);
      expect(isValidIpv6("::1")).toBe(true);
      expect(isValidIpv6("::")).toBe(true);
      expect(isValidIpv6("fe80::1ff:fe23:4567:890a")).toBe(true);
      expect(isValidIpv6("::ffff:192.0.2.128")).toBe(true); // IPv4-mapped IPv6
    });

    it("rejects invalid IPv6 addresses", () => {
      expect(isValidIpv6("2001:db8:::1")).toBe(false); // multiple ::
      expect(isValidIpv6("2001:xyz::1")).toBe(false); // invalid hex
      expect(isValidIpv6("12345::1")).toBe(false); // group > 4 chars
      expect(isValidIpv6("192.168.1.1")).toBe(false);
      expect(isValidIpv6("")).toBe(false);
    });
  });

  describe("stripPort", () => {
    it("strips port from IPv4 addresses", () => {
      expect(stripPort("203.0.113.195:8080")).toBe("203.0.113.195");
      expect(stripPort("127.0.0.1:3000")).toBe("127.0.0.1");
      expect(stripPort("127.0.0.1")).toBe("127.0.0.1");
    });

    it("strips port from bracketed IPv6 addresses", () => {
      expect(stripPort("[2001:db8::1]:8080")).toBe("2001:db8::1");
      expect(stripPort("[2001:db8::1]")).toBe("2001:db8::1");
      expect(stripPort("2001:db8::1")).toBe("2001:db8::1");
    });
  });

  describe("getClientIp spoofing defenses", () => {
    it("ignores spoofed X-Forwarded-For prefixes and extracts rightmost trusted proxy hop", () => {
      // Attacker sends: X-Forwarded-For: 1.2.3.4 (spoofed)
      // Reverse proxy appends: 203.0.113.195 (client real IP)
      const headers = new Headers({
        "x-forwarded-for": "1.2.3.4, 203.0.113.195",
      });

      const ip = getClientIp(headers);
      expect(ip).toBe("203.0.113.195");
    });

    it("supports configurable trusted proxy depth", () => {
      // 2 proxies in chain: [spoofed, real-client, proxy1]
      const headers = new Headers({
        "x-forwarded-for": "10.0.0.1, 198.51.100.42, 172.16.0.1",
      });

      // Default depth 1 selects 172.16.0.1
      expect(getClientIp(headers, { trustedProxyDepth: 1 })).toBe("172.16.0.1");
      // Depth 2 selects 198.51.100.42
      expect(getClientIp(headers, { trustedProxyDepth: 2 })).toBe("198.51.100.42");
    });

    it("prioritizes Cloudflare CF-Connecting-IP and True-Client-IP headers", () => {
      const headers = new Headers({
        "cf-connecting-ip": "198.51.100.77",
        "x-forwarded-for": "1.1.1.1, 2.2.2.2",
      });

      expect(getClientIp(headers)).toBe("198.51.100.77");

      const trueClientHeaders = new Headers({
        "true-client-ip": "198.51.100.88",
        "x-forwarded-for": "1.1.1.1, 2.2.2.2",
      });

      expect(getClientIp(trueClientHeaders)).toBe("198.51.100.88");
    });

    it("falls back to X-Real-IP when X-Forwarded-For is absent", () => {
      const headers = new Headers({
        "x-real-ip": "198.51.100.99",
      });

      expect(getClientIp(headers)).toBe("198.51.100.99");
    });

    it("rejects malformed IP injection strings and returns fallback", () => {
      const headers = new Headers({
        "x-forwarded-for": "<script>alert(1)</script>, ' OR 1=1 --",
      });

      expect(getClientIp(headers)).toBe("unknown");
      expect(getClientIp(headers, { fallbackIp: "127.0.0.1" })).toBe("127.0.0.1");
    });

    it("returns unknown when no headers are present", () => {
      expect(getClientIp(new Headers())).toBe("unknown");
    });
  });

  describe("sanitizeRateLimitKey", () => {
    it("sanitizes keys preventing Redis protocol injection or corruption", () => {
      expect(sanitizeRateLimitKey("192.168.1.1")).toBe("192.168.1.1");
      expect(sanitizeRateLimitKey("2001:db8::1")).toBe("2001:db8::1");
      expect(sanitizeRateLimitKey("1.2.3.4\r\nSET evil 1\r\n")).toBe("1.2.3.4_SET_evil_1");
      expect(sanitizeRateLimitKey("bad key with spaces")).toBe("bad_key_with_spaces");
      expect(sanitizeRateLimitKey("")).toBe("unknown");
    });

    it("works with InMemoryRateLimitStore preventing malformed key corruption", async () => {
      const store = new InMemoryRateLimitStore();
      const res = await store.increment("1.2.3.4\nSET key 1", 60000, 10);
      expect(res.allowed).toBe(true);
      expect(res.remaining).toBe(9);

      await store.reset("1.2.3.4\nSET key 1");
      const res2 = await store.increment("1.2.3.4\nSET key 1", 60000, 10);
      expect(res2.remaining).toBe(9); // count was reset
    });
  });

  describe("isValidIp", () => {
    it("validates both IPv4 and IPv6 addresses", () => {
      expect(isValidIp("192.168.1.1")).toBe(true);
      expect(isValidIp("2001:db8::1")).toBe(true);
      expect(isValidIp("invalid-ip")).toBe(false);
    });
  });

  describe("getTrustedProxyDepth", () => {
    it("returns configured or default depth", () => {
      expect(getTrustedProxyDepth()).toBeGreaterThanOrEqual(1);
    });
  });
});
