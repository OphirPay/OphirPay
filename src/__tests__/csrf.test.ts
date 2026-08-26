// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  csrfCookieHeader,
  getCsrfTokenFromCookies,
  validateCsrfToken,
  verifyCsrf,
} from "@/lib/csrf";

describe("csrf cookie minting and reading", () => {
  it("round-trips a token minted for https (__Host-csrf, Secure)", () => {
    const header = csrfCookieHeader("abc123", true);
    expect(header).toContain("__Host-csrf=abc123");
    expect(header).toContain("Secure");
    expect(header).not.toContain("__Host-__Host-csrf"); // no double prefix
    expect(getCsrfTokenFromCookies(header)).toBe("abc123");
  });

  it("round-trips a token minted for plain-http dev (csrf, no Secure)", () => {
    const header = csrfCookieHeader("def456", false);
    // The __Host- prefix REQUIRES Secure — over plain http we must use a
    // plain name, or browsers reject the cookie entirely.
    expect(header.startsWith("csrf=def456")).toBe(true);
    expect(header).not.toContain("Secure");
    expect(header).not.toContain("__Host-");
    expect(getCsrfTokenFromCookies(header)).toBe("def456");
  });

  it("reads the https cookie name from a mixed cookie jar", () => {
    const jar = `session=xyz; __Host-csrf=tokenA; other=1`;
    expect(getCsrfTokenFromCookies(jar)).toBe("tokenA");
  });

  it("returns null when no CSRF cookie is present", () => {
    expect(getCsrfTokenFromCookies(null)).toBeNull();
    expect(getCsrfTokenFromCookies("session=xyz")).toBeNull();
  });
});

describe("csrf token validation", () => {
  it("accepts matching tokens", () => {
    expect(validateCsrfToken("a".repeat(64), "a".repeat(64))).toBe(true);
  });

  it("rejects mismatched or malformed tokens", () => {
    expect(validateCsrfToken("a".repeat(64), "b".repeat(64))).toBe(false);
    expect(validateCsrfToken("short", "short")).toBe(false);
    expect(validateCsrfToken(null, "a".repeat(64))).toBe(false);
    expect(validateCsrfToken("a".repeat(64), null)).toBe(false);
  });
});

describe("verifyCsrf", () => {
  const makeRequest = (method: string, cookie?: string, header?: string) =>
    new Request("http://localhost/api/test", {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(header ? { "x-csrf-token": header } : {}),
      },
    });

  it("skips the check for GET requests", () => {
    expect(verifyCsrf(makeRequest("GET"))).toBeNull();
  });

  it("rejects POSTs without a matching token", () => {
    const res = verifyCsrf(makeRequest("POST"));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it("accepts a POST with matching cookie and header", () => {
    const token = "c".repeat(64);
    const cookie = csrfCookieHeader(token, true).split(";")[0];
    expect(verifyCsrf(makeRequest("POST", cookie, token))).toBeNull();
  });
});
