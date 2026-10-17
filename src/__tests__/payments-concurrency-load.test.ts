// SPDX-License-Identifier: MIT
/**
 * @vitest-environment node
 *
 * Unit & integration tests for Issue #1404:
 * High-concurrency `/api/payments` ingestion load testing script (`tests/load/payments-concurrency.js`).
 */

import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const require = createRequire(import.meta.url);

const concurrencyMod = require(path.join(
  ROOT,
  "tests",
  "load",
  "payments-concurrency.js"
)) as {
  DEFAULT_CONFIG: {
    connections: number;
    targetRps: number;
    sla: { maxP95Ms: number; max5xxPct: number; minRps: number };
    workloadMix: {
      statusQueries: number;
      paymentCreations: number;
      webhookPolling: number;
    };
  };
  buildWorkloadRequests: (apiKey?: string) => Array<{
    method: string;
    path: string;
    headers: Record<string, string>;
    body?: string;
    workloadType: string;
  }>;
  computeLatencySummary: (samples: number[]) => {
    p50: number;
    p90: number;
    p95: number;
    p99: number;
    samples: number;
  };
  evaluateSla: (
    summary: { latency: { p95: number }; http5xxPct: number; rps: number },
    sla?: { maxP95Ms: number; max5xxPct: number; minRps: number },
    opts?: { enforceRps?: boolean }
  ) => { passed: boolean; breaches: string[] };
  runConcurrencyBenchmark: (cfg?: Record<string, unknown>) => Promise<{
    connections: number;
    latency: { p50: number; p90: number; p95: number; p99: number };
    http5xxPct: number;
    rps: number;
    slaPassed: boolean;
    breaches: string[];
  }>;
  createSelfTestServer: () => {
    server: import("node:http").Server;
    counts: {
      statusQueries: number;
      paymentCreations: number;
      webhookPolling: number;
    };
  };
};

let gateMod: {
  evaluateConcurrencySla: (
    summary: unknown,
    sla?: { maxP95Ms: number; max5xxPct: number; minRps: number }
  ) => { ok: boolean; checks: Array<{ metric: string; ok: boolean }> };
};

beforeAll(async () => {
  gateMod = (await import(
    "../../scripts/check-load-baselines.mjs"
  )) as unknown as typeof gateMod;
});

describe("High-Concurrency /api/payments Load Testing (#1404)", () => {
  it("defaults to 200 concurrent users, 150 RPS target, p95 < 350ms, and 0% 5xx SLA", () => {
    expect(concurrencyMod.DEFAULT_CONFIG.connections).toBe(200);
    expect(concurrencyMod.DEFAULT_CONFIG.targetRps).toBe(150);
    expect(concurrencyMod.DEFAULT_CONFIG.sla).toEqual({
      maxP95Ms: 350,
      max5xxPct: 0,
      minRps: 150,
    });
    expect(concurrencyMod.DEFAULT_CONFIG.workloadMix).toEqual({
      statusQueries: 0.7,
      paymentCreations: 0.2,
      webhookPolling: 0.1,
    });
  });

  it("constructs a 70% status query, 20% payment creation, 10% webhook polling workload ring", () => {
    const requests = concurrencyMod.buildWorkloadRequests("oph_test_key");
    expect(requests).toHaveLength(10);

    const statusQueries = requests.filter(
      (r) => r.workloadType === "statusQueries" && r.method === "GET"
    );
    const creations = requests.filter(
      (r) => r.workloadType === "paymentCreations" && r.method === "POST"
    );
    const webhooks = requests.filter(
      (r) => r.workloadType === "webhookPolling" && r.method === "GET"
    );

    expect(statusQueries).toHaveLength(7); // 70%
    expect(creations).toHaveLength(2); // 20%
    expect(webhooks).toHaveLength(1); // 10%

    for (const req of creations) {
      expect(req.path).toBe("/api/payments");
      const parsed = JSON.parse(req.body!);
      expect(parsed.asset).toBe("XLM");
      expect(parsed.amount).toBe("25.0000000");
    }
  });

  it("computes structured p50, p90, p95, and p99 latency percentiles", () => {
    const samples = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100ms
    const summary = concurrencyMod.computeLatencySummary(samples);
    expect(summary.p50).toBe(50);
    expect(summary.p90).toBe(90);
    expect(summary.p95).toBe(95);
    expect(summary.p99).toBe(99);
    expect(summary.samples).toBe(100);
  });

  it("enforces p95 < 350ms, 0% HTTP 5xx errors, and >= 150 RPS in both runner and baseline gate", () => {
    const passingSummary = {
      latency: { p50: 45, p90: 140, p95: 210, p99: 310 },
      http5xxPct: 0,
      rps: 185,
    };
    const passRes = concurrencyMod.evaluateSla(passingSummary);
    expect(passRes.passed).toBe(true);
    expect(passRes.breaches).toHaveLength(0);
    expect(gateMod.evaluateConcurrencySla(passingSummary).ok).toBe(true);

    const failingSummary = {
      latency: { p50: 120, p90: 310, p95: 380, p99: 520 },
      http5xxPct: 0.5,
      rps: 110,
    };
    const failRes = concurrencyMod.evaluateSla(failingSummary);
    expect(failRes.passed).toBe(false);
    expect(failRes.breaches).toHaveLength(3);
    expect(gateMod.evaluateConcurrencySla(failingSummary).ok).toBe(false);
  });

  it("executes the mixed workload against an ephemeral HTTP server and outputs structured metrics", async () => {
    const { server, counts } = concurrencyMod.createSelfTestServer();
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", () => resolve())
    );
    const addr = server.address() as { port: number };
    try {
      const result = await concurrencyMod.runConcurrencyBenchmark({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        connections: 20,
        durationSeconds: 1,
        enforceRps: false,
      });

      expect(result.http5xxPct).toBe(0);
      expect(result.latency).toHaveProperty("p50");
      expect(result.latency).toHaveProperty("p90");
      expect(result.latency).toHaveProperty("p95");
      expect(result.latency).toHaveProperty("p99");
      expect(counts.statusQueries).toBeGreaterThan(0);
      expect(counts.paymentCreations).toBeGreaterThan(0);
      expect(counts.webhookPolling).toBeGreaterThan(0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("registers test:load:payments in package.json and documents SLA in docs/PERFORMANCE.md", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(ROOT, "package.json"), "utf8")
    );
    expect(pkg.scripts["test:load:payments"]).toBe(
      "node tests/load/payments-concurrency.js"
    );

    const baselines = JSON.parse(
      fs.readFileSync(path.join(ROOT, "tests", "load", "baselines.json"), "utf8")
    );
    expect(baselines.paymentsConcurrencySla.connections).toBe(200);
    expect(baselines.paymentsConcurrencySla.maxP95Ms).toBe(350);

    const doc = fs.readFileSync(
      path.join(ROOT, "docs", "PERFORMANCE.md"),
      "utf8"
    );
    expect(doc).toContain("tests/load/payments-concurrency.js");
    expect(doc).toContain("350 ms");
  });
});
