// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const doc = fs.readFileSync(path.join(root, "docs/SECURITY_HEADERS.md"), "utf8");
const nextConfig = fs.readFileSync(path.join(root, "next.config.ts"), "utf8");
const proxy = fs.readFileSync(path.join(root, "src/proxy.ts"), "utf8");
const vercel = fs.readFileSync(path.join(root, "vercel.json"), "utf8");

describe("security header documentation", () => {
  const headers = [
    "Content-Security-Policy",
    "X-Content-Type-Options",
    "X-Frame-Options",
    "X-XSS-Protection",
    "Referrer-Policy",
    "Permissions-Policy",
    "Strict-Transport-Security",
    "Cross-Origin-Opener-Policy",
    "Cross-Origin-Resource-Policy",
    "Cache-Control",
    "X-Request-Id",
    "X-Api-Version",
    "X-RateLimit-Limit",
    "X-RateLimit-Remaining",
    "X-RateLimit-Reset",
    "Retry-After",
    "Access-Control-Allow-Origin",
    "Access-Control-Allow-Methods",
    "Access-Control-Allow-Headers",
  ];

  it("documents every security-relevant header emitted by config or proxy", () => {
    for (const header of headers) {
      expect(doc).toContain(`\`${header}\``);
      expect(nextConfig + proxy).toContain(header);
    }
  });

  it("records authoritative layers and deliberate relaxations", () => {
    expect(doc).toContain("next.config.ts");
    expect(doc).toContain("src/proxy.ts");
    expect(doc).toContain("vercel.json");
    expect(doc).toContain("script-src 'unsafe-inline'");
    expect(doc).toContain("script-src 'unsafe-eval'");
    expect(doc).toContain("Issue #781");
  });

  it("keeps vercel.json free of duplicated headers", () => {
    const parsed = JSON.parse(vercel) as Record<string, unknown>;
    expect(parsed.headers).toBeUndefined();
    expect(doc).toContain("`vercel.json` must remain free of `headers`");
  });
});
