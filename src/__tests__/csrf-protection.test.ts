// SPDX-License-Identifier: MIT
// Unit and integration tests for CSRF protection and token verification (issue #1314)

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  generateCsrfToken,
  isCsrfExempt,
  validateRequestCsrf,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
} from "@/lib/csrf";
import { GET as getCsrfHandler } from "@/app/api/csrf/route";
import { proxy } from "@/proxy";
import { createApiClient } from "@/lib/api-client";

describe("CSRF Protection Unit Tests (issue #1314)", () => {
  it("generates a high-entropy hex/alphanumeric CSRF token", () => {
    const token1 = generateCsrfToken();
    const token2 = generateCsrfToken();
    expect(token1).toBeTypeOf("string");
    expect(token1.length).toBeGreaterThanOrEqual(32);
    expect(token1).not.toBe(token2);
  });

  describe("isCsrfExempt", () => {
    it("exempts safe HTTP methods (GET, HEAD, OPTIONS)", () => {
      const getReq = { method: "GET", nextUrl: { pathname: "/api/payments" }, headers: new Headers() };
      const headReq = { method: "HEAD", nextUrl: { pathname: "/api/payments" }, headers: new Headers() };
      const optionsReq = { method: "OPTIONS", nextUrl: { pathname: "/api/payments" }, headers: new Headers() };

      expect(isCsrfExempt(getReq)).toBe(true);
      expect(isCsrfExempt(headReq)).toBe(true);
      expect(isCsrfExempt(optionsReq)).toBe(true);
    });

    it("exempts health, metrics, csrf, and monitoring endpoints", () => {
      const csrfReq = { method: "POST", nextUrl: { pathname: "/api/csrf" }, headers: new Headers() };
      const healthReq = { method: "POST", nextUrl: { pathname: "/api/health" }, headers: new Headers() };
      const metricsReq = { method: "POST", nextUrl: { pathname: "/api/metrics" }, headers: new Headers() };

      expect(isCsrfExempt(csrfReq)).toBe(true);
      expect(isCsrfExempt(healthReq)).toBe(true);
      expect(isCsrfExempt(metricsReq)).toBe(true);
    });

    it("exempts requests authenticated via API Key headers (Authorization or x-api-key)", () => {
      const authReq = {
        method: "POST",
        nextUrl: { pathname: "/api/payments" },
        headers: new Headers({ authorization: "Bearer ophir_test_api_key_1234567890" }),
      };
      const keyReq = {
        method: "POST",
        nextUrl: { pathname: "/api/payments" },
        headers: new Headers({ "x-api-key": "ophir_live_key_abcdef123456" }),
      };

      expect(isCsrfExempt(authReq)).toBe(true);
      expect(isCsrfExempt(keyReq)).toBe(true);
    });

    it("requires CSRF verification for browser mutating requests without API key", () => {
      const mutatingReq = {
        method: "POST",
        nextUrl: { pathname: "/api/payments" },
        headers: new Headers({ cookie: "auth-session=valid_user_session" }),
      };
      expect(isCsrfExempt(mutatingReq)).toBe(false);
    });
  });

  describe("validateCsrfToken", () => {
    it("returns true when header matches cookie token", () => {
      const token = generateCsrfToken();
      const headers = new Headers();
      headers.set(CSRF_HEADER_NAME, token);
      headers.set("cookie", `${CSRF_COOKIE_NAME}=${token}; other=value`);

      const req = { method: "POST", headers };
      expect(validateRequestCsrf(req)).toBe(true);
    });

    it("returns false when header token does not match cookie token", () => {
      const headers = new Headers();
      headers.set(CSRF_HEADER_NAME, "forged_token_value_abc");
      headers.set("cookie", `${CSRF_COOKIE_NAME}=authentic_cookie_token_xyz`);

      const req = { method: "POST", headers };
      expect(validateRequestCsrf(req)).toBe(false);
    });

    it("returns false when either header or cookie token is missing", () => {
      const noHeader = {
        method: "POST",
        headers: new Headers({ cookie: `${CSRF_COOKIE_NAME}=token123` }),
      };
      expect(validateRequestCsrf(noHeader)).toBe(false);

      const noCookie = {
        method: "POST",
        headers: new Headers({ [CSRF_HEADER_NAME]: "token123" }),
      };
      expect(validateRequestCsrf(noCookie)).toBe(false);
    });
  });
});

describe("CSRF Route & Middleware Integration", () => {
  it("GET /api/csrf sets the CSRF cookie and returns the token in JSON", async () => {
    const res = await getCsrfHandler(new Request("http://localhost:3000/api/csrf"));
    expect(res.status).toBe(200);

    const json = await res.json();
    const token = json.token || json.csrfToken;
    expect(token).toBeTypeOf("string");

    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toContain(token);
    expect(setCookie?.toLowerCase()).toContain("samesite=strict");
  });

  it("blocks mutating requests with 403 Forbidden when CSRF token is missing", async () => {
    const req = new NextRequest("http://localhost:3000/api/payments", {
      method: "POST",
      headers: {
        cookie: "auth-session=session_token_123",
      },
    });

    const res = await proxy(req);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error.code).toBe("FORBIDDEN");
    expect(json.error.message).toMatch(/csrf/i);
  });

  it("passes mutating requests when CSRF token in header matches cookie", async () => {
    const token = generateCsrfToken();
    const req = new NextRequest("http://localhost:3000/api/payments", {
      method: "POST",
      headers: {
        cookie: `auth-session=session_123; ${CSRF_COOKIE_NAME}=${token}`,
        [CSRF_HEADER_NAME]: token,
      },
    });

    const res = await proxy(req);
    expect(res.status).not.toBe(403);
  });

  it("bypasses CSRF validation when request has API key authorization", async () => {
    const req = new NextRequest("http://localhost:3000/api/payments", {
      method: "POST",
      headers: {
        authorization: "Bearer ophir_live_key_999888777666",
      },
    });

    const res = await proxy(req);
    expect(res.status).not.toBe(403);
  });
});

describe("Client-side API Wrapper CSRF Handling", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("automatically attaches x-csrf-token on mutating requests", async () => {
    const testToken = "test_csrf_token_value_555";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { status: "created" } }),
    });
    global.fetch = fetchMock;

    // Simulate cookie presence
    Object.defineProperty(global, "document", {
      value: { cookie: `${CSRF_COOKIE_NAME}=${testToken}` },
      writable: true,
      configurable: true,
    });

    const client = createApiClient();
    await client.post("/test-endpoint", { name: "test" });

    expect(fetchMock).toHaveBeenCalled();
    const secondArg = fetchMock.mock.calls[0][1];
    expect(secondArg.headers["x-csrf-token"]).toBe(testToken);
  });
});
