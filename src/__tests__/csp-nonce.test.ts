// SPDX-License-Identifier: MIT
// Nonce-based script-src for HTML pages (issue #1257, follow-up to #697).

import { describe, it, expect, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn(), request: vi.fn() },
}));

async function loadProxy(nodeEnv: string) {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", nodeEnv);
  return import("@/proxy");
}

async function renderPage(nodeEnv: string) {
  const { proxy } = await loadProxy(nodeEnv);
  const res = await proxy(new NextRequest("http://localhost/dashboard"));
  const csp = res.headers.get("Content-Security-Policy") ?? "";
  const scriptSrc = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src")) ?? "";
  return { res, csp, scriptSrc };
}

function nonceOf(scriptSrc: string): string | undefined {
  return scriptSrc.match(/'nonce-([A-Za-z0-9+/_-]+={0,2})'/)?.[1];
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proxy CSP — nonce-based script-src (#1257)", () => {
  it("production script-src uses a nonce + strict-dynamic and drops 'unsafe-inline'", async () => {
    const { scriptSrc } = await renderPage("production");
    expect(scriptSrc).toMatch(
      /^script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic' 'wasm-unsafe-eval'$/
    );
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });

  it("development script-src adds only 'unsafe-eval' (HMR) and still drops 'unsafe-inline'", async () => {
    const { scriptSrc } = await renderPage("development");
    expect(scriptSrc).toMatch(
      /^script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic' 'unsafe-eval' 'wasm-unsafe-eval'$/
    );
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  it("generates a fresh nonce for every request", async () => {
    const { proxy } = await loadProxy("production");
    const nonces = new Set<string | undefined>();
    for (let i = 0; i < 5; i++) {
      const res = await proxy(new NextRequest("http://localhost/"));
      const csp = res.headers.get("Content-Security-Policy") ?? "";
      nonces.add(nonceOf(csp));
    }
    expect(nonces.size).toBe(5);
    expect(nonces.has(undefined)).toBe(false);
  });

  it("forwards the same CSP and nonce on the request so the App Router renderer can read it", async () => {
    // NextResponse.next({ request: { headers } }) encodes overridden request
    // headers as x-middleware-request-* on the response; Next applies them to
    // the request the renderer sees (app-render reads content-security-policy).
    const { res, csp } = await renderPage("production");
    const nonce = nonceOf(csp);
    expect(nonce).toBeTruthy();
    expect(res.headers.get("x-middleware-request-content-security-policy")).toBe(csp);
    expect(res.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
    expect(res.headers.get("x-middleware-override-headers")).toContain("content-security-policy");
  });

  it("does not attach a CSP to API responses", async () => {
    const { proxy } = await loadProxy("production");
    const res = await proxy(new NextRequest("http://localhost/api/health"));
    expect(res.headers.get("Content-Security-Policy")).toBeNull();
  });
});
