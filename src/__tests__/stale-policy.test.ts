// SPDX-License-Identifier: MIT
/**
 * @vitest-environment node
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

type StaleConfig = Record<string, string | boolean>;

/**
 * Returns the action step configuration for actions/stale.
 */
function staleStep() {
  const workflow = load(read(".github/workflows/stale.yml")) as {
    jobs: {
      stale: { steps: Array<{ uses?: string; with?: StaleConfig }> };
    };
  };
  const step = workflow.jobs.stale.steps.find((s) => s.uses?.startsWith("actions/stale"));
  expect(step, "no actions/stale step found").toBeTruthy();
  return step!;
}

/**
 * Parses and returns the list of exempt issue labels.
 */
function exemptLabels(): string[] {
  const withConfig = staleStep().with as StaleConfig;
  return String(withConfig["exempt-issue-labels"] ?? "")
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean);
}

describe(".github/workflows/stale.yml — bounty exemptions (issue #736)", () => {
  it("exempts the bounty and Stellar Wave labels (plus the previous exclusions and long-running epics)", () => {
    const labels = exemptLabels();
    for (const label of [
      "bounty",
      "Stellar Wave",
      "pinned",
      "security",
      "blocked",
      "good first issue",
      "help wanted",
      "long-running",
    ]) {
      expect(labels, `"${label}" is no longer exempt from staling`).toContain(label);
    }
  });

  it("never stales or closes an assigned (claimed) issue", () => {
    const withConfig = staleStep().with as StaleConfig;
    expect(withConfig["exempt-all-issue-assignees"]).toBe(true);
    expect(withConfig["exempt-all-issue-milestones"]).toBe(true);
  });

  it("keeps the documented schedule for everything else", () => {
    const withConfig = staleStep().with as StaleConfig;
    expect(withConfig["days-before-issue-stale"]).toBe(60);
    expect(withConfig["days-before-issue-close"]).toBe(14);
    expect(withConfig["days-before-pr-stale"]).toBe(30);
    expect(withConfig["days-before-pr-close"]).toBe(7);
    expect(withConfig["exempt-draft-pr"]).toBe(true);
    expect(withConfig["exempt-pr-labels"]).toBe("pinned,blocked,security");
  });

  it("runs on a weekly schedule with write permissions and supports workflow_dispatch", () => {
    const workflow = load(read(".github/workflows/stale.yml")) as {
      on?: {
        schedule?: Array<{ cron?: string }>;
        workflow_dispatch?: unknown;
      };
      permissions?: Record<string, string>;
    };
    const source = read(".github/workflows/stale.yml");
    expect(source).toMatch(/cron:\s*"0 8 \* \* 1"/);
    expect(workflow.on?.workflow_dispatch).toBeDefined();
    expect(workflow.permissions?.issues).toBe("write");
    expect(workflow.permissions?.["pull-requests"]).toBe("write");
  });
});

describe("CONTRIBUTING documents the stale policy (issue #736)", () => {
  it("explains the exemption list for maintainers", () => {
    const doc = read("CONTRIBUTING.md");
    expect(doc).toMatch(/stale workflow/i);
    expect(doc).toContain("bounty");
    expect(doc).toContain("Stellar Wave");
    expect(doc).toContain("long-running");
    expect(doc).toMatch(/60 days/);
    expect(doc).toContain("exempt-issue-labels");
    expect(doc).toContain(".github/workflows/stale.yml");
    expect(doc).toContain("workflow_dispatch");
  });
});
