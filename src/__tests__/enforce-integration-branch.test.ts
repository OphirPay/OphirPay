// SPDX-License-Identifier: MIT
/**
 * @vitest-environment node
 *
 * Issue #1341: Integration-branch guard passes when the GitHub API call
 * fails for any reason.
 *
 * Verifies that:
 * 1. The workflow parses as valid YAML and defines the pull_request triggers.
 * 2. Only a genuine 404 from the GitHub API signals batch mode is over and exits 0.
 * 3. Any other GitHub API error (401, 403 rate limit, 500 server error, network failure)
 *    fails closed with exit code 1.
 * 4. When the branch exists (200), PRs targeting `main` fail with exit 1,
 *    while PRs targeting `integration/staging` pass with exit 0.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe(".github/workflows/enforce-integration-branch.yml structure (issue #1341)", () => {
  const workflow = load(read(".github/workflows/enforce-integration-branch.yml")) as {
    name: string;
    on: { pull_request: { types: string[] } };
    jobs: {
      "enforce-base": {
        steps: Array<{ name: string; run: string }>;
      };
    };
  };

  it("is valid YAML and defines pull_request trigger types", () => {
    expect(workflow.name).toBe("🚧 Enforce Integration Branch");
    expect(workflow.on.pull_request.types).toContain("opened");
    expect(workflow.on.pull_request.types).toContain("edited");
    expect(workflow.on.pull_request.types).toContain("synchronize");
  });

  it("contains fail-closed branch existence check in the run script", () => {
    const step = workflow.jobs["enforce-base"].steps[0];
    expect(step.run).toContain("gh api -i");
    expect(step.run).toMatch(/HTTP\/\[0-9\.\]\+ 404|HTTP 404/);
    expect(step.run).toContain("Failed to verify integration branch status");
  });
});

describe("Integration branch guard bash logic execution (issue #1341)", () => {
  const workflow = load(read(".github/workflows/enforce-integration-branch.yml")) as {
    jobs: {
      "enforce-base": {
        steps: Array<{ run: string }>;
      };
    };
  };
  const scriptContent = workflow.jobs["enforce-base"].steps[0].run.replace(/\r\n/g, "\n");

  function runGuardScript(options: {
    mockGhOutput: string;
    mockGhExitCode: number;
    baseRef: string;
    headRef: string;
    prNumber?: string;
  }): { status: number; stdout: string; stderr: string } {
    const runnerScript = `
gh() {
  cat << 'MOCK_EOF'
${options.mockGhOutput}
MOCK_EOF
  return ${options.mockGhExitCode}
}
export -f gh

export GITHUB_REPOSITORY="OphirPay/OphirPay"
export BASE_REF="${options.baseRef}"
export HEAD_REF="${options.headRef}"
export PR_NUMBER="${options.prNumber || "123"}"

${scriptContent}
`.replace(/\r\n/g, "\n");

    try {
      const stdout = execFileSync("bash", ["-s"], {
        input: runnerScript,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      return { status: 0, stdout, stderr: "" };
    } catch (err: unknown) {
      const e = err as { status?: number; stdout?: string; stderr?: string };
      return {
        status: e.status ?? 1,
        stdout: e.stdout ?? "",
        stderr: e.stderr ?? "",
      };
    }
  }

  it("passes when branch returns 404 (batch mode over)", () => {
    const res = runGuardScript({
      mockGhOutput: "HTTP/2.0 404 Not Found\n\ngh: Not Found (HTTP 404)\n{\"message\": \"Not Found\"}",
      mockGhExitCode: 1,
      baseRef: "main",
      headRef: "feat/my-feature",
    });

    expect(res.status).toBe(0);
    expect(res.stdout).toContain("Batch mode over: 'integration/staging' does not exist (HTTP 404). Passing.");
  });

  it("fails closed when API returns 403 rate limit error", () => {
    const res = runGuardScript({
      mockGhOutput: "HTTP/2.0 403 Forbidden\n\ngh: API rate limit exceeded (HTTP 403)",
      mockGhExitCode: 1,
      baseRef: "main",
      headRef: "feat/my-feature",
    });

    expect(res.status).toBe(1);
    expect(res.stdout).toContain("Failed to verify integration branch status (exit code 1)");
    expect(res.stdout).toContain("API rate limit exceeded");
  });

  it("fails closed when API returns 500 server error", () => {
    const res = runGuardScript({
      mockGhOutput: "HTTP/2.0 500 Internal Server Error\n\ngh: Internal Server Error (HTTP 500)",
      mockGhExitCode: 1,
      baseRef: "main",
      headRef: "feat/my-feature",
    });

    expect(res.status).toBe(1);
    expect(res.stdout).toContain("Failed to verify integration branch status");
  });

  it("fails closed on network connection failure", () => {
    const res = runGuardScript({
      mockGhOutput: "gh: connection refused: could not reach api.github.com",
      mockGhExitCode: 1,
      baseRef: "main",
      headRef: "feat/my-feature",
    });

    expect(res.status).toBe(1);
    expect(res.stdout).toContain("Failed to verify integration branch status");
  });

  it("when branch exists (200), blocks PRs targeting main", () => {
    const res = runGuardScript({
      mockGhOutput: "HTTP/2.0 200 OK\n\n{\"ref\": \"refs/heads/integration/staging\"}",
      mockGhExitCode: 0,
      baseRef: "main",
      headRef: "feat/my-feature",
      prNumber: "999",
    });

    expect(res.status).toBe(1);
    expect(res.stdout).toContain("PR #999 targets 'main'. Batch mode is active - retarget this PR to 'integration/staging'");
  });

  it("when branch exists (200), allows PRs targeting integration/staging", () => {
    const res = runGuardScript({
      mockGhOutput: "HTTP/2.0 200 OK\n\n{\"ref\": \"refs/heads/integration/staging\"}",
      mockGhExitCode: 0,
      baseRef: "integration/staging",
      headRef: "feat/my-feature",
      prNumber: "999",
    });

    expect(res.status).toBe(0);
    expect(res.stdout).toContain("OK: PR #999 targets 'integration/staging' (batch mode active)");
  });

  it("when branch exists (200), allows the integration branch itself to merge", () => {
    const res = runGuardScript({
      mockGhOutput: "HTTP/2.0 200 OK\n\n{\"ref\": \"refs/heads/integration/staging\"}",
      mockGhExitCode: 0,
      baseRef: "main",
      headRef: "integration/staging",
      prNumber: "1000",
    });

    expect(res.status).toBe(0);
    expect(res.stdout).toContain("PR #1000 is the integration branch itself merging. Passing.");
  });
});
