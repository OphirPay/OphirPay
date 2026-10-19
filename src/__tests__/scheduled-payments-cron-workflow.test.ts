// SPDX-License-Identifier: MIT
//
// Scheduled payments cron workflow and staging deployment verification — Issue #1328.

import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";

const root = process.cwd();
const read = (relPath: string): string => readFileSync(join(root, relPath), "utf8");



describe("Scheduled Payments Cron Workflow (.github/workflows/scheduled-payments-cron.yml) — #1328", () => {
  const workflowPath = ".github/workflows/scheduled-payments-cron.yml";
  const rawYaml = read(workflowPath);
  const parsed = load(rawYaml) as Record<string, unknown>;

  it("exists and is valid YAML", () => {
    expect(existsSync(join(root, workflowPath))).toBe(true);
    expect(parsed).toBeDefined();
    expect(typeof parsed).toBe("object");
  });

  it("contains no hard-coded production URL in the workflow", () => {
    expect(rawYaml).not.toContain("ophirpay.vercel.app");
  });

  it("supports both scheduled execution and targeted workflow_dispatch inputs", () => {
    const onTrigger = parsed.on as Record<string, unknown>;
    expect(onTrigger).toBeDefined();
    expect(onTrigger.schedule).toBeDefined();
    expect(onTrigger.workflow_dispatch).toBeDefined();

    const dispatch = onTrigger.workflow_dispatch as {
      inputs?: {
        target_environment?: {
          type?: string;
          options?: string[];
          default?: string;
        };
      };
    };
    expect(dispatch.inputs?.target_environment?.options).toEqual(
      expect.arrayContaining(["all", "production", "staging"])
    );
  });

  it("defines a multi-environment matrix targeting production and staging with environment scoping", () => {
    const jobs = (parsed.jobs ?? {}) as Record<string, Record<string, unknown>>;
    const sweepJob = jobs["run-sweep"];
    expect(sweepJob).toBeDefined();

    const strategy = sweepJob.strategy as {
      "fail-fast"?: boolean;
      matrix?: { environment?: string[] };
    };
    expect(strategy).toBeDefined();
    expect(strategy.matrix?.environment).toEqual(
      expect.arrayContaining(["production", "staging"])
    );

    // Binds environment dynamically to matrix value for secret/variable resolution
    expect(sweepJob.environment).toBe("${{ matrix.environment }}");
  });

  it("executes /api/cron and /api/requests/expire using environment-derived base URL", () => {
    const jobs = (parsed.jobs ?? {}) as Record<string, Record<string, unknown>>;
    const sweepJob = jobs["run-sweep"];
    const steps = (sweepJob.steps ?? []) as Array<{
      name?: string;
      env?: Record<string, string>;
      run?: string;
    }>;

    expect(steps.length).toBeGreaterThanOrEqual(2);

    const cronStep = steps.find((s) => s.name?.includes("/api/cron"));
    expect(cronStep).toBeDefined();
    expect(cronStep?.env?.CRON_SECRET).toBe("${{ secrets.CRON_SECRET }}");
    expect(cronStep?.env?.CRON_BASE_URL).toContain("vars.CRON_BASE_URL");
    expect(cronStep?.run).toContain("/api/cron");
    expect(cronStep?.run).toContain("x-cron-secret");

    const expireStep = steps.find((s) => s.name?.includes("/api/requests/expire"));
    expect(expireStep).toBeDefined();
    expect(expireStep?.env?.CRON_SECRET).toBe("${{ secrets.CRON_SECRET }}");
    expect(expireStep?.env?.CRON_BASE_URL).toContain("vars.CRON_BASE_URL");
    expect(expireStep?.run).toContain("/api/requests/expire");
  });
});

describe("Vercel configuration for stable staging alias (vercel.json) — #1328", () => {
  const vercel = JSON.parse(read("vercel.json")) as {
    alias?: string[];
    github?: { productionBranch?: string };
  };

  it("declares stable production and staging aliases", () => {
    expect(vercel.alias).toBeDefined();
    expect(vercel.alias).toContain("ophirpay.vercel.app");
    expect(vercel.alias).toContain("ophirpay-staging.vercel.app");
  });
});

describe("Documentation alignment (docs/DEPLOYMENT.md) — #1328", () => {
  const deploymentDoc = read("docs/DEPLOYMENT.md");

  it("documents stable staging URL and integration/staging branch mapping", () => {
    expect(deploymentDoc).toContain("https://ophirpay-staging.vercel.app");
    expect(deploymentDoc).toContain("integration/staging");
    expect(deploymentDoc).toContain("Staging Deployment & Environments");
  });

  it("documents GitHub Environment scoping for CRON_BASE_URL and CRON_SECRET", () => {
    expect(deploymentDoc).toContain("vars.CRON_BASE_URL");
    expect(deploymentDoc).toContain("secrets.CRON_SECRET");
    expect(deploymentDoc).toContain("scheduled-payments-cron.yml");
  });
});
