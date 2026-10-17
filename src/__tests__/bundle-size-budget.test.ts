// SPDX-License-Identifier: MIT
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  evaluateBundleBudget,
  formatBundleSummaryMarkdown,
  normalizeChunk,
  parseManifestSource,
  routeForManifest,
} from "../../scripts/check-bundle-budget.mjs";

describe("Next.js bundle size budget check (#1309)", () => {
  it("normalizes chunk paths across public prefixes and separators", () => {
    expect(normalizeChunk("/_next/static/chunks/app/page-123.js")).toBe(
      "static/chunks/app/page-123.js"
    );
    expect(normalizeChunk("static\\chunks\\main.js")).toBe(
      "static/chunks/main.js"
    );
  });

  it("maps client-reference manifest file paths to App Router routes", () => {
    const appDir = path.join("/repo", ".next", "server", "app");
    expect(
      routeForManifest(
        path.join(appDir, "(dashboard)", "page_client-reference-manifest.js"),
        appDir
      )
    ).toBe("/");
    expect(
      routeForManifest(
        path.join(
          appDir,
          "webhooks",
          "[id]",
          "deliveries",
          "[deliveryId]",
          "page_client-reference-manifest.js"
        ),
        appDir
      )
    ).toBe("/webhooks/[id]/deliveries/[deliveryId]");
  });

  it("parses Next.js RSC client-reference manifest wrapper JS", () => {
    const raw = `globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};
globalThis.__RSC_MANIFEST["/send/page"] = {"moduleLoading":{"prefix":"/_next/"},"entryJSFiles":{"/send/page":["static/chunks/send.js"]},"clientModules":{"m1":{"chunks":["/_next/static/chunks/vendor.js"]}}};`;
    const parsed = parseManifestSource(raw);
    expect(parsed.entryJSFiles["/send/page"]).toEqual(["static/chunks/send.js"]);
  });

  it("evaluates ok, warning (>=95%), and failure (>100%) states plus base branch diffs", () => {
    const measurements = [
      {
        route: "/payments",
        totalBytes: 500 * 1024,
        chunks: [{ chunk: "static/chunks/payments.js", bytes: 500 * 1024 }],
      },
      {
        route: "/escrows",
        totalBytes: 560 * 1024, // 560 / 570 = 98.2% -> warning
        chunks: [{ chunk: "static/chunks/escrows.js", bytes: 560 * 1024 }],
      },
      {
        route: "/send",
        totalBytes: 750 * 1024, // 750 > 730 -> fail
        chunks: [{ chunk: "static/chunks/send.js", bytes: 750 * 1024 }],
      },
    ];
    const budget = {
      defaultBudgetKb: 570,
      warningThresholdRatio: 0.95,
      routes: {
        "/payments": 575,
        "/escrows": 570,
        "/send": 730,
      },
    };
    const baseReport = {
      routes: [
        { route: "/payments", measuredKb: 495 },
        { route: "/escrows", measuredKb: 540 },
        { route: "/send", measuredKb: 710 },
      ],
    };

    const evaluation = evaluateBundleBudget(measurements, budget, baseReport);
    expect(evaluation.failures).toHaveLength(1);
    expect(evaluation.failures[0].route).toBe("/send");
    expect(evaluation.warnings).toHaveLength(1);
    expect(evaluation.warnings[0].route).toBe("/escrows");

    const markdown = formatBundleSummaryMarkdown(evaluation);
    expect(markdown).toContain("| ❌ `/send` | 750.0 KB | 710.0 KB | +40.0 KB | 730.0 KB | +20.0 KB |");
    expect(markdown).toContain("| ⚠️ `/escrows` | 560.0 KB | 540.0 KB | +20.0 KB | 570.0 KB | -10.0 KB |");
    expect(markdown).toContain("| ✅ `/payments` | 500.0 KB | 495.0 KB | +5.0 KB | 575.0 KB | -75.0 KB |");
  });

  it("tracks all App Router pages in bundle-budget.json and documents interpretation in docs/PERFORMANCE.md", () => {
    const budgetPath = path.resolve(process.cwd(), "bundle-budget.json");
    const budget = JSON.parse(fs.readFileSync(budgetPath, "utf8"));
    expect(budget.defaultBudgetKb).toBeGreaterThan(0);
    expect(budget.warningThresholdRatio).toBe(0.95);
    expect(Object.keys(budget.routes).length).toBeGreaterThanOrEqual(30);

    const perfDoc = fs.readFileSync(
      path.resolve(process.cwd(), "docs/PERFORMANCE.md"),
      "utf8"
    );
    expect(perfDoc).toContain("Next.js bundle size monitoring & budgets");
    expect(perfDoc).toContain("npm run bundle:check");
    expect(perfDoc).toContain("npm run analyze");
  });
});
