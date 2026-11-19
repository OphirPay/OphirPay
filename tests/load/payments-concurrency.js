#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS load-test runner */

/**
 * High-concurrency `/api/payments` benchmark (issue #1404).
 *
 * Simulates 200 concurrent users that produce a realistic payments-dashboard
 * traffic mix:
 *
 *   • 70% status queries          GET  /api/payments?limit=20
 *   • 20% payment creations       POST /api/payments
 *   • 10% webhook polling         GET  /api/hooks?event_type=payment.created
 *
 * Unlike `scripts/load-test.js` (which measures one endpoint per pass), this
 * benchmark drives a *mixed* workload through autocannon's request iterator:
 * the ten-entry plan below is repeated in a 7:2:1 ratio, so the share of each
 * operation converges on the target mix without a custom load generator.
 *
 * Pass criteria (all enforced in-process, then re-checked by the shared
 * `scripts/check-load-baselines.mjs` gate):
 *
 *   • p95 latency        < 350 ms
 *   • HTTP 5xx responses = 0%
 *   • sustained RPS     >= 150
 *
 * Usage:
 *   LOAD_TEST_API_KEY=oph_... npm run test:load:concurrency
 *   LOAD_TEST_API_KEY=oph_... node tests/load/payments-concurrency.js --json
 *   node tests/load/payments-concurrency.js --dry-run
 *
 * The JSON file is shaped for `scripts/check-load-baselines.mjs` (a top-level
 * `results` array whose endpoint maps to a threshold in
 * `tests/load/baselines.json`).
 */

"use strict";

const autocannon = require("autocannon");
const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

// ── Configuration ─────────────────────────────────────────────

const BASE_URL = (
  process.env.LOAD_TEST_BASE_URL || "http://localhost:3000"
).replace(/\/$/, "");
const API_KEY = process.env.LOAD_TEST_API_KEY || "";
const CONCURRENCY = positiveInt(process.env.LOAD_TEST_CONCURRENCY, 200);
const DURATION = positiveInt(process.env.LOAD_TEST_DURATION, 15);
const TARGET_RPS = positiveInt(process.env.LOAD_TEST_TARGET_RPS, 150);
const P95_LIMIT_MS = positiveNumber(process.env.LOAD_TEST_P95_MS, 350);
const MAX_SERVER_ERROR_PCT = nonNegativeNumber(
  process.env.LOAD_TEST_MAX_5XX_PCT,
  0,
);
const MIN_RPS = nonNegativeNumber(process.env.LOAD_TEST_MIN_RPS, 150);
const OUTPUT_PATH =
  process.env.LOAD_TEST_CONCURRENCY_JSON ||
  path.join("tests", "load", "results", "payments-concurrency.json");
const CLI = parseCliArgs(process.argv.slice(2));

/** Traffic mix, repeated ten times so the request plan is exactly 7:2:1. */
const TRAFFIC_MIX = Object.freeze({
  statusQueries: 70,
  paymentCreations: 20,
  webhookPolling: 10,
});

// Known-valid Stellar addresses keep the POST body schema-valid without
// touching the database first. `sourceAccountId` is an opaque Stellar account
// reference in the API schema, not a User foreign key.
const VALID_STELLAR_ADDRESS =
  "GACNKEDGJYLLVQDXWYEEPB47Y3JEV5JNZ3RQANTJIVKKEOXX4NC4YWHU";
const SOURCE_ACCOUNT_ID =
  "GACNKEDGJYLLVQDXWYEEPB47Y3JEV5JNZ3RQANTJIVKKEOXX4NC4YWHU";

// ── CLI / parsing ─────────────────────────────────────────────

function positiveInt(raw, fallback) {
  const value = Number(raw ?? fallback);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Expected a positive integer, received "${raw}"`);
  }
  return value;
}

function positiveNumber(raw, fallback) {
  const value = Number(raw ?? fallback);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Expected a positive number, received "${raw}"`);
  }
  return value;
}

