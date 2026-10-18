// SPDX-License-Identifier: MIT
/**
 * @vitest-environment node
 *
 * Issue #1324 — E2E server readiness loop treats HTTP 503 as ready, masking a dead database.
 * Validates that e2e-nightly.yml strictly requires HTTP 200 from /api/health after
 * /api/health/live succeeds, prints diagnostic JSON on failure, and does not accept 503.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("E2E server readiness check in e2e-nightly.yml (issue #1324)", () => {
  const workflowPath = ".github/workflows/e2e-nightly.yml";
  const workflowContent = read(workflowPath);
  const parsed = load(workflowContent) as {
    jobs: {
      "playwright-tests": {
        steps: Array<{
          name?: string;
          run?: string;
        }>;
      };
    };
  };

  const startServerStep = parsed.jobs["playwright-tests"].steps.find(
    (s) => s.name === "Start the server"
  );

  it("finds the 'Start the server' step in e2e-nightly.yml", () => {
    expect(startServerStep, "Start the server step missing from e2e-nightly.yml").toBeTruthy();
    expect(startServerStep?.run).toBeDefined();
  });

  it("does not accept HTTP 503 as a ready state", () => {
    const run = startServerStep!.run!;
    expect(run).not.toContain('[ "$code" = "503" ]');
    expect(run).not.toMatch(/if\s*\[\s*"\$code"\s*=\s*"200"\s*\]\s*\|\|\s*\[\s*"\$code"\s*=\s*"503"\s*\]/);
  });

  it("probes /api/health/live first to confirm process liveness before checking database", () => {
    const run = startServerStep!.run!;
    expect(run).toContain("/api/health/live");
    expect(run.indexOf("/api/health/live")).toBeLessThan(run.indexOf("/api/health\""));
  });

  it("strictly requires /api/health to return HTTP 200 for database readiness", () => {
    const run = startServerStep!.run!;
    expect(run).toMatch(/if\s*\[\s*"\$code"\s*=\s*"200"\s*\];\s*then/);
    expect(run).toContain("Database ready and server operational (HTTP 200)");
  });

  it("dumps the /api/health JSON response and server log when readiness fails", () => {
    const run = startServerStep!.run!;
    expect(run).toContain("Server failed database readiness check");
    expect(run).toContain("cat /tmp/next-server.log");
    expect(run).toContain("$health_json");
  });

  it("maintains documentation comment matching the actual route contract in health/route.ts", () => {
    const run = startServerStep!.run!;
    expect(run).toContain("HTTP 200 is returned for healthy OR degraded");
    expect(run).toContain("HTTP 503 is returned ONLY when the critical database connection check fails");
  });
});
