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

const CHECK_REGRESSIONS =
  process.argv.includes("--check-baselines") ||
  process.argv.includes("--check-regressions") ||
  process.env.CHECK_REGRESSIONS === "true" ||
  process.env.FAIL_ON_REGRESSION === "true" ||
  (process.env.CI === "true" && process.env.LOAD_TEST_SKIP_ASSERTIONS !== "true");

const REGRESSION_MARGIN = Number(
  process.env.PERFORMANCE_MARGIN ||
    process.env.LOAD_TEST_MARGIN ||
    process.env.REGRESSION_MARGIN ||
    0.25
);

const MAX_ERROR_PCT = Number(process.env.LOAD_TEST_MAX_ERROR_PCT || 1.0);
const MAX_NON2XX_PCT = Number(process.env.LOAD_TEST_MAX_NON2XX_PCT || 1.0);

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

/**
 * Parse documented baselines table from docs/PERFORMANCE.md.
 * Returns array of objects with endpoint, connections, req/s, p50, p95, p99, errorPct, non2xxPct.
 */
function parseBaselinesFromDocs(docsPath = DOCS_PATH) {
  if (!fs.existsSync(docsPath)) return [];
  const content = fs.readFileSync(docsPath, "utf8");
  const start = content.indexOf("## Baselines");
  if (start === -1) return [];
  const end = content.indexOf("## Methodology", start);
  const section = end !== -1 ? content.slice(start, end) : content.slice(start);

  const lines = section.split("\n");
  const baselines = [];

  const parseMs = (val) => {
    if (!val || val === "-" || val === "n/a") return null;
    const num = Number(val.replace(/[^\d.]/g, ""));
    return isNaN(num) ? null : num;
  };

  const parsePct = (val) => {
    if (!val || val === "-" || val === "n/a") return null;
    const num = Number(val.replace(/[^\d.]/g, ""));
    return isNaN(num) ? null : num;
  };

  const parseReqs = (val) => {
    if (!val || val === "-" || val === "n/a") return null;
    const num = Number(val.replace(/,/g, ""));
    return isNaN(num) ? null : num;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|") || trimmed.includes("---") || trimmed.includes("Endpoint")) {
      continue;
    }
    const cols = trimmed
      .split("|")
      .map((c) => c.trim())
      .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
    if (cols.length < 8) continue;

    const [endpoint, connectionsStr, reqsStr, p50Str, p95Str, p99Str, errStr, non2xxStr] = cols;
    const connections = Number(connectionsStr);
    if (isNaN(connections)) continue;

    baselines.push({
      endpoint,
      connections,
      requestsPerSecond: parseReqs(reqsStr),
      p50: parseMs(p50Str),
      p95: parseMs(p95Str),
      p99: parseMs(p99Str),
      errorPct: parsePct(errStr) ?? 0,
      non2xxPct: parsePct(non2xxStr),
    });
  }

  return baselines;
}

/**
 * Compare measured load-test results against documented baselines.
 * Exceeding p95 latency or error rates beyond the configured margin returns violations.
 */
function checkRegressions(results, baselines, options = {}) {
  const margin = options.margin != null ? options.margin : REGRESSION_MARGIN;
  const maxErrorPct = options.maxErrorPct != null ? options.maxErrorPct : MAX_ERROR_PCT;
  const maxNon2xxPct = options.maxNon2xxPct != null ? options.maxNon2xxPct : MAX_NON2XX_PCT;

  const violations = [];

  for (const r of results) {
    const base = baselines.find(
      (b) => b.endpoint === r.endpoint && b.connections === r.connections
    );
    if (!base) continue;

    // Check p95 latency (skip SSE streams where p95 is null)
    if (!r.sse && r.latency?.p95 != null && base.p95 != null) {
      const allowedP95 = Math.round(base.p95 * (1 + margin));
      if (r.latency.p95 > allowedP95) {
        violations.push({
          endpoint: r.endpoint,
          connections: r.connections,
          metric: "p95 latency",
          measured: `${Math.round(r.latency.p95)} ms`,
          baseline: `${base.p95} ms`,
          allowed: `${allowedP95} ms (+${Math.round(margin * 100)}%)`,
        });
      }
    }

    // Check transport errors
    const errPct = (r.errors / Math.max(1, r.connections)) * 100;
    const allowedErr = Math.max(base.errorPct * (1 + margin), maxErrorPct);
    if (errPct > allowedErr) {
      violations.push({
        endpoint: r.endpoint,
        connections: r.connections,
        metric: "Error %",
        measured: `${errPct.toFixed(2)}%`,
        baseline: `${base.errorPct.toFixed(2)}%`,
        allowed: `${allowedErr.toFixed(2)}%`,
      });
    }

    // Check application non-2xx failures
    if (!r.sse) {
      const non2xxPct = (r.non2xx / Math.max(1, r.requests.total)) * 100;
      const baseNon2xx = base.non2xxPct ?? 0;
      const allowedNon2xx = Math.max(baseNon2xx * (1 + margin), maxNon2xxPct);
      if (non2xxPct > allowedNon2xx) {
        violations.push({
          endpoint: r.endpoint,
          connections: r.connections,
          metric: "Non-2xx %",
          measured: `${non2xxPct.toFixed(2)}%`,
          baseline: `${baseNon2xx.toFixed(2)}%`,
          allowed: `${allowedNon2xx.toFixed(2)}%`,
        });
      }
    }
  }

  return violations;
}

