// SPDX-License-Identifier: MIT

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import nextConfig from "../../next.config";

describe("Bundle Size Budget Configuration (Issue #1987)", () => {
  const root = process.cwd();
  const budgetJsonPath = join(root, "bundle-budget.json");
  const nextConfigPath = join(root, "next.config.ts");
  const checkScriptPath = join(root, "scripts", "check-bundle-budget.mjs");
  const packageJsonPath = join(root, "package.json");

  describe("bundle-budget.json", () => {
    it("exists and defines initial client warning thresholds", () => {
      expect(existsSync(budgetJsonPath)).toBe(true);
      const budget = JSON.parse(readFileSync(budgetJsonPath, "utf8"));

      expect(budget.warnThresholdKb).toBe(200);
      expect(budget.maxAssetSizeKb).toBe(200);
      expect(budget.maxEntrypointSizeKb).toBe(200);
      expect(budget.defaultBudgetKb).toBeGreaterThan(0);
      expect(typeof budget.routes).toBe("object");
    });
  });

  describe("next.config.ts webpack performance budget", () => {
    it("declares webpack performance budget with 200 KB warning hints", () => {
      const content = readFileSync(nextConfigPath, "utf8");
      expect(content).toContain('import bundleBudget from "./bundle-budget.json"');
      expect(content).toContain("config.performance = {");
      expect(content).toContain('hints: "warning"');

      // Verify the webpack configuration function behavior
      expect(typeof nextConfig.webpack).toBe("function");
      type WebpackFn = NonNullable<typeof nextConfig.webpack>;
      type WebpackConfig = Parameters<WebpackFn>[0];
      type WebpackOptions = Parameters<WebpackFn>[1];

      const mockWebpackConfig = {} as WebpackConfig;
      const clientProdOptions = {
        isServer: false,
        dev: false,
      } as unknown as WebpackOptions;

      const result = nextConfig.webpack!(mockWebpackConfig, clientProdOptions);

      expect(result.performance).toBeDefined();
      expect(result.performance?.hints).toBe("warning");
      expect(result.performance?.maxAssetSize).toBe(200 * 1024);
      expect(result.performance?.maxEntrypointSize).toBe(200 * 1024);
    });

    it("does not attach performance hints during server or dev builds", () => {
      type WebpackFn = NonNullable<typeof nextConfig.webpack>;
      type WebpackConfig = Parameters<WebpackFn>[0];
      type WebpackOptions = Parameters<WebpackFn>[1];

      const mockServerConfig = {} as WebpackConfig;
      const serverOptions = {
        isServer: true,
        dev: false,
      } as unknown as WebpackOptions;
      const serverResult = nextConfig.webpack!(mockServerConfig, serverOptions);
      expect(serverResult.performance).toBeUndefined();

      const mockDevConfig = {} as WebpackConfig;
      const devOptions = {
        isServer: false,
        dev: true,
      } as unknown as WebpackOptions;
      const devResult = nextConfig.webpack!(mockDevConfig, devOptions);
      expect(devResult.performance).toBeUndefined();
    });
  });

  describe("scripts/check-bundle-budget.mjs", () => {
    it("implements warning check for chunks exceeding threshold", () => {
      expect(existsSync(checkScriptPath)).toBe(true);
      const content = readFileSync(checkScriptPath, "utf8");
      expect(content).toContain("warnThresholdKb");
      expect(content).toContain("chunkWarnings");
      expect(content).toContain("Performance Warning");
    });
  });

  describe("package.json", () => {
    it("registers bundle:check script", () => {
      const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
      expect(pkg.scripts["bundle:check"]).toBe("node scripts/check-bundle-budget.mjs");
    });
  });
});
