// SPDX-License-Identifier: MIT
/**
 * Tests for enforce-integration-branch workflow guard logic (issue #1341).
 *
 * Acceptance Criteria:
 * - A 404 for the branch passes ("batch mode over")
 * - Any non-404 API error fails the check with a clear message
 * - Behaviour is covered by a small script test
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** Pure implementation of the workflow's guard decision tree */
export function evaluateIntegrationBranchGuard(params: {
  apiOutput: string;
  apiExit: number;
  baseRef: string;
  headRef: string;
  integrationBranch?: string;
}): { status: "pass" | "fail"; exitCode: number; reason: string } {
  const integrationBranch = params.integrationBranch || "integration/staging";

  // Parse HTTP status code from the output
  const statusMatch = params.apiOutput.match(/^HTTP\/[0-9.]+\s+([0-9]{3})/m);
  const httpStatus = statusMatch ? statusMatch[1] : null;

  const is404 =
    httpStatus === "404" ||
    (params.apiExit !== 0 && /HTTP 404/i.test(params.apiOutput));

  const is200 = httpStatus === "200" || (params.apiExit === 0 && !is404);

  if (is404) {
    return {
      status: "pass",
      exitCode: 0,
      reason: `Batch mode over: '${integrationBranch}' does not exist (HTTP 404). Passing.`,
    };
  }

  if (is200) {
    if (params.headRef === integrationBranch) {
      return {
        status: "pass",
        exitCode: 0,
        reason: "PR is the integration branch itself merging. Passing.",
      };
    }
    if (params.baseRef === "main") {
      return {
        status: "fail",
        exitCode: 1,
        reason: `::error title=Wrong base branch::PR targets 'main'. Batch mode is active - retarget this PR to '${integrationBranch}'.`,
      };
    }
    return {
      status: "pass",
      exitCode: 0,
      reason: `OK: PR targets '${params.baseRef}' (batch mode active).`,
    };
  }

  // Any non-404 and non-200 API error must fail closed
  return {
    status: "fail",
    exitCode: 1,
    reason: `Failed to verify existence of branch '${integrationBranch}'. API returned exit code ${params.apiExit}, HTTP status '${httpStatus || "unknown"}'. Failing closed to avoid bypassing batch mode guard.`,
  };
}

describe("enforce-integration-branch guard logic (issue #1341)", () => {
  it("passes when the integration branch genuinely does not exist (HTTP 404)", () => {
    const result = evaluateIntegrationBranchGuard({
      apiOutput: "HTTP/2.0 404 Not Found\n{\"message\":\"Not Found\"}",
      apiExit: 1,
      baseRef: "main",
      headRef: "feature/foo",
    });
    expect(result.status).toBe("pass");
    expect(result.exitCode).toBe(0);
    expect(result.reason).toContain("Batch mode over");
  });

  it("blocks PRs targeting main when integration branch exists (HTTP 200)", () => {
    const result = evaluateIntegrationBranchGuard({
      apiOutput: "HTTP/2.0 200 OK\n{\"ref\":\"refs/heads/integration/staging\"}",
      apiExit: 0,
      baseRef: "main",
      headRef: "feature/foo",
    });
    expect(result.status).toBe("fail");
    expect(result.exitCode).toBe(1);
    expect(result.reason).toContain("Wrong base branch");
  });

  it("allows PRs targeting integration/staging when it exists (HTTP 200)", () => {
    const result = evaluateIntegrationBranchGuard({
      apiOutput: "HTTP/2.0 200 OK\n{\"ref\":\"refs/heads/integration/staging\"}",
      apiExit: 0,
      baseRef: "integration/staging",
      headRef: "feature/foo",
    });
    expect(result.status).toBe("pass");
    expect(result.exitCode).toBe(0);
  });

  it("fails closed on rate limiting (HTTP 429)", () => {
    const result = evaluateIntegrationBranchGuard({
      apiOutput: "HTTP/2.0 429 Too Many Requests\n{\"message\":\"API rate limit exceeded\"}",
      apiExit: 1,
      baseRef: "main",
      headRef: "feature/foo",
    });
    expect(result.status).toBe("fail");
    expect(result.exitCode).toBe(1);
    expect(result.reason).toContain("Failing closed");
  });

  it("fails closed on authentication errors (HTTP 401)", () => {
    const result = evaluateIntegrationBranchGuard({
      apiOutput: "HTTP/2.0 401 Unauthorized\n{\"message\":\"Bad credentials\"}",
      apiExit: 1,
      baseRef: "main",
      headRef: "feature/foo",
    });
    expect(result.status).toBe("fail");
    expect(result.exitCode).toBe(1);
    expect(result.reason).toContain("Failing closed");
  });

  it("fails closed on server errors (HTTP 500 / 503)", () => {
    const result = evaluateIntegrationBranchGuard({
      apiOutput: "HTTP/2.0 500 Internal Server Error",
      apiExit: 1,
      baseRef: "main",
      headRef: "feature/foo",
    });
    expect(result.status).toBe("fail");
    expect(result.exitCode).toBe(1);
    expect(result.reason).toContain("Failing closed");
  });

  it("fails closed on network / connection failure", () => {
    const result = evaluateIntegrationBranchGuard({
      apiOutput: "gh: Could not resolve host: api.github.com",
      apiExit: 1,
      baseRef: "main",
      headRef: "feature/foo",
    });
    expect(result.status).toBe("fail");
    expect(result.exitCode).toBe(1);
    expect(result.reason).toContain("Failing closed");
  });

  it("the workflow YAML parses and contains the fail-closed guard", () => {
    const content = read(".github/workflows/enforce-integration-branch.yml");
    const parsed = load(content) as Record<string, unknown>;
    expect(parsed).toBeDefined();
    expect(content).toContain("gh api -i");
    expect(content).toContain('"$http_status" = "404"');
    expect(content).toContain("Failing closed");
  });
});