/**
 * Format markdown table summarizing measured results vs baselines for GitHub Step Summary.
 */
function formatStepSummary(results, baselines, violations, margin = REGRESSION_MARGIN) {
  const lines = [];
  lines.push("### ⚡ API Load Test Results");
  lines.push("");
  lines.push(`- **Target:** \`${BASE_URL}\``);
  lines.push(`- **Duration per pass:** ${DURATION}s`);
  lines.push(`- **Allowed regression margin:** +${Math.round(margin * 100)}%`);
  lines.push("");
  lines.push("| Endpoint | Concurrency | Req/s | p50 | p95 (Observed / Baseline / Limit) | p99 | Error % | Non-2xx % | Status |");
  lines.push("|---|---|---|---|---|---|---|---|---|");

  for (const r of results) {
    const base = baselines.find((b) => b.endpoint === r.endpoint && b.connections === r.connections);
    const errPct = pct((r.errors / Math.max(1, r.connections)) * 100);
    const non2xxPct = r.sse ? "n/a" : pct((r.non2xx / Math.max(1, r.requests.total)) * 100);
    const throughput = r.sse ? "n/a" : rate(r.requestsPerSecond);

    let p95Cell = "-";
    if (!r.sse && r.latency?.p95 != null) {
      const obsP95 = ms(r.latency.p95);
      if (base?.p95 != null) {
        const limitP95 = Math.round(base.p95 * (1 + margin));
        p95Cell = `${obsP95} / ${base.p95} ms / ${limitP95} ms`;
      } else {
        p95Cell = obsP95;
      }
    }

    const rowViolations = violations.filter(
      (v) => v.endpoint === r.endpoint && v.connections === r.connections
    );
    const status = rowViolations.length > 0 ? "❌ Regressed" : "✅ Passed";

    lines.push(
      `| \`${r.endpoint}\` | ${r.connections} | ${throughput} | ${r.sse ? "-" : ms(r.latency?.p50)} | ${p95Cell} | ${r.sse ? "-" : ms(r.latency?.p99)} | ${errPct} | ${non2xxPct} | ${status} |`
    );
  }

  lines.push("");
  if (violations.length > 0) {
    lines.push(`#### ❌ Regressions Detected (${violations.length})`);
    lines.push("");
    for (const v of violations) {
      lines.push(
        `- **\`${v.endpoint}\` (concurrency ${v.connections})**: ${v.metric} measured **${v.measured}** exceeded baseline **${v.baseline}** (max allowed: ${v.allowed})`
      );
    }
  } else {
    lines.push("✅ **All measured latency and error metrics are within documented thresholds.**");
  }
  lines.push("");
  return lines.join("\n");
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  console.log(`OphirPay load test`);
  console.log(`  base URL : ${BASE_URL}`);
  console.log(`  duration : ${DURATION}s per pass`);
  console.log(`  concurrency: ${CONNECTIONS.join(", ")}`);
  console.log(`  API key  : ${API_KEY ? "provided" : "NOT set (authenticated endpoints will be skipped)"}`);
  console.log(`  check regressions: ${CHECK_REGRESSIONS ? `YES (+${Math.round(REGRESSION_MARGIN * 100)}% margin)` : "no"}`);
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

  const baselines = parseBaselinesFromDocs();
  const violations = checkRegressions(results, baselines, {
    margin: REGRESSION_MARGIN,
    maxErrorPct: MAX_ERROR_PCT,
    maxNon2xxPct: MAX_NON2XX_PCT,
  });

  // Report to GitHub Job Summary when running in GitHub Actions
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      const summaryMarkdown = formatStepSummary(results, baselines, violations, REGRESSION_MARGIN);
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryMarkdown + "\n");
    } catch (err) {
      console.error("Failed to write to GITHUB_STEP_SUMMARY:", err.message);
    }
  }

  const shouldSaveResults =
    WRITE_DOCS ||
    process.env.LOAD_TEST_SAVE_RESULTS === "true" ||
    process.env.CI === "true";

  if (shouldSaveResults) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const file = path.join(
      OUTPUT_DIR,
      `load-results-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
    );
    fs.writeFileSync(
      file,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          baseUrl: BASE_URL,
          durationSeconds: DURATION,
          margin: REGRESSION_MARGIN,
          violations,
          results,
        },
        null,
        2
      )
    );
    console.log(`Wrote raw results → ${file}`);
  }

  if (WRITE_DOCS) {
    updateDocs(results);
  }

  if (CHECK_REGRESSIONS && violations.length > 0) {
    console.error(`\n❌ Performance regression check FAILED (${violations.length} violation(s)):`);
    for (const v of violations) {
      console.error(
        `  • ${v.endpoint} (connections=${v.connections}): ${v.metric} measured=${v.measured}, baseline=${v.baseline} (max allowed=${v.allowed})`
      );
    }
    process.exit(1);
  } else if (CHECK_REGRESSIONS) {
    console.log(`\n✔ All observed metrics within documented baseline thresholds (+${Math.round(REGRESSION_MARGIN * 100)}% margin).`);
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
module.exports = {
  ENDPOINTS,
  runPass,
  summaryRow,
  buildBaselinesSection,
  updateDocs,
  parseBaselinesFromDocs,
  checkRegressions,
  formatStepSummary,
  DOCS_PATH,
};
