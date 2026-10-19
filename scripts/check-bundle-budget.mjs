#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// JavaScript bundle-size budget check (issues #739, #1309).
//
// After `next build` it reads the App Router client-reference manifests under
// `.next/server/app/**`, unions the chunks each route loads, gzip-sizes them
// and compares the result against the committed budgets in `bundle-budget.json`.
// It can also compare measured sizes against a base branch report and output
// workflow summaries or machine-readable JSON artifacts.
//
// Usage:
//   node scripts/check-bundle-budget.mjs [buildDir] [--json [path]] [--compare <baseJson>] [--warn-only]
//
// Environment:
//   NEXT_BUILD_DIR      build output directory (default: .next)
//   GITHUB_STEP_SUMMARY written to when running in CI
//
// Exit code 0 when every route is within budget, 1 otherwise (with a per-route
// breakdown naming the chunks that dominate the route).

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const BUDGET_FILE = path.join(ROOT, "bundle-budget.json");

/**
 * Parse a Next client-reference manifest. Both bundlers emit a JS file that
 * assigns one JSON object to `globalThis.__RSC_MANIFEST[...]`, with the JSON
 * starting at the first `"moduleLoading"` key.
 */
export function parseManifest(file) {
  const source = fs.readFileSync(file, "utf8");
  const keyIndex = source.indexOf('"moduleLoading"');
  const start =
    keyIndex === -1 ? source.indexOf("{") : source.lastIndexOf("{", keyIndex);
  const end = source.lastIndexOf("}");
  return JSON.parse(source.slice(start, end + 1));
}

export function walkForPageManifests(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkForPageManifests(full, out);
    } else if (entry.name === "page_client-reference-manifest.js") {
      out.push(full);
    }
  }
  return out;
}

/** Map a manifest directory to a URL route, dropping route groups and internal segments. */
export function routeForManifest(file, baseAppDir) {
  const relDir = path
    .relative(baseAppDir, path.dirname(file))
    .split(path.sep)
    .filter(Boolean)
    // `(group)` segments don't appear in the URL; `_not-found` /
    // `_global-error` are framework internals rather than tracked pages.
    .filter((segment) => !/^\(.*\)$/.test(segment) && !segment.startsWith("_"));
  return "/" + relDir.join("/");
}

/**
 * Normalise a chunk path from a manifest into a path relative to the build
 * directory. `entryJSFiles` uses `static/chunks/x.js` while `clientModules`
 * uses `/_next/static/chunks/x.js`, so strip the public prefix before sizing.
 */
