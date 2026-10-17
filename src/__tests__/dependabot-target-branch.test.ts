// SPDX-License-Identifier: MIT
/**
 * Guardrail tests for Issue #1320:
 * Ensure Dependabot PRs target `integration/staging` while batch mode is active
 * so `.github/workflows/enforce-integration-branch.yml` does not block them,
 * and verify CONTRIBUTING.md documents the switch-back procedure.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const DEPENDABOT_PATH = path.join(ROOT, ".github", "dependabot.yml");
const CONTRIBUTING_PATH = path.join(ROOT, "CONTRIBUTING.md");
const ENFORCE_BASE_WORKFLOW_PATH = path.join(
  ROOT,
  ".github",
  "workflows",
  "enforce-integration-branch.yml"
);

interface DependabotEntry {
  packageEcosystem: string;
  directory: string;
  targetBranch?: string;
}

/**
 * Minimal YAML block parser for `.github/dependabot.yml` `updates:` list items.
 */
function parseDependabotUpdates(yamlContent: string): DependabotEntry[] {
  const entries: DependabotEntry[] = [];
  const lines = yamlContent.split(/\r?\n/);
  let current: Partial<DependabotEntry> | null = null;

  for (const line of lines) {
    const ecosystemMatch = line.match(
      /^\s*-\s*package-ecosystem:\s*"?([^"#\s]+)"?/
    );
    if (ecosystemMatch) {
      if (current && current.packageEcosystem && current.directory) {
        entries.push(current as DependabotEntry);
      }
      current = { packageEcosystem: ecosystemMatch[1] };
      continue;
    }

    if (!current) continue;

    const dirMatch = line.match(/^\s+directory:\s*"?([^"#\s]+)"?/);
    if (dirMatch) {
      current.directory = dirMatch[1];
      continue;
    }

    const targetMatch = line.match(/^\s+target-branch:\s*"?([^"#\s]+)"?/);
    if (targetMatch) {
      current.targetBranch = targetMatch[1];
    }
  }

  if (current && current.packageEcosystem && current.directory) {
    entries.push(current as DependabotEntry);
  }

  return entries;
}

describe("Dependabot target-branch alignment with integration/staging (#1320)", () => {
  const dependabotYaml = readFileSync(DEPENDABOT_PATH, "utf8");
  const contributingMd = readFileSync(CONTRIBUTING_PATH, "utf8");
  const enforceBaseYaml = readFileSync(ENFORCE_BASE_WORKFLOW_PATH, "utf8");

  it("parses all four pinned Dependabot ecosystem entries", () => {
    const entries = parseDependabotUpdates(dependabotYaml);
    expect(entries).toHaveLength(4);
    expect(entries.map((e) => `${e.packageEcosystem}:${e.directory}`)).toEqual([
      "npm:/",
      "cargo:/contracts/ophirpay",
      "cargo:/contracts/emitter",
      "github-actions:/",
    ]);
  });

  it("sets target-branch: 'integration/staging' on every Dependabot updates entry", () => {
    const entries = parseDependabotUpdates(dependabotYaml);
    for (const entry of entries) {
      expect(
        entry.targetBranch,
        `Expected ${entry.packageEcosystem} (${entry.directory}) to target integration/staging`
      ).toBe("integration/staging");
    }
  });

  it("matches the integration branch enforced by .github/workflows/enforce-integration-branch.yml", () => {
    expect(enforceBaseYaml).toContain("integration/staging");
    const entries = parseDependabotUpdates(dependabotYaml);
    for (const entry of entries) {
      expect(enforceBaseYaml).toContain(entry.targetBranch!);
    }
  });

  it("documents the batch-mode target-branch, @dependabot recreate, and switch-back step in CONTRIBUTING.md", () => {
    expect(contributingMd).toContain("### Dependency Updates");
    expect(contributingMd).toContain('target-branch: "integration/staging"');
    expect(contributingMd).toContain("@dependabot recreate");
    expect(contributingMd).toMatch(/Switch-back when batch mode ends/i);
  });
});
