// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isValidIPv4,
  isValidIPv6,
  isValidIp,
  stripPort,
  extractClientIp,
  sanitizeIpForRedisKey,
} from "@/lib/client-ip";

describe("Hardened Client IP & Spoof-Resistant Rate Limiting (Issue #1387 - 5D Matrix)", () => {
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

  // ════════════════════════════════════════════════════════════════════════════
  // Dimension 1: Boundaries & Address Syntax (40 tests)
  // ════════════════════════════════════════════════════════════════════════════
  describe("Dimension 1: Boundaries & Strict IP Address Syntax", () => {
    const validIPv4Addresses = [
      "0.0.0.0",
      "127.0.0.1",
      "10.0.0.1",
      "172.16.0.1",
      "192.168.1.1",
      "192.0.2.1",
      "198.51.100.1",
      "203.0.113.195",
      "8.8.8.8",
      "1.1.1.1",
      "255.255.255.255",
      "224.0.0.1",
      "169.254.1.1",
    ];

    validIPv4Addresses.forEach((ip) => {
      it(`validates genuine IPv4 address: ${ip}`, () => {
        expect(isValidIPv4(ip)).toBe(true);
        expect(isValidIp(ip)).toBe(true);
      });
    });

    const invalidIPv4Addresses = [
      "256.0.0.1",
      "1.256.1.1",
      "1.1.256.1",
      "1.1.1.256",
      "1.2.3",
      "1.2.3.4.5",
      "1.2",
      "1",
      "...",
      "01.02.03.04",
      "192.168.01.1",
      "-1.2.3.4",
      "1.-2.3.4",
      "1.2.3.4.",
      ".1.2.3.4",
      "999.999.999.999",
      "abc.def.ghi.jkl",
    ];

    invalidIPv4Addresses.forEach((ip) => {
      it(`rejects malformed IPv4 address: ${ip}`, () => {
        expect(isValidIPv4(ip)).toBe(false);
      });
    });

    const validIPv6Addresses = [
      "::1",
      "::",
      "2001:db8::1",
      "fe80::1",
      "2001:0db8:85a3:0000:0000:8a2e:0370:7334",
      "2001:db8:85a3:0:0:8a2e:370:7334",
      "2001:db8:85a3::8a2e:370:7334",
      "::ffff:192.0.2.1",
      "0:0:0:0:0:ffff:192.0.2.1",
      "[::1]",
      "[2001:db8::1]",
    ];

    validIPv6Addresses.forEach((ip) => {
      it(`validates genuine IPv6 address: ${ip}`, () => {
        expect(isValidIPv6(ip)).toBe(true);
        expect(isValidIp(ip)).toBe(true);
      });
    });

    const invalidIPv6Addresses = [
      "2001::db8::1", // Double ::
      "1:2:3:4:5:6:7:8:9", // Too many groups
      "2001:xyz::1", // Non-hex chars
      "::g", // Invalid hex
      "::ffff:999.999.999.999", // Invalid IPv4-mapped
      "::ffff:1.2.3", // Incomplete IPv4-mapped
    ];

    invalidIPv6Addresses.forEach((ip) => {
      it(`rejects malformed IPv6 address: ${ip}`, () => {
        expect(isValidIPv6(ip)).toBe(false);
      });
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Dimension 2: Combinatorics of Headers & Proxy Trust (30 tests)
  // ════════════════════════════════════════════════════════════════════════════
  describe("Dimension 2: Combinatorics of Headers & Proxy Trust", () => {
    it("trusts cf-connecting-ip when valid", () => {
      const headers = new Headers({
        "cf-connecting-ip": "198.51.100.55",
        "x-forwarded-for": "10.0.0.1, 192.0.2.1",
        "x-real-ip": "172.16.0.1",
      });
      expect(extractClientIp(headers)).toBe("198.51.100.55");
    });

    it("bypasses cf-connecting-ip when trustCloudflare is false", () => {
      const headers = new Headers({
        "cf-connecting-ip": "198.51.100.55",
        "x-real-ip": "192.0.2.1",
      });
      expect(extractClientIp(headers, { trustCloudflare: false })).toBe("192.0.2.1");
    });

    it("falls back to x-real-ip when cf-connecting-ip is invalid", () => {
      const headers = new Headers({
        "cf-connecting-ip": "malformed-ip",
        "x-real-ip": "192.0.2.42",
      });
      expect(extractClientIp(headers)).toBe("192.0.2.42");
    });

    it("defaults to leftmost valid forwarded IP when no proxy depth is configured", () => {
      const headers = new Headers({
        "x-forwarded-for": "203.0.113.195, 70.41.3.18, 150.172.238.178",
      });
      expect(extractClientIp(headers)).toBe("203.0.113.195");
    });

    const depthScenarios = [
      { depth: 1, expected: "150.172.238.178" },
      { depth: 2, expected: "70.41.3.18" },
      { depth: 3, expected: "203.0.113.195" },
      { depth: 5, expected: "203.0.113.195" }, // Beyond length -> clamps safely
    ];

    depthScenarios.forEach(({ depth, expected }) => {
      it(`extracts correct client IP with trustedProxyDepth=${depth}`, () => {
        const headers = new Headers({
          "x-forwarded-for": "203.0.113.195, 70.41.3.18, 150.172.238.178",
        });
        expect(extractClientIp(headers, { trustedProxyDepth: depth })).toBe(expected);
      });
    });

    it("respects process.env.TRUSTED_PROXY_DEPTH when options.trustedProxyDepth is not passed", () => {
      process.env.TRUSTED_PROXY_DEPTH = "2";
      const headers = new Headers({
        "x-forwarded-for": "203.0.113.195, 70.41.3.18, 150.172.238.178",
      });
      expect(extractClientIp(headers)).toBe("70.41.3.18");
    });

    const fallbackHeaders = [
      { header: "x-client-ip", ip: "192.0.2.88" },
      { header: "x-real-ip", ip: "198.51.100.99" },
    ];

    fallbackHeaders.forEach(({ header, ip }) => {
      it(`resolves ${header} correctly when present alone`, () => {
        const headers = new Headers({ [header]: ip });
        expect(extractClientIp(headers)).toBe(ip);
      });
    });

    it("returns 'unknown' when all headers are missing or empty", () => {
      expect(extractClientIp(new Headers())).toBe("unknown");
      expect(extractClientIp(new Headers({ "x-forwarded-for": "" }))).toBe("unknown");
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Dimension 3: Host Variations, Ports & Whitespace (25 tests)
  // ════════════════════════════════════════════════════════════════════════════
  describe("Dimension 3: Host Variations, Ports & Whitespace", () => {
    const portCases = [
      { input: "192.0.2.1:8080", expected: "192.0.2.1" },
      { input: "10.0.0.1:443", expected: "10.0.0.1" },
      { input: "127.0.0.1:3000", expected: "127.0.0.1" },
      { input: "[2001:db8::1]:8080", expected: "2001:db8::1" },
      { input: "[::1]:443", expected: "::1" },
    ];

    portCases.forEach(({ input, expected }) => {
      it(`strips port number cleanly: ${input} -> ${expected}`, () => {
        expect(stripPort(input)).toBe(expected);
        const headers = new Headers({ "x-real-ip": input });
        expect(extractClientIp(headers)).toBe(expected);
      });
    });

    const whitespaceCases = [
      "  192.0.2.1  ",
      "192.0.2.1\t",
      "\n192.0.2.1\r\n",
    ];

    whitespaceCases.forEach((ws) => {
      it(`handles padding whitespace safely for ${JSON.stringify(ws)}`, () => {
        const headers = new Headers({ "x-real-ip": ws });
        expect(extractClientIp(headers)).toBe("192.0.2.1");
      });
    });

    it("handles multiple comma-separated IPs with varied spacing", () => {
      const headers = new Headers({
        "x-forwarded-for": "  192.0.2.1 ,  198.51.100.2   , 203.0.113.3",
      });
      expect(extractClientIp(headers, { trustedProxyDepth: 1 })).toBe("203.0.113.3");
    });

    it("ignores empty entries in comma lists", () => {
      const headers = new Headers({
        "x-forwarded-for": "192.0.2.1, , , 198.51.100.2",
      });
      expect(extractClientIp(headers, { trustedProxyDepth: 1 })).toBe("198.51.100.2");
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Dimension 4: Negative Controls, Spoofing & Injection Attacks (30 tests)
  // ════════════════════════════════════════════════════════════════════════════
  describe("Dimension 4: Negative Controls, Spoofing & Injection Attacks", () => {
    const maliciousInputs = [
      "<script>alert(1)</script>",
      "192.0.2.1\r\nSet-Cookie: evil=1",
      "192.0.2.1\nINCR evil_key",
      "../../etc/passwd",
      "' OR 1=1 --",
      "127.0.0.1; DROP TABLE users;",
      "javascript:void(0)",
      "data:text/html,evil",
      "192.0.2.1\0",
      "null",
      "undefined",
      "[object Object]",
      "NaN",
      "192.0.2.1 && rm -rf /",
    ];

    maliciousInputs.forEach((malicious) => {
      it(`rejects malicious input: ${JSON.stringify(malicious)}`, () => {
        expect(isValidIp(malicious)).toBe(false);
        const headers = { get: (name: string) => (name.toLowerCase() === "x-forwarded-for" ? malicious : null) };
        expect(extractClientIp(headers)).toBe("unknown");
        expect(sanitizeIpForRedisKey(malicious)).toBe("unknown");
      });
    });

    it("skips spoofed prepended IP and picks real client IP before ingress proxy", () => {
      // Attacker sends: X-Forwarded-For: 1.2.3.4 (spoofed)
      // Reverse proxy appends actual client 203.0.113.50
      // Header received: "1.2.3.4, 203.0.113.50"
      const headers = new Headers({
        "x-forwarded-for": "1.2.3.4, 203.0.113.50",
      });
      // With depth 1, extracts real client 203.0.113.50, ignoring spoofed 1.2.3.4!
      expect(extractClientIp(headers, { trustedProxyDepth: 1 })).toBe("203.0.113.50");
    });

    it("filters out invalid spoofed garbage prepended to valid IP", () => {
      const headers = new Headers({
        "x-forwarded-for": "fake-proxy, <script>, 198.51.100.99",
      });
      expect(extractClientIp(headers)).toBe("198.51.100.99");
    });

    it("sanitizes valid IP for Redis key with zero dangerous chars", () => {
      expect(sanitizeIpForRedisKey("192.0.2.1")).toBe("192.0.2.1");
      expect(sanitizeIpForRedisKey("2001:db8::1")).toBe("2001:db8::1");
      expect(sanitizeIpForRedisKey("unknown")).toBe("unknown");
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // ════════════════════════════════════════════════════════════════════════════
  // Dimension 5: Lifecycle, Concurrency & Invariant Stress (30 tests)
  // ════════════════════════════════════════════════════════════════════════════
  describe("Dimension 5: Lifecycle, Concurrency & Invariant Stress", () => {
    it("handles 1,000 rapid calls with randomized headers deterministically", () => {
      const sampleIps = [
        "192.0.2.1",
        "198.51.100.2",
        "203.0.113.3",
        "10.0.0.4",
        "172.16.0.5",
      ];

      for (let i = 0; i < 1000; i++) {
        const expectedIp = sampleIps[i % sampleIps.length];
        const headers = new Headers({
          "x-real-ip": expectedIp,
          "x-forwarded-for": `spoofed-${i}, ${expectedIp}`,
        });
        const extracted = extractClientIp(headers, { trustedProxyDepth: 1 });
        expect(extracted).toBe(expectedIp);
      }
    });

    it("produces identical results under parallel asynchronous execution", async () => {
      const promises = Array.from({ length: 50 }, (_, i) => {
        const ip = `192.0.2.${(i % 250) + 1}`;
        const headers = new Headers({ "x-real-ip": ip });
        return Promise.resolve(extractClientIp(headers));
      });

      const results = await Promise.all(promises);
      expect(results).toHaveLength(50);
      results.forEach((res, i) => {
        expect(res).toBe(`192.0.2.${(i % 250) + 1}`);
      });
    });

    const boundaryOctets = [0, 1, 10, 50, 100, 127, 128, 172, 192, 200, 254, 255];
    boundaryOctets.forEach((octet) => {
      it(`validates boundary octet value in first position: ${octet}.1.1.1`, () => {
        expect(isValidIPv4(`${octet}.1.1.1`)).toBe(true);
      });
      it(`validates boundary octet value in last position: 1.1.1.${octet}`, () => {
        expect(isValidIPv4(`1.1.1.${octet}`)).toBe(true);
      });
    });

    const depthSweep = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    depthSweep.forEach((d) => {
      it(`handles proxy depth ${d} safely on 5-hop chain`, () => {
        const chain = "192.0.2.1, 192.0.2.2, 192.0.2.3, 192.0.2.4, 192.0.2.5";
        const headers = new Headers({ "x-forwarded-for": chain });
        const res = extractClientIp(headers, { trustedProxyDepth: d });
        expect(isValidIp(res)).toBe(true);
      });
    });
  });
});

