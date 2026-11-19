// SPDX-License-Identifier: MIT
/**
 * @vitest-environment node
 *
 * Issue #735 — the load tests must be *scheduled* and their documented
 * baselines must actually bite.
 *
 * These tests pin the four moving parts that make that true, so a future edit
 * cannot silently disable the gate:
 *   1. `scripts/load-test.js --json` emits machine-readable results without
 *      touching docs/PERFORMANCE.md,
 *   2. `scripts/check-load-baselines.mjs` compares measured vs allowed with the
 *      documented margin/absolute-cap semantics,
 *   3. `tests/load/baselines.json` covers **every** endpoint the load test
 *      measures (a new endpoint cannot pass unmeasured), and
 *   4. `.github/workflows/load-test.yml` runs both existing scripts and reports
 *      their output in the job summary.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { load } from "js-yaml";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

// load-test.js is CommonJS (package.json has no "type": "module").
const require = createRequire(import.meta.url);
const loadTest = require(path.join(ROOT, "scripts", "load-test.js")) as {
  ENDPOINTS: Array<{ name: string }>;
  parseCliArgs: (argv: string[]) => { writeDocs: boolean; jsonPath: string | true | null };
  summaryRow: (r: unknown) => string[];
};

// ── Types for the ESM gate module ─────────────────────────────
type Outcome = {
  endpoint: string;
  connections: number;
  checks: Array<{ metric: string; measured: number; allowed: number; ok: boolean }>;
  ok: boolean;
};
type Baselines = {
  margin: { default: number };
  endpoints: Record<
    string,
    { p95Ms: number | null; p99Ms: number | null; errorPct: number; non2xxPct: number | null }
  >;
};
type GateModule = {
  loadBaselines: (file?: string) => Baselines;
  resolveMargin: (baselines: Baselines, env?: Record<string, string | undefined>) => number;
  deriveMetrics: (result: unknown) => {
    p95Ms: number | null;
    errorPct: number;
    non2xxPct: number;
    sse: boolean;
  };
  evaluateResult: (result: unknown, thresholds: unknown, margin: number) => Outcome;
  renderReport: (
    outcomes: Outcome[],
    opts?: { margin: number; generatedAt?: string | null; breached?: Outcome[] }
  ) => string;
};

let gate: GateModule;

beforeAll(async () => {
  gate = (await import("../../scripts/check-load-baselines.mjs")) as unknown as GateModule;
});

// ── 1. scripts/load-test.js --json ────────────────────────────

describe("scripts/load-test.js — --json output (issue #735)", () => {
  it("defaults to no JSON output and no docs edit", () => {
    expect(loadTest.parseCliArgs([])).toEqual({ writeDocs: false, jsonPath: null });
  });

  it("accepts bare --json (timestamped file in LOAD_TEST_OUTPUT_DIR)", () => {
    expect(loadTest.parseCliArgs(["--json"])).toEqual({
      writeDocs: false,
      jsonPath: true,
    });
  });

  it("accepts --json=<path> and still honours --write-docs", () => {
    expect(loadTest.parseCliArgs(["--json=out/results.json"])).toEqual({
      writeDocs: false,
      jsonPath: "out/results.json",
    });
    expect(loadTest.parseCliArgs(["--write-docs", "--json=x.json"])).toEqual({
      writeDocs: true,
      jsonPath: "x.json",
    });
  });

  it("only --write-docs regenerates the documented baselines", () => {
    const source = read("scripts/load-test.js");
    // updateDocs() must stay gated behind WRITE_DOCS, otherwise a CI run would
    // rewrite docs/PERFORMANCE.md with runner-specific numbers.
    expect(source).toMatch(/if \(WRITE_DOCS\) updateDocs\(results\);/);
  });
});

// ── 2. The gate ───────────────────────────────────────────────

describe("scripts/check-load-baselines.mjs", () => {
  it("loads the committed thresholds", () => {
    const baselines = gate.loadBaselines();
    expect(Object.keys(baselines.endpoints).length).toBeGreaterThan(0);
    expect(baselines.margin.default).toBeGreaterThan(1);
  });

  it("covers every endpoint scripts/load-test.js measures", () => {
    const baselines = gate.loadBaselines();
    for (const endpoint of loadTest.ENDPOINTS) {
      expect(
        baselines.endpoints[endpoint.name],
        `${endpoint.name} has no threshold — a new endpoint must not pass the gate unmeasured`
      ).toBeTruthy();
    }
  });

  it("resolves the margin from env, then the file, and rejects nonsense", () => {
    const baselines = gate.loadBaselines();
    expect(gate.resolveMargin(baselines, {})).toBe(baselines.margin.default);
    expect(gate.resolveMargin(baselines, { LOAD_TEST_MARGIN: "1.5" })).toBe(1.5);
    expect(() => gate.resolveMargin(baselines, { LOAD_TEST_MARGIN: "nope" })).toThrow();
    expect(() => gate.resolveMargin(baselines, { LOAD_TEST_MARGIN: "0" })).toThrow();
  });

  it("derives error rates exactly like the console summary does", () => {
    const metrics = gate.deriveMetrics({
      connections: 10,
      requests: { total: 200 },
      latency: { p95: 120 },
      errors: 1,
      non2xx: 4,
      sse: false,
    });
    expect(metrics.errorPct).toBeCloseTo(10); // 1 error / 10 connections
    expect(metrics.non2xxPct).toBeCloseTo(2); // 4 / 200 requests
    expect(metrics.p95Ms).toBe(120);
    expect(metrics.sse).toBe(false);
  });

  it("passes a run inside the margin and fails one outside it", () => {
    const thresholds = { p95Ms: 100, p99Ms: 200, errorPct: 1, non2xxPct: 1 };

    const within = gate.evaluateResult(
      { endpoint: "/api/health", connections: 10, requests: { total: 100 }, latency: { p95: 250, p99: 400 }, errors: 0, non2xx: 0 },
      thresholds,
      3 // allowed p95 = 300ms
    );
    expect(within.ok).toBe(true);
    expect(within.checks.every((c) => c.ok)).toBe(true);

    const breach = gate.evaluateResult(
      { endpoint: "/api/health", connections: 10, requests: { total: 100 }, latency: { p95: 301, p99: 400 }, errors: 0, non2xx: 0 },
      thresholds,
      3
    );
    expect(breach.ok).toBe(false);
    const failing = breach.checks.filter((c) => !c.ok);
    expect(failing).toHaveLength(1);
    expect(failing[0]!.metric).toBe("p95 latency");
    // The failure report must carry the measured value and the allowed value.
    expect(failing[0]!.measured).toBe(301);
    expect(failing[0]!.allowed).toBe(300);
  });

  it("gates error rates against absolute caps, not the latency margin", () => {
    const outcome = gate.evaluateResult(
      { endpoint: "/api/payments", connections: 10, requests: { total: 100 }, latency: null, errors: 1, non2xx: 0 },
      { p95Ms: 100, p99Ms: 200, errorPct: 1, non2xxPct: 1 },
      3
    );
    const errorCheck = outcome.checks.find((c) => c.metric === "error rate");
    expect(errorCheck?.allowed).toBe(1);
    expect(errorCheck?.ok).toBe(false);
  });

  it("skips SSE latency/non-2xx rows but still gates transport errors", () => {
    const outcome = gate.evaluateResult(
      { endpoint: "/api/events", sse: true, connections: 100, requests: { total: 0 }, latency: null, errors: 0, non2xx: 0 },
      { p95Ms: null, p99Ms: null, errorPct: 1, non2xxPct: null },
      3
    );
    expect(outcome.checks.map((c) => c.metric)).toEqual(["error rate"]);
    expect(outcome.ok).toBe(true);
  });

  it("renders a report that names breaches and measured values", () => {
    const breached = gate.evaluateResult(
      { endpoint: "/api/health", connections: 50, requests: { total: 100 }, latency: { p95: 5000 }, errors: 0, non2xx: 0 },
      { p95Ms: 503, p99Ms: null, errorPct: 1, non2xxPct: 1 },
      1
    );
    const report = gate.renderReport([breached], {
      margin: 1,
      generatedAt: "2026-09-25T00:00:00.000Z",
      breached: [breached],
    });
    expect(report).toContain("/api/health");
    expect(report).toContain("measured");
    expect(report).toContain("Updating the baselines deliberately");
  });

  it("requires thresholds for a new endpoint rather than passing it silently", () => {
    // The gate exits non-zero when an endpoint has no threshold; asserted here
    // through the file contents it reads, since main() is process-level.
    const source = read("scripts/check-load-baselines.mjs");
    expect(source).toContain("No thresholds for");
    expect(source).toContain("process.exit(1)");
  });
});

// ── 3. The scheduled workflow ─────────────────────────────────

describe(".github/workflows/load-test.yml (issue #735)", () => {
  const workflowPath = ".github/workflows/load-test.yml";

  it("exists and is valid YAML", () => {
    expect(existsSync(path.join(ROOT, workflowPath))).toBe(true);
    const doc = load(read(workflowPath)) as Record<string, unknown>;
    expect(doc).toBeTruthy();
  });

  it("runs on a schedule AND on manual dispatch", () => {
    const doc = load(read(workflowPath)) as {
      on?: unknown;
      true?: unknown;
    };
    // js-yaml parses the bare `on:` key as boolean true in YAML 1.1.
    const triggers = (doc.on ?? doc.true) as Record<string, unknown>;
    expect(Array.isArray(triggers.schedule)).toBe(true);
    expect(triggers.workflow_dispatch).toBeDefined();
    const cron = (triggers.schedule as Array<{ cron: string }>)[0]!.cron;
    expect(cron).toMatch(/^\d+ \d+ \* \* \d+$/);
  });

  it("runs the existing scripts unmodified and enforces the baselines", () => {
    const source = read(workflowPath);
    expect(source).toContain("node scripts/load-test.js");
    expect(source).toContain("node scripts/sse-load-test.mjs");
    expect(source).toContain("node scripts/check-load-baselines.mjs");
    expect(source).toContain("LOAD_TEST_MARGIN");
  });

  it("publishes the numbers to the job summary and as an artifact", () => {
    const source = read(workflowPath);
    expect(source).toContain("GITHUB_STEP_SUMMARY");
    expect(source).toContain("actions/upload-artifact");
    expect(source).toContain("tests/load/results/");
  });

  it("measures an authenticated, realistically-seeded instance", () => {
    const source = read(workflowPath);
    // Without an API key the payments endpoint is skipped; without a generous
    // rate limit the numbers are dominated by 429s (documented methodology).
    expect(source).toContain("create-load-test-key.mjs");
    expect(source).toContain("RATE_LIMIT_RPM");
    expect(source).toContain("METRICS_TOKEN");
  });
});

// ── 4. Documentation ──────────────────────────────────────────

describe("docs/PERFORMANCE.md — deliberate baseline maintenance", () => {
  const doc = () => read("docs/PERFORMANCE.md");

  it("documents the scheduled gate and the threshold file", () => {
    expect(doc()).toContain("load-test.yml");
    expect(doc()).toContain("check-load-baselines.mjs");
    expect(doc()).toContain("tests/load/baselines.json");
  });

  it("documents how to update the baselines deliberately", () => {
    expect(doc()).toMatch(/Updating the baselines deliberately/);
    expect(doc()).toMatch(/Scheduled CI gate/i);
  });

  it("keeps the CI-optional stance for pull requests", () => {
    expect(doc()).toMatch(/CI-optional/);
  });

  it("documents the --json flag and the key-minting script", () => {
    expect(doc()).toContain("--json");
    expect(doc()).toContain("create-load-test-key.mjs");
  });
});
