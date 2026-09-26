// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import path from "path";

const ROOT = process.cwd();
const SCRIPT = path.join(ROOT, "scripts", "load-test.js");

describe("scripts/load-test.js", () => {
  it("is valid Node syntax (node --check)", () => {
    expect(existsSync(SCRIPT)).toBe(true);
    expect(() =>
      execFileSync(process.execPath, ["--check", SCRIPT], { stdio: "pipe" })
    ).not.toThrow();
  });

  it("load-tests the required endpoints at increasing concurrency", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(SCRIPT);
    const names = mod.ENDPOINTS.map((e: { name: string }) => e.name);
    expect(names).toContain("/api/health");
    expect(names).toContain("/api/payments");
    expect(names).toContain("/api/events");
    // Default concurrency profile has multiple increasing levels
    const defaults = /1,5,10,25,50/.test(readFileSync(SCRIPT, "utf8"));
    expect(defaults).toBe(true);
  });

  it("reports req/s, p95 latency, and error rate in its summary builder", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(SCRIPT);
    const row = mod.summaryRow({
      endpoint: "/api/health",
      sse: false,
      connections: 10,
      requests: { total: 100 },
      requestsPerSecond: 42,
      latency: { p50: 10, p95: 25, p99: 40 },
      errors: 0,
      non2xx: 0,
    });
    expect(row[0]).toBe("/api/health");
    expect(row[1]).toBe("10");
    expect(row[2]).toBe("42"); // req/s
    expect(row[4]).toBe("25 ms"); // p95
    expect(row[6]).toBe("0.00%"); // error rate
  });

  it("marks SSE rows as n/a for req/s and latency (stream semantics)", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(SCRIPT);
    const row = mod.summaryRow({
      endpoint: "/api/events",
      sse: true,
      connections: 5,
      requests: { total: 0 },
      requestsPerSecond: 0,
      latency: null,
      errors: 0,
      non2xx: 0,
    });
    expect(row[2]).toBe("n/a"); // no req/s for streams
    expect(row[3]).toBe("-"); // no p50
    expect(row[6]).toBe("0.00%"); // transport errors still reported
  });

  it("parses documented baselines from docs/PERFORMANCE.md", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(SCRIPT);
    const baselines = mod.parseBaselinesFromDocs();
    expect(baselines.length).toBeGreaterThanOrEqual(15);

    const health1 = baselines.find(
      (b: { endpoint: string; connections: number }) =>
        b.endpoint === "/api/health" && b.connections === 1
    );
    expect(health1).toBeDefined();
    expect(health1.p95).toBe(187);
    expect(health1.errorPct).toBe(0);

    const payments10 = baselines.find(
      (b: { endpoint: string; connections: number }) =>
        b.endpoint === "/api/payments" && b.connections === 10
    );
    expect(payments10).toBeDefined();
    expect(payments10.p95).toBe(212);
  });

  it("passes regression checks when results stay within allowed margin", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(SCRIPT);
    const baselines = [
      {
        endpoint: "/api/health",
        connections: 10,
        requestsPerSecond: 80,
        p50: 120,
        p95: 174,
        p99: 204,
        errorPct: 0,
        non2xxPct: 0,
      },
    ];

    const results = [
      {
        endpoint: "/api/health",
        sse: false,
        connections: 10,
        requests: { total: 800 },
        requestsPerSecond: 80,
        latency: { p50: 125, p95: 180, p99: 210 }, // 180 ms < 174 * 1.25 = 217.5 ms
        errors: 0,
        non2xx: 0,
      },
    ];

    const violations = mod.checkRegressions(results, baselines, { margin: 0.25 });
    expect(violations).toHaveLength(0);
  });

  it("fails regression checks with measured values when p95 latency exceeds threshold", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(SCRIPT);
    const baselines = [
      {
        endpoint: "/api/payments",
        connections: 10,
        requestsPerSecond: 70,
        p50: 135,
        p95: 212,
        p99: 258,
        errorPct: 0,
        non2xxPct: 0,
      },
    ];

    // p95 doubled: 450 ms > 212 * 1.25 = 265 ms
    const results = [
      {
        endpoint: "/api/payments",
        sse: false,
        connections: 10,
        requests: { total: 700 },
        requestsPerSecond: 60,
        latency: { p50: 250, p95: 450, p99: 600 },
        errors: 0,
        non2xx: 0,
      },
    ];

    const violations = mod.checkRegressions(results, baselines, { margin: 0.25 });
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].endpoint).toBe("/api/payments");
    expect(violations[0].metric).toBe("p95 latency");
    expect(violations[0].measured).toBe("450 ms");
    expect(violations[0].baseline).toBe("212 ms");
    expect(violations[0].allowed).toContain("265 ms");
  });

  it("fails regression checks when error rates exceed threshold", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(SCRIPT);
    const baselines = [
      {
        endpoint: "/api/health",
        connections: 10,
        requestsPerSecond: 80,
        p50: 100,
        p95: 150,
        p99: 200,
        errorPct: 0,
        non2xxPct: 0,
      },
    ];

    const results = [
      {
        endpoint: "/api/health",
        sse: false,
        connections: 10,
        requests: { total: 500 },
        requestsPerSecond: 50,
        latency: { p50: 100, p95: 150, p99: 200 },
        errors: 3, // 3/10 = 30% error rate > 1%
        non2xx: 0,
      },
    ];

    const violations = mod.checkRegressions(results, baselines, { maxErrorPct: 1.0 });
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].metric).toBe("Error %");
    expect(violations[0].measured).toBe("30.00%");
  });

  it("formats markdown summary tables for GitHub Step Summary", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(SCRIPT);
    const baselines = [
      {
        endpoint: "/api/health",
        connections: 1,
        p95: 187,
        errorPct: 0,
      },
    ];
    const results = [
      {
        endpoint: "/api/health",
        sse: false,
        connections: 1,
        requests: { total: 100 },
        requestsPerSecond: 10,
        latency: { p50: 100, p95: 180, p99: 250 },
        errors: 0,
        non2xx: 0,
      },
    ];

    const md = mod.formatStepSummary(results, baselines, [], 0.30);
    expect(md).toContain("### ⚡ API Load Test Results");
    expect(md).toContain("| Endpoint | Concurrency | Req/s |");
    expect(md).toContain("/api/health");
    expect(md).toContain("✅ Passed");
  });
});

