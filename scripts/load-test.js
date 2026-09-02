#!/usr/bin/env node
// SPDX-License-Identifier: MIT

/**
 * OphirPay load / performance test.
 *
 * Runs autocannon against the API endpoints at increasing concurrency and
 * prints req/s, p95 latency, and error rate. Optionally regenerates the
 * baseline tables in docs/PERFORMANCE.md and writes raw JSON results.
 *
 * Usage:
 *   node scripts/load-test.js                 # run against localhost:3000
 *   node scripts/load-test.js --write-docs    # also regenerate docs/PERFORMANCE.md baselines
 *
 * Environment:
 *   LOAD_TEST_BASE_URL      base URL (default http://localhost:3000)
 *   LOAD_TEST_API_KEY       API key for authenticated endpoints (Bearer auth)
 *   LOAD_TEST_DURATION      seconds per run (default 10)
 *   LOAD_TEST_CONNECTIONS   comma-separated concurrency levels (default 1,5,10,25,50)
 *   LOAD_TEST_OUTPUT_DIR    where JSON results are written (default tests/load/results)
 *
 * Notes:
 *   - Intended to run locally against a dev instance + test DB (see
 *     docs/PERFORMANCE.md). Never point it at production without approval.
 *   - /api/events is an SSE stream: connections stay open for the duration,
 *     so its req/s is inherently low — treat it as a connection + latency
 *     check, not a throughput check.
 *   - /api/payments requires an API key; it is skipped (with a warning) when
 *     LOAD_TEST_API_KEY is not set.
 */

"use strict";

const autocannon = require("autocannon");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// ── Config ────────────────────────────────────────────────────

const BASE_URL = (process.env.LOAD_TEST_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const API_KEY = process.env.LOAD_TEST_API_KEY || "";
const DURATION = Number(process.env.LOAD_TEST_DURATION || 10);
const CONNECTIONS = (process.env.LOAD_TEST_CONNECTIONS || "1,5,10,25,50")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isInteger(n) && n >= 1);
const OUTPUT_DIR = process.env.LOAD_TEST_OUTPUT_DIR || path.join("tests", "load", "results");
const WRITE_DOCS = process.argv.includes("--write-docs");

if (!CONNECTIONS.length) {
  console.error("LOAD_TEST_CONNECTIONS must contain at least one positive integer.");
  process.exit(1);
}

const ENDPOINTS = [
  {
    name: "/api/health",
    path: "/api/health",
    headers: {},
    note: "public health check (DB + RPC + Redis probes)",
  },
  {
    name: "/api/payments",
    path: "/api/payments?limit=20",
    headers: API_KEY ? { authorization: `Bearer ${API_KEY}` } : null,
    requiresAuth: true,
    note: "authenticated list query (keyset pagination)",
  },
  {
    name: "/api/events",
    path: "/api/events",
    headers: {},
    sse: true,
    note: "SSE stream — connection + first-byte latency check",
  },
];

// ── Helpers ───────────────────────────────────────────────────

function ms(value) {
  return value == null ? "-" : `${Math.round(value)} ms`;
}

function pct(value) {
  return value == null ? "-" : `${value.toFixed(2)}%`;
}

function rate(value) {
  return value == null ? "-" : Math.round(value).toLocaleString("en-US");
}

/** Percentile from a sorted sample array (0-100). */
function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

/** Compute p50/p95/p99 from raw per-request latency samples (ms). */
function computePercentiles(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    samples: samples.length,
  };
}

/** Run a single autocannon pass; resolves with the summary. */
function runPass(endpoint, connections) {
  return new Promise((resolve, reject) => {
    const opts = {
      url: `${BASE_URL}${endpoint.path}`,
      connections,
      // SSE streams hold sockets open for the whole duration — keep the pass
      // short: one request per connection is all we need to measure stream
      // establishment + first-byte latency.
      duration: endpoint.sse ? Math.min(5, DURATION) : DURATION,
      headers: endpoint.headers || undefined,
    };

    // Collect per-request response times so we can report a true p95
    // (autocannon's summary percentiles skip p95). For SSE the response event
    // fires on the first bytes of the stream — i.e. connection establishment.
    const responseTimes = [];

    const instance = autocannon(opts, (err, result) => {
      if (err) return reject(err);
      // Prefer percentiles computed from per-request samples (true p95). SSE
      // streams never complete so their response event never fires — report
      // streams-opened (requests.total) instead of latency there.
      const computed = computePercentiles(responseTimes);
      const latency = computed.samples > 0 ? computed : null;
      resolve({
        endpoint: endpoint.name,
        sse: !!endpoint.sse,
        connections,
        requests: result.requests,
        requestsPerSecond: result.requests.average,
        latency,
        errors: result.errors,
        non2xx: result.non2xx,
        timeouts: result.timeouts,
      });
    });

    instance.on("response", (_client, _status, _bytes, responseTime) => {
      if (typeof responseTime === "number") responseTimes.push(responseTime);
    });
    instance.on("error", reject);
  });
}

// ── Reporting ─────────────────────────────────────────────────

