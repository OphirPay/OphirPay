#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// JavaScript bundle-size budget check (issue #739).
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
//   node scripts/check-bundle-budget.mjs [buildDir]
// Environment:
//   NEXT_BUILD_DIR      build output directory (default: .next)
//   GITHUB_STEP_SUMMARY written to when running in CI
//
// Exit code 0 when every route is within budget, 1 otherwise (with a per-route
// breakdown naming the chunks that dominate the route).

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const ROOT = process.cwd();
const BUDGET_FILE = path.join(ROOT, "bundle-budget.json");
const NEXT_DIR =
  process.env.NEXT_BUILD_DIR ||
  process.argv[2] ||
  path.join(ROOT, ".next");
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

/**
 * Parse a Next client-reference manifest. Both bundlers emit a JS file that
 * assigns one JSON object to `globalThis.__RSC_MANIFEST[...]`, with the JSON
 * starting at the first `"moduleLoading"` key.
 */
function parseManifest(file) {
  const source = fs.readFileSync(file, "utf8");
  const keyIndex = source.indexOf('"moduleLoading"');
  const start =
    keyIndex === -1 ? source.indexOf("{") : source.lastIndexOf("{", keyIndex);
  const end = source.lastIndexOf("}");
  return JSON.parse(source.slice(start, end + 1));
}

function walkForPageManifests(dir, out = []) {
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
function routeForManifest(file) {
  const relDir = path
    .relative(APP_SERVER_DIR, path.dirname(file))
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
function normalizeChunk(rawChunk) {
  return String(rawChunk).replace(/^\/_next\//, "").replace(/^\/+/, "");
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

// ── Measure ─────────────────────────────────────────────────────

const buildManifest = JSON.parse(
  fs.readFileSync(path.join(NEXT_DIR, "build-manifest.json"), "utf8")
);
const sharedChunks = [
  ...(buildManifest.rootMainFiles ?? []),
  ...(buildManifest.polyfillFiles ?? []),
];

const measurements = [];
for (const manifestFile of walkForPageManifests(APP_SERVER_DIR)) {
  const route = routeForManifest(manifestFile);
  if (route === "/") {
    // Only the real root page maps to "/"; skip if a layout-only manifest slips through.
  }
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

// Prefer the largest manifest for a duplicate route (e.g. route groups).
const byRoute = new Map();
for (const m of measurements) {
  const existing = byRoute.get(m.route);
  if (!existing || m.totalBytes > existing.totalBytes) byRoute.set(m.route, m);
}

const budget = JSON.parse(fs.readFileSync(BUDGET_FILE, "utf8"));
const defaultBudgetKb = budget.defaultBudgetKb ?? 0;
const routeBudgets = budget.routes ?? {};

const kb = (bytes) => bytes / 1024;
const fmt = (n) => n.toFixed(1).padStart(8);

const rows = [...byRoute.values()].sort((a, b) => b.totalBytes - a.totalBytes);
const failures = [];
let untracked = 0;

console.log("\n📦 JavaScript bundle budget (first-load JS, gzip)\n");
console.log(
  "  Route".padEnd(34) +
    "Measured".padStart(10) +
    "  Budget".padStart(9) +
    "     Δ (KB)"
);
console.log("  " + "─".repeat(62));

for (const row of rows) {
  const measuredKb = kb(row.totalBytes);
  const budgetKb = routeBudgets[row.route] ?? defaultBudgetKb;
  const delta = measuredKb - budgetKb;
  if (!(row.route in routeBudgets)) untracked += 1;

  const over = delta > 0;
  const marker = over ? "❌" : "✅";
  console.log(
    `  ${marker} ${row.route}`.padEnd(34) +
      fmt(measuredKb).padStart(10) +
      fmt(budgetKb).padStart(9) +
      fmt(delta).padStart(10)
  );

  if (over) failures.push({ ...row, measuredKb, budgetKb, delta });
}

console.log("  " + "─".repeat(62));
console.log(
  `  ${rows.length} routes measured · ${rows.length - untracked} tracked · ` +
    `${untracked} using default budget (${defaultBudgetKb} KB)\n`
);

// ── Job summary (GitHub Actions) ────────────────────────────────
const summaryLines = [
  "## 📦 JavaScript bundle budget",
  "",
  "| Route | Measured (gzip) | Budget | Δ |",
  "|---|---:|---:|---:|",
  ...rows.map((row) => {
    const measuredKb = kb(row.totalBytes);
    const budgetKb = routeBudgets[row.route] ?? defaultBudgetKb;
    const delta = measuredKb - budgetKb;
    const icon = delta > 0 ? "❌" : "✅";
    return `| ${icon} \`${row.route}\` | ${measuredKb.toFixed(1)} KB | ${budgetKb.toFixed(1)} KB | ${delta > 0 ? "+" : ""}${delta.toFixed(1)} KB |`;
  }),
  "",
  `_${rows.length} routes measured · budgets are committed in \`bundle-budget.json\`._`,
  "",
];

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryLines.join("\n"));
}

// ── Verdict ─────────────────────────────────────────────────────
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
        `      ${kb(chunk.bytes).toFixed(1).padStart(7)} KB  ${chunk.chunk}`
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
