// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  normalizeChunk,
  routeForManifest,
  compareBudgets,
  formatSummaryMarkdown,
  formatCliTable,
  kb,
  fmt,
} from "./check-bundle-budget.mjs";

describe("check-bundle-budget", () => {
  describe("normalizeChunk", () => {
    it("strips /_next/ prefix", () => {
      expect(normalizeChunk("/_next/static/chunks/main.js")).toBe(
        "static/chunks/main.js"
      );
    });

    it("strips leading slashes", () => {
      expect(normalizeChunk("///static/chunks/app.js")).toBe(
        "static/chunks/app.js"
      );
    });

    it("leaves relative paths intact", () => {
      expect(normalizeChunk("static/chunks/123-abc.js")).toBe(
        "static/chunks/123-abc.js"
      );
    });
  });

  describe("routeForManifest", () => {
    const fakeBaseDir = "/project/.next/server/app";

    it("maps root manifest to /", () => {
      const manifestPath = "/project/.next/server/app/page_client-reference-manifest.js";
      expect(routeForManifest(manifestPath, fakeBaseDir)).toBe("/");
    });

    it("maps nested route manifests correctly", () => {
      const manifestPath = "/project/.next/server/app/payments/page_client-reference-manifest.js";
      expect(routeForManifest(manifestPath, fakeBaseDir)).toBe("/payments");
    });

    it("strips route groups like (dashboard)", () => {
      const manifestPath =
        "/project/.next/server/app/(dashboard)/payments/[id]/page_client-reference-manifest.js";
      expect(routeForManifest(manifestPath, fakeBaseDir)).toBe("/payments/[id]");
    });

    it("filters out internal segments starting with underscore", () => {
      const manifestPath =
        "/project/.next/server/app/_not-found/page_client-reference-manifest.js";
      expect(routeForManifest(manifestPath, fakeBaseDir)).toBe("/");
    });
  });

  describe("compareBudgets", () => {
    const budgetConfig = {
      defaultBudgetKb: 500,
      routes: {
        "/": 450,
        "/payments": 500,
      },
    };

    it("evaluates within-budget routes correctly", () => {
      const rows = [
        { route: "/", totalBytes: 400 * 1024, chunks: [] },
        { route: "/payments", totalBytes: 490 * 1024, chunks: [] },
      ];

      const res = compareBudgets(rows, { budgetConfig });
      expect(res.failures).toHaveLength(0);
      expect(res.untracked).toBe(0);
      expect(res.rows[0].overBudget).toBe(false);
      expect(res.rows[1].overBudget).toBe(false);
    });

    it("flags routes exceeding budget and defaults for untracked routes", () => {
      const rows = [
        { route: "/", totalBytes: 460 * 1024, chunks: [{ chunk: "big.js", bytes: 200 * 1024 }] },
        { route: "/unknown-page", totalBytes: 520 * 1024, chunks: [] },
      ];

      const res = compareBudgets(rows, { budgetConfig });
      expect(res.failures).toHaveLength(2);
      expect(res.untracked).toBe(1);
      expect(res.rows[0].overBudget).toBe(true);
      expect(res.rows[0].delta).toBeCloseTo(10, 1);
      expect(res.rows[1].overBudget).toBe(true);
      expect(res.rows[1].budgetKb).toBe(500); // fallback default
    });

    it("computes diff against base branch comparison data", () => {
      const rows = [
        { route: "/payments", totalBytes: 510 * 1024, chunks: [] },
        { route: "/new-feature", totalBytes: 200 * 1024, chunks: [] },
      ];
      const baseData = {
        routes: {
          "/payments": { sizeKb: 480.0, sizeBytes: 480 * 1024 },
        },
      };

      const res = compareBudgets(rows, { budgetConfig, baseData });
      expect(res.hasBaseComparison).toBe(true);
      const paymentsRow = res.rows.find((r) => r.route === "/payments");
      expect(paymentsRow).toBeDefined();
      expect(paymentsRow!.baseKb).toBe(480.0);
      expect(paymentsRow!.deltaVsBase).toBeCloseTo(30, 1);

      const newRow = res.rows.find((r) => r.route === "/new-feature");
      expect(newRow).toBeDefined();
      expect(newRow!.isNewRoute).toBe(true);
      expect(newRow!.baseKb).toBeNull();
      expect(newRow!.deltaVsBase).toBeNull();
    });
  });

  describe("formatSummaryMarkdown & formatCliTable", () => {
    const budgetConfig = {
      defaultBudgetKb: 500,
      routes: {
        "/payments": 500,
      },
    };

    it("generates markdown summary without base comparison", () => {
      const rows = [{ route: "/payments", totalBytes: 450 * 1024, chunks: [] }];
      const res = compareBudgets(rows, { budgetConfig });
      const md = formatSummaryMarkdown(res);

      expect(md).toContain("## 📦 JavaScript bundle budget & size analysis");
      expect(md).toContain("| Status | Route | Measured (gzip) | Budget | Headroom / Δ |");
      expect(md).toContain("✅ | `/payments` | 450.0 KB | 500.0 KB | -50.0 KB |");
    });

    it("generates markdown summary with base comparison", () => {
      const rows = [{ route: "/payments", totalBytes: 510 * 1024, chunks: [] }];
      const baseData = {
        routes: { "/payments": { sizeKb: 490.0 } },
      };
      const res = compareBudgets(rows, { budgetConfig, baseData });
      const md = formatSummaryMarkdown(res);

      expect(md).toContain("| Δ vs Base |");
      expect(md).toContain("+20.0 KB");
      expect(md).toContain("490.0 KB");
    });

    it("formats CLI table string correctly", () => {
      const rows = [{ route: "/payments", totalBytes: 450 * 1024, chunks: [] }];
      const res = compareBudgets(rows, { budgetConfig });
      const table = formatCliTable(res);

      expect(table).toContain("JavaScript bundle budget & size monitoring");
      expect(table).toContain("/payments");
      expect(table).toContain("✅");
    });
  });

  describe("helpers", () => {
    it("converts bytes to kb", () => {
      expect(kb(1024)).toBe(1);
      expect(kb(2048)).toBe(2);
    });

    it("formats number with pad", () => {
      expect(fmt(12.345)).toBe("    12.3");
    });
  });
});
