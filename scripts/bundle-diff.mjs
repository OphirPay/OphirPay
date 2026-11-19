#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// Compare two bundle measurements and publish a per-route diff table.
//
// Measurements are produced by `scripts/check-bundle-budget.mjs --json=<path>`
// after `next build`. CI measures the pull-request build and the base-branch
// build, then this script:
//
//   - prints a route-by-route table (base KB, PR KB, delta, budget, status);
//   - appends the same table to `$GITHUB_STEP_SUMMARY`;
//   - fails when a route exceeds its committed budget;
//   - warns when a route grows by more than BUNDLE_GROWTH_WARN_KB (default 10).
//
// Usage:
//   node scripts/bundle-diff.mjs <base.json> <head.json> [--warn-growth-kb=<n>]
// Environment:
//   BUNDLE_GROWTH_WARN_KB  growth threshold for warnings (default: 10)
//   GITHUB_STEP_SUMMARY    written to when running in CI

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const kb = (bytes) => bytes / 1024;
const fmt = (value) => `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;

/** Read and validate a measurement report from check-bundle-budget.mjs. */
export function loadReport(file) {
  const resolved = path.resolve(file);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Bundle measurement not found: ${file}`);
  }
  const parsed = JSON.parse(fs.readFileSync(resolved, "utf8"));
  if (!Array.isArray(parsed.routes)) {
    throw new Error(`Invalid bundle measurement (missing routes[]): ${file}`);
  }
  return parsed;
}

/**
 * Diff two reports.
 *
 * @param {ReturnType<typeof loadReport>} base
 * @param {ReturnType<typeof loadReport>} head
 * @param {{ warnGrowthKb?: number }} [options]
 */
export function diffReports(base, head, options = {}) {
  const warnGrowthKb = options.warnGrowthKb ?? 10;
  const baseByRoute = new Map(base.routes.map((r) => [r.route, r]));
  const headByRoute = new Map(head.routes.map((r) => [r.route, r]));
  const routes = [...new Set([...baseByRoute.keys(), ...headByRoute.keys()])].sort();

  const rows = routes.map((route) => {
    const baseRoute = baseByRoute.get(route);
    const headRoute = headByRoute.get(route);
    const baseKb = baseRoute ? kb(baseRoute.totalBytes) : null;
    const headKb = headRoute ? kb(headRoute.totalBytes) : null;
    const deltaKb = baseKb !== null && headKb !== null ? headKb - baseKb : null;
    const deltaPct =
      deltaKb !== null && baseKb > 0 ? (deltaKb / baseKb) * 100 : null;
    const budgetKb = headRoute?.budgetKb ?? baseRoute?.budgetKb ?? null;
    const overBudget = headKb !== null && budgetKb !== null && headKb > budgetKb;
    const grew = deltaKb !== null && deltaKb > warnGrowthKb;

    return {
      route,
      baseKb,
      headKb,
      deltaKb,
      deltaPct,
      budgetKb,
      status: headRoute ? (overBudget ? "over-budget" : grew ? "grown" : "ok") : "removed",
    };
  });

  return {
    rows,
    failures: rows.filter((row) => row.status === "over-budget"),
    warnings: rows.filter((row) => row.status === "grown"),
    added: rows.filter((row) => row.baseKb === null),
    removed: rows.filter((row) => row.headKb === null),
    warnGrowthKb,
  };
}

