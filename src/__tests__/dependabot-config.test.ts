// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";

interface DependabotGroup {
  patterns?: string[];
  "update-types"?: string[];
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
    prefix: string;
  };
  groups?: Record<string, DependabotGroup>;
}

interface DependabotConfig {
  version: number;
  updates: DependabotUpdate[];
}

describe("Dependabot Configuration & Grouping Rules (#1415)", () => {
  const configPath = join(process.cwd(), ".github", "dependabot.yml");

  it("exists on disk", () => {
    expect(existsSync(configPath)).toBe(true);
  });

  const raw = readFileSync(configPath, "utf8");
  const config = load(raw) as DependabotConfig;

  it("is valid YAML adhering to version 2", () => {
    expect(config).toBeDefined();
    expect(config.version).toBe(2);
    expect(Array.isArray(config.updates)).toBe(true);
  });

  const npmUpdate = config.updates.find((u) => u["package-ecosystem"] === "npm");
  const ophirpayCargo = config.updates.find(
    (u) => u["package-ecosystem"] === "cargo" && u.directory === "/contracts/ophirpay"
  );
  const emitterCargo = config.updates.find(
    (u) => u["package-ecosystem"] === "cargo" && u.directory === "/contracts/emitter"
  );
  const actionsUpdate = config.updates.find(
    (u) => u["package-ecosystem"] === "github-actions"
  );

  describe("npm ecosystem updates", () => {
    it("configures npm updates on root directory", () => {
      expect(npmUpdate).toBeDefined();
      expect(npmUpdate?.directory).toBe("/");
      expect(npmUpdate?.schedule?.interval).toBe("weekly");
    });

    it("defines react-ecosystem group", () => {
      const group = npmUpdate?.groups?.["react-ecosystem"];
      expect(group).toBeDefined();
      expect(group?.patterns).toContain("next");
      expect(group?.patterns).toContain("react");
      expect(group?.patterns).toContain("react-dom");
      expect(group?.["update-types"]).toEqual(["minor", "patch"]);
    });

    it("defines dev-tools group", () => {
      const group = npmUpdate?.groups?.["dev-tools"];
      expect(group).toBeDefined();
      expect(group?.patterns).toEqual(
        expect.arrayContaining(["eslint*", "prettier*", "vitest*", "typescript"])
      );
      expect(group?.["update-types"]).toEqual(["minor", "patch"]);
    });

    it("defines utilities group", () => {
      const group = npmUpdate?.groups?.["utilities"];
      expect(group).toBeDefined();
      expect(group?.patterns).toEqual(
        expect.arrayContaining(["zod*", "date-fns*", "clsx", "tailwind-merge"])
      );
      expect(group?.["update-types"]).toEqual(["minor", "patch"]);
    });
  });

  describe("cargo ecosystem updates", () => {
    it("configures ophirpay contract updates", () => {
      expect(ophirpayCargo).toBeDefined();
      expect(ophirpayCargo?.groups?.["soroban-sdk"]).toBeDefined();
      expect(ophirpayCargo?.groups?.["rust-tooling"]).toBeDefined();
    });

    it("configures emitter contract updates", () => {
      expect(emitterCargo).toBeDefined();
      expect(emitterCargo?.groups?.["soroban-sdk"]).toBeDefined();
      expect(emitterCargo?.groups?.["rust-tooling"]).toBeDefined();
    });
  });

  describe("github-actions ecosystem updates", () => {
    it("runs monthly to reduce PR noise", () => {
      expect(actionsUpdate).toBeDefined();
      expect(actionsUpdate?.directory).toBe("/");
      expect(actionsUpdate?.schedule?.interval).toBe("monthly");
    });

    it("groups minor and patch actions updates", () => {
      const group = actionsUpdate?.groups?.["actions-all"];
      expect(group).toBeDefined();
      expect(group?.patterns).toContain("*");
      expect(group?.["update-types"]).toEqual(["minor", "patch"]);
    });
  });
});
