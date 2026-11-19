// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

interface DependabotGroup {
  patterns?: string[];
  "exclude-patterns"?: string[];
  "update-types"?: string[];
}

interface DependabotUpdate {
  "package-ecosystem": string;
  directory: string;
  schedule: {
    interval: string;
  };
  "open-pull-requests-limit"?: number;
  groups?: Record<string, DependabotGroup>;
  labels?: string[];
}

interface DependabotConfig {
  version: number;
  updates: DependabotUpdate[];
}

describe("Dependabot Configuration (.github/dependabot.yml)", () => {
  const configPath = path.resolve(".github/dependabot.yml");

  it("exists and parses as valid YAML", () => {
    expect(fs.existsSync(configPath)).toBe(true);
    const raw = fs.readFileSync(configPath, "utf8");
    const config = yaml.load(raw) as DependabotConfig;
    expect(config).toBeDefined();
    expect(config.version).toBe(2);
    expect(Array.isArray(config.updates)).toBe(true);
    expect(config.updates.length).toBeGreaterThanOrEqual(4);
  });

  it("configures npm grouping for react-ecosystem, dev-tools, and utilities (issue #1415)", () => {
    const raw = fs.readFileSync(configPath, "utf8");
    const config = yaml.load(raw) as DependabotConfig;
    const npmUpdate = config.updates.find((u) => u["package-ecosystem"] === "npm");

    expect(npmUpdate).toBeDefined();
    expect(npmUpdate?.groups).toBeDefined();

    const groups = npmUpdate?.groups ?? {};
    expect(groups["react-ecosystem"]).toBeDefined();
    expect(groups["react-ecosystem"].patterns).toContain("react*");
    expect(groups["react-ecosystem"].patterns).toContain("next*");

    expect(groups["dev-tools"]).toBeDefined();
    expect(groups["dev-tools"].patterns?.some((p) => p.includes("eslint"))).toBe(true);
    expect(groups["dev-tools"].patterns?.some((p) => p.includes("vitest"))).toBe(true);
    expect(groups["dev-tools"].patterns?.some((p) => p.includes("playwright"))).toBe(true);

    expect(groups["utilities"]).toBeDefined();
    expect(groups["utilities"].patterns?.some((p) => p.includes("zod"))).toBe(true);
    expect(groups["utilities"].patterns?.some((p) => p.includes("date-fns"))).toBe(true);
  });

  it("configures cargo grouping for soroban-sdk and rust-tooling (issue #1415)", () => {
    const raw = fs.readFileSync(configPath, "utf8");
    const config = yaml.load(raw) as DependabotConfig;
    const cargoUpdates = config.updates.filter((u) => u["package-ecosystem"] === "cargo");

    expect(cargoUpdates.length).toBeGreaterThanOrEqual(2);
    for (const update of cargoUpdates) {
      expect(update.groups).toBeDefined();
      expect(update.groups?.["soroban-sdk"]).toBeDefined();
      expect(update.groups?.["soroban-sdk"].patterns).toContain("soroban-sdk*");
      expect(update.groups?.["rust-tooling"]).toBeDefined();
      expect(update.groups?.["rust-tooling"]?.["exclude-patterns"]).toBeDefined();
    }
  });

  it("configures monthly schedule for GitHub Actions to minimize PR noise (issue #1415)", () => {
    const raw = fs.readFileSync(configPath, "utf8");
    const config = yaml.load(raw) as DependabotConfig;
    const ghaUpdate = config.updates.find((u) => u["package-ecosystem"] === "github-actions");

    expect(ghaUpdate).toBeDefined();
    expect(ghaUpdate?.schedule.interval).toBe("monthly");
    expect(ghaUpdate?.groups).toBeDefined();
  });
});
