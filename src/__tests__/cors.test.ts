// SPDX-License-Identifier: MIT
// Issue #1393 — Strict CORS origin allowlist and preflight handler tests.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import {
  getAllowedOrigins,
  isOriginAllowed,
  resolveCorsOrigin,
  handleCorsPreflight,
  applyCorsHeaders,
  normalizeOrigin,
  CORS_ALLOWED_METHODS,
  CORS_ALLOWED_HEADERS,
  CORS_MAX_AGE_SECONDS,
} from "@/lib/cors";
import proxy from "@/proxy";

describe("CORS Module (Issue #1393)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.ALLOWED_ORIGINS;
    delete process.env.NEXT_PUBLIC_APP_URL;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("normalizeOrigin", () => {
    it("lowercases scheme and domain", () => {
      expect(normalizeOrigin("HTTPS://EXAMPLE.COM")).toBe("https://example.com");
    });

    it("strips trailing slashes", () => {
      expect(normalizeOrigin("https://example.com/")).toBe("https://example.com");
      expect(normalizeOrigin("https://example.com///")).toBe("https://example.com");
    });

    it("preserves wildcard '*'", () => {
      expect(normalizeOrigin("*")).toBe("*");
    });
  });

  describe("getAllowedOrigins", () => {
    it("parses ALLOWED_ORIGINS separated by commas, semicolons, and spaces", () => {
      process.env.ALLOWED_ORIGINS =
        "https://app.ophirpay.com, https://admin.ophirpay.com; https://partner.com";
      const allowed = getAllowedOrigins();
      expect(allowed.has("https://app.ophirpay.com")).toBe(true);
      expect(allowed.has("https://admin.ophirpay.com")).toBe(true);
      expect(allowed.has("https://partner.com")).toBe(true);
      expect(allowed.size).toBe(3);
    });

    it("includes NEXT_PUBLIC_APP_URL", () => {
      process.env.NEXT_PUBLIC_APP_URL = "https://checkout.ophirpay.com";
      const allowed = getAllowedOrigins();
      expect(allowed.has("https://checkout.ophirpay.com")).toBe(true);
    });

    it("defaults to local development origins in non-production when unset", () => {
      (process.env as Record<string, string | undefined>).NODE_ENV = "test";
      const allowed = getAllowedOrigins();
      expect(allowed.has("http://localhost:3000")).toBe(true);
      expect(allowed.has("http://127.0.0.1:3000")).toBe(true);
      expect(allowed.has("http://localhost:3001")).toBe(true);
    });
  });

  describe("isOriginAllowed", () => {
    it("returns true for matching origin", () => {
      process.env.ALLOWED_ORIGINS = "https://app.ophirpay.com";
      expect(isOriginAllowed("https://app.ophirpay.com")).toBe(true);
      expect(isOriginAllowed("https://app.ophirpay.com/")).toBe(true);
    });

    it("returns false for non-matching origin", () => {
      process.env.ALLOWED_ORIGINS = "https://app.ophirpay.com";
      expect(isOriginAllowed("https://evil.attacker.com")).toBe(false);
    });

    it("returns false for null, empty, or undefined", () => {
      expect(isOriginAllowed(null)).toBe(false);
      expect(isOriginAllowed("")).toBe(false);
      expect(isOriginAllowed(undefined)).toBe(false);
    });
  });

  describe("resolveCorsOrigin security invariants", () => {
    it("returns allowed with matching origin for legitimate origin", () => {
      process.env.ALLOWED_ORIGINS = "https://app.ophirpay.com";
      const resolution = resolveCorsOrigin("https://app.ophirpay.com", true);
      expect(resolution).toEqual({
        allowed: true,
        originHeader: "https://app.ophirpay.com",
        allowCredentials: true,
      });
    });

    it("STRICT INVARIANT: rejects wildcard '*' when credentials are required", () => {
      process.env.ALLOWED_ORIGINS = "*";
      const resolution = resolveCorsOrigin("https://attacker.com", true);
      // Fetch standard mandates that '*' and credentials=true MUST NEVER be combined
      expect(resolution.allowed).toBe(false);
      expect(resolution.originHeader).toBeNull();
      expect(resolution.allowCredentials).toBe(false);
    });

    it("permits wildcard '*' only when credentials are explicitly false", () => {
      process.env.ALLOWED_ORIGINS = "*";
      const resolution = resolveCorsOrigin("https://attacker.com", false);
      expect(resolution).toEqual({
        allowed: true,
        originHeader: "*",
        allowCredentials: false,
      });
    });

    it("rejects untrusted origin with allowCredentials: false", () => {
      process.env.ALLOWED_ORIGINS = "https://app.ophirpay.com";
      const resolution = resolveCorsOrigin("https://evil.com", true);
      expect(resolution.allowed).toBe(false);
      expect(resolution.originHeader).toBeNull();
    });
  });

  describe("handleCorsPreflight", () => {
    it("returns 204 with strict CORS headers for allowed origin", () => {
      process.env.ALLOWED_ORIGINS = "https://app.ophirpay.com";
      const request = new NextRequest("http://localhost/api/payments", {
        method: "OPTIONS",
        headers: {
          origin: "https://app.ophirpay.com",
          "access-control-request-method": "POST",
        },
      });

      const response = handleCorsPreflight(request);
      expect(response.status).toBe(204);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://app.ophirpay.com");
      expect(response.headers.get("Access-Control-Allow-Methods")).toBe(CORS_ALLOWED_METHODS);
      expect(response.headers.get("Access-Control-Allow-Headers")).toBe(CORS_ALLOWED_HEADERS);
      expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");
      expect(response.headers.get("Access-Control-Max-Age")).toBe(CORS_MAX_AGE_SECONDS);
      expect(response.headers.get("Vary")).toBe("Origin");
    });

    it("returns 403 Forbidden for disallowed origin preflight", async () => {
      process.env.ALLOWED_ORIGINS = "https://app.ophirpay.com";
      const request = new NextRequest("http://localhost/api/payments", {
        method: "OPTIONS",
        headers: {
          origin: "https://malicious.site",
          "access-control-request-method": "POST",
        },
      });

      const response = handleCorsPreflight(request);
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("FORBIDDEN");
    });

    it("returns 204 without CORS headers if no origin header is provided", () => {
      const request = new NextRequest("http://localhost/api/payments", {
        method: "OPTIONS",
      });
      const response = handleCorsPreflight(request);
      expect(response.status).toBe(204);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });
  });

  describe("applyCorsHeaders", () => {
    it("attaches CORS headers for allowed origin on POST", () => {
      process.env.ALLOWED_ORIGINS = "https://app.ophirpay.com";
      const request = new NextRequest("http://localhost/api/payments", {
        method: "POST",
        headers: { origin: "https://app.ophirpay.com" },
      });
      const original = NextResponse.json({ ok: true });
      const modified = applyCorsHeaders(original, request);

      expect(modified.status).toBe(200);
      expect(modified.headers.get("Access-Control-Allow-Origin")).toBe("https://app.ophirpay.com");
      expect(modified.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    });

    it("blocks mutation requests with 403 Forbidden when origin is disallowed", async () => {
      process.env.ALLOWED_ORIGINS = "https://app.ophirpay.com";
      const request = new NextRequest("http://localhost/api/payments", {
        method: "POST",
        headers: { origin: "https://evil.com" },
      });
      const original = NextResponse.json({ ok: true });
      const blocked = applyCorsHeaders(original, request);

      expect(blocked.status).toBe(403);
      const body = await blocked.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("FORBIDDEN");
      expect(body.error.message).toMatch(/origin not allowed/i);
    });

    it("passes through GET requests without setting CORS headers if origin is disallowed", () => {
      process.env.ALLOWED_ORIGINS = "https://app.ophirpay.com";
      const request = new NextRequest("http://localhost/api/payments", {
        method: "GET",
        headers: { origin: "https://evil.com" },
      });
      const original = NextResponse.json({ ok: true });
      const result = applyCorsHeaders(original, request);

      expect(result.status).toBe(200);
      expect(result.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });
  });

  describe("Edge Proxy Integration (src/proxy.ts)", () => {
    it("handles OPTIONS preflight at edge middleware and blocks unapproved origin", async () => {
      process.env.ALLOWED_ORIGINS = "https://app.ophirpay.com";
      const req = new NextRequest("http://localhost/api/payments", {
        method: "OPTIONS",
        headers: { origin: "https://unauthorized.org" },
      });

      const res = await proxy(req);
      expect(res.status).toBe(403);
    });

    it("handles OPTIONS preflight at edge middleware and permits approved origin", async () => {
      process.env.ALLOWED_ORIGINS = "https://app.ophirpay.com";
      const req = new NextRequest("http://localhost/api/payments", {
        method: "OPTIONS",
        headers: { origin: "https://app.ophirpay.com" },
      });

      const res = await proxy(req);
      expect(res.status).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://app.ophirpay.com");
    });

    it("blocks cross-origin POST with 403 if origin is not allowlisted", async () => {
      process.env.ALLOWED_ORIGINS = "https://app.ophirpay.com";
      const req = new NextRequest("http://localhost/api/payments", {
        method: "POST",
        headers: {
          origin: "https://hacker.com",
          "content-type": "application/json",
        },
      });

      const res = await proxy(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe("FORBIDDEN");
    });
  });
});
