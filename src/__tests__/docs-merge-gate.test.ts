import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("Merge Gate Documentation & CI Workflow Alignment (Issue #779)", () => {
  const rootDir = path.resolve(__dirname, "../..");
  const mergeGatePath = path.join(rootDir, "docs/MERGE_GATE.md");
  const contributingPath = path.join(rootDir, "CONTRIBUTING.md");
  const packageJsonPath = path.join(rootDir, "package.json");
  const workflowsDir = path.join(rootDir, ".github/workflows");

  it("verifies docs/MERGE_GATE.md exists and contains the required check table with local commands", () => {
    expect(fs.existsSync(mergeGatePath)).toBe(true);
    const content = fs.readFileSync(mergeGatePath, "utf-8");

    // Must document batch integration mode and required approvals
    expect(content).toContain("integration/staging");
    expect(content).toContain("1 approving review");

    // Must document each required check and its local command
    expect(content).toContain("npm run lint -- --max-warnings 0");
    expect(content).toContain("npm run typecheck");
    expect(content).toContain("npm test");
    expect(content).toContain("npm run build");
    expect(content).toContain("node scripts/check-bundle-budget.mjs");
    expect(content).toContain("cargo test");
    expect(content).toContain("bash scripts/validate-deploy-config.sh");
    expect(content).toContain("gitleaks detect");
    expect(content).toContain("helm lint helm/ophirpay");
    expect(content).toContain("enforce-integration-branch.yml");

    // Path-scoped checks
    expect(content).toContain("prisma-ci.yml");
    expect(content).toContain("contract-regression.yml");
    expect(content).toContain("readme-sync-check.yml");

    // Scheduled non-gating workflows
    expect(content).toContain("db-backup.yml");
    expect(content).toContain("dependency-scan.yml");
    expect(content).toContain("e2e-nightly.yml");
    expect(content).toContain("scheduled-payments-cron.yml");
    expect(content).toContain("scorecard.yml");
    expect(content).toContain("stale.yml");

    // One-command local gate
    expect(content).toContain("npm run ci");
  });

  it("verifies all workflows referenced in docs/MERGE_GATE.md exist in .github/workflows", () => {
    const content = fs.readFileSync(mergeGatePath, "utf-8");
    const workflowMatches = content.match(/[\w-]+\.ya?ml/g);
    expect(workflowMatches).not.toBeNull();

    const uniqueWorkflows = Array.from(new Set(workflowMatches));
    for (const workflow of uniqueWorkflows) {
      const workflowPath = path.join(workflowsDir, workflow);
      expect(fs.existsSync(workflowPath), `Workflow file ${workflow} should exist`).toBe(true);
    }
  });

  it("verifies CONTRIBUTING.md links to docs/MERGE_GATE.md and documents merge requirements", () => {
    const content = fs.readFileSync(contributingPath, "utf-8");
    expect(content).toContain("docs/MERGE_GATE.md");
    expect(content).toContain("Non-Gating Scheduled Workflows");
    expect(content).toContain("npm run lint -- --max-warnings 0");
    expect(content).toContain("npm run typecheck");
    expect(content).toContain("npm test");
    expect(content).toContain("npm run build");
  });

  it("verifies package.json ci script executes the documented sequence", () => {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    expect(packageJson.scripts.ci).toBeDefined();
    const ciScript = packageJson.scripts.ci;

    expect(ciScript).toContain("npm run typecheck");
    expect(ciScript).toContain("npm run lint -- --max-warnings 0");
    expect(ciScript).toContain("npm test");
    expect(ciScript).toContain("npm run build");
    expect(ciScript).toContain("scripts/validate-deploy-config.sh");
  });
});