function nonNegativeNumber(raw, fallback) {
  const value = Number(raw ?? fallback);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Expected a non-negative number, received "${raw}"`);
  }
  return value;
}

/**
 * Parse the flags.
 *
 *   --json            write tests/load/results/payments-concurrency.json
 *   --json=<path>     write that exact path
 *   --dry-run         print the plan and exit without sending traffic
 */
function parseCliArgs(argv) {
  const jsonArg = argv.find(
    (arg) => arg === "--json" || arg.startsWith("--json="),
  );
  return {
    dryRun: argv.includes("--dry-run"),
    jsonPath: jsonArg
      ? jsonArg === "--json"
        ? true
        : jsonArg.slice("--json=".length)
      : null,
  };
}

function resolveJsonPath(cli = CLI) {
  if (cli.jsonPath === true) return OUTPUT_PATH;
  if (typeof cli.jsonPath === "string" && cli.jsonPath) return cli.jsonPath;
  return null;
}

// ── Request plan ──────────────────────────────────────────────

function authHeaders(apiKey) {
  return apiKey ? { authorization: `Bearer ${apiKey}` } : {};
}

function paymentBody() {
  return JSON.stringify({
    amount: 1.25,
    sourceAccountId: SOURCE_ACCOUNT_ID,
    destAddress: VALID_STELLAR_ADDRESS,
    assetCode: "XLM",
    description: "concurrency benchmark [<id>]",
  });
}

/**
 * Build the ten-request cycle. Autocannon walks it in order, so the 7 status
 * queries, 2 payment creations and 1 webhook poll produce a 70/20/10 mix.
 */
function buildRequestPlan(apiKey) {
  const headers = authHeaders(apiKey);
  const status = {
    method: "GET",
    path: "/api/payments?limit=20",
    headers,
  };
  const create = {
    method: "POST",
    path: "/api/payments",
    headers: { ...headers, "content-type": "application/json" },
    body: paymentBody(),
  };
  const webhook = {
    method: "GET",
    path: "/api/hooks?event_type=payment.created",
    headers,
  };

  return [
    status,
    status,
    status,
    status,
    status,
    status,
    status,
    create,
    create,
    webhook,
  ];
}

// ── Percentiles ───────────────────────────────────────────────

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[index];
}

/** Compute p50/p90/p95/p99 (plus mean/max) from raw response times. */
function computePercentiles(samples) {
  if (samples.length === 0) {
    return { p50: null, p90: null, p95: null, p99: null, mean: null, max: null };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    mean: sum / sorted.length,
    max: sorted[sorted.length - 1],
  };
}

// ── Threshold evaluation ─────────────────────────────────────

function serverErrorCount(statusCodeStats = {}) {
  return Object.entries(statusCodeStats).reduce((total, [code, count]) => {
    const status = Number(code);
    const occurrences =
      typeof count === "number" ? count : Number(count?.count) || 0;
    return status >= 500 && status <= 599
      ? total + occurrences
      : total;
  }, 0);
}

/**
 * Evaluate the pass/fail contract. Returns a report object instead of exiting
 * so the logic is unit-testable.
 */
function evaluateThresholds(summary, thresholds) {
  const checks = [
    {
      metric: "p95 latency",
      measured: summary.p95Ms,
      allowed: thresholds.p95Ms,
      unit: "ms",
      ok: summary.p95Ms !== null && summary.p95Ms < thresholds.p95Ms,
    },
    {
      metric: "HTTP 5xx rate",
      measured: summary.serverErrorPct,
      allowed: thresholds.maxServerErrorPct,
      unit: "%",
      ok: summary.serverErrorPct <= thresholds.maxServerErrorPct,
    },
    {
      metric: "throughput",
      measured: summary.requestsPerSecond,
      allowed: thresholds.minRps,
      unit: "req/s",
      ok: summary.requestsPerSecond >= thresholds.minRps,
    },
  ];

  return { checks, ok: checks.every((check) => check.ok) };
}

// ── Run ───────────────────────────────────────────────────────

function runBenchmark() {
  return new Promise((resolve, reject) => {
    const responseTimes = [];
    const instance = autocannon(
      {
        url: BASE_URL,
        connections: CONCURRENCY,
        duration: DURATION,
        overallRate: TARGET_RPS,
        requests: buildRequestPlan(API_KEY),
        idReplacement: true,
        timeout: 10,
      },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }

        const latency = computePercentiles(responseTimes);
        const requestsTotal = Number(result.requests?.total) || 0;
        const serverErrors = serverErrorCount(result.statusCodeStats);
        const summary = {
          requestsTotal,
          requestsPerSecond: Number(result.requests?.average) || 0,
          p50Ms: latency.p50,
          p90Ms: latency.p90,
          p95Ms: latency.p95,
          p99Ms: latency.p99,
          meanMs: latency.mean,
          maxMs: latency.max,
          errors: Number(result.errors) || 0,
          non2xx: Number(result.non2xx) || 0,
          serverErrors,
          serverErrorPct:
            requestsTotal > 0 ? (serverErrors / requestsTotal) * 100 : 0,
          statusCodes: result.statusCodeStats || {},
        };
        resolve({ summary, result });
      },
    );

    instance.on("response", (_client, _status, _bytes, responseTime) => {
      if (typeof responseTime === "number") responseTimes.push(responseTime);
    });
    instance.on("error", reject);
  });
}

function formatMetric(value, unit) {
  if (value === null || value === undefined) return "n/a";
  if (unit === "ms") return `${Math.round(value)} ms`;
  if (unit === "%") return `${Number(value).toFixed(2)}%`;
  return `${Math.round(value).toLocaleString("en-US")} req/s`;
}

function buildResultEnvelope(summary, thresholds) {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    profile: {
      concurrency: CONCURRENCY,
      durationSeconds: DURATION,
      targetRps: TARGET_RPS,
      trafficMix: TRAFFIC_MIX,
    },
    thresholds,
    summary,
    results: [
      {
        endpoint: "/api/payments-concurrency",
        connections: CONCURRENCY,
        requests: {
          total: summary.requestsTotal,
          average: summary.requestsPerSecond,
        },
        latency: {
          p50: summary.p50Ms,
          p90: summary.p90Ms,
          p95: summary.p95Ms,
          p99: summary.p99Ms,
          mean: summary.meanMs,
          max: summary.maxMs,
        },
        errors: summary.errors,
        non2xx: summary.non2xx,
        serverErrors: summary.serverErrors,
      },
    ],
  };
}

function printReport(summary, evaluation) {
  console.log("");
  console.log("── Payments ingestion concurrency benchmark ─────────────");
  console.log(
    `  profile     : ${CONCURRENCY} connections · ${DURATION}s · target ${TARGET_RPS} req/s`,
  );
  console.log(
    `  traffic mix : ${TRAFFIC_MIX.statusQueries}% status · ${TRAFFIC_MIX.paymentCreations}% create · ${TRAFFIC_MIX.webhookPolling}% webhook`,
  );
  console.log(`  requests    : ${summary.requestsTotal.toLocaleString("en-US")}`);
  console.log(
    `  throughput  : ${formatMetric(summary.requestsPerSecond, "req/s")}`,
  );
  console.log(
    `  latency     : p50 ${formatMetric(summary.p50Ms, "ms")} · p90 ${formatMetric(summary.p90Ms, "ms")} · p95 ${formatMetric(summary.p95Ms, "ms")} · p99 ${formatMetric(summary.p99Ms, "ms")}`,
  );
  console.log(
    `  errors      : transport ${summary.errors} · non-2xx ${summary.non2xx} · 5xx ${summary.serverErrors}`,
  );
  console.log("");
  for (const check of evaluation.checks) {
    console.log(
      `  ${check.ok ? "✅" : "❌"} ${check.metric}: ${formatMetric(check.measured, check.unit)} (limit ${formatMetric(check.allowed, check.unit)})`,
    );
  }
  console.log("");
}

async function main() {
  const thresholds = {
    p95Ms: P95_LIMIT_MS,
    maxServerErrorPct: MAX_SERVER_ERROR_PCT,
    minRps: MIN_RPS,
  };

  if (CLI.dryRun) {
    console.log("Dry run — no traffic sent.");
    console.log(
      JSON.stringify(
        {
          baseUrl: BASE_URL,
          profile: {
            concurrency: CONCURRENCY,
            durationSeconds: DURATION,
            targetRps: TARGET_RPS,
            trafficMix: TRAFFIC_MIX,
          },
          thresholds,
          requestPlan: buildRequestPlan(API_KEY).map((request) => ({
            method: request.method,
            path: request.path,
          })),
        },
        null,
        2,
      ),
    );
    return;
  }

  if (!API_KEY) {
    console.error(
      "LOAD_TEST_API_KEY is required: POST /api/payments and GET /api/hooks are authenticated.\n" +
        "Mint one with `node scripts/create-load-test-key.mjs`, then re-run.",
    );
    process.exit(1);
  }

  console.log("OphirPay payments ingestion concurrency benchmark");
  console.log(`  base URL   : ${BASE_URL}`);
  console.log(`  connections: ${CONCURRENCY}`);
  console.log(`  duration   : ${DURATION}s`);
  console.log(`  target rate: ${TARGET_RPS} req/s`);

  const { summary } = await runBenchmark();
  const evaluation = evaluateThresholds(summary, thresholds);
  printReport(summary, evaluation);

  const envelope = buildResultEnvelope(summary, thresholds);
  const jsonPath = resolveJsonPath();
  if (jsonPath) {
    fs.mkdirSync(path.dirname(path.resolve(REPO_ROOT, jsonPath)), {
      recursive: true,
    });
    fs.writeFileSync(
      path.resolve(REPO_ROOT, jsonPath),
      `${JSON.stringify(envelope, null, 2)}\n`,
    );
    console.log(`Wrote structured results → ${jsonPath}`);
  }

  if (!evaluation.ok) {
    const failed = evaluation.checks
      .filter((check) => !check.ok)
      .map((check) => check.metric)
      .join(", ");
    console.error(`::error title=Concurrency threshold exceeded::${failed}`);
    process.exit(1);
  }

  console.log("✅ All concurrency thresholds passed.");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  TRAFFIC_MIX,
  buildRequestPlan,
  buildResultEnvelope,
  computePercentiles,
  evaluateThresholds,
  parseCliArgs,
  resolveJsonPath,
  serverErrorCount,
};
