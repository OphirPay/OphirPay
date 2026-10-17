#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// JavaScript bundle-size budget check (issues #739, #1309).
//
// After `next build` it reads the App Router client-reference manifests under
// `.next/server/app/**`, unions the chunks each route loads, gzip-sizes them
// and compares the result against the committed budgets in
// `bundle-budget.json`.
//
// It works with both bundlers because the client-reference manifest is emitted
// by Next itself: the default Turbopack build and a webpack build both write
// `<route>/page_client-reference-manifest.js`, so CI does not need a second,
// webpack-only build just to measure the bundle.
//
// Usage:
//   node scripts/check-bundle-budget.mjs [buildDir] [--base=base-report.json] [--json=report.json]
// Environment:
//   NEXT_BUILD_DIR      build output directory (default: .next)
//   BUNDLE_BASE_REPORT  optional JSON report from base branch to compute PR deltas
//   BUNDLE_REPORT_JSON  optional path to write current JSON measurements
//   GITHUB_STEP_SUMMARY written to when running in CI
//
// Exit code 0 when every route is within budget, 1 otherwise (with a per-route
// breakdown naming the chunks that dominate the route).

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import zlib from "node:zlib";

/**
 * Parse a Next client-reference manifest. Both bundlers emit a JS file that
 * assigns one JSON object to `globalThis.__RSC_MANIFEST[...]`, with the JSON
 * starting at the first `"moduleLoading"` key.
 */
export function parseManifestSource(source) {
  const keyIndex = source.indexOf('"moduleLoading"');
  const start =
    keyIndex === -1 ? source.indexOf("{") : source.lastIndexOf("{", keyIndex);
  const end = source.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Invalid client-reference manifest format");
  }
  return JSON.parse(source.slice(start, end + 1));
}

export function parseManifest(file) {
  return parseManifestSource(fs.readFileSync(file, "utf8"));
}

