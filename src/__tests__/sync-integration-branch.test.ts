// SPDX-License-Identifier: MIT
// Unit tests for .github/workflows/sync-integration-branch.yml and MERGE_GATE documentation

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import yaml from "js-yaml";

const WORKFLOW_PATH = resolve(
  __dirname,
  "../../.github/workflows/sync-integration-branch.yml"
);
const MERGE_GATE_PATH = resolve(__dirname, "../../docs/MERGE_GATE.md");

describe("sync-integration-branch workflow", () => {
  it("exists on disk and parses as valid YAML", () => {
    expect(existsSync(WORKFLOW_PATH)).toBe(true);
    const content = readFileSync(WORKFLOW_PATH, "utf8");
    const doc = yaml.load(content) as Record<string, unknown>;
    expect(doc).toBeTypeOf("object");
    expect(doc).not.toBeNull();
  });

  it("is configured to trigger strictly on push to main and workflow_dispatch", () => {
    const content = readFileSync(WORKFLOW_PATH, "utf8");
    const doc = yaml.load(content) as {
      on?: {
        push?: { branches?: string[] };
        workflow_dispatch?: unknown;
      };
    };

    expect(doc.on).toBeDefined();
    expect(doc.on?.push?.branches).toEqual(["main"]);
    expect(doc.on?.workflow_dispatch).toBeDefined();
  });

  it("grants write permissions for contents and issues to update branches and file alerts", () => {
    const content = readFileSync(WORKFLOW_PATH, "utf8");
    const doc = yaml.load(content) as {
      permissions?: Record<string, string>;
    };

    expect(doc.permissions).toBeDefined();
    expect(doc.permissions?.contents).toBe("write");
    expect(doc.permissions?.issues).toBe("write");
  });

  it("includes branch existence guard to no-op when integration/staging does not exist", () => {
    const content = readFileSync(WORKFLOW_PATH, "utf8");
    expect(content).toContain("repos/${GITHUB_REPOSITORY}/git/ref/heads/${INTEGRATION_BRANCH}");
    expect(content).toContain("exists=false");
    expect(content).toContain("exists=true");
  });

  it("handles merge conflicts safely by aborting the merge and reporting conflicting files", () => {
    const content = readFileSync(WORKFLOW_PATH, "utf8");
    expect(content).toContain("git merge --abort");
    expect(content).toContain("git diff --name-only --diff-filter=U");
    expect(content).toContain("status=conflict");
    expect(content).toContain("gh issue create");
    expect(content).toContain("gh issue comment");
  });
});

describe("MERGE_GATE documentation", () => {
  it("documents sync-integration-branch.yml and the automated sync protocol", () => {
    expect(existsSync(MERGE_GATE_PATH)).toBe(true);
    const content = readFileSync(MERGE_GATE_PATH, "utf8");

    expect(content).toContain("sync-integration-branch.yml");
    expect(content).toContain("Automated integration branch synchronization");
    expect(content).toContain("Self-Retiring Guard");
    expect(content).toContain("Conflict Escalation Protocol");
  });
});
