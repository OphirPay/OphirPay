// SPDX-License-Identifier: MIT
/**
 * @vitest-environment node
 *
 * Issue #1415 — Add Dependabot grouping rules in dependabot.yml to reduce PR noise.
 *
 * Verifies:
 *   • `.github/dependabot.yml` is valid v2 configuration covering `npm`,
 *     both `cargo` contract workspaces (`/contracts/ophirpay`, `/contracts/emitter`),
 *     and `github-actions`.
 *   • `npm` defines `react-ecosystem`, `dev-tools`, and `utilities` groups
 *     restricted to `["minor", "patch"]` update-types so major bumps stay
 *     isolated in individual PRs.
 *   • Both `cargo` entries define `soroban-sdk` and `rust-tooling` groups
 *     restricted to `["minor", "patch"]`.
 *   • `github-actions` runs on a `monthly` schedule with a single grouped PR
 *     for minor/patch updates.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";

interface DependabotGroup {
  patterns: string[];
  "exclude-patterns"?: string[];
  "update-types"?: string[];
}

interface DependabotUpdateEntry {
  "package-ecosystem": string;
  directory: string;
  schedule: { interval: string };
  "open-pull-requests-limit"?: number;
  labels?: string[];
  "commit-message"?: { prefix: string };
  groups?: Record<string, DependabotGroup>;
}

interface DependabotConfig {
  version: number;
  updates: DependabotUpdateEntry[];
}

const ROOT = process.cwd();
const loadDependabotConfig = (): DependabotConfig => {
  const raw = readFileSync(path.join(ROOT, ".github/dependabot.yml"), "utf8");
  return load(raw) as DependabotConfig;
};

describe(".github/dependabot.yml grouping rules (issue #1415)", () => {
  it("parses as valid Dependabot v2 YAML with npm, cargo, and github-actions ecosystems", () => {
    const config = loadDependabotConfig();
    expect(config.version).toBe(2);
    expect(Array.isArray(config.updates)).toBe(true);
    expect(config.updates.length).toBeGreaterThanOrEqual(4);
  });

  it("configures npm grouping rules for react-ecosystem, dev-tools, and utilities with minor/patch update-types", () => {
    const config = loadDependabotConfig();
    const npmEntry = config.updates.find(
      (u) => u["package-ecosystem"] === "npm" && u.directory === "/"
    );

    expect(npmEntry).toBeDefined();
    expect(npmEntry!.schedule.interval).toBe("weekly");

    const groups = npmEntry!.groups ?? {};
    expect(Object.keys(groups)).toEqual(
      expect.arrayContaining(["react-ecosystem", "dev-tools", "utilities"])
    );

    expect(groups["react-ecosystem"].patterns).toEqual(
      expect.arrayContaining(["next", "react", "react-dom", "@types/react*"])
    );
    expect(groups["react-ecosystem"]["update-types"]).toEqual(["minor", "patch"]);

    expect(groups["dev-tools"].patterns).toEqual(
      expect.arrayContaining(["eslint*", "prettier*", "vitest*", "@playwright/*"])
    );
    expect(groups["dev-tools"]["update-types"]).toEqual(["minor", "patch"]);

    expect(groups["utilities"].patterns).toEqual(
      expect.arrayContaining(["zod", "date-fns*"])
    );
    expect(groups["utilities"]["update-types"]).toEqual(["minor", "patch"]);
  });

  it("configures cargo grouping rules for soroban-sdk and rust-tooling across both contract directories", () => {
    const config = loadDependabotConfig();
    const cargoEntries = config.updates.filter(
      (u) => u["package-ecosystem"] === "cargo"
    );

    expect(cargoEntries.map((c) => c.directory)).toEqual(
      expect.arrayContaining(["/contracts/ophirpay", "/contracts/emitter"])
    );

    for (const entry of cargoEntries) {
      const groups = entry.groups ?? {};
      expect(Object.keys(groups)).toEqual(
        expect.arrayContaining(["soroban-sdk", "rust-tooling"])
      );
      expect(groups["soroban-sdk"].patterns).toContain("soroban-*");
      expect(groups["soroban-sdk"]["update-types"]).toEqual(["minor", "patch"]);
      expect(groups["rust-tooling"]["update-types"]).toEqual(["minor", "patch"]);
    }
  });

  it("configures github-actions updates on a monthly schedule with a single grouped PR", () => {
    const config = loadDependabotConfig();
    const actionsEntry = config.updates.find(
      (u) => u["package-ecosystem"] === "github-actions"
    );

    expect(actionsEntry).toBeDefined();
    expect(actionsEntry!.schedule.interval).toBe("monthly");

    const groups = actionsEntry!.groups ?? {};
    const groupKeys = Object.keys(groups);
    expect(groupKeys.length).toBe(1);
    const singleGroup = groups[groupKeys[0]!];
    expect(singleGroup.patterns).toContain("*");
    expect(singleGroup["update-types"]).toEqual(["minor", "patch"]);
  });
});
