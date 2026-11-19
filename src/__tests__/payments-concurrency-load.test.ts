// SPDX-License-Identifier: MIT
/**
 * @vitest-environment node
 *
 * Unit coverage for the high-concurrency payments benchmark (#1404). These
 * assertions pin the parts that make the benchmark meaningful without needing
 * a live server: the 70/20/10 request mix, integer percentile maths, the
 * pass/fail contract, and compatibility with the shared baseline gate.
 */

import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const require = createRequire(import.meta.url);

type PlanEntry = {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: string;
};

type Summary = {
  requestsTotal: number;
  requestsPerSecond: number;
  p50Ms: number | null;
  p90Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  meanMs: number | null;
  maxMs: number | null;
  errors: number;
  non2xx: number;
  serverErrors: number;
  serverErrorPct: number;
  statusCodes: Record<string, number>;
};

const benchmark = require(
  path.join(ROOT, "tests", "load", "payments-concurrency.js"),
) as {
  TRAFFIC_MIX: {
    statusQueries: number;
    paymentCreations: number;
    webhookPolling: number;
  };
  buildRequestPlan: (apiKey: string) => PlanEntry[];
  buildResultEnvelope: (
    summary: Summary,
    thresholds: { p95Ms: number; maxServerErrorPct: number; minRps: number },
  ) => {
    results: Array<{
      endpoint: string;
      connections: number;
      requests: { total: number; average: number };
      latency: { p50: number | null; p90: number | null; p95: number | null; p99: number | null };
      errors: number;
      non2xx: number;
    }>;
  };
  computePercentiles: (samples: number[]) => {
    p50: number | null;
    p90: number | null;
    p95: number | null;
    p99: number | null;
    mean: number | null;
    max: number | null;
  };
  evaluateThresholds: (
    summary: Summary,
    thresholds: { p95Ms: number; maxServerErrorPct: number; minRps: number },
  ) => {
    ok: boolean;
    checks: Array<{
      metric: string;
      measured: number | null;
      allowed: number;
      ok: boolean;
    }>;
  };
  parseCliArgs: (argv: string[]) => {
    dryRun: boolean;
    jsonPath: string | true | null;
  };
  resolveJsonPath: (cli: {
    dryRun: boolean;
    jsonPath: string | true | null;
  }) => string | null;
  serverErrorCount: (
    statusCodes: Record<string, number | { count: number }>,
  ) => number;
};

const summary = (overrides: Partial<Summary> = {}): Summary => ({
  requestsTotal: 2_250,
  requestsPerSecond: 150,
  p50Ms: 20,
  p90Ms: 30,
  p95Ms: 40,
  p99Ms: 60,
  meanMs: 22,
  maxMs: 120,
  errors: 0,
  non2xx: 0,
  serverErrors: 0,
  serverErrorPct: 0,
  statusCodes: { 200: 2_200, 201: 50 },
  ...overrides,
});

const thresholds = { p95Ms: 350, maxServerErrorPct: 0, minRps: 150 };

describe("payments-concurrency benchmark — request plan", () => {
  it("documents exactly 70% status, 20% create and 10% webhook polling", () => {
    expect(benchmark.TRAFFIC_MIX).toEqual({
      statusQueries: 70,
      paymentCreations: 20,
      webhookPolling: 10,
    });
  });

  it("builds a ten-entry 7:2:1 plan", () => {
    const plan = benchmark.buildRequestPlan("oph_test_key");
    expect(plan).toHaveLength(10);

    const counts = plan.reduce<Record<string, number>>((acc, request) => {
      acc[`${request.method} ${request.path}`] =
        (acc[`${request.method} ${request.path}`] ?? 0) + 1;
      return acc;
    }, {});

    expect(counts["GET /api/payments?limit=20"]).toBe(7);
    expect(counts["POST /api/payments"]).toBe(2);
    expect(counts["GET /api/hooks?event_type=payment.created"]).toBe(1);
  });

  it("authenticates every request and gives each POST a unique id placeholder", () => {
    const plan = benchmark.buildRequestPlan("oph_test_key");
    for (const request of plan) {
      expect(request.headers.authorization).toBe("Bearer oph_test_key");
    }
    const posts = plan.filter((request) => request.method === "POST");
    expect(posts).toHaveLength(2);
    for (const post of posts) {
      expect(post.headers["content-type"]).toBe("application/json");
      expect(post.body).toContain("[<id>]");
      expect(JSON.parse(post.body!)).toMatchObject({
        amount: 1.25,
        assetCode: "XLM",
      });
    }
  });
});

