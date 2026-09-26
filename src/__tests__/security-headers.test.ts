// SPDX-License-Identifier: MIT

/**
 * Issue #681 — one owner for the static security header set.
 *
 * `vercel.json` used to declare its own `/(.*)` header block whose
 * `X-XSS-Protection` value (`1; mode=block`, the deprecated filter that has
 * itself been abused for XSS) contradicted the `0` set by `next.config.ts`.
 * Which value a response carried depended on which layer applied last.
 *
 * These tests pin the fix down:
 *   - `next.config.ts` owns the security header set;
 *   - `vercel.json` never repeats a header the app layer already sets;
 *   - `X-XSS-Protection` is declared once and is exactly `"0"`.
 *
 * Issue #740 extends the same single-owner rule to cache policy: the
 * `/_next/static` immutable directive and the `/_next/image` rule live in
 * `next.config.ts`, so self-hosted targets emit the identical headers.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import nextConfig from "../../next.config";

interface HeaderEntry {
  key: string;
  value: string;
}

interface HeaderRule {
  source: string;
  headers: HeaderEntry[];
}

interface VercelConfig {
  headers?: HeaderRule[];
}

const vercelConfig = JSON.parse(
  readFileSync(join(process.cwd(), "vercel.json"), "utf8"),
) as VercelConfig;

/** Static header rules declared by `next.config.ts` (the app layer). */
async function appHeaderRules(): Promise<HeaderRule[]> {
  const rules = await nextConfig.headers?.();
  return (rules ?? []) as HeaderRule[];
}

/** Static header rules declared by `vercel.json` (the platform layer). */
function platformHeaderRules(): HeaderRule[] {
  return vercelConfig.headers ?? [];
}

function keysFor(rules: HeaderRule[], source: string): string[] {
  const rule = rules.find((candidate) => candidate.source === source);
  return (rule?.headers ?? []).map((header) => header.key.toLowerCase());
}

function allKeys(rules: HeaderRule[]): string[] {
  return rules.flatMap((rule) =>
    rule.headers.map((header) => header.key.toLowerCase()),
  );
}

describe("X-XSS-Protection (#681)", () => {
  it('is set to "0" by next.config.ts', async () => {
    const rule = (await appHeaderRules()).find(
      (candidate) => candidate.source === "/(.*)",
    );
    const header = (rule?.headers ?? []).find(
      (candidate) => candidate.key === "X-XSS-Protection",
    );

    expect(header?.value).toBe("0");
  });

  it("is not declared by vercel.json", () => {
    expect(allKeys(platformHeaderRules())).not.toContain("x-xss-protection");
  });

  it("is declared by exactly one layer, so responses carry a single value", async () => {
    const declarations = [
      ...allKeys(await appHeaderRules()),
      ...allKeys(platformHeaderRules()),
    ].filter((key) => key === "x-xss-protection");

    expect(declarations).toHaveLength(1);
  });
});

describe("security header ownership (#681)", () => {
  it("does not declare the same header for the same path from both layers", async () => {
    // `Cache-Control` is declared for several paths, but only ever by one
    // layer per path (issue #740 moved `/_next/static` out of vercel.json),
    // so the pair (path, header) stays unique.
    const declarations = [
      ...(await appHeaderRules()),
      ...platformHeaderRules(),
    ].flatMap((rule) =>
      rule.headers.map(
        (header) => `${rule.source} ${header.key.toLowerCase()}`,
      ),
    );

    expect(declarations).toHaveLength(new Set(declarations).size);
  });

  it("declares the immutable static-asset cache rule in next.config.ts (#740)", async () => {
    const rule = (await appHeaderRules()).find(
      (candidate) => candidate.source === "/_next/static/(.*)",
    );

    expect(rule?.headers).toContainEqual({
      key: "Cache-Control",
      value: "public, max-age=31536000, immutable",
    });
  });

  it("declares a short, revalidatable cache rule for /_next/image (#740)", async () => {
    const rule = (await appHeaderRules()).find(
      (candidate) => candidate.source === "/_next/image",
    );
    const value = rule?.headers.find(
      (header) => header.key === "Cache-Control",
    )?.value;

    expect(value).toBeDefined();
    // Must be far shorter than the 1-year immutable chunk policy and must allow
    // a revalidation window, because the optimised bytes can change.
    expect(value).not.toContain("immutable");
    expect(value).toContain("max-age=3600");
    expect(value).toContain("stale-while-revalidate");
  });

  it("does not duplicate the static-asset cache rule in vercel.json (#740)", () => {
    expect(keysFor(platformHeaderRules(), "/_next/static/(.*)")).not.toContain(
      "cache-control",
    );
  });

  it("keeps the /api no-store rule and leaves the security set to /(.*) (#740)", async () => {
    const rules = await appHeaderRules();

    // The security headers live once, on `/(.*)` — which matches asset and API
    // requests too — so responses carry exactly one value each.
    const assetRules = ["/_next/static/(.*)", "/_next/image"] as const;
    for (const source of assetRules) {
      const rule = rules.find((candidate) => candidate.source === source);
      expect(rule?.headers.map((header) => header.key)).toEqual([
        "Cache-Control",
      ]);
    }

    const apiRule = rules.find((candidate) => candidate.source === "/api/(.*)");
    expect(apiRule?.headers).toContainEqual({
      key: "Cache-Control",
      value: "no-cache, no-store, must-revalidate",
    });
  });

  it("keeps the app layer covering the baseline header set", async () => {
    expect(keysFor(await appHeaderRules(), "/(.*)")).toEqual(
      expect.arrayContaining([
        "x-content-type-options",
        "x-frame-options",
        "x-xss-protection",
        "referrer-policy",
        "permissions-policy",
        "strict-transport-security",
        "cross-origin-opener-policy",
        "cross-origin-resource-policy",
      ]),
    );
  });
});
