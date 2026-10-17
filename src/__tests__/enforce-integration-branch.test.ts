// SPDX-License-Identifier: MIT
//
// Regression test suite for .github/workflows/enforce-integration-branch.yml — Issue #1341
// Verifies that the integration-branch guard fails closed on any non-404 GitHub API error.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (relPath: string): string => readFileSync(join(root, relPath), "utf8");

export interface GuardEvaluationInput {
  apiStatus: number | null;
  apiOutput: string;
  headRef: string;
  baseRef: string;
  integrationBranch?: string;
}

export interface GuardEvaluationResult {
  action: "pass" | "reject" | "fail-closed";
  message: string;
  exitCode: number;
}

/**
 * Replicates the state machine executed by .github/workflows/enforce-integration-branch.yml
 */
export function evaluateIntegrationBranchGuard(input: GuardEvaluationInput): GuardEvaluationResult {
  const integrationBranch = input.integrationBranch ?? "integration/staging";

  if (input.apiStatus === 200) {
    // Branch exists -> batch mode active
    if (input.headRef === integrationBranch) {
      return {
        action: "pass",
        message: "PR is the integration branch itself merging. Passing.",
        exitCode: 0,
      };
    }
    if (input.baseRef === "main") {
      return {
        action: "reject",
        message: `PR targets 'main'. Batch mode is active - retarget this PR to '${integrationBranch}'.`,
        exitCode: 1,
      };
    }
    return {
      action: "pass",
      message: `PR targets '${input.baseRef}' (batch mode active).`,
      exitCode: 0,
    };
  }

  // Branch ref call returned an error
  const is404 = input.apiStatus === 404 || input.apiOutput.includes("HTTP 404");
  if (is404) {
    return {
      action: "pass",
      message: `Batch mode over: '${integrationBranch}' does not exist (HTTP 404). Passing.`,
      exitCode: 0,
    };
  }

  // Non-404 API error (rate limits, 5xx, network drops) must FAIL CLOSED
  return {
    action: "fail-closed",
    message: `Branch verification failed: Failed to verify existence of '${integrationBranch}' (HTTP status: '${input.apiStatus ?? "unknown"}'). Failing closed to prevent bypass.`,
    exitCode: 1,
  };
}

describe("Enforce Integration Branch Workflow (#1341)", () => {
  const workflowContent = read(".github/workflows/enforce-integration-branch.yml");

  it("inspects HTTP status using gh api -i instead of blind failure catch", () => {
    expect(workflowContent).toContain("gh api -i");
    // Ensure the old vulnerable pattern is completely absent
    expect(workflowContent).not.toMatch(/if\s*!\s*gh\s*api[^\n]*;[^\n]*then\s*exit\s*0/);
  });

  it("extracts HTTP status code and verifies genuine 404", () => {
    expect(workflowContent).toContain('HTTP_STATUS=$(echo "$API_OUTPUT"');
    expect(workflowContent).toContain('[ "${HTTP_STATUS}" = "404" ]');
  });

  it("fails closed on non-404 API errors with descriptive error annotations", () => {
    expect(workflowContent).toContain("::error title=Branch verification failed::");
    expect(workflowContent).toContain("Failing closed to prevent bypass");
  });

  it("allows PR to main only when integration/staging legitimately returns 404 (batch mode over)", () => {
    const res = evaluateIntegrationBranchGuard({
      apiStatus: 404,
      apiOutput: '{"message":"Not Found"} gh: Not Found (HTTP 404)',
      headRef: "feature/foo",
      baseRef: "main",
    });
    expect(res.action).toBe("pass");
    expect(res.exitCode).toBe(0);
    expect(res.message).toContain("Batch mode over");
  });

  it("rejects PR to main when integration/staging is active (HTTP 200)", () => {
    const res = evaluateIntegrationBranchGuard({
      apiStatus: 200,
      apiOutput: "refs/heads/integration/staging",
      headRef: "feature/foo",
      baseRef: "main",
    });
    expect(res.action).toBe("reject");
    expect(res.exitCode).toBe(1);
    expect(res.message).toContain("PR targets 'main'. Batch mode is active");
  });

  it("passes PR targeting integration/staging when active (HTTP 200)", () => {
    const res = evaluateIntegrationBranchGuard({
      apiStatus: 200,
      apiOutput: "refs/heads/integration/staging",
      headRef: "feature/foo",
      baseRef: "integration/staging",
    });
    expect(res.action).toBe("pass");
    expect(res.exitCode).toBe(0);
  });

  it("passes when integration/staging itself is merging into main (HTTP 200)", () => {
    const res = evaluateIntegrationBranchGuard({
      apiStatus: 200,
      apiOutput: "refs/heads/integration/staging",
      headRef: "integration/staging",
      baseRef: "main",
    });
    expect(res.action).toBe("pass");
    expect(res.exitCode).toBe(0);
  });

  it("fails closed when GitHub API hits rate limit (HTTP 403)", () => {
    const res = evaluateIntegrationBranchGuard({
      apiStatus: 403,
      apiOutput: '{"message":"API rate limit exceeded"} gh: API rate limit exceeded (HTTP 403)',
      headRef: "feature/foo",
      baseRef: "main",
    });
    expect(res.action).toBe("fail-closed");
    expect(res.exitCode).toBe(1);
    expect(res.message).toContain("Failing closed");
  });

  it("fails closed when GitHub API returns internal server error (HTTP 500)", () => {
    const res = evaluateIntegrationBranchGuard({
      apiStatus: 500,
      apiOutput: "HTTP/2.0 500 Internal Server Error",
      headRef: "feature/foo",
      baseRef: "main",
    });
    expect(res.action).toBe("fail-closed");
    expect(res.exitCode).toBe(1);
  });

  it("fails closed on network drop or token issue without HTTP response", () => {
    const res = evaluateIntegrationBranchGuard({
      apiStatus: null,
      apiOutput: "gh: dial tcp 140.82.121.4:443: connect: connection refused",
      headRef: "feature/foo",
      baseRef: "main",
    });
    expect(res.action).toBe("fail-closed");
    expect(res.exitCode).toBe(1);
  });
});
