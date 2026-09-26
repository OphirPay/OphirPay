// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  CSP_DIRECTIVES,
  CSP_DEV_SCRIPT_RELAXATIONS,
  STELLAR_HORIZON_ENDPOINTS,
  STELLAR_SOROBAN_RPC_ENDPOINTS,
  STELLAR_EXPLORER_AND_ASSET_HOSTS,
  WALLET_FRAME_SOURCES,
  SECURITY_HEADERS,
  CORS_CONFIG,
  RATE_LIMIT_WINDOW_MS,
  DEFAULT_RATE_LIMIT_RPM,
  CLIENT_IP_HEADERS,
  buildCsp,
  formatCsp,
  getRateLimitMax,
  resolveClientIp,
  generateRequestId,
} from "@/lib/security-policy";
import { readFileSync } from "fs";
import path from "path";

describe("Security Policy & CSP Constants (Issue #765)", () => {
  describe("Stellar Host Whitelists", () => {
    it("defines exact Horizon endpoints", () => {
      expect([...STELLAR_HORIZON_ENDPOINTS]).toEqual([
        "https://horizon-testnet.stellar.org",
        "https://horizon.stellar.org",
      ]);
    });

    it("defines exact Soroban RPC endpoints", () => {
      expect([...STELLAR_SOROBAN_RPC_ENDPOINTS]).toEqual([
        "https://soroban-testnet.stellar.org",
        "https://soroban.stellar.org",
        "https://rpc-futurenet.stellar.org",
        "https://mainnet.soroban.rpc.pulse.so",
      ]);
    });

    it("defines exact asset and explorer hosts", () => {
      expect([...STELLAR_EXPLORER_AND_ASSET_HOSTS]).toEqual([
        "https://stellar.expert",
        "https://raw.githubusercontent.com",
      ]);
    });

    it("defines exact wallet extension frame sources", () => {
      expect([...WALLET_FRAME_SOURCES]).toEqual([
        "https://*.freighter.app",
        "chrome-extension:",
        "moz-extension:",
      ]);
    });
  });

  describe("CSP Directives as Structured Data", () => {
    it("has one structured entry per CSP directive", () => {
      const keys = Object.keys(CSP_DIRECTIVES);
      expect(keys).toEqual([
        "default-src",
        "script-src",
        "style-src",
        "connect-src",
        "img-src",
        "font-src",
        "frame-src",
        "object-src",
        "base-uri",
        "form-action",
      ]);
    });

    it("asserts exact production directive set (fails when a host is added or removed without updating)", () => {
      expect(CSP_DIRECTIVES).toEqual({
        "default-src": ["'self'"],
        "script-src": ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "connect-src": [
          "'self'",
          "https://horizon-testnet.stellar.org",
          "https://horizon.stellar.org",
          "https://soroban-testnet.stellar.org",
          "https://soroban.stellar.org",
          "https://rpc-futurenet.stellar.org",
          "https://mainnet.soroban.rpc.pulse.so",
        ],
        "img-src": [
          "'self'",
          "data:",
          "https://stellar.expert",
          "https://raw.githubusercontent.com",
        ],
        "font-src": ["'self'"],
        "frame-src": [
          "'self'",
          "https://*.freighter.app",
          "chrome-extension:",
          "moz-extension:",
        ],
        "object-src": ["'none'"],
        "base-uri": ["'self'"],
        "form-action": ["'self'"],
      });
    });

    it("assembles correct production CSP string via buildCsp(true)", () => {
      const prodCsp = buildCsp(true);
      expect(prodCsp).toBe(
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; " +
        "style-src 'self' 'unsafe-inline'; " +
        "connect-src 'self' https://horizon-testnet.stellar.org https://horizon.stellar.org https://soroban-testnet.stellar.org https://soroban.stellar.org https://rpc-futurenet.stellar.org https://mainnet.soroban.rpc.pulse.so; " +
        "img-src 'self' data: https://stellar.expert https://raw.githubusercontent.com; " +
        "font-src 'self'; " +
        "frame-src 'self' https://*.freighter.app chrome-extension: moz-extension:; " +
        "object-src 'none'; " +
        "base-uri 'self'; " +
        "form-action 'self'"
      );
    });

    it("includes dev script relaxations in development mode via buildCsp(false)", () => {
      const devCsp = buildCsp(false);
      expect(devCsp).toContain("'unsafe-eval'");
      expect(devCsp).toMatch(/script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' 'unsafe-eval'/);
    });

    it("formatCsp formats arbitrary directive objects correctly", () => {
      const formatted = formatCsp({
        "default-src": ["'self'"],
        "object-src": ["'none'"],
      });
      expect(formatted).toBe("default-src 'self'; object-src 'none'");
    });
  });

  describe("Client IP Resolution Order", () => {
    it("defines client IP headers in correct precedence", () => {
      expect([...CLIENT_IP_HEADERS]).toEqual(["x-forwarded-for", "x-real-ip"]);
    });

    it("resolves the first IP from comma-separated x-forwarded-for header", () => {
      const headers = new Map<string, string>([
        ["x-forwarded-for", "203.0.113.195, 198.51.100.1"],
        ["x-real-ip", "198.51.100.2"],
      ]);
      const ip = resolveClientIp((h) => headers.get(h));
      expect(ip).toBe("203.0.113.195");
    });

    it("falls back to x-real-ip when x-forwarded-for is missing", () => {
      const headers = new Map<string, string>([
        ["x-real-ip", "198.51.100.42"],
      ]);
      const ip = resolveClientIp((h) => headers.get(h));
      expect(ip).toBe("198.51.100.42");
    });

    it("returns 'unknown' when no client IP header is present", () => {
      const ip = resolveClientIp(() => null);
      expect(ip).toBe("unknown");
    });
  });

  describe("Rate Limiting Defaults & Request ID", () => {
    it("defines standard 60-second window and 120 RPM default", () => {
      expect(RATE_LIMIT_WINDOW_MS).toBe(60_000);
      expect(DEFAULT_RATE_LIMIT_RPM).toBe(120);
    });

    it("uses default RPM when env is not set", () => {
      expect(getRateLimitMax(undefined)).toBe(120);
      expect(getRateLimitMax("")).toBe(120);
    });

    it("parses valid env RPM override and enforces minimum 1", () => {
      expect(getRateLimitMax("300")).toBe(300);
      expect(getRateLimitMax("0")).toBe(120); // Fallback on non-positive
      expect(getRateLimitMax("invalid")).toBe(120);
    });

    it("generates request IDs with req_ prefix and alphanumeric parts", () => {
      const id1 = generateRequestId();
      const id2 = generateRequestId();
      expect(id1).toMatch(/^req_[a-z0-9]+_[a-z0-9]+$/);
      expect(id2).toMatch(/^req_[a-z0-9]+_[a-z0-9]+$/);
      expect(id1).not.toBe(id2);
    });
  });

  describe("Security Headers & CORS Config", () => {
    it("defines baseline security headers", () => {
      expect(SECURITY_HEADERS).toEqual({
        "X-Api-Version": "1.0.0",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "strict-origin-when-cross-origin",
      });
    });

    it("defines CORS configuration", () => {
      expect(CORS_CONFIG.allowMethods).toBe("GET, POST, PUT, DELETE, OPTIONS");
      expect(CORS_CONFIG.allowHeaders).toBe("Content-Type, Authorization, X-API-Key");
      expect(CORS_CONFIG.defaultOrigin).toBe("http://localhost:3000");
    });
  });

  describe("proxy.ts Policy Literals Check", () => {
    it("proxy.ts contains no inline CSP or host policy literals", () => {
      const proxyPath = path.join(process.cwd(), "src/proxy.ts");
      const content = readFileSync(proxyPath, "utf8");

      // Verify no inline endpoint or host literals remain in proxy.ts
      expect(content).not.toContain("https://horizon.stellar.org");
      expect(content).not.toContain("https://soroban.stellar.org");
      expect(content).not.toContain("https://stellar.expert");
      expect(content).not.toContain("https://*.freighter.app");
      expect(content).not.toContain("default-src 'self'");
      expect(content).not.toContain("wasm-unsafe-eval");
    });
  });
});
