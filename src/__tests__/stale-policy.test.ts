// SPDX-License-Identifier: MIT
/**
 * @vitest-environment node
 *
 * Issue #736 — the stale bot must never close bounty / Stellar Wave work that is
 * deliberately parked until a contributor claims it, and it must never close
 * assigned (claimed) work from under whoever is doing it. Everything else keeps
 * the documented 60-day + 14-day schedule.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

type StaleConfig = Record<string, string | boolean>;

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

function exemptLabels(): string[] {
  const withConfig = staleStep().with as StaleConfig;
  return String(withConfig["exempt-issue-labels"] ?? "")
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean);
}

describe(".github/workflows/stale.yml — bounty exemptions (issue #736)", () => {
  it("exempts the bounty and Stellar Wave labels (plus the previous exclusions)", () => {
    const labels = exemptLabels();
    for (const label of [
      "bounty",
      "Stellar Wave",
      "pinned",
      "security",
      "blocked",
      "good first issue",
      "help wanted",
    ]) {
      expect(labels, `"${label}" is no longer exempt from staling`).toContain(label);
    }
  });

  it("never stales or closes an assigned (claimed) issue", () => {
    const withConfig = staleStep().with as StaleConfig;
    expect(withConfig["exempt-all-issue-assignees"]).toBe(true);
  });

  it("keeps the documented schedule for everything else", () => {
    const withConfig = staleStep().with as StaleConfig;
    expect(withConfig["days-before-issue-stale"]).toBe(60);
    expect(withConfig["days-before-issue-close"]).toBe(14);
    // PR policy is a separate, shorter clock and must not have been touched.
    expect(withConfig["days-before-pr-stale"]).toBe(30);
    expect(withConfig["days-before-pr-close"]).toBe(7);
  });

  it("still runs on a weekly schedule with write permissions for issues", () => {
    const workflow = load(read(".github/workflows/stale.yml")) as {
      permissions?: Record<string, string>;
    };
    const source = read(".github/workflows/stale.yml");
    expect(source).toMatch(/cron:\s*"0 8 \* \* 1"/);
    expect(workflow.permissions?.issues).toBe("write");
  });
});

describe("CONTRIBUTING documents the stale policy (issue #736)", () => {
  it("explains the exemption list for maintainers", () => {
    const doc = read("CONTRIBUTING.md");
    expect(doc).toMatch(/stale workflow/i);
    expect(doc).toContain("bounty");
    expect(doc).toContain("Stellar Wave");
    expect(doc).toMatch(/60 days/);
    // A maintainer adding a new long-running programme is told where to edit.
    expect(doc).toContain("exempt-issue-labels");
    expect(doc).toContain(".github/workflows/stale.yml");
  });
});