/** Render the diff as GitHub-flavoured Markdown. */
export function renderMarkdown(diff, headReport) {
  const icon = { ok: "✅", grown: "⚠️", "over-budget": "❌", removed: "🗑️" };
  const lines = ["## 📦 Bundle size report", ""];
  if (headReport.gitRef) {
    lines.push(`PR build: \`${headReport.gitRef}\``, "");
  }
  lines.push(
    "| Route | Base | PR | Δ | Δ % | Budget | Status |",
    "|---|---:|---:|---:|---:|---:|---|",
  );

  for (const row of diff.rows) {
    const base = row.baseKb === null ? "—" : `${row.baseKb.toFixed(1)} KB`;
    const head = row.headKb === null ? "—" : `${row.headKb.toFixed(1)} KB`;
    const delta =
      row.deltaKb === null ? "—" : `${fmt(row.deltaKb)} KB`;
    const pct =
      row.deltaPct === null ? "—" : `${fmt(row.deltaPct)}%`;
    const budget = row.budgetKb === null ? "—" : `${row.budgetKb.toFixed(1)} KB`;
    const status =
      row.status === "over-budget"
        ? "❌ over budget"
        : row.status === "grown"
          ? "⚠️ large growth"
          : row.status === "removed"
            ? "🗑️ removed"
            : "✅";
    lines.push(
      `| ${icon[row.status]} \`${row.route}\` | ${base} | ${head} | ${delta} | ${pct} | ${budget} | ${status} |`,
    );
  }

  lines.push(
    "",
    `_${diff.rows.length} routes compared · growth warning threshold: ` +
      `${diff.warnGrowthKb} KB · budgets are committed in \`bundle-budget.json\`._`,
  );

  if (diff.failures.length > 0) {
    lines.push("", "### ❌ Routes over budget");
    for (const row of diff.failures) {
      lines.push(
        `- \`${row.route}\`: ${row.headKb.toFixed(1)} KB > ${row.budgetKb.toFixed(1)} KB`,
      );
    }
    lines.push(
      "",
      "Raise the budget deliberately in `bundle-budget.json` (and explain why in the PR), or trim the route.",
    );
  }

  if (diff.warnings.length > 0) {
    lines.push("", "### ⚠️ Large per-route growth (review)");
    for (const row of diff.warnings) {
      lines.push(
        `- \`${row.route}\`: ${fmt(row.deltaKb)} KB (${fmt(row.deltaPct)}%) — check for a new heavy dependency or an accidental client import.`,
      );
    }
  }

  if (diff.added.length > 0) {
    lines.push(
      "",
      `New routes: ${diff.added.map((row) => `\`${row.route}\``).join(", ")}`,
    );
  }

  if (diff.removed.length > 0) {
    lines.push(
      "",
      `Removed routes: ${diff.removed.map((row) => `\`${row.route}\``).join(", ")}`,
    );
  }

  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  let warnGrowthKb = Number(process.env.BUNDLE_GROWTH_WARN_KB ?? "10");
  const positional = [];
  for (const arg of argv) {
    if (arg.startsWith("--warn-growth-kb=")) {
      warnGrowthKb = Number(arg.slice("--warn-growth-kb=".length));
    } else {
      positional.push(arg);
    }
  }
  if (!Number.isFinite(warnGrowthKb) || warnGrowthKb < 0) {
    throw new Error("--warn-growth-kb must be a non-negative number");
  }
  return { positional, warnGrowthKb };
}

function main() {
  const { positional, warnGrowthKb } = parseArgs(process.argv.slice(2));
  const [baseFile, headFile] = positional;
  if (!baseFile || !headFile) {
    console.error(
      "Usage: node scripts/bundle-diff.mjs <base.json> <head.json> [--warn-growth-kb=<n>]",
    );
    process.exit(2);
  }

  const base = loadReport(baseFile);
  const head = loadReport(headFile);
  const diff = diffReports(base, head, { warnGrowthKb });
  const markdown = renderMarkdown(diff, head);

  console.log(markdown);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  }

  if (diff.failures.length > 0) {
    console.error(`❌ ${diff.failures.length} route(s) exceed their bundle budget.`);
    process.exit(1);
  }

  console.log(
    `✅ All routes are within budget${
      diff.warnings.length > 0
        ? `; ${diff.warnings.length} route(s) grew by more than ${warnGrowthKb} KB — review the table.`
        : "."
    }`,
  );
}

// Allow unit tests to import the helpers without running the CLI.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
