// SPDX-License-Identifier: MIT
// Unit tests for GitHub rulesets definition and apply script (issue #1318)

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const RULESET_PATH = resolve(
  __dirname,
  "../../.github/rulesets/protected-branches.json"
);
const SCRIPT_PATH = resolve(__dirname, "../../scripts/apply-ruleset.sh");
const MERGE_GATE_PATH = resolve(__dirname, "../../docs/MERGE_GATE.md");

describe("Repository Branch Protection Ruleset (issue #1318)", () => {
  it("exists on disk and contains valid JSON", () => {
    expect(existsSync(RULESET_PATH)).toBe(true);
    const content = readFileSync(RULESET_PATH, "utf8");
    const json = JSON.parse(content);
    expect(json).toBeTypeOf("object");
    expect(json.name).toContain("Protected Branches");
    expect(json.target).toBe("branch");
    expect(json.enforcement).toBe("active");
  });

  it("targets both main and integration/staging branches", () => {
    const json = JSON.parse(readFileSync(RULESET_PATH, "utf8"));
    const includedRefs: string[] = json.conditions?.ref_name?.include ?? [];
    expect(includedRefs).toContain("refs/heads/main");
    expect(includedRefs).toContain("refs/heads/integration/staging");
  });

  it("enforces pull requests, deletion prevention, and force-push blocking", () => {
    const json = JSON.parse(readFileSync(RULESET_PATH, "utf8"));
    const ruleTypes = json.rules.map((r: { type: string }) => r.type);

    expect(ruleTypes).toContain("deletion");
    expect(ruleTypes).toContain("non_fast_forward");
    expect(ruleTypes).toContain("pull_request");

    const prRule = json.rules.find((r: { type: string }) => r.type === "pull_request");
    expect(prRule.parameters.required_approving_review_count).toBeGreaterThanOrEqual(1);
    expect(prRule.parameters.required_review_thread_resolution).toBe(true);
  });

  it("enforces all required status checks documented in MERGE_GATE.md", () => {
    const json = JSON.parse(readFileSync(RULESET_PATH, "utf8"));
    const statusChecksRule = json.rules.find(
      (r: { type: string }) => r.type === "required_status_checks"
    );
    expect(statusChecksRule).toBeDefined();
    expect(statusChecksRule.parameters.strict_required_status_checks_policy).toBe(true);

    const checkContexts = statusChecksRule.parameters.required_status_checks.map(
      (c: { context: string }) => c.context
    );

    expect(checkContexts.some((c: string) => /typecheck/i.test(c))).toBe(true);
    expect(checkContexts.some((c: string) => /eslint/i.test(c))).toBe(true);
    expect(checkContexts.some((c: string) => /unit tests/i.test(c))).toBe(true);
    expect(checkContexts.some((c: string) => /build/i.test(c))).toBe(true);
    expect(checkContexts.some((c: string) => /deploy configuration/i.test(c))).toBe(true);
    expect(checkContexts.some((c: string) => /contract wasm/i.test(c))).toBe(true);
    expect(checkContexts.some((c: string) => /secrets scan/i.test(c))).toBe(true);
    expect(checkContexts.some((c: string) => /helm lint/i.test(c))).toBe(true);
    expect(checkContexts.some((c: string) => /prisma/i.test(c))).toBe(true);
    expect(checkContexts.some((c: string) => /regression guard/i.test(c))).toBe(true);
    expect(checkContexts.some((c: string) => /enforce integration branch/i.test(c))).toBe(true);
  });
});

describe("apply-ruleset script", () => {
  it("exists on disk with valid bash header and argument handling", () => {
    expect(existsSync(SCRIPT_PATH)).toBe(true);
    const content = readFileSync(SCRIPT_PATH, "utf8");
    expect(content).toContain("#!/usr/bin/env bash");
    expect(content).toContain("--dry-run");
    expect(content).toContain("--verify");
    expect(content).toContain("repos/${REPO}/rulesets");
  });
});

describe("MERGE_GATE documentation reference", () => {
  it("references protected-branches.json and apply-ruleset.sh", () => {
    const content = readFileSync(MERGE_GATE_PATH, "utf8");
    expect(content).toContain("Repository ruleset & branch protection");
    expect(content).toContain(".github/rulesets/protected-branches.json");
    expect(content).toContain("scripts/apply-ruleset.sh");
    expect(content).toContain("Pull Request Enforcement");
    expect(content).toContain("Branch Immutability");
  });
});