describe("docs/PERFORMANCE.md", () => {
  const docPath = path.join(ROOT, "docs", "PERFORMANCE.md");

  it("documents baselines with req/s, p95, and error rate", () => {
    expect(existsSync(docPath)).toBe(true);
    const doc = readFileSync(docPath, "utf8");
    expect(doc).toMatch(/## Baselines/);
    expect(doc).toMatch(/\| Endpoint \| Connections \| Req\/s \| p50 \| p95 \| p99 \| Error % \| Non-2xx % \|/);
    expect(doc).toMatch(/\| \/api\/health \|/);
    expect(doc).toMatch(/\| \/api\/payments \|/);
    expect(doc).toMatch(/\| \/api\/events \|/);
  });

  it("explains how to run the load test locally against a test DB", () => {
    const doc = readFileSync(docPath, "utf8");
    expect(doc).toContain("scripts/load-test.js");
    expect(doc).toContain("LOAD_TEST_API_KEY");
    expect(doc).toContain("npm run dev");
    expect(doc).toContain("prisma db push");
  });

  it("documents the CI-optional stance", () => {
    const doc = readFileSync(docPath, "utf8");
    expect(doc).toMatch(/CI-optional/i);
  });

  it("documents scheduled CI workflow and failure criteria", () => {
    const doc = readFileSync(docPath, "utf8");
    expect(doc).toContain("load-tests.yml");
    expect(doc).toContain("PERFORMANCE_MARGIN");
  });

  it("documents how to update baselines deliberately", () => {
    const doc = readFileSync(docPath, "utf8");
    expect(doc).toContain("## How to update baselines deliberately");
    expect(doc).toContain("--write-docs");
    expect(doc).toContain("git diff docs/PERFORMANCE.md");
  });
});

describe(".github/workflows/load-tests.yml", () => {
  const workflowPath = path.join(ROOT, ".github", "workflows", "load-tests.yml");

  it("exists and defines a valid scheduled load-test workflow", () => {
    expect(existsSync(workflowPath)).toBe(true);
    const content = readFileSync(workflowPath, "utf8");
    expect(content).toContain("cron:");
    expect(content).toContain("workflow_dispatch:");
    expect(content).toContain("scripts/load-test.js");
    expect(content).toContain("scripts/sse-load-test.mjs");
    expect(content).toContain("actions/upload-artifact");
  });
});
