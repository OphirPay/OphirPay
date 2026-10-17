#!/usr/bin/env node
// SPDX-License-Identifier: MIT

/**
 * High-Concurrency /api/payments Ingestion Load Test (Issue #1404)
 *
 * Simulates 200 concurrent users with a realistic mixed payment workload:
 *   - 70% status queries    (GET /api/payments?limit=20&status=COMPLETED)
 *   - 20% payment creations (POST /api/payments)
 *   - 10% webhook polling   (GET /api/webhooks?limit=20)
 *
 * Enforces strict production SLA thresholds under 150 RPS:
 *   - p95 latency < 350 ms
 *   - 0% HTTP 5xx server errors
 *
 * Outputs a structured JSON latency summary containing p50, p90, p95, and p99.
 *
 * Usage:
 *   npm run test:load:payments
 *   node tests/load/payments-concurrency.js --self-test
 *   node tests/load/payments-concurrency.js --json=tests/load/results/payments-concurrency.json
 */

"use strict";

const autocannon = require("autocannon");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");

const DEFAULT_CONFIG = {
  baseUrl: (process.env.LOAD_TEST_BASE_URL || "http://localhost:3000").replace(/\/$/, ""),
  apiKey: process.env.LOAD_TEST_API_KEY || "oph_test_concurrency_key",
  connections: Number(process.env.PAYMENTS_LOAD_CONNECTIONS || 200),
  targetRps: Number(process.env.PAYMENTS_LOAD_TARGET_RPS || 150),
  durationSeconds: Number(process.env.PAYMENTS_LOAD_DURATION || 10),
  sla: {
    maxP95Ms: Number(process.env.PAYMENTS_SLA_MAX_P95_MS || 350),
    max5xxPct: Number(process.env.PAYMENTS_SLA_MAX_5XX_PCT || 0),
    minRps: Number(process.env.PAYMENTS_SLA_MIN_RPS || 150),
  },
  workloadMix: {
    statusQueries: 0.7,
    paymentCreations: 0.2,
    webhookPolling: 0.1,
  },
};

/**
 * Build the 10-slot request ring matching the 70% / 20% / 10% workload ratio:
 *   - 7 × GET /api/payments?limit=20&status=COMPLETED (70%)
 *   - 2 × POST /api/payments                          (20%)
 *   - 1 × GET /api/webhooks?limit=20                  (10%)
 */
function buildWorkloadRequests(apiKey = DEFAULT_CONFIG.apiKey) {
  const authHeader = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
  const requests = [];

  // 70% status queries (7 of 10 slots)
  for (let i = 0; i < 7; i++) {
    requests.push({
      method: "GET",
      path: `/api/payments?limit=20&status=COMPLETED&slot=${i}`,
      headers: { ...authHeader, accept: "application/json" },
      workloadType: "statusQueries",
    });
  }

  // 20% payment creations (2 of 10 slots)
  for (let i = 0; i < 2; i++) {
    requests.push({
      method: "POST",
      path: "/api/payments",
      headers: {
        ...authHeader,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        recipient: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
        amount: "25.0000000",
        asset: "XLM",
        memo: `load-test-slot-${i}`,
        transactionHash: crypto.randomBytes(32).toString("hex"),
      }),
      workloadType: "paymentCreations",
    });
  }

  // 10% webhook polling (1 of 10 slots)
  requests.push({
    method: "GET",
    path: "/api/webhooks?limit=20",
    headers: { ...authHeader, accept: "application/json" },
    workloadType: "webhookPolling",
  });

  return requests;
}

/** Compute a percentile from a sorted ascending numeric array. */
function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
  );
  return Number(sorted[idx].toFixed(2));
}

/** Compute structured p50, p90, p95, p99 latency summary from sample array (ms). */
function computeLatencySummary(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    samples: sorted.length,
  };
}

/**
 * Evaluate measured concurrency summary against SLA thresholds:
 *   - p95 < 350ms
 *   - 0% HTTP 5xx errors
 *   - throughput >= targetRps (when enforceRps is true)
 */
function evaluateSla(summary, sla = DEFAULT_CONFIG.sla, { enforceRps = true } = {}) {
  const breaches = [];

  if (summary.latency.p95 >= sla.maxP95Ms) {
    breaches.push(
      `p95 latency ${summary.latency.p95}ms >= SLA ceiling ${sla.maxP95Ms}ms`
    );
  }

  if (summary.http5xxPct > sla.max5xxPct) {
    breaches.push(
      `HTTP 5xx error rate ${summary.http5xxPct.toFixed(2)}% > SLA ceiling ${sla.max5xxPct.toFixed(2)}%`
    );
  }

  if (enforceRps && summary.rps < sla.minRps) {
    breaches.push(
      `Throughput ${summary.rps.toFixed(1)} RPS < target ${sla.minRps} RPS`
    );
  }

  return {
    passed: breaches.length === 0,
    breaches,
  };
}

/**
 * Run the high-concurrency autocannon benchmark against `baseUrl`.
 */
