// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("Disaster Recovery and Restore Drill Conformance", () => {
  const repoRoot = path.resolve(__dirname, "../..");
  const drDocPath = path.join(repoRoot, "docs/DISASTER_RECOVERY.md");
  const backupWorkflowPath = path.join(repoRoot, ".github/workflows/db-backup.yml");
  const restoreScriptPath = path.join(repoRoot, "scripts/restore-drill.sh");
  const schemaPath = path.join(repoRoot, "prisma/schema.prisma");
  const deploymentDocPath = path.join(repoRoot, "docs/DEPLOYMENT.md");

  it("docs/DISASTER_RECOVERY.md exists and is documented comprehensively", () => {
    expect(fs.existsSync(drDocPath)).toBe(true);
    const content = fs.readFileSync(drDocPath, "utf-8");
    expect(content.length).toBeGreaterThan(1500);
  });

  it("explicitly documents RPO and RTO with numerical targets and derivations", () => {
    const content = fs.readFileSync(drDocPath, "utf-8");
    // RPO stated as 24 hours (nightly backup schedule)
    expect(content).toMatch(/RPO|Recovery Point Objective/i);
    expect(content).toMatch(/24\s*(hours?|h)/i);

    // RTO stated with target < 1 hour / 30–60 minutes
    expect(content).toMatch(/RTO|Recovery Time Objective/i);
    expect(content).toMatch(/(<|less than)?\s*1\s*(hour|hr)|30[–-]60\s*min/i);
  });

  it("synchronizes S3 bucket and retention policy between backup workflow and runbook", () => {
    const drContent = fs.readFileSync(drDocPath, "utf-8");
    const workflowContent = fs.readFileSync(backupWorkflowPath, "utf-8");

    // Extract bucket from workflow
    const bucketMatch = workflowContent.match(/BACKUP_BUCKET:\s*([^\s]+)/);
    expect(bucketMatch).not.toBeNull();
    const bucketName = bucketMatch![1];

    // Extract retention days from workflow
    const retentionMatch = workflowContent.match(/BACKUP_RETENTION_DAYS:\s*(\d+)/);
    expect(retentionMatch).not.toBeNull();
    const retentionDays = retentionMatch![1];

    // Check that DR doc specifies the exact bucket and retention period
    expect(drContent).toContain(bucketName);
    expect(drContent).toContain(`${retentionDays} Days`);
  });

  it("verifies scripts/restore-drill.sh table assertions match canonical Prisma models", () => {
    const scriptContent = fs.readFileSync(restoreScriptPath, "utf-8");
    const schemaContent = fs.readFileSync(schemaPath, "utf-8");

    // Extract models from Prisma schema
    const modelMatches = Array.from(schemaContent.matchAll(/^model\s+([A-Za-z0-9_]+)\s+{/gm)).map(
      (m) => m[1]
    );
    expect(modelMatches.length).toBeGreaterThan(5);

    // Extract TABLES from restore-drill.sh
    const tablesMatch = scriptContent.match(/TABLES=\(([^)]+)\)/);
    expect(tablesMatch).not.toBeNull();

    const rawTables = tablesMatch![1]
      .split(/\s+/)
      .map((t) => t.replace(/["']/g, "").trim())
      .filter(Boolean);

    expect(rawTables.length).toBeGreaterThan(0);

    // Ensure non-existent tables are not asserted
    expect(rawTables).not.toContain("Escrow");
    expect(rawTables).not.toContain("Stream");
    expect(rawTables).not.toContain("WebhookEndpoint");

    // Ensure all asserted tables exist as actual Prisma models
    for (const table of rawTables) {
      expect(
        modelMatches,
        `Table "${table}" asserted in restore-drill.sh does not exist in schema.prisma`
      ).toContain(table);
    }
  });

  it("verifies scripts/restore-drill.sh uses robust error handling and transaction controls", () => {
    const scriptContent = fs.readFileSync(restoreScriptPath, "utf-8");

    // Must set PASS=false when a query fails so drill cannot falsely pass
    expect(scriptContent).toContain("PASS=false");
    expect(scriptContent).toContain('if [[ "$PASS" == "true" ]]');

    // Must execute restore in a single transaction with ON_ERROR_STOP
    expect(scriptContent).toContain("--single-transaction");
    expect(scriptContent).toContain("ON_ERROR_STOP=1");

    // Must have a cleanup trap for ephemeral Docker containers
    expect(scriptContent).toContain("trap cleanup EXIT");
  });

  it("documents blockchain vs database reconciliation and references payment-sync.ts", () => {
    const drContent = fs.readFileSync(drDocPath, "utf-8");

    expect(drContent).toMatch(/reconciliation|reconcile/i);
    expect(drContent).toMatch(/Stellar|Soroban/i);
    expect(drContent).toContain("payment-sync.ts");
    expect(drContent).toContain("runPaymentStatusSync");
    expect(drContent).toMatch(/immutable|immutability/i);
  });

  it("explicitly flags untested and manual steps in the disaster recovery matrix", () => {
    const drContent = fs.readFileSync(drDocPath, "utf-8");

    // Matrix or section documenting manual and untested steps
    expect(drContent).toMatch(/Tested vs\.? Untested/i);
    expect(drContent).toMatch(/Untested/i);
    expect(drContent).toMatch(/Manual/i);
  });

  it("links docs/DISASTER_RECOVERY.md from docs/DEPLOYMENT.md", () => {
    const deploymentContent = fs.readFileSync(deploymentDocPath, "utf-8");
    expect(deploymentContent).toContain("DISASTER_RECOVERY.md");
  });
});
