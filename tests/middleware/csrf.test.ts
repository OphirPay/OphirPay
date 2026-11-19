// SPDX-License-Identifier: MIT

/**
 * Central CSRF enforcement (proxy/middleware) and browser client wiring.
 *
 * Browser sessions present a signed `ophirpay_session` cookie and must echo
 * the CSRF cookie in `x-csrf-token` on every mutating request. API keys and
 * cron secrets travel in custom headers and are exempt.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { generateCsrfToken, validateCsrfToken } from "@/lib/csrf";

const SESSION = "ophirpay_session=test-session";
const VALID_API_KEY = `oph_${"a".repeat(64)}`;

function request(
  path: string,
  init: { method?: string; cookie?: string; headers?: Record<string, string> } = {}
) {
  return new NextRequest(`http://localhost${path}`, {
    method: init.method ?? "POST",
    headers: {
      ...(init.cookie ? { cookie: init.cookie } : {}),
      ...(init.headers ?? {}),
    },
  });
}

describe("proxy CSRF enforcement", () => {
  it("rejects a session mutation without an x-csrf-token header", async () => {
    const token = generateCsrfToken();
    const res = await proxy(
      request("/api/batches", { cookie: `${SESSION}; csrf=${token}` })
    );

    expect(res.status).toBe(403);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = (await res.json()) as {
      error: { code: string };
    };
    expect(body.error.code).toBe("CSRF_INVALID");
  });

  it("rejects a session mutation whose header does not match the cookie", async () => {
    const res = await proxy(
      request("/api/webhooks", {
        method: "PATCH",
        cookie: `${SESSION}; csrf=${generateCsrfToken()}`,
        headers: { "x-csrf-token": generateCsrfToken() },
      })
    );

    expect(res.status).toBe(403);
  });

  it("allows a session mutation with a matching double-submit token", async () => {
    const token = generateCsrfToken();
    const res = await proxy(
      request("/api/batches", {
        cookie: `${SESSION}; csrf=${token}`,
        headers: { "x-csrf-token": token },
      })
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Request-Id")).toBeTruthy();
  });

  it("accepts the __Host-csrf cookie used over HTTPS", async () => {
    const token = generateCsrfToken();
    const res = await proxy(
      request("/api/escrows", {
        cookie: `${SESSION}; __Host-csrf=${token}`,
        headers: { "x-csrf-token": token },
      })
    );

    expect(res.status).toBe(200);
  });

  it("does not block reads", async () => {
    const res = await proxy(
      request("/api/batches", { method: "GET", cookie: SESSION })
    );

    expect(res.status).toBe(200);
  });

  it("leaves unauthenticated (no session cookie) requests to route-level auth", async () => {
    const res = await proxy(request("/api/auth/session"));

    expect(res.status).toBe(200);
  });

  it("bypasses CSRF for API-key authenticated requests", async () => {
    const res = await proxy(
      request("/api/batches", {
        cookie: SESSION,
        headers: { authorization: `Bearer ${VALID_API_KEY}` },
      })
    );

    expect(res.status).toBe(200);
  });

  it("bypasses CSRF for cron-secret requests", async () => {
    const res = await proxy(
      request("/api/cron", {
        cookie: SESSION,
        headers: { "x-cron-secret": "scheduler-secret" },
      })
    );

    expect(res.status).toBe(200);
  });

  it("enforces DELETE and PUT session mutations too", async () => {
    for (const method of ["DELETE", "PUT"] as const) {
      const res = await proxy(
        request("/api/payments", { method, cookie: SESSION })
      );
      expect(res.status, `${method} should be protected`).toBe(403);
    }
  });
});

describe("CSRF token cookie and client", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("sets a SameSite=Lax CSRF cookie", async () => {
    vi.resetModules();
    const { GET } = await import("@/app/api/csrf/route");
    const res = await GET(new Request("http://localhost/api/csrf"));

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("HttpOnly");

    const body = (await res.json()) as { token: string };
    expect(validateCsrfToken(body.token, body.token)).toBe(true);
  });

  it("attaches x-csrf-token to mutating api-client requests", async () => {
    vi.resetModules();
    const token = generateCsrfToken();
    const calls: Array<{ url: string; headers: Headers }> = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const headers = new Headers(init?.headers);
        calls.push({ url, headers });

        if (url.endsWith("/api/csrf")) {
          return new Response(JSON.stringify({ token }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ success: true, data: { ok: true } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      })
    );

    const { createApiClient } = await import("@/lib/api-client");
    const client = createApiClient();

    await client.post("/api/batches", { name: "run" });

    const mutation = calls.find((c) => c.url === "/api/batches");
    expect(mutation).toBeDefined();
    expect(mutation!.headers.get("x-csrf-token")).toBe(token);

    // The GET mint must not send a CSRF header.
    const mint = calls.find((c) => c.url === "/api/csrf");
    expect(mint!.headers.get("x-csrf-token")).toBeNull();
  });

  it("does not attach a CSRF header to GET requests", async () => {
    vi.resetModules();
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { createApiClient } = await import("@/lib/api-client");
    await createApiClient().get("/api/payments");

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get("x-csrf-token")).toBeNull();
  });
});
