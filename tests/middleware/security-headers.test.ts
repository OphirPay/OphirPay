// SPDX-License-Identifier: MIT
// Automated tests for Content Security Policy (CSP) and Edge Middleware Security Headers (Issue #1310)

import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import {
  getSecurityHeaders,
  applySecurityHeaders,
  DEFAULT_SECURITY_HEADERS,
  HSTS_HEADER,
} from "@/lib/security-headers";
import { buildCsp, generateNonce, CSP_POLICY } from "@/lib/proxy-config";
import { proxy } from "@/proxy";

describe("HTTP Security Headers Unit Tests (#1310)", () => {
  it("provides standard security headers by default", () => {
    expect(DEFAULT_SECURITY_HEADERS["X-Content-Type-Options"]).toBe("nosniff");
    const headers = getSecurityHeaders({ isApi: true, isProduction: false });

    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Permissions-Policy"]).toContain("camera=()");
    expect(headers["Permissions-Policy"]).toContain("microphone=()");
    expect(headers["Permissions-Policy"]).toContain("geolocation=()");
    expect(headers["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    expect(headers["Cross-Origin-Resource-Policy"]).toBe("same-origin");
  });

  it("applies HSTS Strict-Transport-Security header in production mode", () => {
    const devHeaders = getSecurityHeaders({ isProduction: false });
    expect(devHeaders["Strict-Transport-Security"]).toBeUndefined();

    const prodHeaders = getSecurityHeaders({ isProduction: true });
    expect(prodHeaders["Strict-Transport-Security"]).toBe(HSTS_HEADER);
    expect(prodHeaders["Strict-Transport-Security"]).toContain("max-age=63072000");
    expect(prodHeaders["Strict-Transport-Security"]).toContain("includeSubDomains");
  });

  it("generates strict Content-Security-Policy with dynamic nonce for web documents", () => {
    const nonce = generateNonce();
    const headers = getSecurityHeaders({ isApi: false, nonce, isProduction: true });

    const csp = headers["Content-Security-Policy"];
    expect(csp).toBeDefined();

    const scriptSrcMatch = csp.match(/script-src\s+([^;]+)/);
    expect(scriptSrcMatch).not.toBeNull();
    const scriptSrc = scriptSrcMatch![1];

    expect(scriptSrc).toContain(`'nonce-${nonce}'`);
    expect(scriptSrc).toContain("'strict-dynamic'");
    expect(scriptSrc).toContain("'wasm-unsafe-eval'");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });

  it("authorizes canonical Stellar Horizon and Soroban RPC domains in connect-src", () => {
    const nonce = generateNonce();
    const csp = buildCsp(nonce, true);

    expect(csp).toContain("https://horizon-testnet.stellar.org");
    expect(csp).toContain("https://horizon.stellar.org");
    expect(csp).toContain("https://soroban-testnet.stellar.org");
    expect(csp).toContain("https://soroban.stellar.org");
    expect(csp).toContain("https://rpc-futurenet.stellar.org");
    expect(csp).toContain("https://mainnet.soroban.rpc.pulse.so");
  });

  it("authorizes Freighter and browser extension schemes in frame-src", () => {
    const nonce = generateNonce();
    const csp = buildCsp(nonce, true);

    expect(csp).toContain("https://*.freighter.app");
    expect(csp).toContain("chrome-extension:");
    expect(csp).toContain("moz-extension:");
  });

  it("applies headers onto an existing Headers instance", () => {
    const target = new Headers();
    applySecurityHeaders(target, { isApi: true, isProduction: true });

    expect(target.get("X-Content-Type-Options")).toBe("nosniff");
    expect(target.get("X-Frame-Options")).toBe("DENY");
    expect(target.get("Strict-Transport-Security")).toBe(HSTS_HEADER);
  });
});

describe("Edge Middleware Security Headers Integration (#1310)", () => {
  it("enforces security headers on API routes", async () => {
    const req = new NextRequest("http://localhost:3000/api/payments", {
      method: "GET",
    });

    const res = await proxy(req);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("Permissions-Policy")).toContain("camera=()");
    expect(res.headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(res.headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
    expect(res.headers.get("X-Request-Id")).toBeDefined();
  });

  it("enforces strict CSP and reporting headers on HTML page routes", async () => {
    const req = new NextRequest("http://localhost:3000/dashboard", {
      method: "GET",
      headers: {
        accept: "text/html",
      },
    });

    const res = await proxy(req);
    const csp = res.headers.get("Content-Security-Policy");
    expect(csp).toBeDefined();
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).toContain("'wasm-unsafe-eval'");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Report-To")).toContain(CSP_POLICY.reportingGroup);
    expect(res.headers.get("Reporting-Endpoints")).toContain(CSP_POLICY.reportUri);
  });
});
