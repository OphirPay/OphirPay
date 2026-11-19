// SPDX-License-Identifier: MIT
/**
 * Tests for e2e-nightly failure tracking and notification (issue #1342).
 *
 * Acceptance Criteria:
 * - A failing nightly run creates or updates exactly one tracking issue
 * - A subsequent green run closes it
 * - The issue links the run and the merged HTML report artifact
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** Pure simulation of the nightly tracking issue state machine */
export function evaluateNightlyTrackingAction(params: {
  testResult: "success" | "failure" | "cancelled" | "skipped";
  refName: string;
  existingOpenIssueNumber: number | null;
  runUrl: string;
  reportUrl: string;
}): {
  action: "create_issue" | "comment_issue" | "close_issue" | "none";
  title?: string;
  label?: string;
  issueNumber?: number;
  bodyContains?: string[];
} {
  const title = `Nightly E2E failing on ${params.refName}`;
  const label = "ci";

  if (params.testResult === "failure") {
    if (params.existingOpenIssueNumber) {
      return {
        action: "comment_issue",
        issueNumber: params.existingOpenIssueNumber,
        bodyContains: [params.runUrl, params.reportUrl],
      };
    }
    return {
      action: "create_issue",
      title,
      label,
      bodyContains: [params.runUrl, params.reportUrl, "merged-html-report"],
    };
  }

  if (params.testResult === "success") {
    if (params.existingOpenIssueNumber) {
      return {
        action: "close_issue",
        issueNumber: params.existingOpenIssueNumber,
        bodyContains: [params.runUrl],
      };
    }
    return {
      action: "none",
    };
  }

  return { action: "none" };
}

describe("e2e-nightly failure tracking logic (issue #1342)", () => {
  const runUrl = "https://github.com/OphirPay/OphirPay/actions/runs/123456";
  const reportUrl = "https://github.com/OphirPay/OphirPay/actions/runs/123456#artifacts";

  it("creates exactly one tracking issue on initial failure", () => {
    const result = evaluateNightlyTrackingAction({
      testResult: "failure",
      refName: "integration/staging",
      existingOpenIssueNumber: null,
      runUrl,
      reportUrl,
    });

    expect(result.action).toBe("create_issue");
    expect(result.title).toBe("Nightly E2E failing on integration/staging");
    expect(result.label).toBe("ci");
    expect(result.bodyContains).toContain(runUrl);
    expect(result.bodyContains).toContain(reportUrl);
  });

  it("updates existing tracking issue instead of creating duplicates on consecutive failure", () => {
    const result = evaluateNightlyTrackingAction({
      testResult: "failure",
      refName: "integration/staging",
      existingOpenIssueNumber: 42,
      runUrl,
      reportUrl,
    });

    expect(result.action).toBe("comment_issue");
    expect(result.issueNumber).toBe(42);
    expect(result.bodyContains).toContain(runUrl);
    expect(result.bodyContains).toContain(reportUrl);
  });

  it("automatically closes the tracking issue on subsequent green run", () => {
    const result = evaluateNightlyTrackingAction({
      testResult: "success",
      refName: "integration/staging",
      existingOpenIssueNumber: 42,
      runUrl,
      reportUrl,
    });

    expect(result.action).toBe("close_issue");
    expect(result.issueNumber).toBe(42);
  });

  it("does nothing when run succeeds and no tracking issue was open", () => {
    const result = evaluateNightlyTrackingAction({
      testResult: "success",
      refName: "integration/staging",
      existingOpenIssueNumber: null,
      runUrl,
      reportUrl,
    });

    expect(result.action).toBe("none");
  });
});

describe("e2e-nightly.yml workflow structure (issue #1342)", () => {
  it("workflow YAML parses and declares track-nightly-status job with issues: write", () => {
    const content = read(".github/workflows/e2e-nightly.yml");
    const parsed = load(content) as {
      permissions: Record<string, string>;
      jobs: Record<string, { needs?: string[]; permissions?: Record<string, string> }>;
    };

    expect(parsed).toBeDefined();
    expect(parsed.permissions.issues).toBe("write");

    const trackJob = parsed.jobs["track-nightly-status"];
    expect(trackJob).toBeDefined();
    expect(trackJob.needs).toContain("playwright-tests");
    expect(trackJob.needs).toContain("merge-reports");
    expect(trackJob.permissions?.issues).toBe("write");

    // Content checks for the title, label, and links
    expect(content).toContain('TITLE="Nightly E2E failing on ${REF_NAME}"');
    expect(content).toContain('LABEL="ci"');
    expect(content).toContain("merged-html-report");
    expect(content).toContain("gh issue close");
    expect(content).toContain("gh issue create");
    expect(content).toContain("gh issue comment");
  });
});
