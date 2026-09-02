// SPDX-License-Identifier: MIT

import { describe, it, expect, vi } from "vitest";
import {
  generateCsrfToken,
  csrfCookieHeader,
  validateCsrfToken,
  getCsrfTokenFromCookies,
  getCsrfTokenFromHeaders,
  verifyCsrf,
  withCsrf,
  findUnprotectedRoutes,
  auditRouteProtection,
} from "@/lib/csrf";

describe("CSRF Protection", () => {
  describe("generateCsrfToken", () => {
    it("generates unique tokens", () => {
      const token1 = generateCsrfToken();
      const token2 = generateCsrfToken();
      expect(token1).not.toBe(token2);
    });

    it("generates 64-character hex tokens", () => {
      const token = generateCsrfToken();
      expect(token).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe("csrfCookieHeader", () => {
    it("creates secure cookie header for production", () => {
      const token = generateCsrfToken();
      const header = csrfCookieHeader(token, true);
      
      expect(header).toContain("__Host-csrf=");
      expect(header).toContain("Secure");
      expect(header).toContain("HttpOnly");
      expect(header).toContain("SameSite=Strict");
      expect(header).toContain("Max-Age=86400");
    });

    it("creates insecure cookie header for development", () => {
      const token = generateCsrfToken();
      const header = csrfCookieHeader(token, false);
      
      expect(header).toContain("csrf=");
      expect(header).not.toContain("Secure");
      expect(header).toContain("HttpOnly");
      expect(header).toContain("SameSite=Strict");
    });
  });

  describe("validateCsrfToken", () => {
    it("accepts matching tokens", () => {
      const token = generateCsrfToken();
      expect(validateCsrfToken(token, token)).toBe(true);
    });

    it("rejects mismatched tokens", () => {
      const token1 = generateCsrfToken();
      const token2 = generateCsrfToken();
      expect(validateCsrfToken(token1, token2)).toBe(false);
    });

    it("rejects null tokens", () => {
      expect(validateCsrfToken(null, "token")).toBe(false);
      expect(validateCsrfToken("token", null)).toBe(false);
      expect(validateCsrfToken(null, null)).toBe(false);
    });

    it("rejects tokens of wrong length", () => {
      expect(validateCsrfToken("abc", "abc")).toBe(false);
      expect(validateCsrfToken("a".repeat(64), "a".repeat(64))).toBe(false);
    });

    it("rejects non-hex tokens", () => {
      const token = "z".repeat(64);
      expect(validateCsrfToken(token, token)).toBe(false);
    });
  });

  describe("getCsrfTokenFromCookies", () => {
    it("extracts secure cookie", () => {
      const token = generateCsrfToken();
      const cookieHeader = `__Host-csrf=${token}; Path=/; Secure`;
      expect(getCsrfTokenFromCookies(cookieHeader)).toBe(token);
    });

    it("extracts insecure cookie", () => {
      const token = generateCsrfToken();
      const cookieHeader = `csrf=${token}; Path=/`;
      expect(getCsrfTokenFromCookies(cookieHeader)).toBe(token);
    });

    it("returns null for missing cookie", () => {
      expect(getCsrfTokenFromCookies(null)).toBeNull();
      expect(getCsrfTokenFromCookies("")).toBeNull();
      expect(getCsrfTokenFromCookies("other=value")).toBeNull();
    });
  });

  describe("getCsrfTokenFromHeaders", () => {
    it("extracts token from headers", () => {
      const token = generateCsrfToken();
      const headers = new Headers({ "x-csrf-token": token });
      expect(getCsrfTokenFromHeaders(headers)).toBe(token);
    });

    it("returns null for missing header", () => {
      const headers = new Headers();
      expect(getCsrfTokenFromHeaders(headers)).toBeNull();
    });
  });

  describe("verifyCsrf", () => {
    it("allows GET requests without CSRF", () => {
      const request = new Request("http://localhost/api/test", {
        method: "GET",
      });
      expect(verifyCsrf(request)).toBeNull();
    });

    it("allows HEAD requests without CSRF", () => {
      const request = new Request("http://localhost/api/test", {
        method: "HEAD",
      });
      expect(verifyCsrf(request)).toBeNull();
    });

    it("allows OPTIONS requests without CSRF", () => {
      const request = new Request("http://localhost/api/test", {
        method: "OPTIONS",
      });
      expect(verifyCsrf(request)).toBeNull();
    });

    it("rejects POST without CSRF token", () => {
      const request = new Request("http://localhost/api/test", {
        method: "POST",
      });
      const response = verifyCsrf(request);
      expect(response).not.toBeNull();
      expect(response!.status).toBe(403);
    });

    it("rejects POST with mismatched tokens", () => {
      const token1 = generateCsrfToken();
      const token2 = generateCsrfToken();
      const request = new Request("http://localhost/api/test", {
        method: "POST",
        headers: {
          "cookie": `__Host-csrf=${token1}`,
          "x-csrf-token": token2,
        },
      });
      const response = verifyCsrf(request);
      expect(response).not.toBeNull();
      expect(response!.status).toBe(403);
    });

    it("accepts POST with matching tokens", () => {
      const token = generateCsrfToken();
      const request = new Request("http://localhost/api/test", {
        method: "POST",
        headers: {
          "cookie": `__Host-csrf=${token}`,
          "x-csrf-token": token,
        },
      });
      expect(verifyCsrf(request)).toBeNull();
    });

    it("rejects DELETE without CSRF token", () => {
      const request = new Request("http://localhost/api/test", {
        method: "DELETE",
      });
      const response = verifyCsrf(request);
      expect(response).not.toBeNull();
      expect(response!.status).toBe(403);
    });

    it("rejects PATCH without CSRF token", () => {
      const request = new Request("http://localhost/api/test", {
        method: "PATCH",
      });
      const response = verifyCsrf(request);
      expect(response).not.toBeNull();
      expect(response!.status).toBe(403);
    });
  });

  describe("withCsrf wrapper", () => {
    it("calls handler for valid CSRF", async () => {
      const handler = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: true }), { status: 200 })
      );
      const wrapped = withCsrf(handler);
      
      const token = generateCsrfToken();
      const request = new Request("http://localhost/api/test", {
        method: "POST",
        headers: {
          "cookie": `__Host-csrf=${token}`,
          "x-csrf-token": token,
        },
      });
      
      const response = await wrapped(request);
      expect(handler).toHaveBeenCalled();
      expect(response.status).toBe(200);
    });

    it("blocks handler for invalid CSRF", async () => {
      const handler = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: true }), { status: 200 })
      );
      const wrapped = withCsrf(handler);
      
      const request = new Request("http://localhost/api/test", {
        method: "POST",
      });
      
      const response = await wrapped(request);
      expect(handler).not.toHaveBeenCalled();
      expect(response.status).toBe(403);
    });
  });

  describe("CSRF Route Audit", () => {
    it("has no unprotected mutating routes", () => {
      const unprotected = findUnprotectedRoutes();
      expect(unprotected).toEqual([]);
    });

    it("correctly identifies mutating methods", () => {
      expect(auditRouteProtection("POST", true)).toEqual({
        method: "POST",
        isMutating: true,
        isProtected: true,
      });
      
      expect(auditRouteProtection("POST", false)).toEqual({
        method: "POST",
        isMutating: true,
        isProtected: false,
      });
      
      expect(auditRouteProtection("GET", true)).toEqual({
        method: "GET",
        isMutating: false,
        isProtected: true,
      });
    });
  });

  it("skips CSRF when an API key header is present", () => {
    const req = new Request("http://localhost/api/test", {
      method: "POST",
      headers: { authorization: "Bearer oph_testkey1234567890abcdef" },
    });
    expect(verifyCsrf(req)).toBeNull();
  });
});
