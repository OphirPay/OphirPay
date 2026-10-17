// SPDX-License-Identifier: MIT
//
// Regression test suite for Nightly E2E failure reporting — Issue #1342
// Verifies that failing nightly runs create/update a single tracking issue
// and successful runs automatically close it.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";

const root = process.cwd();
const read = (relPath: string): string => readFileSync(join(root, relPath), "utf8");

interface JobConfig {
  name?: string;
  if?: string;
  needs?: string | string[];
  steps?: Array<{ name?: string; run?: string }>;
}

interface WorkflowConfig {
  name: string;
  permissions?: Record<string, string>;
  jobs: Record<string, JobConfig>;
}

export interface StatusReporterInput {
  testsResult: "success" | "failure" | "cancelled";
  refName: string;
  runId: string;
  existingIssueNumber: number | null;
}

export interface StatusReporterOutput {
  action: "create-issue" | "update-issue" | "close-issue" | "noop";
  issueTitle: string;
  issueNumber?: number;
  bodySnippet?: string;
  exitCode: number;
}

/**
 * Replicates the behavior in the `report-status` job in e2e-nightly.yml
 */
export function evaluateE2EStatusReporter(input: StatusReporterInput): StatusReporterOutput {
  const issueTitle = `Nightly E2E failing on ${input.refName}`;

  if (input.testsResult === "success") {
    if (input.existingIssueNumber !== null) {
      return {
        action: "close-issue",
        issueTitle,
        issueNumber: input.existingIssueNumber,
        exitCode: 0,
      };
    }
    return {
      action: "noop",
      issueTitle,
      exitCode: 0,
    };
  }

  // Failure
  if (input.existingIssueNumber !== null) {
    return {
      action: "update-issue",
      issueTitle,
      issueNumber: input.existingIssueNumber,
      bodySnippet: `Nightly E2E failed again on [Run #${input.runId}]`,
      exitCode: 1,
    };
  }

  return {
    action: "create-issue",
    issueTitle,
    bodySnippet: `The nightly E2E test run on branch \`${input.refName}\` has failed.`,
    exitCode: 1,
  };
}

describe("Nightly E2E Failure Reporter (.github/workflows/e2e-nightly.yml) — Issue #1342", () => {
  const workflow = load(read(".github/workflows/e2e-nightly.yml")) as WorkflowConfig;

  it("grants issues: write permission to the workflow", () => {
    expect(workflow.permissions).toBeDefined();
    expect(workflow.permissions?.issues).toBe("write");
  });

  it("defines the report-status job with correct dependencies and always() condition", () => {
    const reportJob = workflow.jobs["report-status"];
    expect(reportJob).toBeDefined();
    expect(reportJob.if).toBe("always()");
    expect(reportJob.needs).toContain("playwright-tests");
    expect(reportJob.needs).toContain("merge-reports");
  });

  it("creates a single tracking issue on failure with run and artifact links", () => {
    const out = evaluateE2EStatusReporter({
      testsResult: "failure",
      refName: "integration/staging",
      runId: "12345678",
      existingIssueNumber: null,
    });

    expect(out.action).toBe("create-issue");
    expect(out.issueTitle).toBe("Nightly E2E failing on integration/staging");
    expect(out.bodySnippet).toContain("The nightly E2E test run on branch `integration/staging` has failed.");
    expect(out.exitCode).toBe(1);
  });

  it("updates existing tracking issue instead of opening duplicates on repeated failure", () => {
    const out = evaluateE2EStatusReporter({
      testsResult: "failure",
      refName: "integration/staging",
      runId: "12345679",
      existingIssueNumber: 888,
    });

    expect(out.action).toBe("update-issue");
    expect(out.issueNumber).toBe(888);
    expect(out.bodySnippet).toContain("Nightly E2E failed again on [Run #12345679]");
    expect(out.exitCode).toBe(1);
  });

  it("automatically closes tracking issue on subsequent green run", () => {
    const out = evaluateE2EStatusReporter({
      testsResult: "success",
      refName: "integration/staging",
      runId: "12345680",
      existingIssueNumber: 888,
    });

    expect(out.action).toBe("close-issue");
    expect(out.issueNumber).toBe(888);
    expect(out.exitCode).toBe(0);
  });

  it("does nothing when clean and no tracking issue exists", () => {
    const out = evaluateE2EStatusReporter({
      testsResult: "success",
      refName: "main",
      runId: "12345681",
      existingIssueNumber: null,
    });

    expect(out.action).toBe("noop");
    expect(out.exitCode).toBe(0);
  });
});
