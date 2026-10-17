// SPDX-License-Identifier: MIT

import { describe, it, expect, vi } from "vitest";
import {
  generateCsrfToken,
  csrfCookieHeader,
  verifyCsrf,
  withCsrf,
} from "@/lib/csrf";
import { GET as getCsrfRoute } from "@/app/api/csrf/route";
import { createApiClient } from "@/lib/api-client";

describe("Session CSRF protection and API client integration (#1314)", () => {
  it("rejects mutating browser requests (POST, PUT, PATCH, DELETE) without a valid CSRF header with 403 Forbidden", async () => {
    const token = generateCsrfToken();

    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      // Missing x-csrf-token header
      const missingHeaderReq = new Request("https://ophirpay.com/api/webhooks", {
        method,
        headers: {
          cookie: `__Host-csrf=${token}`,
        },
      });
      const res1 = verifyCsrf(missingHeaderReq);
      expect(res1).not.toBeNull();
      expect(res1!.status).toBe(403);
      const body1 = await res1!.json();
      expect(body1.error.code).toBe("CSRF_INVALID");

      // Forged cross-origin request with mismatched token
      const forgedToken = generateCsrfToken();
      const forgedReq = new Request("https://ophirpay.com/api/payments", {
        method,
        headers: {
          cookie: `__Host-csrf=${token}`,
          "x-csrf-token": forgedToken,
          origin: "https://evil.example.com",
        },
      });
      const res2 = verifyCsrf(forgedReq);
      expect(res2).not.toBeNull();
      expect(res2!.status).toBe(403);
    }
  });

  it("allows mutating browser requests when cookie and x-csrf-token header match", async () => {
    const token = generateCsrfToken();
    const handler = vi.fn().mockResolvedValue(
      Response.json({ success: true, data: { updated: true } })
    );
    const protectedHandler = withCsrf(handler);

    const req = new Request("https://ophirpay.com/api/webhooks", {
      method: "PUT",
      headers: {
        cookie: `__Host-csrf=${token}`,
        "x-csrf-token": token,
      },
    });

    const res = await protectedHandler(req);
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("bypasses CSRF validation for API key-authenticated requests", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const bearerReq = new Request("https://ophirpay.com/api/payments", {
        method,
        headers: {
          Authorization: "Bearer oph_live_1234567890abcdef",
        },
      });
      expect(verifyCsrf(bearerReq)).toBeNull();

      const apiKeyHeaderReq = new Request("https://ophirpay.com/api/batches", {
        method,
        headers: {
          "x-api-key": "oph_live_1234567890abcdef",
        },
      });
      expect(verifyCsrf(apiKeyHeaderReq)).toBeNull();
    }
  });

  it("mints a CSRF token and sets cookie header via GET /api/csrf", async () => {
    const req = new Request("https://ophirpay.com/api/csrf", { method: "GET" });
    const res = await getCsrfRoute(req);

    expect(res.status).toBe(200);
    const setCookie = res.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain("__Host-csrf=");
    expect(setCookie).toContain("HttpOnly");

    const data = (await res.json()) as { token: string };
    expect(data.token).toMatch(/^[0-9a-f]{64}$/);
    expect(res.headers.get("X-CSRF-Token")).toBe(data.token);
    expect(csrfCookieHeader(data.token, true, "Lax")).toContain("SameSite=Lax");
  });

  it("automatically retrieves and attaches x-csrf-token in frontend API client for mutating requests", async () => {
    const mintedToken = generateCsrfToken();
    const calls: Array<{ url: string; method: string; csrfHeader: string | null }> = [];

    const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method || "GET").toUpperCase();
      const headers = new Headers(init?.headers);
      calls.push({ url, method, csrfHeader: headers.get("x-csrf-token") });

      if (url.endsWith("/api/csrf")) {
        return new Response(JSON.stringify({ token: mintedToken }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(
        JSON.stringify({ success: true, data: { id: "wh_1" } }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as unknown as typeof fetch;

    const client = createApiClient({
      baseUrl: "https://ophirpay.com",
      fetchImpl: mockFetch,
    });

    // GET request does not fetch CSRF token
    await client.get("/api/webhooks");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      url: "https://ophirpay.com/api/webhooks",
      method: "GET",
      csrfHeader: null,
    });

    // POST request automatically fetches /api/csrf and attaches x-csrf-token
    await client.post("/api/webhooks", { url: "https://example.com/hook" });
    expect(calls).toHaveLength(3);
    expect(calls[1].url).toBe("https://ophirpay.com/api/csrf");
    expect(calls[2]).toEqual({
      url: "https://ophirpay.com/api/webhooks",
      method: "POST",
      csrfHeader: mintedToken,
    });

    // Subsequent DELETE reuses cached token without extra /api/csrf call
    await client.delete("/api/webhooks/wh_1");
    expect(calls).toHaveLength(4);
    expect(calls[3]).toEqual({
      url: "https://ophirpay.com/api/webhooks/wh_1",
      method: "DELETE",
      csrfHeader: mintedToken,
    });
  });

  it("skips fetching CSRF token in API client when Authorization Bearer header is configured", async () => {
    const calls: string[] = [];
    const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response(
        JSON.stringify({ success: true, data: { ok: true } }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as unknown as typeof fetch;

    const apiKeyClient = createApiClient({
      baseUrl: "https://ophirpay.com",
      headers: { Authorization: "Bearer oph_live_secret" },
      fetchImpl: mockFetch,
    });

    await apiKeyClient.post("/api/payments", { amount: 10 });
    expect(calls).toEqual(["https://ophirpay.com/api/payments"]);
  });
});
