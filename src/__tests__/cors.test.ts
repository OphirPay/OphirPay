// SPDX-License-Identifier: MIT

/**
 * Strict CORS origin allowlist and mutation enforcement tests (issue #1393)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import {
  parseAllowedOrigins,
  isOriginAllowed,
  buildStrictCorsHeaders,
  handleCorsPreflight,
  validateMutationOrigin,
  normalizeOrigin,
  MUTATION_METHODS,
} from "@/lib/cors";

vi.mock("@/lib/logger", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    request: vi.fn(),
  },
}));

describe("Strict CORS Configuration & Validation (issue #1393)", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("normalizeOrigin", () => {
    it("trims whitespace and removes trailing slashes", () => {
      expect(normalizeOrigin("  https://ophirpay.com/  ")).toBe("https://ophirpay.com");
      expect(normalizeOrigin("https://app.ophirpay.com///")).toBe("https://app.ophirpay.com");
      expect(normalizeOrigin("http://localhost:3000")).toBe("http://localhost:3000");
    });
  });

  describe("parseAllowedOrigins", () => {
    it("parses comma-separated origins from ALLOWED_ORIGINS", () => {
      const allowed = parseAllowedOrigins(
        "https://ophirpay.com, https://app.ophirpay.com ,http://localhost:3000/",
        "https://default.ophirpay.com"
      );
      expect(allowed.has("https://ophirpay.com")).toBe(true);
      expect(allowed.has("https://app.ophirpay.com")).toBe(true);
      expect(allowed.has("http://localhost:3000")).toBe(true);
      expect(allowed.has("https://default.ophirpay.com")).toBe(true);
    });

    it("rejects wildcard '*' from allowed domain origins", () => {
      const allowed = parseAllowedOrigins("*, https://valid.com", "http://localhost:3000");
      expect(allowed.has("*")).toBe(false);
      expect(allowed.has("https://valid.com")).toBe(true);
    });

    it("falls back to defaultAppUrl when ALLOWED_ORIGINS is empty or undefined", () => {
      const allowed = parseAllowedOrigins("", "https://app.ophirpay.com");
      expect(allowed.size).toBe(1);
      expect(allowed.has("https://app.ophirpay.com")).toBe(true);
    });

    it("falls back to process.env.NEXT_PUBLIC_APP_URL when params are omitted", () => {
      vi.stubEnv("ALLOWED_ORIGINS", "https://api.ophirpay.com");
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://ophirpay.com");
      const allowed = parseAllowedOrigins();
      expect(allowed.has("https://api.ophirpay.com")).toBe(true);
      expect(allowed.has("https://ophirpay.com")).toBe(true);
    });
  });

  describe("isOriginAllowed", () => {
    const allowed = new Set(["https://ophirpay.com", "https://app.ophirpay.com"]);

    it("accepts explicitly configured origins", () => {
      expect(isOriginAllowed("https://ophirpay.com", allowed)).toBe(true);
      expect(isOriginAllowed("https://app.ophirpay.com", allowed)).toBe(true);
    });

    it("accepts origins with trailing slashes after normalization", () => {
      expect(isOriginAllowed("https://ophirpay.com/", allowed)).toBe(true);
    });

    it("rejects untrusted third-party origins", () => {
      expect(isOriginAllowed("https://evil.com", allowed)).toBe(false);
      expect(isOriginAllowed("https://attacker-ophirpay.com", allowed)).toBe(false);
    });

    it("rejects null, empty string, or wildcard '*'", () => {
      expect(isOriginAllowed(null, allowed)).toBe(false);
      expect(isOriginAllowed(undefined, allowed)).toBe(false);
      expect(isOriginAllowed("", allowed)).toBe(false);
      expect(isOriginAllowed("*", allowed)).toBe(false);
    });
  });

  describe("buildStrictCorsHeaders", () => {
    const allowed = new Set(["https://app.ophirpay.com"]);

    it("returns exact origin and credentials when origin is allowed", () => {
      const headers = buildStrictCorsHeaders({
        origin: "https://app.ophirpay.com",
        allowedOrigins: allowed,
        allowCredentials: true,
      });

      expect(headers["Access-Control-Allow-Origin"]).toBe("https://app.ophirpay.com");
      expect(headers["Access-Control-Allow-Credentials"]).toBe("true");
      expect(headers["Vary"]).toBe("Origin");
      expect(headers["Access-Control-Allow-Methods"]).toContain("POST");
    });

    it("withholds Access-Control-Allow-Origin and credentials when origin is disallowed", () => {
      const headers = buildStrictCorsHeaders({
        origin: "https://hostile.com",
        allowedOrigins: allowed,
        allowCredentials: true,
      });

      expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
      expect(headers["Access-Control-Allow-Credentials"]).toBeUndefined();
      expect(headers["Vary"]).toBeUndefined();
    });

    it("guarantees wildcard '*' is NEVER returned with Access-Control-Allow-Credentials: true", () => {
      const headers = buildStrictCorsHeaders({
        origin: "*",
        allowedOrigins: allowed,
        allowCredentials: true,
      });

      expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
      expect(headers["Access-Control-Allow-Credentials"]).toBeUndefined();
    });
  });

  describe("handleCorsPreflight", () => {
    const allowed = new Set(["https://trusted.com"]);

    it("ignores non-OPTIONS requests", () => {
      const req = new NextRequest("http://localhost/api/payments", { method: "GET" });
      expect(handleCorsPreflight(req, allowed)).toBeNull();
    });

    it("allows OPTIONS preflight from trusted origin with 204 No Content", () => {
      const req = new NextRequest("http://localhost/api/payments", {
        method: "OPTIONS",
        headers: { origin: "https://trusted.com" },
      });
      const res = handleCorsPreflight(req, allowed);
      expect(res).not.toBeNull();
      expect(res?.status).toBe(204);
      expect(res?.headers.get("Access-Control-Allow-Origin")).toBe("https://trusted.com");
      expect(res?.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    });

    it("rejects OPTIONS preflight from untrusted origin with 403 Forbidden", async () => {
      const req = new NextRequest("http://localhost/api/payments", {
        method: "OPTIONS",
        headers: { origin: "https://untrusted.com" },
      });
      const res = handleCorsPreflight(req, allowed);
      expect(res).not.toBeNull();
      expect(res?.status).toBe(403);
      expect(res?.headers.get("Access-Control-Allow-Origin")).toBeNull();
      const body = await res?.json();
      expect(body.error.code).toBe("CORS_PREFLIGHT_FORBIDDEN");
    });
  });

  describe("validateMutationOrigin", () => {
    const allowed = new Set(["https://trusted.com"]);

    it("allows read-only GET requests regardless of origin", () => {
      const req = new NextRequest("http://localhost/api/payments", {
        method: "GET",
        headers: { origin: "https://anywhere.com" },
      });
      expect(validateMutationOrigin(req, allowed).allowed).toBe(true);
    });

    it("blocks cross-origin mutation methods (POST, PUT, DELETE, PATCH) from untrusted origin", () => {
      for (const method of Array.from(MUTATION_METHODS)) {
        const req = new NextRequest("http://localhost/api/payments", {
          method,
          headers: { origin: "https://hostile.com" },
        });
        const result = validateMutationOrigin(req, allowed);
        expect(result.allowed).toBe(false);
      }
    });

    it("allows mutation methods from trusted origin", () => {
      for (const method of Array.from(MUTATION_METHODS)) {
        const req = new NextRequest("http://localhost/api/payments", {
          method,
          headers: { origin: "https://trusted.com" },
        });
        expect(validateMutationOrigin(req, allowed).allowed).toBe(true);
      }
    });

    it("allows mutation methods without Origin header (e.g. server-to-server or curl)", () => {
      const req = new NextRequest("http://localhost/api/payments", {
        method: "POST",
      });
      expect(validateMutationOrigin(req, allowed).allowed).toBe(true);
    });
  });

  describe("Integration: proxy() in src/proxy.ts", () => {
    beforeEach(() => {
      vi.resetModules();
      vi.stubEnv("ALLOWED_ORIGINS", "https://app.ophirpay.com,https://admin.ophirpay.com");
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://ophirpay.com");
    });

    it("blocks cross-origin POST /api/payments from untrusted origin with 403", async () => {
      const { proxy } = await import("@/proxy");
      const req = new NextRequest("http://localhost/api/payments", {
        method: "POST",
        headers: {
          origin: "https://malicious-site.com",
          "content-type": "application/json",
        },
      });

      const res = await proxy(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("CORS_ORIGIN_FORBIDDEN");
      expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });

    it("handles preflight OPTIONS /api/payments for trusted origin with 204", async () => {
      const { proxy } = await import("@/proxy");
      const req = new NextRequest("http://localhost/api/payments", {
        method: "OPTIONS",
        headers: {
          origin: "https://app.ophirpay.com",
        },
      });

      const res = await proxy(req);
      expect(res.status).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://app.ophirpay.com");
      expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    });

    it("rejects preflight OPTIONS /api/payments for untrusted origin with 403", async () => {
      const { proxy } = await import("@/proxy");
      const req = new NextRequest("http://localhost/api/payments", {
        method: "OPTIONS",
        headers: {
          origin: "https://evil.com",
        },
      });

      const res = await proxy(req);
      expect(res.status).toBe(403);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });

    it("allows trusted origin on GET /api/health and sets credentials and exact origin", async () => {
      const { proxy } = await import("@/proxy");
      const req = new NextRequest("http://localhost/api/health", {
        method: "GET",
        headers: {
          origin: "https://app.ophirpay.com",
        },
      });

      const res = await proxy(req);
      expect(res.status).toBe(200);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://app.ophirpay.com");
      expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
      expect(res.headers.get("Vary")).toBe("Origin");
    });

    it("never returns wildcard '*' alongside credentials on GET request with unknown origin", async () => {
      const { proxy } = await import("@/proxy");
      const req = new NextRequest("http://localhost/api/health", {
        method: "GET",
        headers: {
          origin: "https://unknown.com",
        },
      });

      const res = await proxy(req);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
      expect(res.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    });
  });
});
