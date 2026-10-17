// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import {
  STRICT_SECURITY_HEADERS,
  STELLAR_CONNECT_ORIGINS,
  WALLET_FRAME_ORIGINS,
  applySecurityHeaders,
  buildStrictCspHeader,
  computeScriptSha256Hash,
  generateCspNonce,
  getStrictSecurityHeaders,
  verifyScriptHash,
} from "@/lib/security-headers";
import { proxy } from "@/proxy";

describe("Edge Middleware & Strict Security Headers (#1310)", () => {
  describe("Strict static security headers", () => {
    it("includes X-Frame-Options, X-Content-Type-Options, Referrer-Policy, and Permissions-Policy", () => {
      const headers = getStrictSecurityHeaders({ pathname: "/" });

      expect(headers["X-Frame-Options"]).toBe("DENY");
      expect(headers["X-Content-Type-Options"]).toBe("nosniff");
      expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
      expect(headers["Permissions-Policy"]).toContain("camera=()");
      expect(headers["Permissions-Policy"]).toContain("microphone=()");
      expect(headers["Permissions-Policy"]).toContain("geolocation=()");
      expect(headers["Strict-Transport-Security"]).toContain("max-age=63072000");
      expect(headers["X-XSS-Protection"]).toBe("0");
    });
  });

  describe("Content-Security-Policy directives", () => {
    it("allows legitimate Stellar RPC and wallet connector origins while blocking unauthorized origins", () => {
      const nonce = generateCspNonce();
      const csp = buildStrictCspHeader({
        nonce,
        isProduction: true,
        pathname: "/dashboard",
      });

      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain(`'nonce-${nonce}'`);
      expect(csp).toContain("'strict-dynamic'");
      expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");

      for (const rpcOrigin of STELLAR_CONNECT_ORIGINS) {
        expect(csp).toContain(rpcOrigin);
      }
      for (const frameOrigin of WALLET_FRAME_ORIGINS) {
        expect(csp).toContain(frameOrigin);
      }
      expect(csp).not.toContain("https://evil.example.com");
    });

    it("supports SHA-256 script hash verification and injection into script-src", () => {
      const inlineScript = "window.__OPHIR_THEME__ = 'dark';";
      const hashToken = computeScriptSha256Hash(inlineScript);

      expect(hashToken).toMatch(/^sha256-[A-Za-z0-9+/=]+$/);
      expect(verifyScriptHash(inlineScript, hashToken)).toBe(true);
      expect(verifyScriptHash(inlineScript, `'${hashToken}'`)).toBe(true);
      expect(verifyScriptHash("window.__OPHIR_THEME__ = 'tampered';", hashToken)).toBe(false);
      expect(verifyScriptHash(inlineScript, "sha256-short")).toBe(false);

      const csp = buildStrictCspHeader({
        nonce: "test-nonce-123",
        scriptHashes: [hashToken],
        isProduction: true,
        pathname: "/",
      });
      expect(csp).toContain(`'nonce-test-nonce-123' '${hashToken}'`);
    });

    it("applies locked-down CSP on API and webhook routes", () => {
      const webhookHeaders = getStrictSecurityHeaders({ pathname: "/api/webhooks" });
      expect(webhookHeaders["Content-Security-Policy"]).toBe(
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      );
      expect(webhookHeaders["x-nonce"]).toBeUndefined();
      expect(webhookHeaders["X-Frame-Options"]).toBe("DENY");
      expect(webhookHeaders["X-Content-Type-Options"]).toBe("nosniff");
    });
  });

  describe("Route coverage across root, dashboard, and webhook endpoints", () => {
    it("applies headers cleanly to Response objects via applySecurityHeaders", () => {
      const response = new Response(JSON.stringify({ ok: true }), { status: 200 });
      applySecurityHeaders(response, { pathname: "/api/webhooks" });

      expect(response.headers.get("X-Frame-Options")).toBe(STRICT_SECURITY_HEADERS["X-Frame-Options"]);
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(response.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
      expect(response.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    });

    it("verifies edge proxy sets nonce-backed CSP on root and dashboard routes and request ID on webhook routes", async () => {
      const rootReq = new NextRequest("http://localhost:3000/");
      const rootRes = await proxy(rootReq);
      const rootCsp = rootRes.headers.get("Content-Security-Policy") ?? "";
      expect(rootCsp).toContain("default-src 'self'");
      expect(rootCsp).toContain("https://soroban-testnet.stellar.org");
      expect(rootCsp).toContain("https://*.freighter.app");

      const dashboardReq = new NextRequest("http://localhost:3000/payments");
      const dashboardRes = await proxy(dashboardReq);
      const dashboardCsp = dashboardRes.headers.get("Content-Security-Policy") ?? "";
      expect(dashboardCsp).toContain("'strict-dynamic'");
      expect(dashboardRes.headers.get("Reporting-Endpoints")).toContain("/api/csp-report");

      const webhookReq = new NextRequest("http://localhost:3000/api/webhooks");
      const webhookRes = await proxy(webhookReq);
      expect(webhookRes.headers.get("X-Request-Id")).toBeTruthy();
    });
  });
});