describe("payments-concurrency benchmark — CLI", () => {
  it("parses the documented flags", () => {
    expect(benchmark.parseCliArgs([])).toEqual({
      dryRun: false,
      jsonPath: null,
    });
    expect(benchmark.parseCliArgs(["--dry-run", "--json"])).toEqual({
      dryRun: true,
      jsonPath: true,
    });
    expect(benchmark.parseCliArgs(["--json=out/results.json"])).toEqual({
      dryRun: false,
      jsonPath: "out/results.json",
    });
  });

  it("resolves the default and explicit output paths", () => {
    expect(
      benchmark.resolveJsonPath({ dryRun: false, jsonPath: true }),
    ).toBe("tests/load/results/payments-concurrency.json");
    expect(
      benchmark.resolveJsonPath({ dryRun: false, jsonPath: "custom.json" }),
    ).toBe("custom.json");
    expect(
      benchmark.resolveJsonPath({ dryRun: false, jsonPath: null }),
    ).toBeNull();
  });
});

describe("payments-concurrency benchmark — statistics", () => {
  it("computes p50/p90/p95/p99 from raw response times", () => {
    const samples = Array.from({ length: 100 }, (_, index) => index + 1);
    const result = benchmark.computePercentiles(samples);
    expect(result.p50).toBe(50);
    expect(result.p90).toBe(90);
    expect(result.p95).toBe(95);
    expect(result.p99).toBe(99);
    expect(result.mean).toBe(50.5);
    expect(result.max).toBe(100);
  });

  it("returns nulls for an empty sample", () => {
    expect(benchmark.computePercentiles([])).toEqual({
      p50: null,
      p90: null,
      p95: null,
      p99: null,
      mean: null,
      max: null,
    });
  });

  it("counts only 5xx responses as server errors", () => {
    expect(
      benchmark.serverErrorCount({ 200: 10, 201: 5, 400: 2, 429: 1 }),
    ).toBe(0);
    expect(
      benchmark.serverErrorCount({ 200: 10, 500: 2, 503: 3 }),
    ).toBe(5);
    // autocannon's aggregate result stores `{ count }` objects.
    expect(
      benchmark.serverErrorCount({ 200: { count: 10 }, 500: { count: 2 } }),
    ).toBe(2);
  });
});

describe("payments-concurrency benchmark — thresholds", () => {
  it("passes a run inside the SLO", () => {
    const evaluation = benchmark.evaluateThresholds(summary(), thresholds);
    expect(evaluation.ok).toBe(true);
    expect(evaluation.checks.map((check) => check.metric)).toEqual([
      "p95 latency",
      "HTTP 5xx rate",
      "throughput",
    ]);
  });

  it("fails p95 at the boundary (strictly less than 350 ms)", () => {
    const evaluation = benchmark.evaluateThresholds(
      summary({ p95Ms: 350 }),
      thresholds,
    );
    expect(evaluation.ok).toBe(false);
    expect(evaluation.checks.find((check) => check.metric === "p95 latency")?.ok).toBe(
      false,
    );
  });

  it("fails any 5xx response", () => {
    const evaluation = benchmark.evaluateThresholds(
      summary({ requestsTotal: 1_000, serverErrors: 1, serverErrorPct: 0.1 }),
      thresholds,
    );
    expect(evaluation.ok).toBe(false);
    expect(
      evaluation.checks.find((check) => check.metric === "HTTP 5xx rate")?.ok,
    ).toBe(false);
  });

  it("fails when throughput falls below 150 req/s", () => {
    const evaluation = benchmark.evaluateThresholds(
      summary({ requestsPerSecond: 149 }),
      thresholds,
    );
    expect(evaluation.ok).toBe(false);
    expect(
      evaluation.checks.find((check) => check.metric === "throughput")?.ok,
    ).toBe(false);
  });
});

describe("payments-concurrency benchmark — baseline gate integration", () => {
  it("emits the envelope shape check-load-baselines.mjs consumes", async () => {
    const gate = (await import("../../scripts/check-load-baselines.mjs")) as {
      loadBaselines: () => {
        endpoints: Record<string, { p95Ms: number | null; p99Ms: number | null; errorPct: number; non2xxPct: number | null; margin?: number }>;
      };
      evaluateResult: (result: unknown, thresholds: unknown, margin: number) => { ok: boolean; checks: Array<{ metric: string; allowed: number }> };
    };

    const envelope = benchmark.buildResultEnvelope(summary(), thresholds);
    const baselines = gate.loadBaselines();
    const endpointThresholds = baselines.endpoints["/api/payments-concurrency"];
    expect(endpointThresholds).toBeTruthy();
    expect(endpointThresholds?.margin).toBe(1);

    const outcome = gate.evaluateResult(
      envelope.results[0],
      endpointThresholds,
      3, // global margin — the endpoint's margin:1 override must win
    );
    expect(outcome.ok).toBe(true);
    expect(
      outcome.checks.find((check) => check.metric === "p95 latency")?.allowed,
    ).toBe(350);
  });
});