export function normalizeChunk(rawChunk) {
  return String(rawChunk).replace(/^\/_next\//, "").replace(/^\/+/, "");
}

export function gzipBytes(rawChunk, nextDir, cache = new Map()) {
  const relChunk = normalizeChunk(rawChunk);
  if (cache.has(relChunk)) return cache.get(relChunk);
  const full = path.join(nextDir, relChunk);
  let size = 0;
  if (fs.existsSync(full)) {
    size = zlib.gzipSync(fs.readFileSync(full)).length;
  } else {
    console.warn(`⚠ Bundled chunk referenced but missing on disk: ${relChunk}`);
  }
  cache.set(relChunk, size);
  return size;
}

export const kb = (bytes) => bytes / 1024;
export const fmt = (n) => n.toFixed(1).padStart(8);

/**
 * @typedef {{ sizeKb: number, sizeBytes?: number }} BaseRouteData
 * @typedef {{ routes?: Record<string, BaseRouteData> }} BaseData
 * @typedef {{ defaultBudgetKb?: number, routes?: Record<string, number> }} BudgetConfig
 *
 * Compare measured route sizes against committed budget and optional base comparison data.
 * @param {Array<{ route: string, totalBytes: number, chunks?: Array<{ chunk: string, bytes: number }> }>} rows
 * @param {{ budgetConfig: BudgetConfig, baseData?: BaseData | null }} options
 */
export function compareBudgets(rows, { budgetConfig, baseData = null }) {
  const defaultBudgetKb = budgetConfig.defaultBudgetKb ?? 0;
  const routeBudgets = budgetConfig.routes ?? {};
  const baseRoutes = baseData?.routes ?? {};

  let untracked = 0;
  const evaluatedRows = [];
  const failures = [];

  for (const row of rows) {
    const measuredKb = kb(row.totalBytes);
    const budgetKb = routeBudgets[row.route] ?? defaultBudgetKb;
    const delta = measuredKb - budgetKb;
    const isTracked = row.route in routeBudgets;
    if (!isTracked) untracked += 1;

    const overBudget = delta > 0;

    let baseKb = null;
    let deltaVsBase = null;
    let isNewRoute = false;

    if (baseData) {
      if (row.route in baseRoutes) {
        baseKb = baseRoutes[row.route].sizeKb;
        deltaVsBase = measuredKb - baseKb;
      } else {
        isNewRoute = true;
      }
    }

    const item = {
      route: row.route,
      totalBytes: row.totalBytes,
      measuredKb,
      budgetKb,
      delta,
      overBudget,
      isTracked,
      baseKb,
      deltaVsBase,
      isNewRoute,
      chunks: row.chunks || [],
    };

    evaluatedRows.push(item);
    if (overBudget) failures.push(item);
  }

  return {
    rows: evaluatedRows,
    failures,
    untracked,
    defaultBudgetKb,
    hasBaseComparison: Boolean(baseData),
  };
}

/**
 * Build Markdown table for GitHub Actions job summary (GITHUB_STEP_SUMMARY).
 */
export function formatSummaryMarkdown(evaluatedResult) {
  const { rows, hasBaseComparison, defaultBudgetKb } = evaluatedResult;

  const header = hasBaseComparison
    ? [
        "## 📦 JavaScript bundle budget & size analysis",
        "",
        "| Status | Route | Measured (gzip) | Base (gzip) | Δ vs Base | Budget | Headroom / Δ |",
        "|:---:|---|---:|---:|---:|---:|---:|",
      ]
    : [
        "## 📦 JavaScript bundle budget & size analysis",
        "",
        "| Status | Route | Measured (gzip) | Budget | Headroom / Δ |",
        "|:---:|---|---:|---:|---:|",
      ];

  const body = rows.map((r) => {
    const icon = r.overBudget ? "❌" : "✅";
    const deltaBudgetStr = `${r.delta > 0 ? "+" : ""}${r.delta.toFixed(1)} KB`;

    if (hasBaseComparison) {
      const baseStr = r.baseKb !== null ? `${r.baseKb.toFixed(1)} KB` : "*(new)*";
      const deltaBaseStr =
        r.deltaVsBase !== null
          ? `${r.deltaVsBase > 0 ? "+" : ""}${r.deltaVsBase.toFixed(1)} KB`
          : "—";
      return `| ${icon} | \`${r.route}\` | ${r.measuredKb.toFixed(1)} KB | ${baseStr} | ${deltaBaseStr} | ${r.budgetKb.toFixed(1)} KB | ${deltaBudgetStr} |`;
    }

    return `| ${icon} | \`${r.route}\` | ${r.measuredKb.toFixed(1)} KB | ${r.budgetKb.toFixed(1)} KB | ${deltaBudgetStr} |`;
  });

  const footer = [
    "",
    `_${rows.length} routes measured · default budget: ${defaultBudgetKb} KB · budgets committed in \`bundle-budget.json\`._`,
    "",
  ];

  return [...header, ...body, ...footer].join("\n");
}

/**
 * Format terminal output table.
 */
export function formatCliTable(evaluatedResult) {
  const { rows, untracked, defaultBudgetKb, hasBaseComparison } = evaluatedResult;
  const out = [];

  out.push("\n📦 JavaScript bundle budget & size monitoring (first-load JS, gzip)\n");

  if (hasBaseComparison) {
    out.push(
      "  Route".padEnd(32) +
        "Measured".padStart(10) +
        "  Base".padStart(9) +
        "    Δ(Base)".padStart(11) +
        "  Budget".padStart(9) +
        "    Δ(Budget)"
    );
    out.push("  " + "─".repeat(82));
  } else {
    out.push(
      "  Route".padEnd(34) +
        "Measured".padStart(10) +
        "  Budget".padStart(9) +
        "     Δ (KB)"
    );
    out.push("  " + "─".repeat(62));
  }

  for (const r of rows) {
    const marker = r.overBudget ? "❌" : "✅";
    if (hasBaseComparison) {
      const baseStr = r.baseKb !== null ? fmt(r.baseKb) : "     new";
      const deltaBaseStr =
        r.deltaVsBase !== null
          ? `${r.deltaVsBase > 0 ? "+" : ""}${r.deltaVsBase.toFixed(1)}`.padStart(11)
          : "          —";
      out.push(
        `  ${marker} ${r.route}`.padEnd(32) +
          fmt(r.measuredKb).padStart(10) +
          baseStr.padStart(9) +
          deltaBaseStr +
          fmt(r.budgetKb).padStart(9) +
          fmt(r.delta).padStart(12)
      );
    } else {
      out.push(
        `  ${marker} ${r.route}`.padEnd(34) +
          fmt(r.measuredKb).padStart(10) +
          fmt(r.budgetKb).padStart(9) +
          fmt(r.delta).padStart(10)
      );
    }
  }

  out.push("  " + "─".repeat(hasBaseComparison ? 82 : 62));
  out.push(
    `  ${rows.length} routes measured · ${rows.length - untracked} tracked · ` +
      `${untracked} using default budget (${defaultBudgetKb} KB)\n`
  );

  return out.join("\n");
}

/**
 * Main execution function.
 */
export async function runBundleBudgetCheck(args = process.argv.slice(2)) {
  let buildDir = process.env.NEXT_BUILD_DIR;
  let jsonOutputPath = null;
  let compareBaselinePath = null;
  let warnOnly = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json" || arg === "--output") {
      jsonOutputPath = args[i + 1] && !args[i + 1].startsWith("-") ? args[++i] : path.join(NEXT_DIR || ".next", "bundle-report.json");
    } else if (arg.startsWith("--json=")) {
      jsonOutputPath = arg.slice("--json=".length);
    } else if (arg === "--compare") {
      compareBaselinePath = args[++i];
    } else if (arg.startsWith("--compare=")) {
      compareBaselinePath = arg.slice("--compare=".length);
    } else if (arg === "--warn-only") {
      warnOnly = true;
    } else if (!arg.startsWith("-") && !buildDir) {
      buildDir = arg;
    }
  }

  const resolvedNextDir = buildDir || process.env.NEXT_BUILD_DIR || path.join(ROOT, ".next");
  const appServerDir = path.join(resolvedNextDir, "server", "app");

  if (!fs.existsSync(BUDGET_FILE)) {
    console.error(`\n❌ Missing budget file: ${BUDGET_FILE}\n`);
    process.exit(1);
  }

  if (!fs.existsSync(appServerDir)) {
    console.error(
      `\n❌ No build output at ${appServerDir}. Run \`next build\` first (or set NEXT_BUILD_DIR).\n`
    );
    process.exit(1);
  }

  const buildManifestPath = path.join(resolvedNextDir, "build-manifest.json");
  if (!fs.existsSync(buildManifestPath)) {
    console.error(`\n❌ Missing build manifest at ${buildManifestPath}\n`);
    process.exit(1);
  }

  const buildManifest = JSON.parse(fs.readFileSync(buildManifestPath, "utf8"));
  const sharedChunks = [
    ...(buildManifest.rootMainFiles ?? []),
    ...(buildManifest.polyfillFiles ?? []),
  ];

  const gzipCache = new Map();
  const measurements = [];

  for (const manifestFile of walkForPageManifests(appServerDir)) {
    const route = routeForManifest(manifestFile, appServerDir);
    const manifest = parseManifest(manifestFile);

    const chunks = new Set(sharedChunks.map(normalizeChunk));
    for (const entryChunks of Object.values(manifest.entryJSFiles ?? {})) {
      for (const chunk of entryChunks) chunks.add(normalizeChunk(chunk));
    }
    for (const moduleInfo of Object.values(manifest.clientModules ?? {})) {
      for (const chunk of moduleInfo.chunks ?? []) {
        if (typeof chunk === "string" && chunk.endsWith(".js")) {
          chunks.add(normalizeChunk(chunk));
        }
      }
    }

    const sized = [...chunks]
      .map((chunk) => ({ chunk, bytes: gzipBytes(chunk, resolvedNextDir, gzipCache) }))
      .sort((a, b) => b.bytes - a.bytes);

    const totalBytes = sized.reduce((sum, c) => sum + c.bytes, 0);
    measurements.push({ route, totalBytes, chunks: sized });
  }

  if (measurements.length === 0) {
    console.error("\n❌ Found no page client-reference manifests — nothing to measure.\n");
    process.exit(1);
  }

  const byRoute = new Map();
  for (const m of measurements) {
    const existing = byRoute.get(m.route);
    if (!existing || m.totalBytes > existing.totalBytes) byRoute.set(m.route, m);
  }

  const budgetConfig = JSON.parse(fs.readFileSync(BUDGET_FILE, "utf8"));

  let baseData = null;
  if (compareBaselinePath) {
    const resolvedCompare = path.resolve(ROOT, compareBaselinePath);
    if (fs.existsSync(resolvedCompare)) {
      try {
        baseData = JSON.parse(fs.readFileSync(resolvedCompare, "utf8"));
      } catch (err) {
        console.warn(`⚠ Could not parse baseline comparison file at ${resolvedCompare}: ${err.message}`);
      }
    } else {
      console.warn(`⚠ Baseline comparison file not found at ${resolvedCompare}`);
    }
  }

  const sortedRows = [...byRoute.values()].sort((a, b) => b.totalBytes - a.totalBytes);
  const evaluation = compareBudgets(sortedRows, { budgetConfig, baseData });

  console.log(formatCliTable(evaluation));

  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      fs.appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        formatSummaryMarkdown(evaluation) + "\n"
      );
    } catch (err) {
      console.warn(`⚠ Could not write to GITHUB_STEP_SUMMARY: ${err.message}`);
    }
  }

  if (jsonOutputPath) {
    const resolvedOut = path.resolve(ROOT, jsonOutputPath);
    fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
    const jsonReport = {
      timestamp: new Date().toISOString(),
      routes: Object.fromEntries(
        evaluation.rows.map((r) => [
          r.route,
          {
            sizeBytes: r.totalBytes,
            sizeKb: Number(r.measuredKb.toFixed(2)),
            budgetKb: r.budgetKb,
            overBudget: r.overBudget,
          },
        ])
      ),
    };
    fs.writeFileSync(resolvedOut, JSON.stringify(jsonReport, null, 2) + "\n");
    console.log(`📁 Bundle size report saved to: ${resolvedOut}`);
  }

  if (evaluation.failures.length > 0) {
    console.error("❌ Bundle budget exceeded:\n");
    for (const f of evaluation.failures) {
      console.error(
        `  ${f.route}: ${f.measuredKb.toFixed(1)} KB > ${f.budgetKb.toFixed(1)} KB (+${f.delta.toFixed(1)} KB)`
      );
      console.error("    largest chunks:");
      for (const chunk of f.chunks.slice(0, 3)) {
        console.error(
          `      ${kb(chunk.bytes).toFixed(1).padStart(7)} KB  ${chunk.chunk}`
        );
      }
    }
    console.error(
      "\n  Raise the budget deliberately in bundle-budget.json (and note why in " +
        "the PR), or trim the route."
    );
    if (!warnOnly) {
      process.exit(1);
    }
  }

  console.log("✅ All routes are within their bundle budget.");
}

// Run directly when called from CLI
const isDirectRun =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectRun) {
  runBundleBudgetCheck().catch((err) => {
    console.error(`\n❌ Unexpected bundle check error: ${err.message}\n`, err);
    process.exit(1);
  });
}