export function walkForPageManifests(dir, out = []) {
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
export function routeForManifest(file, appServerDir) {
  const relDir = path
    .relative(appServerDir, path.dirname(file))
    .split(/[\\/]+/)
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
  return String(rawChunk)
    .replace(/\\/g, "/")
    .replace(/^\/_next\//, "")
    .replace(/^\/+/, "");
}

/**
 * Evaluate route measurements against the configured bundle budget and optional
 * base-branch report.
 */
export function evaluateBundleBudget(measurements, budget, baseReport = null) {
  const defaultBudgetKb = budget.defaultBudgetKb ?? 0;
  const warningThresholdRatio = budget.warningThresholdRatio ?? 0.95;
  const routeBudgets = budget.routes ?? {};

  const baseByRoute = new Map();
  if (baseReport && Array.isArray(baseReport.routes)) {
    for (const r of baseReport.routes) {
      if (r && typeof r.route === "string" && typeof r.measuredKb === "number") {
        baseByRoute.set(r.route, r.measuredKb);
      }
    }
  } else if (baseReport && typeof baseReport === "object") {
    for (const [route, val] of Object.entries(baseReport)) {
      if (typeof val === "number") {
        baseByRoute.set(route, val);
      } else if (val && typeof val.measuredKb === "number") {
        baseByRoute.set(route, val.measuredKb);
      }
    }
  }

  // Prefer the largest manifest for a duplicate route (e.g. route groups).
  const byRoute = new Map();
  for (const m of measurements) {
    const existing = byRoute.get(m.route);
    if (!existing || m.totalBytes > existing.totalBytes) {
      byRoute.set(m.route, m);
    }
  }

  const kb = (bytes) => bytes / 1024;
  const sorted = [...byRoute.values()].sort((a, b) => b.totalBytes - a.totalBytes);

  const rows = [];
  const failures = [];
  const warnings = [];
  let untracked = 0;

  for (const item of sorted) {
    const measuredKb = kb(item.totalBytes);
    const budgetKb = routeBudgets[item.route] ?? defaultBudgetKb;
    const delta = measuredKb - budgetKb;
    const utilization = budgetKb > 0 ? measuredKb / budgetKb : 1;
    const baseKb = baseByRoute.has(item.route) ? baseByRoute.get(item.route) : null;
    const baseDeltaKb = baseKb !== null ? measuredKb - baseKb : null;

    if (!(item.route in routeBudgets)) untracked += 1;

    const over = delta > 0;
    const warn = !over && utilization >= warningThresholdRatio;
    const status = over ? "fail" : warn ? "warn" : "ok";
    const marker = over ? "❌" : warn ? "⚠️" : "✅";

    const row = {
      ...item,
      measuredKb,
      budgetKb,
      delta,
      utilization,
      baseKb,
      baseDeltaKb,
      status,
      marker,
    };
    rows.push(row);
    if (over) failures.push(row);
    else if (warn) warnings.push(row);
  }

  return {
    rows,
    failures,
    warnings,
    untracked,
    defaultBudgetKb,
    warningThresholdRatio,
    hasBaseComparison: baseByRoute.size > 0,
  };
}

/**
 * Format the GitHub Actions step summary Markdown table.
 */
export function formatBundleSummaryMarkdown(evaluation) {
  const { rows, warnings, failures, hasBaseComparison } = evaluation;
  const header = hasBaseComparison
    ? "| Route | Measured (gzip) | Base | Change | Budget | Headroom / Δ |"
    : "| Route | Measured (gzip) | Budget | Δ |";
  const divider = hasBaseComparison
    ? "|---|---:|---:|---:|---:|---:|"
    : "|---|---:|---:|---:|";

  const body = rows.map((row) => {
    const deltaStr = `${row.delta > 0 ? "+" : ""}${row.delta.toFixed(1)} KB`;
    if (hasBaseComparison) {
      const baseStr = row.baseKb !== null ? `${row.baseKb.toFixed(1)} KB` : "n/a";
      const changeStr =
        row.baseDeltaKb !== null
          ? `${row.baseDeltaKb > 0 ? "+" : ""}${row.baseDeltaKb.toFixed(1)} KB`
          : "new";
      return `| ${row.marker} \`${row.route}\` | ${row.measuredKb.toFixed(1)} KB | ${baseStr} | ${changeStr} | ${row.budgetKb.toFixed(1)} KB | ${deltaStr} |`;
    }
    return `| ${row.marker} \`${row.route}\` | ${row.measuredKb.toFixed(1)} KB | ${row.budgetKb.toFixed(1)} KB | ${deltaStr} |`;
  });

  const lines = [
    "## 📦 JavaScript bundle budget",
    "",
    header,
    divider,
    ...body,
    "",
    `_${rows.length} routes measured · ${warnings.length} warning(s) · ${failures.length} failure(s) · budgets are committed in \`bundle-budget.json\`._`,
    "",
  ];
  return lines.join("\n");
}

function parseCliArgs(argv) {
  let buildDirArg = null;
  let baseReportPath = process.env.BUNDLE_BASE_REPORT || null;
  let jsonOutPath = process.env.BUNDLE_REPORT_JSON || null;

  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--base=")) {
      baseReportPath = arg.slice("--base=".length);
    } else if (arg.startsWith("--json=")) {
      jsonOutPath = arg.slice("--json=".length);
    } else if (!arg.startsWith("--") && !buildDirArg) {
      buildDirArg = arg;
    }
  }
  return { buildDirArg, baseReportPath, jsonOutPath };
}

