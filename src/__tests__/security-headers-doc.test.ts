// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

describe("Security Headers Documentation (#781)", () => {
  const docPath = join(process.cwd(), "docs", "SECURITY_HEADERS.md");
  const securityMdPath = join(process.cwd(), "SECURITY.md");
  const deploymentMdPath = join(process.cwd(), "docs", "DEPLOYMENT.md");

  it("exists as docs/SECURITY_HEADERS.md", () => {
    expect(existsSync(docPath)).toBe(true);
  });

  it("documents every authoritative security header in a matrix", () => {
    const content = readFileSync(docPath, "utf8");

    const requiredHeaders = [
      "Content-Security-Policy",
      "X-Content-Type-Options",
      "X-Frame-Options",
      "X-XSS-Protection",
      "Referrer-Policy",
      "Permissions-Policy",
      "Strict-Transport-Security",
      "Cross-Origin-Opener-Policy",
      "Cross-Origin-Resource-Policy",
    ];

    for (const header of requiredHeaders) {
      expect(content).toContain(header);
    }

    // Authoritative sources are documented
    expect(content).toContain("next.config.ts");
    expect(content).toContain("src/proxy.ts");
  });

  it("documents deliberate relaxations and their technical justifications", () => {
    const content = readFileSync(docPath, "utf8");

    // unsafe-inline rationale & tracking issue
    expect(content).toContain("'unsafe-inline'");
    expect(content).toContain("App Router");
    expect(content).toContain("#697");

    // wasm-unsafe-eval for Soroban crypto
    expect(content).toContain("'wasm-unsafe-eval'");
    expect(content).toContain("Soroban");

    // unsafe-eval restricted to dev
    expect(content).toContain("'unsafe-eval'");
    expect(content).toContain("Development Only");

    // freighter extension frame-src
    expect(content).toContain("freighter");
  });

  it("is referenced from SECURITY.md", () => {
    const securityContent = readFileSync(securityMdPath, "utf8");
    expect(securityContent).toContain("docs/SECURITY_HEADERS.md");
  });

  it("is referenced from docs/DEPLOYMENT.md", () => {
    const deploymentContent = readFileSync(deploymentMdPath, "utf8");
    expect(deploymentContent).toContain("docs/SECURITY_HEADERS.md");
  });
});