// SSE streams never "complete" a request, so req/s and latency are n/a there.
// Transport errors still matter (a failed stream open shows up in `errors`),
// so Error % stays real; Non-2xx % is n/a (streams have no status code).
function summaryRow(r) {
  const errPct = pct((r.errors / Math.max(1, r.connections)) * 100);
  const non2xxPct = r.sse ? "n/a" : pct((r.non2xx / Math.max(1, r.requests.total)) * 100);
  const throughput = r.sse ? "n/a" : rate(r.requestsPerSecond);
  return [
    r.endpoint,
    String(r.connections),
    throughput,
    r.sse ? "-" : ms(r.latency?.p50),
    r.sse ? "-" : ms(r.latency?.p95),
    r.sse ? "-" : ms(r.latency?.p99),
    errPct,
    non2xxPct,
  ];
}

function printTable(rows) {
  const headers = ["Endpoint", "Connections", "Req/s", "p50", "p95", "p99", "Error %", "Non-2xx %"];
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => String(r[i]).length))
  );
  const fmt = (row) =>
    row.map((cell, i) => String(cell).padEnd(widths[i])).join("  |  ");
  console.log(fmt(headers));
  console.log(widths.map((w) => "-".repeat(w)).join("--+--"));
  for (const row of rows) console.log(fmt(row));
}

// ── Docs regeneration ─────────────────────────────────────────

const DOCS_PATH = path.join("docs", "PERFORMANCE.md");

function buildBaselinesSection(results) {
  const lines = [];
  lines.push("## Baselines (local reference run)");
  lines.push("");
  lines.push(
    `Generated on ${new Date().toISOString()} against ${BASE_URL} ` +
      `(${DURATION}s per pass). Regenerate with ` +
      "`node scripts/load-test.js --write-docs`."
  );
  lines.push("");
  lines.push("| Endpoint | Connections | Req/s | p50 | p95 | p99 | Error % | Non-2xx % |");
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const r of results) {
    const errPct = pct((r.errors / Math.max(1, r.connections)) * 100);
    const non2xxPct = r.sse ? "n/a" : pct((r.non2xx / Math.max(1, r.requests.total)) * 100);
    const throughput = r.sse ? "n/a" : rate(r.requestsPerSecond);
    lines.push(
      `| ${r.endpoint} | ${r.connections} | ${throughput} | ${r.sse ? "-" : ms(r.latency?.p50)} | ${r.sse ? "-" : ms(r.latency?.p95)} | ${r.sse ? "-" : ms(r.latency?.p99)} | ${errPct} | ${non2xxPct} |`
    );
  }
  return lines.join("\n");
}

function updateDocs(results) {
  if (!fs.existsSync(DOCS_PATH)) {
    console.error(`Cannot regenerate docs: ${DOCS_PATH} does not exist.`);
    return;
  }
  const docs = fs.readFileSync(DOCS_PATH, "utf8");
  const start = docs.indexOf("## Baselines");
  const end = docs.indexOf("## Methodology");
  if (start === -1 || end === -1 || end <= start) {
    console.error("docs/PERFORMANCE.md is missing the expected Baselines/Methodology sections.");
    return;
  }
  const updated =
    docs.slice(0, start) + buildBaselinesSection(results) + "\n" + docs.slice(end);
  fs.writeFileSync(DOCS_PATH, updated);
  console.log(`\nUpdated ${DOCS_PATH}`);
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  console.log(`OphirPay load test`);
  console.log(`  base URL : ${BASE_URL}`);
  console.log(`  duration : ${DURATION}s per pass`);
  console.log(`  concurrency: ${CONNECTIONS.join(", ")}`);
  console.log(`  API key  : ${API_KEY ? "provided" : "NOT set (authenticated endpoints will be skipped)"}`);
  console.log("");

  const results = [];

  for (const endpoint of ENDPOINTS) {
    if (endpoint.requiresAuth && !API_KEY) {
      console.log(`⚠ Skipping ${endpoint.name} — set LOAD_TEST_API_KEY to load-test authenticated endpoints.`);
      continue;
    }
    console.log(`▶ ${endpoint.name} — ${endpoint.note}`);
    for (const connections of CONNECTIONS) {
      try {
        const r = await runPass(endpoint, connections);
        results.push(r);
        console.log(
          `  connections=${connections}  ${r.sse ? `streams held open (errors=${r.errors})` : `req/s=${rate(r.requestsPerSecond)}  p95=${ms(r.latency?.p95)}`}  errors=${r.errors}  non2xx=${r.non2xx}`
        );
      } catch (err) {
        console.error(`  connections=${connections} FAILED: ${err.message}`);
      }
    }
    console.log("");
  }

  if (!results.length) {
    console.error("No results collected — nothing to report.");
    process.exit(1);
  }

  console.log("── Summary ──────────────────────────────────────────────");
  printTable(results.map(summaryRow));
  console.log("");

  if (WRITE_DOCS) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const file = path.join(OUTPUT_DIR, `load-results-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(
      file,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          baseUrl: BASE_URL,
          durationSeconds: DURATION,
          results,
        },
        null,
        2
      )
    );
    console.log(`Wrote raw results → ${file}`);
    updateDocs(results);
  }
}

// Allow running under `node scripts/load-test.js` only, not on require().
if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

// Re-exported for tests.
module.exports = { ENDPOINTS, runPass, summaryRow, buildBaselinesSection, updateDocs };
