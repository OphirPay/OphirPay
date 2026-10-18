// SPDX-License-Identifier: MIT
//
// Regression test suite for CI concurrency configuration — Issue #1343
// Verifies that post-merge CI runs on branches (push events) are never cancelled
// while stale PR runs continue to be cancelled on new pushes.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";

const root = process.cwd();
const read = (relPath: string): string => readFileSync(join(root, relPath), "utf8");

interface ConcurrencyConfig {
  group: string;
  "cancel-in-progress": boolean | string;
}

interface WorkflowConfig {
  name: string;
  concurrency?: ConcurrencyConfig;
}

/**
 * Simulates GitHub Actions expression evaluation for concurrency
 */
function evaluateConcurrency(
  groupExpr: string,
  cancelExpr: string | boolean,
  context: {
    workflow: string;
    event_name: string;
    ref: string;
    sha: string;
  }
) {
  // Evaluate cancel-in-progress
  let cancelInProgress = false;
  if (typeof cancelExpr === "boolean") {
    cancelInProgress = cancelExpr;
  } else if (cancelExpr.includes("github.event_name == 'pull_request'")) {
    cancelInProgress = context.event_name === "pull_request";
  }

  // Evaluate group
  let group = groupExpr;
  if (groupExpr.includes("github.event_name == 'pull_request' && github.ref || github.sha")) {
    const activeRefOrSha = context.event_name === "pull_request" ? context.ref : context.sha;
    group = `${context.workflow}-${activeRefOrSha}`;
  } else {
    group = groupExpr
      .replace("${{ github.workflow }}", context.workflow)
      .replace("${{ github.ref }}", context.ref);
  }

  return { group, cancelInProgress };
}

describe("CI Concurrency Guard (.github/workflows/ci.yml) — Issue #1343", () => {
  const ciYaml = load(read(".github/workflows/ci.yml")) as WorkflowConfig;

  it("defines a concurrency block in ci.yml", () => {
    expect(ciYaml.concurrency).toBeDefined();
  });

  it("restricts cancel-in-progress only to pull_request events", () => {
    const cancelVal = String(ciYaml.concurrency?.["cancel-in-progress"]);
    expect(cancelVal).toMatch(/github\.event_name\s*==\s*['"]pull_request['"]/);
  });

  it("differentiates group keys between PRs and branch push events", () => {
    const groupVal = ciYaml.concurrency?.group ?? "";
    expect(groupVal).toContain("github.sha");
    expect(groupVal).toContain("github.ref");
  });

  it("cancels stale runs when a PR receives consecutive pushes", () => {
    const run1 = evaluateConcurrency(
      ciYaml.concurrency!.group,
      ciYaml.concurrency!["cancel-in-progress"],
      {
        workflow: "OphirPay CI/CD",
        event_name: "pull_request",
        ref: "refs/pull/42/merge",
        sha: "commit-1",
      }
    );

    const run2 = evaluateConcurrency(
      ciYaml.concurrency!.group,
      ciYaml.concurrency!["cancel-in-progress"],
      {
        workflow: "OphirPay CI/CD",
        event_name: "pull_request",
        ref: "refs/pull/42/merge",
        sha: "commit-2",
      }
    );

    // Both runs share the same group so the newer run cancels the older one
    expect(run1.group).toBe(run2.group);
    expect(run2.cancelInProgress).toBe(true);
  });

  it("does not cancel runs when two PRs are merged back-to-back into main or staging", () => {
    const merge1 = evaluateConcurrency(
      ciYaml.concurrency!.group,
      ciYaml.concurrency!["cancel-in-progress"],
      {
        workflow: "OphirPay CI/CD",
        event_name: "push",
        ref: "refs/heads/main",
        sha: "sha-merge-pr-101",
      }
    );

    const merge2 = evaluateConcurrency(
      ciYaml.concurrency!.group,
      ciYaml.concurrency!["cancel-in-progress"],
      {
        workflow: "OphirPay CI/CD",
        event_name: "push",
        ref: "refs/heads/main",
        sha: "sha-merge-pr-102",
      }
    );

    // cancel-in-progress must be false for push events
    expect(merge1.cancelInProgress).toBe(false);
    expect(merge2.cancelInProgress).toBe(false);

    // Groups are isolated by commit SHA so intermediate runs never cancel each other
    expect(merge1.group).not.toBe(merge2.group);
    expect(merge1.group).toBe("OphirPay CI/CD-sha-merge-pr-101");
    expect(merge2.group).toBe("OphirPay CI/CD-sha-merge-pr-102");
  });
});
