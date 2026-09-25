// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { buildCsp, proxy } from "@/proxy";
import { NextRequest } from "next/server";
import { readFileSync, existsSync } from "fs";
import path from "path";

describe("Content Security Policy Directives & Audit (Issue #697)", () => {
  describe("Production Directive Set", () => {
    const csp = buildCsp(true);

    it("enforces default-src 'self'", () => {
      expect(csp).toContain("default-src 'self'");
    });

    it("enforces script-src with unsafe-inline and wasm-unsafe-eval but no unsafe-eval in production", () => {
      expect(csp).toMatch(/script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'(;|$)/);
      expect(csp).not.toContain("'unsafe-eval'");
    });

    it("enforces style-src 'self' 'unsafe-inline'", () => {
      expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    });

    it("whitelists only authorized Horizon, Soroban, and Stellar RPC endpoints in connect-src", () => {
      expect(csp).toContain("connect-src 'self'");
      expect(csp).toContain("https://horizon-testnet.stellar.org");
      expect(csp).toContain("https://horizon.stellar.org");
      expect(csp).toContain("https://soroban-testnet.stellar.org");
      expect(csp).toContain("https://soroban.stellar.org");
      expect(csp).toContain("https://rpc-futurenet.stellar.org");
      expect(csp).toContain("https://mainnet.soroban.rpc.pulse.so");
    });

    it("restricts img-src to self, data:, stellar.expert, and raw.githubusercontent.com", () => {
      expect(csp).toContain(
        "img-src 'self' data: https://stellar.expert https://raw.githubusercontent.com"
      );
    });

    it("restricts font-src to self", () => {
      expect(csp).toContain("font-src 'self'");
    });

    it("restricts frame-src to self, Freighter, and browser extension schemes", () => {
      expect(csp).toContain(
        "frame-src 'self' https://*.freighter.app chrome-extension: moz-extension:"
      );
    });

    it("disables plugins via object-src 'none'", () => {
      expect(csp).toContain("object-src 'none'");
    });

    it("restricts base-uri to self to prevent base tag injection", () => {
      expect(csp).toContain("base-uri 'self'");
    });

    it("restricts form-action to self", () => {
      expect(csp).toContain("form-action 'self'");
    });
  });

  describe("Development Directive Set", () => {
    const devCsp = buildCsp(false);

    it("includes unsafe-eval for Fast Refresh and HMR in development", () => {
      expect(devCsp).toMatch(
        /script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'(;|$)/
      );
    });
  });

  describe("Proxy HTML Security Headers", () => {
    it("applies CSP and baseline security headers on HTML responses", async () => {
      const req = new NextRequest("http://localhost/dashboard");
      const res = await proxy(req);

      expect(res.headers.get("Content-Security-Policy")).toBeDefined();
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(res.headers.get("X-Frame-Options")).toBe("DENY");
      expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    });
  });

  describe("Documentation & Audit Invariant Consistency", () => {
    const rootDir = process.cwd();

    it("next.config.ts does not claim an active per-request nonce or nonexistent src/middleware.ts", () => {
      const nextConfigPath = path.join(rootDir, "next.config.ts");
      const content = readFileSync(nextConfigPath, "utf8");

      expect(content).not.toMatch(/set per-request in src\/middleware\.ts with a per-request nonce/i);
      expect(content).toContain("src/proxy.ts");
      expect(content).toContain("unsafe-inline");
    });

    it("SECURITY.md documents the CSP directive matrix and the unsafe-inline limitation", () => {
      const securityPath = path.join(rootDir, "SECURITY.md");
      const content = readFileSync(securityPath, "utf8");

      expect(content).toContain("Content Security Policy (CSP) & Inline Scripts");
      expect(content).toContain("Known Limitation: 'unsafe-inline' in script-src");
      expect(content).toContain("Next.js 16 (App Router)");
      expect(content).toContain("React Automatic JSX Escaping");
    });

    it("docs/AUDIT.md records the LOW-13 finding for the unsafe-inline limitation", () => {
      const auditPath = path.join(rootDir, "docs/AUDIT.md");
      const content = readFileSync(auditPath, "utf8");

      expect(content).toContain("LOW-13");
      expect(content).toContain("Content Security Policy retains 'unsafe-inline' in script-src");
      expect(content).toContain("ARCHITECTURAL LIMITATION");
    });
  });
});
