// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { generateMockDatasets } from "../../scripts/seed-transactions";

const root = process.cwd();

describe("CI & Developer Scripts Verification", () => {
  describe("Mock Stellar Testnet Transactions Seeder (Issue #1993)", () => {
    const seedScriptPath = join(root, "scripts", "seed-transactions.ts");
    const packageJsonPath = join(root, "package.json");

    it("scripts/seed-transactions.ts exists and exports dataset generator", () => {
      expect(existsSync(seedScriptPath)).toBe(true);
      const datasets = generateMockDatasets();
      expect(datasets.payments.length).toBeGreaterThanOrEqual(5);
      expect(datasets.scheduled.length).toBeGreaterThanOrEqual(2);
    });

    it("generated mock payments cover diverse assets and memos", () => {
      const { payments, scheduled } = generateMockDatasets();
      const assets = new Set(payments.map((p) => p.assetCode));
      expect(assets.has("XLM")).toBe(true);
      expect(assets.has("USDC")).toBe(true);
      expect(assets.has("EURC")).toBe(true);

      for (const p of payments) {
        expect(p.amount).toBeDefined();
        expect(p.payerAddress).toMatch(/^G[A-Z0-9]{55}$/);
        expect(p.payeeAddress).toMatch(/^G[A-Z0-9]{55}$/);
        expect(p.memo.length).toBeGreaterThan(0);
        expect(p.status).toBeDefined();
      }

      for (const s of scheduled) {
        expect(s.destAddress).toMatch(/^G[A-Z0-9]{55}$/);
        expect(s.scheduledAt).toBeInstanceOf(Date);
        expect(s.scheduledAt.getTime()).toBeGreaterThan(Date.now());
      }
    });

    it("package.json registers seed:transactions script", () => {
      const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
      expect(pkg.scripts["seed:transactions"]).toBe("npx tsx scripts/seed-transactions.ts");
    });
  });

  describe("Playwright Smoke Tests Workflow (Issue #1994)", () => {
    const workflowPath = join(root, ".github", "workflows", "staging-smoke.yml");
    const specPath = join(root, "e2e", "smoke.spec.ts");

    it(".github/workflows/staging-smoke.yml exists with required triggers", () => {
      expect(existsSync(workflowPath)).toBe(true);
      const content = readFileSync(workflowPath, "utf8");
      expect(content).toContain("workflow_dispatch");
      expect(content).toContain("staging");
      expect(content).toContain("playwright test e2e/smoke.spec.ts");
      expect(content).toContain("upload-artifact");
    });

    it("e2e/smoke.spec.ts exists and tests health, navigation, and wallet flows", () => {
      expect(existsSync(specPath)).toBe(true);
      const content = readFileSync(specPath, "utf8");
      expect(content).toContain("/api/health");
      expect(content).toContain("/api/health/live");
      expect(content).toContain("Connect");
      expect(content).toContain("/send");
    });
  });

  describe("Soroban Contract Build & Optimization Automation (Issue #1995)", () => {
    const scriptPath = join(root, "scripts", "build-contracts.sh");
    const makefilePath = join(root, "contracts", "Makefile");

    it("scripts/build-contracts.sh exists and enforces 128 KB WASM limit", () => {
      expect(existsSync(scriptPath)).toBe(true);
      const content = readFileSync(scriptPath, "utf8");
      expect(content).toContain("MAX_WASM_SIZE=131072");
      expect(content).toContain("cargo build");
      expect(content).toContain("wasm-opt");
      expect(content).toContain("128 KB");
    });

    it("contracts/Makefile exists with standard build and optimize targets", () => {
      expect(existsSync(makefilePath)).toBe(true);
      const content = readFileSync(makefilePath, "utf8");
      expect(content).toContain("build:");
      expect(content).toContain("optimize:");
      expect(content).toContain("test:");
      expect(content).toContain("clean:");
    });
  });

  describe("Prettier Markdown & YAML Formatting Gate (Issue #1996)", () => {
    const prettierrcPath = join(root, ".prettierrc");
    const prettierignorePath = join(root, ".prettierignore");
    const ciWorkflowPath = join(root, ".github", "workflows", "ci.yml");
    const packageJsonPath = join(root, "package.json");

    it(".prettierrc and .prettierignore exist", () => {
      expect(existsSync(prettierrcPath)).toBe(true);
      expect(existsSync(prettierignorePath)).toBe(true);
      const ignoreContent = readFileSync(prettierignorePath, "utf8");
      expect(ignoreContent).toContain("helm/**/templates/**");
      expect(ignoreContent).toContain(".github/ISSUE_TEMPLATE/**");
    });

    it("package.json registers format:check and format:write scripts", () => {
      const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
      expect(pkg.scripts["format:check"]).toContain("prettier --check");
      expect(pkg.scripts["format:write"]).toContain("prettier --write");
    });

    it(".github/workflows/ci.yml includes prettier formatting verification", () => {
      const content = readFileSync(ciWorkflowPath, "utf8");
      expect(content).toContain("prettier:");
      expect(content).toContain("npm run format:check");
    });
  });
});
