// SPDX-License-Identifier: MIT
//
// Security-header contract tests for `src/proxy.ts`.
//
// These complement `src/__tests__/security-headers.test.ts` (which pins the
// static `next.config.ts` / vercel.json ownership rules) by exercising the
// actual middleware entry point:
//
//   - every document route carries the baseline headers and a per-request
//     nonce-based CSP;
//   - every API route carries the baseline headers, including responses the
//     proxy rejects before a route handler runs;
//   - the CSP allows the Stellar RPC/Horizon and wallet-extension origins the
//     app depends on while blocking unsafe script execution.
//
// They intentionally do not boot Next.js: `proxy()` is the same function the
// framework calls, so a missing/incorrect header fails here before deploy.

import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import nextConfig from "../../next.config";
import proxy from "../../src/proxy";
import { SECURITY_HEADERS } from "../../src/lib/security-headers";

const BASE_URL = "https://ophirpay.example";

/** Root (dashboard home), a dashboard page, and the webhooks dashboard page. */
const DOCUMENT_ROUTES = ["/", "/payments", "/webhooks"];

/** Webhook API collection, a webhook resource, and the health probe. */
const API_ROUTES = ["/api/webhooks", "/api/webhooks/webhook_123", "/api/health"];

function request(path: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(`${BASE_URL}${path}`, init);
}

function directive(csp: string, name: string): string[] {
  const entry = csp
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `));
  return entry?.split(/\s+/).slice(1) ?? [];
}

function expectBaselineHeaders(headers: Headers): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    expect(headers.get(name), `${name} must be present`).toBe(value);
  }
}

describe.each(DOCUMENT_ROUTES)("document route %s", (route) => {
  it("sets every baseline security header", async () => {
    const response = await proxy(request(route));
    expectBaselineHeaders(response.headers);
  });

  it("emits a nonce-based CSP that blocks framing and inline scripts", async () => {
    const response = await proxy(request(route));
    const csp = response.headers.get("content-security-policy");
    expect(csp).toBeTruthy();

    const scriptSrc = directive(csp!, "script-src");
    expect(scriptSrc).toContain("'self'");
    expect(scriptSrc).toContain("'strict-dynamic'");
    expect(scriptSrc.some((source) => /^'nonce-[^']+'$/.test(source))).toBe(true);
    expect(scriptSrc).not.toContain("'unsafe-inline'");

    expect(directive(csp!, "object-src")).toEqual(["'none'"]);
    expect(directive(csp!, "frame-ancestors")).toEqual(["'none'"]);
    expect(directive(csp!, "base-uri")).toEqual(["'self'"]);
    expect(directive(csp!, "form-action")).toEqual(["'self'"]);
    expect(directive(csp!, "report-to")).toEqual(["csp-endpoint"]);
    expect(directive(csp!, "report-uri")).toEqual(["/api/csp-report"]);
  });

  it("allows Stellar RPC/Horizon and wallet origins only where needed", async () => {
    const response = await proxy(request(route));
    const csp = response.headers.get("content-security-policy")!;

    expect(directive(csp, "connect-src")).toEqual(
      expect.arrayContaining([
        "https://horizon-testnet.stellar.org",
        "https://horizon.stellar.org",
        "https://soroban-testnet.stellar.org",
        "https://soroban.stellar.org",
      ]),
    );
    expect(directive(csp, "frame-src")).toEqual(
      expect.arrayContaining(["https://*.freighter.app"]),
    );
    // No wildcard origin may creep into the script or connect policy.
    expect(directive(csp, "script-src")).not.toContain("*");
    expect(directive(csp, "connect-src")).not.toContain("*");
  });

  it("uses a fresh nonce for every request", async () => {
    const first = await proxy(request(route));
    const second = await proxy(request(route));
    const nonceOf = (response: Response) =>
      response.headers
        .get("content-security-policy")!
        .match(/'nonce-([^']+)'/)?.[1];

    expect(nonceOf(first)).toBeTruthy();
    expect(nonceOf(second)).toBeTruthy();
    expect(nonceOf(first)).not.toBe(nonceOf(second));
  });
});

describe.each(API_ROUTES)("API route %s", (route) => {
  it("sets every baseline security header", async () => {
    const response = await proxy(request(route));
    expectBaselineHeaders(response.headers);
  });

  it("does not attach the browser page CSP to JSON responses", async () => {
    const response = await proxy(request(route));
    expect(response.headers.get("content-security-policy")).toBeNull();
  });
});

describe("proxy-generated error responses", () => {
  it("keeps the security headers on a 401 rejection", async () => {
    const response = await proxy(
      request("/api/payments", {
        headers: { authorization: "Bearer not-a-valid-key" },
      }),
    );

    expect(response.status).toBe(401);
    expectBaselineHeaders(response.headers);
  });
});

describe("static header ownership", () => {
  it("next.config.ts applies the same baseline values to every path", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const global = rules.find((rule) => rule.source === "/(.*)");
    expect(global).toBeDefined();

    const byKey = new Map(
      (global?.headers ?? []).map((header) => [header.key, header.value]),
    );
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(byKey.get(name), `${name} in next.config.ts`).toBe(value);
    }
  });
});