function runCli() {
  const ROOT = process.cwd();
  const BUDGET_FILE = path.join(ROOT, "bundle-budget.json");
  const { buildDirArg, baseReportPath, jsonOutPath } = parseCliArgs(process.argv);
  const NEXT_DIR =
    process.env.NEXT_BUILD_DIR || buildDirArg || path.join(ROOT, ".next");
  const APP_SERVER_DIR = path.join(NEXT_DIR, "server", "app");

  function fail(message) {
    console.error(`\n❌ ${message}\n`);
    process.exit(1);
  }

  if (!fs.existsSync(BUDGET_FILE)) fail(`Missing budget file: ${BUDGET_FILE}`);
  if (!fs.existsSync(APP_SERVER_DIR)) {
    fail(
      `No build output at ${APP_SERVER_DIR}. Run \`next build\` first ` +
        `(or set NEXT_BUILD_DIR).`
    );
  }

  const gzipCache = new Map();
  function gzipBytes(rawChunk) {
    const relChunk = normalizeChunk(rawChunk);
    if (gzipCache.has(relChunk)) return gzipCache.get(relChunk);
    const full = path.join(NEXT_DIR, relChunk);
    let size = 0;
    if (fs.existsSync(full)) {
      size = zlib.gzipSync(fs.readFileSync(full)).length;
    } else {
      console.warn(`⚠ Bundled chunk referenced but missing on disk: ${relChunk}`);
    }
    gzipCache.set(relChunk, size);
    return size;
  }

  const buildManifest = JSON.parse(
    fs.readFileSync(path.join(NEXT_DIR, "build-manifest.json"), "utf8")
  );
  const sharedChunks = [
    ...(buildManifest.rootMainFiles ?? []),
    ...(buildManifest.polyfillFiles ?? []),
  ];

  const measurements = [];
  for (const manifestFile of walkForPageManifests(APP_SERVER_DIR)) {
    const route = routeForManifest(manifestFile, APP_SERVER_DIR);
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
      .map((chunk) => ({ chunk, bytes: gzipBytes(chunk) }))
      .sort((a, b) => b.bytes - a.bytes);

    const totalBytes = sized.reduce((sum, c) => sum + c.bytes, 0);
    measurements.push({ route, totalBytes, chunks: sized });
  }

  if (measurements.length === 0) {
    fail("Found no page client-reference manifests — nothing to measure.");
  }

  const budget = JSON.parse(fs.readFileSync(BUDGET_FILE, "utf8"));
  const baseReport =
    baseReportPath && fs.existsSync(baseReportPath)
      ? JSON.parse(fs.readFileSync(baseReportPath, "utf8"))
      : null;

  const evaluation = evaluateBundleBudget(measurements, budget, baseReport);
  const { rows, failures, warnings, untracked, defaultBudgetKb } = evaluation;
  const fmt = (n) => n.toFixed(1).padStart(8);

  console.log("\n📦 JavaScript bundle budget (first-load JS, gzip)\n");
  console.log(
    "  Route".padEnd(34) +
      "Measured".padStart(10) +
      "  Budget".padStart(9) +
      "     Δ (KB)"
  );
  console.log("  " + "─".repeat(62));

  for (const row of rows) {
    console.log(
      `  ${row.marker} ${row.route}`.padEnd(34) +
        fmt(row.measuredKb).padStart(10) +
        fmt(row.budgetKb).padStart(9) +
        fmt(row.delta).padStart(10)
    );
  }

  console.log("  " + "─".repeat(62));
  console.log(
    `  ${rows.length} routes measured · ${rows.length - untracked} tracked · ` +
      `${untracked} using default budget (${defaultBudgetKb} KB)\n`
  );

  if (warnings.length > 0) {
    console.warn(`⚠️  ${warnings.length} route(s) are approaching their bundle budget (≥${Math.round(evaluation.warningThresholdRatio * 100)}%):`);
    for (const w of warnings) {
      console.warn(
        `    ${w.route}: ${w.measuredKb.toFixed(1)} KB / ${w.budgetKb.toFixed(1)} KB (${Math.round(w.utilization * 100)}%)`
      );
    }
    console.warn("");
  }

  if (jsonOutPath) {
    fs.mkdirSync(path.dirname(path.resolve(jsonOutPath)), { recursive: true });
    fs.writeFileSync(
      jsonOutPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          routes: rows.map((r) => ({
            route: r.route,
            measuredKb: Number(r.measuredKb.toFixed(2)),
            budgetKb: r.budgetKb,
            deltaKb: Number(r.delta.toFixed(2)),
            status: r.status,
          })),
        },
        null,
        2
      )
    );
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      formatBundleSummaryMarkdown(evaluation)
    );
  }

  if (failures.length > 0) {
    console.error("❌ Bundle budget exceeded:\n");
    for (const f of failures) {
      console.error(
        `  ${f.route}: ${f.measuredKb.toFixed(1)} KB > ${f.budgetKb.toFixed(1)} KB ` +
          `(+${f.delta.toFixed(1)} KB)`
      );
      console.error("    largest chunks:");
      for (const chunk of f.chunks.slice(0, 3)) {
        console.error(
          `      ${(chunk.bytes / 1024).toFixed(1).padStart(7)} KB  ${chunk.chunk}`
        );
      }
    }
    console.error(
      "\n  Raise the budget deliberately in bundle-budget.json (and note why in " +
        "the PR), or trim the route."
    );
    process.exit(1);
  }

  console.log("✅ All routes are within their bundle budget.");
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  runCli();
}
