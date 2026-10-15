// SPDX-License-Identifier: MIT

/**
 * Tests for client IP extraction, spoofing prevention, and rate-limiter key sanitization (issue #1387).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getClientIp,
  isValidIp,
  isIPv4,
  isIPv6,
  cleanIp,
} from "@/lib/client-ip";
import { sanitizeRateLimitKey } from "@/lib/rate-limit";

describe("IP address validation (issue #1387)", () => {
  it("validates standard IPv4 addresses", () => {
    expect(isIPv4("127.0.0.1")).toBe(true);
    expect(isIPv4("203.0.113.195")).toBe(true);
    expect(isIPv4("10.0.0.1")).toBe(true);
    expect(isIPv4("255.255.255.255")).toBe(true);
  });

  it("rejects invalid IPv4 addresses", () => {
    expect(isIPv4("256.0.0.1")).toBe(false);
    expect(isIPv4("999.999.999.999")).toBe(false);
    expect(isIPv4("1.2.3")).toBe(false);
    expect(isIPv4("1.2.3.4.5")).toBe(false);
    expect(isIPv4("not-an-ip")).toBe(false);
    expect(isIPv4("<script>alert(1)</script>")).toBe(false);
  });

  it("validates IPv6 addresses", () => {
    expect(isIPv6("::1")).toBe(true);
    expect(isIPv6("2001:db8::1")).toBe(true);
    expect(isIPv6("fe80::1")).toBe(true);
    expect(isIPv6("::ffff:192.0.2.1")).toBe(true);
  });

  it("rejects invalid IPv6 addresses", () => {
    expect(isIPv6(":::1")).toBe(false);
    expect(isIPv6("2001::db8::1")).toBe(false);
    expect(isIPv6("hello:world")).toBe(false);
  });

  it("cleans and strips ports from IPv4 and bracketed IPv6", () => {
    expect(cleanIp(" 192.0.2.1:8080 ")).toBe("192.0.2.1");
    expect(cleanIp("[2001:db8::1]:443")).toBe("2001:db8::1");
    expect(cleanIp("[2001:db8::1]")).toBe("2001:db8::1");
    expect(cleanIp("203.0.113.5")).toBe("203.0.113.5");
  });
});

describe("Client IP extraction and spoofing prevention (issue #1387)", () => {
  const originalEnv = process.env.TRUSTED_PROXY_DEPTH;

  beforeEach(() => {
    delete process.env.TRUSTED_PROXY_DEPTH;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.TRUSTED_PROXY_DEPTH = originalEnv;
    } else {
      delete process.env.TRUSTED_PROXY_DEPTH;
    }
  });

  it("extracts leftmost IP by default when no proxy depth is configured", () => {
    const headers = new Headers({
      "x-forwarded-for": " 203.0.113.5, 198.51.100.2 ",
    });
    expect(getClientIp(headers)).toBe("203.0.113.5");
  });

  it("ignores spoofed leftmost IP when trustedProxyDepth is set", () => {
    // Client sends spoofed 1.1.1.1, ingress appends real client 203.0.113.50
    const headers = new Headers({
      "x-forwarded-for": "1.1.1.1, 203.0.113.50",
    });

    expect(getClientIp(headers, { trustedProxyDepth: 1 })).toBe("203.0.113.50");
  });

  it("reads TRUSTED_PROXY_DEPTH from environment variable", () => {
    process.env.TRUSTED_PROXY_DEPTH = "1";

    const headers = new Headers({
      "x-forwarded-for": "1.1.1.1, 203.0.113.50",
    });

    expect(getClientIp(headers)).toBe("203.0.113.50");
  });

  it("prefers valid Cloudflare CF-Connecting-IP over X-Forwarded-For", () => {
    const headers = new Headers({
      "cf-connecting-ip": "198.51.100.42",
      "x-forwarded-for": "1.1.1.1",
    });

    expect(getClientIp(headers)).toBe("198.51.100.42");
  });

  it("rejects malformed IP strings in X-Forwarded-For and falls back to X-Real-IP", () => {
    const headers = new Headers({
      "x-forwarded-for": "malformed_injection;drop table",
      "x-real-ip": "192.0.2.1",
    });

    expect(getClientIp(headers)).toBe("192.0.2.1");
  });

  it("falls back to remoteAddress when all headers are invalid or missing", () => {
    const headers = new Headers({
      "x-forwarded-for": "invalid-ip",
    });

    expect(getClientIp(headers, { remoteAddress: "10.0.0.99" })).toBe("10.0.0.99");
  });

  it("falls back to target.ip when passed an object with socket ip", () => {
    const req = {
      headers: new Headers(),
      ip: "10.0.0.5",
    };

    expect(getClientIp(req)).toBe("10.0.0.5");
  });

  it("returns 'unknown' when no valid IP can be found", () => {
    const headers = new Headers();
    expect(getClientIp(headers)).toBe("unknown");

    const badHeaders = new Headers({
      "x-forwarded-for": "bad-string",
      "x-real-ip": "another-bad-string",
    });
    expect(getClientIp(badHeaders)).toBe("unknown");
  });
});

describe("Rate limiter key sanitization (issue #1387)", () => {
  it("preserves clean IP addresses", () => {
    expect(sanitizeRateLimitKey("203.0.113.5")).toBe("203.0.113.5");
    expect(sanitizeRateLimitKey("::1")).toBe("::1");
  });

  it("sanitizes control characters, newlines, and carriage returns", () => {
    expect(sanitizeRateLimitKey("203.0.113.5\r\nINCR foo\r\n")).toBe(
      "203.0.113.5_INCR_foo",
    );
    expect(sanitizeRateLimitKey("key with spaces")).toBe("key_with_spaces");
    expect(sanitizeRateLimitKey("key\x00with\x07controls")).toBe("key_with_controls");
  });

  it("falls back to unknown for empty or whitespace-only keys", () => {
    expect(sanitizeRateLimitKey("")).toBe("unknown");
    expect(sanitizeRateLimitKey("   ")).toBe("unknown");
    expect(sanitizeRateLimitKey("\r\n\t")).toBe("unknown");
  });

  it("truncates excessively long keys to prevent Redis key bloat", () => {
    const longKey = "a".repeat(500);
    const sanitized = sanitizeRateLimitKey(longKey);
    expect(sanitized.length).toBe(256);
  });
});
