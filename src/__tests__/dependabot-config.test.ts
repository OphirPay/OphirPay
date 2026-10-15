// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";

interface DependabotGroup {
  patterns: string[];
  "exclude-patterns"?: string[];
  "update-types": string[];
}

interface DependabotUpdate {
  "package-ecosystem": string;
  directory: string;
  schedule: {
    interval: string;
  };
  "open-pull-requests-limit"?: number;
  labels?: string[];
  "commit-message"?: {
    prefix?: string;
  };
  groups?: Record<string, DependabotGroup>;
}

interface DependabotConfig {
  version: number;
  updates: DependabotUpdate[];
}

const repoRoot = process.cwd();
const dependabotPath = join(repoRoot, ".github", "dependabot.yml");
const config = load(readFileSync(dependabotPath, "utf8")) as DependabotConfig;

describe(".github/dependabot.yml configuration (#1415)", () => {
  it("uses version 2 schema", () => {
    expect(config.version).toBe(2);
    expect(Array.isArray(config.updates)).toBe(true);
  });

  it("configures npm ecosystem with react-ecosystem, dev-tools, and utilities groups", () => {
    const npmUpdate = config.updates.find(
      (u) => u["package-ecosystem"] === "npm" && u.directory === "/",
    );
    expect(npmUpdate).toBeDefined();
    expect(npmUpdate?.schedule.interval).toBe("weekly");

    const groups = npmUpdate?.groups;
    expect(groups).toBeDefined();
    expect(groups?.["react-ecosystem"]).toBeDefined();
    expect(groups?.["dev-tools"]).toBeDefined();
    expect(groups?.["utilities"]).toBeDefined();

    expect(groups?.["react-ecosystem"].patterns).toContain("react*");
    expect(groups?.["react-ecosystem"].patterns).toContain("next*");
    expect(groups?.["dev-tools"].patterns).toContain("eslint*");
    expect(groups?.["dev-tools"].patterns).toContain("vitest*");
    expect(groups?.["utilities"].patterns).toContain("zod*");
    expect(groups?.["utilities"].patterns).toContain("date-fns*");

    for (const group of Object.values(groups ?? {})) {
      expect(group["update-types"]).toEqual(["minor", "patch"]);
    }
  });

  it("configures cargo ecosystems with soroban-sdk and rust-tooling groups", () => {
    const cargoOphir = config.updates.find(
      (u) =>
        u["package-ecosystem"] === "cargo" &&
        u.directory === "/contracts/ophirpay",
    );
    const cargoEmitter = config.updates.find(
      (u) =>
        u["package-ecosystem"] === "cargo" &&
        u.directory === "/contracts/emitter",
    );

    for (const cargoUpdate of [cargoOphir, cargoEmitter]) {
      expect(cargoUpdate).toBeDefined();
      expect(cargoUpdate?.schedule.interval).toBe("weekly");
      const groups = cargoUpdate?.groups;
      expect(groups?.["soroban-sdk"]).toBeDefined();
      expect(groups?.["rust-tooling"]).toBeDefined();
      expect(groups?.["soroban-sdk"].patterns).toContain("soroban-sdk*");
      expect(groups?.["soroban-sdk"]["update-types"]).toEqual(["minor", "patch"]);
      expect(groups?.["rust-tooling"]["update-types"]).toEqual(["minor", "patch"]);
    }
  });

  it("configures github-actions on a monthly schedule with single grouped PR", () => {
    const actionsUpdate = config.updates.find(
      (u) =>
        u["package-ecosystem"] === "github-actions" && u.directory === "/",
    );
    expect(actionsUpdate).toBeDefined();
    expect(actionsUpdate?.schedule.interval).toBe("monthly");
    expect(actionsUpdate?.groups?.["actions"]).toBeDefined();
    expect(actionsUpdate?.groups?.["actions"].patterns).toEqual(["*"]);
    expect(actionsUpdate?.groups?.["actions"]["update-types"]).toEqual([
      "minor",
      "patch",
    ]);
  });
});
