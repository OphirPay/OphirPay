#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
// SPDX-License-Identifier: MIT

/**
 * High-concurrency /api/payments load testing benchmark suite (issue #1404).
 *
 * Simulates 200 concurrent users submitting payments and querying status endpoints
 * under simulated realistic traffic:
 *   • 70% status & history queries (GET /api/payments?limit=20, GET /api/health)
 *   • 20% payment creations (POST /api/payments with idempotency key)
 *   • 10% webhook & audit polling (GET /api/webhooks, GET /api/audit-log)
 *
 * Performance criteria:
 *   • Target p95 latency < 350ms
 *   • 0% HTTP 5xx errors under sustained 150+ RPS load
 *   • Outputs structured JSON summary with p50, p90, p95, p99 latencies
 *
 * Usage:
 *   node tests/load/payments-concurrency.js                # run against http://localhost:3000
 *   node tests/load/payments-concurrency.js --json         # output tests/load/results/latest.json
 *   node tests/load/payments-concurrency.js --json=<path>  # output to specific path
 *   node tests/load/payments-concurrency.js --help         # show help
 */

"use strict";

const autocannon = require("autocannon");
const fs = require("fs");
const path = require("path");

// ── Configuration ────────────────────────────────────────────────────────────

const BASE_URL = (process.env.LOAD_TEST_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const API_KEY = process.env.LOAD_TEST_API_KEY || "test_api_key_load_1404";
const DURATION = Number(process.env.LOAD_TEST_DURATION || 10);
const CONCURRENCY = Number(process.env.LOAD_TEST_CONCURRENCY || 200);
const OUTPUT_DIR = process.env.LOAD_TEST_OUTPUT_DIR || path.join("tests", "load", "results");

/**
 * Parse CLI flags.
 */
function parseCliArgs(argv) {
  const jsonArg = argv.find((a) => a === "--json" || a.startsWith("--json="));
  return {
    help: argv.includes("--help") || argv.includes("-h"),
    jsonPath: jsonArg
      ? jsonArg === "--json"
        ? path.join(OUTPUT_DIR, "payments-concurrency-latest.json")
        : jsonArg.slice("--json=".length)
      : null,
  };
}

/**
 * Generate 70/20/10 realistic traffic requests mix.
 */
function buildTrafficMix() {
  const authHeader = {
    authorization: `Bearer ${API_KEY}`,
    "content-type": "application/json",
  };

  const requests = [];

  // 1. 70% Status & History Queries (7 out of 10 requests)
  for (let i = 0; i < 5; i++) {
    requests.push({
      method: "GET",
      path: "/api/payments?limit=20",
      headers: authHeader,
    });
  }
  for (let i = 0; i < 2; i++) {
    requests.push({
      method: "GET",
      path: "/api/health",
      headers: {},
    });
  }

  // 2. 20% Payment Ingestion & Submissions (2 out of 10 requests)
  for (let i = 0; i < 2; i++) {
    requests.push({
      method: "POST",
      path: "/api/payments",
      headers: authHeader,
      body: JSON.stringify({
        amount: "10.5000000",
        assetCode: "USDC",
        destination: "GACZ7ZEL6QG2B3H7G4U2XN65J6E75CQB7QM2U",
        memo: `load-test-${i}`,
      }),
    });
  }

  // 3. 10% Webhook & Audit Polling (1 out of 10 requests)
  requests.push({
    method: "GET",
    path: "/api/audit-log?limit=10",
    headers: authHeader,
  });

  return requests;
}

/**
 * Run the high-concurrency benchmark pass.
 */
function runBenchmark({ baseUrl = BASE_URL, connections = CONCURRENCY, duration = DURATION } = {}) {
  const requests = buildTrafficMix();

  return new Promise((resolve, reject) => {
    const instance = autocannon(
      {
        url: baseUrl,
        connections,
        duration,
        pipelining: 1,
        requests,
      },
      (err, result) => {
        if (err) return reject(err);
        resolve(result);
      }
    );

    autocannon.track(instance, { renderProgressBar: true });
  });
}

/**
 * Format benchmark outcome into standard JSON payload.
 */
function formatResults(result, { baseUrl = BASE_URL, connections = CONCURRENCY } = {}) {
  const p50 = result.latency?.p50 ?? 0;
  const p90 = result.latency?.p90 ?? 0;
  const p95 = result.latency?.p95 ?? 0;
  const p99 = result.latency?.p99 ?? 0;
  const totalRequests = result.requests?.total ?? 0;
  const rps = result.requests?.average ?? 0;
  const errors = result.errors ?? 0;
  const non2xx = result.non2xx ?? 0;
  const status5xx = result["5xx"] ?? 0;

  return {
    generatedAt: new Date().toISOString(),
    baseUrl,
    trafficDistribution: {
      statusQueriesPct: 70,
      paymentCreationsPct: 20,
      webhookPollingPct: 10,
    },
    results: [
      {
        endpoint: "/api/payments-concurrency",
        connections,
        durationSeconds: result.duration ?? DURATION,
        requests: {
          total: totalRequests,
          average: rps,
        },
        latency: {
          p50,
          p90,
          p95,
          p99,
          mean: result.latency?.mean ?? 0,
          max: result.latency?.max ?? 0,
        },
        errors,
        non2xx,
        "5xx": status5xx,
      },
    ],
  };
}

// ── Main Entrypoint ──────────────────────────────────────────────────────────

async function main() {
  const cli = parseCliArgs(process.argv.slice(2));

  if (cli.help) {
    console.log(`
OphirPay High-Concurrency Payments Load Test (Issue #1404)

Usage:
  node tests/load/payments-concurrency.js [options]

Options:
  --json[=path]   Write structured JSON summary to tests/load/results/ (or custom path)
  --help, -h      Show this help dialog

Environment Variables:
  LOAD_TEST_BASE_URL     Base URL to test (default: http://localhost:3000)
  LOAD_TEST_CONCURRENCY  Concurrent users/connections (default: 200)
  LOAD_TEST_DURATION     Duration of load test in seconds (default: 10)
  LOAD_TEST_API_KEY      API Key for authenticated endpoints
`);
    process.exit(0);
  }

  console.log("=================================================================");
  console.log("  OphirPay — High-Concurrency /api/payments Load Benchmark");
  console.log("=================================================================");
  console.log(`Base URL:     ${BASE_URL}`);
  console.log(`Concurrency:  ${CONCURRENCY} users`);
  console.log(`Duration:     ${DURATION} seconds`);
  console.log("Traffic Mix:  70% Status queries | 20% Payment creations | 10% Webhooks");
  console.log("-----------------------------------------------------------------");

  try {
    const rawResult = await runBenchmark();
    const formatted = formatResults(rawResult);
    const summary = formatted.results[0];

    console.log("\n=================================================================");
    console.log("  Benchmark Results Summary");
    console.log("=================================================================");
    console.log(`Total Requests:  ${summary.requests.total}`);
    console.log(`Throughput:      ${Math.round(summary.requests.average)} req/sec`);
    console.log(`Latency p50:     ${summary.latency.p50} ms`);
    console.log(`Latency p90:     ${summary.latency.p90} ms`);
    console.log(`Latency p95:     ${summary.latency.p95} ms (Threshold: < 350 ms)`);
    console.log(`Latency p99:     ${summary.latency.p99} ms`);
    console.log(`Transport Errors:${summary.errors}`);
    console.log(`Non-2xx Status:  ${summary.non2xx}`);
    console.log(`5xx Errors:      ${summary["5xx"]} (Threshold: 0)`);
    console.log("-----------------------------------------------------------------");

    if (cli.jsonPath) {
      const outDir = path.dirname(cli.jsonPath);
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }
      fs.writeFileSync(cli.jsonPath, JSON.stringify(formatted, null, 2), "utf8");
      console.log(`✅ Structured JSON results written to: ${cli.jsonPath}`);
    }

    // Performance threshold assertions
    let failed = false;
    if (summary.latency.p95 > 350) {
      console.warn(`⚠️  Warning: p95 latency (${summary.latency.p95}ms) exceeded 350ms target.`);
    }
    if (summary["5xx"] > 0) {
      console.error(`❌ Error: Observed ${summary["5xx"]} HTTP 5xx responses under concurrency.`);
      failed = true;
    }

    if (failed) {
      process.exit(1);
    }
  } catch (err) {
    console.error("Load test failed:", err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  parseCliArgs,
  buildTrafficMix,
  formatResults,
  runBenchmark,
};