function runConcurrencyBenchmark(customConfig = {}) {
  const cfg = {
    ...DEFAULT_CONFIG,
    ...customConfig,
    sla: { ...DEFAULT_CONFIG.sla, ...(customConfig.sla || {}) },
  };
  const requests = buildWorkloadRequests(cfg.apiKey);
  const responseTimes = [];
  let status5xxCount = 0;
  let totalResponses = 0;

  return new Promise((resolve, reject) => {
    const instance = autocannon(
      {
        url: cfg.baseUrl,
        connections: cfg.connections,
        duration: cfg.durationSeconds,
        overallRate: cfg.overallRate || undefined,
        requests: requests.map(({ method, path: reqPath, headers, body }) => ({
          method,
          path: reqPath,
          headers,
          body,
        })),
      },
      (err, result) => {
        if (err) return reject(err);

        const latency = computeLatencySummary(responseTimes);
        const totalReqs = Math.max(1, totalResponses || result.requests?.total || 0);
        const fiveXx = status5xxCount + (result["5xx"] || 0);
        // Avoid double-counting if both event listener and autocannon tally 5xx
        const resolved5xx = Math.max(status5xxCount, result["5xx"] || 0);
        const http5xxPct = Number(((resolved5xx / totalReqs) * 100).toFixed(4));
        const rps = Number((result.requests?.average || 0).toFixed(2));

        const summary = {
          benchmark: "payments-high-concurrency",
          timestamp: new Date().toISOString(),
          baseUrl: cfg.baseUrl,
          connections: cfg.connections,
          targetRps: cfg.targetRps,
          durationSeconds: cfg.durationSeconds,
          workloadMix: cfg.workloadMix,
          totalRequests: result.requests?.total || totalResponses,
          rps,
          latency,
          http5xxCount: resolved5xx,
          http5xxPct,
          transportErrors: result.errors || 0,
          timeouts: result.timeouts || 0,
          slaThresholds: cfg.sla,
        };

        const slaResult = evaluateSla(summary, cfg.sla, {
          enforceRps: cfg.enforceRps !== false,
        });
        summary.slaPassed = slaResult.passed;
        summary.breaches = slaResult.breaches;

        void fiveXx;
        resolve(summary);
      }
    );

    instance.on("response", (_client, statusCode, _resBytes, responseTime) => {
      totalResponses += 1;
      if (typeof responseTime === "number") {
        responseTimes.push(responseTime);
      }
      if (statusCode >= 500 && statusCode <= 599) {
        status5xxCount += 1;
      }
    });

    instance.on("error", reject);
  });
}

/**
 * Start a fast local mock server for `--self-test` mode so CI and unit tests
 * can verify the 200-connection workload runner without an external Next.js process.
 */
function createSelfTestServer() {
  const counts = {
    statusQueries: 0,
    paymentCreations: 0,
    webhookPolling: 0,
  };

  const server = http.createServer((req, res) => {
    const url = req.url || "/";
    if (req.method === "GET" && url.startsWith("/api/payments")) {
      counts.statusQueries += 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ success: true, data: { items: [], nextCursor: null } }));
      return;
    }
    if (req.method === "POST" && url.startsWith("/api/payments")) {
      counts.paymentCreations += 1;
      req.resume();
      req.on("end", () => {
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify({ success: true, data: { id: "pay_load_1" } }));
      });
      return;
    }
    if (req.method === "GET" && url.startsWith("/api/webhooks")) {
      counts.webhookPolling += 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ success: true, data: { hooks: [] } }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  return { server, counts };
}

function parseCliArgs(argv) {
  const jsonArg = argv.find((a) => a === "--json" || a.startsWith("--json="));
  return {
    selfTest: argv.includes("--self-test"),
    jsonPath: jsonArg
      ? jsonArg === "--json"
        ? path.join("tests", "load", "results", "payments-concurrency.json")
        : jsonArg.slice("--json=".length)
      : null,
  };
}

async function main() {
  const cli = parseCliArgs(process.argv.slice(2));
  let selfServer = null;
  let baseUrl = DEFAULT_CONFIG.baseUrl;
  let durationSeconds = DEFAULT_CONFIG.durationSeconds;

  if (cli.selfTest) {
    const created = createSelfTestServer();
    selfServer = created.server;
    await new Promise((resolve) => selfServer.listen(0, "127.0.0.1", resolve));
    const addr = selfServer.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
    durationSeconds = 2;
  }

  try {
    const summary = await runConcurrencyBenchmark({
      baseUrl,
      durationSeconds,
      enforceRps: !cli.selfTest,
    });

    const jsonOutput = JSON.stringify(summary, null, 2);
    console.log(jsonOutput);

    if (cli.jsonPath) {
      fs.mkdirSync(path.dirname(cli.jsonPath), { recursive: true });
      fs.writeFileSync(cli.jsonPath, `${jsonOutput}\n`, "utf8");
    }

    if (!summary.slaPassed) {
      console.error(
        `❌ Payments concurrency SLA failed: ${summary.breaches.join("; ")}`
      );
      process.exit(1);
    }
  } finally {
    if (selfServer) {
      await new Promise((resolve) => selfServer.close(resolve));
    }
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_CONFIG,
  buildWorkloadRequests,
  computeLatencySummary,
  evaluateSla,
  runConcurrencyBenchmark,
  createSelfTestServer,
  parseCliArgs,
};
