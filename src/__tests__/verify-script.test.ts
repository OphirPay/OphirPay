// SPDX-License-Identifier: MIT

/**
 * Drift guard for issue #728 — "Add a single verify script that mirrors
 * the real merge gate".
 *
 * The gate is defined once, in scripts/check-submission.sh, and exposed as
 * `npm run verify`. The CI workflow calls that exact script, so the two
 * definitions of "green" can no longer drift apart silently. This test fails
 * if the wiring breaks: the package.json scripts, the CI workflow, or the
 * CONTRIBUTING documentation.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";

const root = process.cwd();

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

type WorkflowJob = {
  env?: Record<string, string>;
  steps?: { run?: string }[];
};

const workflow = load(
  readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf8"),
) as { jobs: Record<string, WorkflowJob> };

const contributing = readFileSync(join(root, "CONTRIBUTING.md"), "utf8");

describe("single verify gate (issue #728)", () => {
  it("exposes npm run verify as the full submission gate", () => {
    expect(pkg.scripts.verify).toBeDefined();
    expect(pkg.scripts.verify).toContain("scripts/check-submission.sh");
  });

  it("exposes npm run verify:quick as the typecheck + unit-test fast loop", () => {
    expect(pkg.scripts["verify:quick"]).toContain("npm run typecheck");
    expect(pkg.scripts["verify:quick"]).toContain("npm test");
  });

  it("keeps npm run ci as an alias of npm run verify", () => {
    expect(pkg.scripts.ci).toBe("npm run verify");
  });

  it("runs the same command from the CI workflow", () => {
    const job = workflow.jobs.verify;
    expect(job).toBeDefined();
    const runs = (job.steps ?? []).map((step) => step.run ?? "");
    expect(runs).toContain("npm run verify");
  });

  it("keeps the documented contract-test deviation in CI", () => {
    expect(workflow.jobs.verify.env?.SKIP_CONTRACTS).toBe("1");
  });

  it("documents which command to run before pushing", () => {
    expect(contributing).toContain("npm run verify");
    expect(contributing).toContain("npm run verify:quick");
  });
});
