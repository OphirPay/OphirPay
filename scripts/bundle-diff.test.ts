// SPDX-License-Identifier: MIT
//
// Unit tests for scripts/bundle-diff.mjs — the per-route bundle comparison
// used by the PR bundle-analysis CI job.

import { describe, expect, it } from "vitest";
import { diffReports, renderMarkdown } from "./bundle-diff.mjs";

type Route = {
  route: string;
  totalBytes: number;
  budgetKb: number;
  chunks: Array<{ chunk: string; bytes: number }>;
};

const report = (routes: Route[], gitRef: string | null = null) => ({
  generatedAt: "2026-10-20T00:00:00.000Z",
  buildDir: ".next",
  gitRef,
  routes,
});

const kb = (value: number) => value * 1024;

describe("diffReports", () => {
  it("computes per-route deltas and keeps unchanged routes green", () => {
    const base = report([
      { route: "/", totalBytes: kb(100), budgetKb: 120, chunks: [] },
      { route: "/payments", totalBytes: kb(90), budgetKb: 120, chunks: [] },
    ]);
    const head = report([
      { route: "/", totalBytes: kb(104), budgetKb: 120, chunks: [] },
      { route: "/payments", totalBytes: kb(90), budgetKb: 120, chunks: [] },
    ]);

    const diff = diffReports(base, head, { warnGrowthKb: 10 });
    expect(diff.failures).toEqual([]);
    expect(diff.warnings).toEqual([]);

    const root = diff.rows.find((row) => row.route === "/")!;
    expect(root.baseKb).toBe(100);
    expect(root.headKb).toBe(104);
    expect(root.deltaKb).toBeCloseTo(4);
    expect(root.deltaPct).toBeCloseTo(4);
    expect(root.status).toBe("ok");
  });

  it("fails a route over its committed budget", () => {
    const base = report([{ route: "/send", totalBytes: kb(700), budgetKb: 730, chunks: [] }]);
    const head = report([{ route: "/send", totalBytes: kb(750), budgetKb: 730, chunks: [] }]);

    const diff = diffReports(base, head);
    expect(diff.failures.map((row) => row.route)).toEqual(["/send"]);
    expect(diff.failures[0].status).toBe("over-budget");
  });

  it("warns when a route grows beyond the threshold without breaching budget", () => {
    const base = report([{ route: "/", totalBytes: kb(100), budgetKb: 120, chunks: [] }]);
    const head = report([{ route: "/", totalBytes: kb(115), budgetKb: 120, chunks: [] }]);

    const diff = diffReports(base, head, { warnGrowthKb: 10 });
    expect(diff.failures).toEqual([]);
    expect(diff.warnings.map((row) => row.route)).toEqual(["/"]);
    expect(diff.warnings[0].status).toBe("grown");
  });

  it("reports added and removed routes without treating them as regressions", () => {
    const base = report([{ route: "/old", totalBytes: kb(50), budgetKb: 60, chunks: [] }]);
    const head = report([{ route: "/new", totalBytes: kb(80), budgetKb: 100, chunks: [] }]);

    const diff = diffReports(base, head);
    expect(diff.added.map((row) => row.route)).toEqual(["/new"]);
    expect(diff.removed.map((row) => row.route)).toEqual(["/old"]);
    expect(diff.failures).toEqual([]);
    expect(diff.warnings).toEqual([]);
  });
});

describe("renderMarkdown", () => {
  it("includes the per-route table, CI ref, and status markers", () => {
    const base = report([{ route: "/send", totalBytes: kb(700), budgetKb: 730, chunks: [] }]);
    const head = report(
      [{ route: "/send", totalBytes: kb(750), budgetKb: 730, chunks: [] }],
      "abc123",
    );

    const markdown = renderMarkdown(diffReports(base, head), head);
    expect(markdown).toContain("## 📦 Bundle size report");
    expect(markdown).toContain("PR build: `abc123`");
    expect(markdown).toContain("`/send`");
    expect(markdown).toContain("❌ over budget");
    expect(markdown).toContain("750.0 KB > 730.0 KB");
  });
});
