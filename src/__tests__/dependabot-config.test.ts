// SPDX-License-Identifier: MIT

/**
 * Dependabot configuration and batch mode integration tests (issue #1320).
 *
 * Ensures all automated dependency updates target `integration/staging`
 * while batch mode is active, preventing them from being blocked by
 * `.github/workflows/enforce-integration-branch.yml`.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";

const root = process.cwd();
const read = (relPath: string): string => readFileSync(join(root, relPath), "utf8");

interface DependabotUpdate {
  "package-ecosystem": string;
  directory: string;
  "target-branch"?: string;
  schedule: { interval: string };
  "open-pull-requests-limit"?: number;
  labels?: string[];
  "commit-message"?: { prefix?: string };
}

interface DependabotConfig {
  version: number;
  updates: DependabotUpdate[];
}

describe("Dependabot Configuration (.github/dependabot.yml) — issue #1320", () => {
  it("exists and is valid YAML", () => {
    expect(existsSync(join(root, ".github/dependabot.yml"))).toBe(true);
    const parsed = load(read(".github/dependabot.yml")) as DependabotConfig;
    expect(parsed).toBeDefined();
    expect(parsed.version).toBe(2);
    expect(Array.isArray(parsed.updates)).toBe(true);
  });

  it("configures target-branch: integration/staging on all updates entries", () => {
    const config = load(read(".github/dependabot.yml")) as DependabotConfig;
    expect(config.updates.length).toBeGreaterThanOrEqual(4);

    for (const update of config.updates) {
      expect(
        update["target-branch"],
        `Expected ${update["package-ecosystem"]} (${update.directory}) to target 'integration/staging'`
      ).toBe("integration/staging");
    }
  });

  it("covers npm, cargo (both contracts), and github-actions ecosystems", () => {
    const config = load(read(".github/dependabot.yml")) as DependabotConfig;
    const ecosystems = config.updates.map((u) => `${u["package-ecosystem"]}:${u.directory}`);

    expect(ecosystems).toContain("npm:/");
    expect(ecosystems).toContain("cargo:/contracts/ophirpay");
    expect(ecosystems).toContain("cargo:/contracts/emitter");
    expect(ecosystems).toContain("github-actions:/");
  });

  it("has weekly schedule and chore(deps) prefix for all updates", () => {
    const config = load(read(".github/dependabot.yml")) as DependabotConfig;

    for (const update of config.updates) {
      expect(update.schedule.interval).toBe("weekly");
      expect(update["commit-message"]?.prefix).toBe("chore(deps)");
      expect(update["open-pull-requests-limit"]).toBeGreaterThan(0);
    }
  });

  it("passes the enforce-integration-branch rule for Dependabot PRs", () => {
    const config = load(read(".github/dependabot.yml")) as DependabotConfig;
    const integrationBranch = "integration/staging";

    // Simulate enforce-integration-branch.yml check:
    // Any PR with base != main passes the integration guard while batch mode is active.
    for (const update of config.updates) {
      const baseRef = update["target-branch"];
      const isBlocked = baseRef === "main";
      expect(isBlocked).toBe(false);
      expect(baseRef).toBe(integrationBranch);
    }
  });
});

describe("Documentation of Dependabot Batch Mode (CONTRIBUTING.md) — issue #1320", () => {
  it("documents batch mode target branch and switch-back procedure", () => {
    const contributing = read("CONTRIBUTING.md");
    expect(contributing).toContain("#### Batch mode & target branch");
    expect(contributing).toContain('target-branch: "integration/staging"');
    expect(contributing).toContain("enforce-integration-branch.yml");
    expect(contributing).toContain("Reverting when batch mode ends");
  });
});
