// SPDX-License-Identifier: MIT
/**
 * Tests for the path-scoped workflow gates.
 *
 * A workflow skipped by a workflow-level `paths:` filter never reports a
 * status, so requiring it in branch protection leaves unrelated PRs stuck on
 * "Expected — waiting for status". Each path-scoped workflow therefore keeps
 * its heavy job conditional but exposes an always-running gate job, and only
 * that gate may be required.
 *
 * Acceptance criteria:
 * - a docs-only PR gets a passing (not pending) gate check
 * - a PR touching the relevant paths runs the full job and fails the gate
 * - docs/MERGE_GATE.md lists the gate job names
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

type Step = { id?: string; uses?: string; if?: string };
type Job = {
  name?: string;
  needs?: string | string[];
  if?: string;
  outputs?: Record<string, string>;
  steps?: Step[];
};
type Workflow = { on?: Record<string, unknown>; jobs?: Record<string, Job> };

const SCOPED_WORKFLOWS = [
  {
    file: ".github/workflows/prisma-ci.yml",
    filter: "prisma",
    heavy: "prisma",
    gate: "prisma-gate",
  },
  {
    file: ".github/workflows/contract-regression.yml",
    filter: "contracts",
    heavy: "contract-regression",
    gate: "contract-regression-gate",
  },
  {
    file: ".github/workflows/docker-smoke.yml",
    filter: "docker",
    heavy: "docker-smoke",
    gate: "docker-smoke-gate",
  },
] as const;

const parse = (rel: string): Workflow => load(read(rel)) as Workflow;

describe("path-scoped workflow gates", () => {
  for (const { file, filter, heavy, gate } of SCOPED_WORKFLOWS) {
    describe(file, () => {
      const workflow = parse(file);
      const jobs = workflow.jobs ?? {};

      it("does not use workflow-level paths filters", () => {
        for (const trigger of Object.values(workflow.on ?? {})) {
          if (trigger && typeof trigger === "object") {
            expect(trigger).not.toHaveProperty("paths");
          }
        }
      });

      it("detects changes with a SHA-pinned dorny/paths-filter step", () => {
        const changes = jobs.changes;
        expect(changes, "missing changes job").toBeDefined();
        expect(Object.keys(changes.outputs ?? {})).toContain(filter);

        const filterStep = changes.steps?.find((step) =>
          step.uses?.startsWith("dorny/paths-filter@")
        );
        expect(filterStep, "missing dorny/paths-filter step").toBeDefined();
        // A floating tag would silently change under us; pin to a commit SHA.
        expect(filterStep?.uses).toMatch(/^dorny\/paths-filter@[0-9a-f]{40}$/);
      });

      it("runs the heavy job only when its paths changed", () => {
        expect(jobs[heavy], `missing ${heavy} job`).toBeDefined();
        expect(jobs[heavy].needs).toContain("changes");
        expect(jobs[heavy].if).toContain(`needs.changes.outputs.${filter}`);
      });

      it("exposes an always-running gate that depends on both jobs", () => {
        const gateJob = jobs[gate];
        expect(gateJob, `missing ${gate} job`).toBeDefined();
        expect(gateJob.if).toBe("always()");
        expect(gateJob.needs).toEqual(["changes", heavy]);
        // The check name in branch protection must match the documented gate.
        expect(gateJob.name).toBe(gate);
      });
    });
  }

  it("documents the gate job names as the required checks", () => {
    const doc = read("docs/MERGE_GATE.md");
    for (const { gate, heavy, filter } of SCOPED_WORKFLOWS) {
      expect(doc, `docs should list ${gate}`).toContain(gate);
      expect(doc, `docs should mention the ${filter} filter`).toContain(filter);
      // The docs must warn against requiring the skippable jobs themselves.
      expect(doc).toContain("Do not require");
      expect(doc).toContain(heavy);
    }
  });
});
