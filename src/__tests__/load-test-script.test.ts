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
});
