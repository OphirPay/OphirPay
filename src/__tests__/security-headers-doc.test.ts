/**
 * Unit tests verifying compliance with the security header policy documentation requirements (issue #781).
 *
 * Verifies that docs/SECURITY_HEADERS.md exists, enumerates all security headers with authoritative sources,
 * documents deliberate relaxations with tracking issue pointers, and is linked from SECURITY.md and DEPLOYMENT.md.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const rootDir = path.resolve(__dirname, "../..");
const docPath = path.join(rootDir, "docs", "SECURITY_HEADERS.md");
const securityMdPath = path.join(rootDir, "SECURITY.md");
const deploymentMdPath = path.join(rootDir, "docs", "DEPLOYMENT.md");

describe("docs/SECURITY_HEADERS.md (issue #781)", () => {
  it("exists as a non-empty document", () => {
    expect(existsSync(docPath)).toBe(true);
    const content = readFileSync(docPath, "utf8");
    expect(content.length).toBeGreaterThan(500);
  });

  const doc = existsSync(docPath) ? readFileSync(docPath, "utf8") : "";

  it("defines authoritative sources for every security-relevant header", () => {
    const requiredHeaders = [
      "X-Content-Type-Options",
      "X-Frame-Options",
      "X-XSS-Protection",
      "Referrer-Policy",
      "Permissions-Policy",
      "Strict-Transport-Security",
      "Cross-Origin-Opener-Policy",
      "Cross-Origin-Resource-Policy",
      "Content-Security-Policy",
      "Report-To",
      "Reporting-Endpoints",
      "Cache-Control",
      "X-Request-Id",
      "X-Api-Version",
      "X-RateLimit",
      "Access-Control-Allow-Origin",
    ];

    for (const header of requiredHeaders) {
      expect(doc).toContain(header);
    }

    expect(doc).toContain("next.config.ts");
    expect(doc).toContain("src/proxy.ts");
    expect(doc).toContain("vercel.json");
  });

  it("documents deliberate relaxations and their tracking issues", () => {
    expect(doc).toContain("unsafe-inline");
    expect(doc).toMatch(/697/);
    expect(doc).toContain("wasm-unsafe-eval");
    expect(doc).toContain("unsafe-eval");
    expect(doc).toContain("connect-src");
    expect(doc).toContain("frame-src");
    expect(doc).toContain("Freighter");
    expect(doc).toMatch(/681/);
  });

  it("documents multi-layer deployment precedence and vercel.json non-duplication", () => {
    expect(doc).toContain("vercel.json");
    expect(doc).toContain("single owner");
    expect(doc).toContain("Parity");
  });

  it("provides curl verification commands", () => {
    expect(doc).toContain("curl -sI");
    expect(doc).toContain("content-security-policy");
  });
});

describe("cross-document references to docs/SECURITY_HEADERS.md", () => {
  it("is referenced from SECURITY.md", () => {
    expect(existsSync(securityMdPath)).toBe(true);
    const securityDoc = readFileSync(securityMdPath, "utf8");
    expect(securityDoc).toMatch(/docs\/SECURITY_HEADERS\.md/);
    expect(securityDoc).toContain("## Security Headers Policy");
  });

  it("is referenced from docs/DEPLOYMENT.md", () => {
    expect(existsSync(deploymentMdPath)).toBe(true);
    const deploymentDoc = readFileSync(deploymentMdPath, "utf8");
    expect(deploymentDoc).toMatch(/SECURITY_HEADERS\.md/);
  });
});
