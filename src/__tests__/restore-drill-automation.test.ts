// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

describe("Database Restore Drill Automation (#751)", () => {
  const rootDir = path.resolve(__dirname, "../..");
  const scriptPath = path.join(rootDir, "scripts/restore-drill.sh");
  const workflowPath = path.join(rootDir, ".github/workflows/db-backup.yml");
  const docsPath = path.join(rootDir, "docs/DEPLOYMENT.md");

  it("verifies scripts/restore-drill.sh exists and is executable", () => {
    expect(fs.existsSync(scriptPath)).toBe(true);
    const stats = fs.statSync(scriptPath);
    // Check executable permission (user or group or other executable bit set)
    expect(stats.mode & 0o111).toBeGreaterThan(0);
  });

  it("ensures restore drill fails loudly on non-existent backup file", () => {
    const nonexistentPath = path.join(rootDir, "nonexistent-backup-fixture.sql.gz");
    expect(() => {
      execSync(`bash "${scriptPath}" "${nonexistentPath}"`, {
        cwd: rootDir,
        stdio: "pipe",
      });
    }).toThrow();
  });

  it("ensures restore drill fails loudly on empty 0-byte backup file", () => {
    const emptyFile = path.join(rootDir, "test-empty-fixture.sql.gz");
    fs.writeFileSync(emptyFile, "");
    try {
      expect(() => {
        execSync(`bash "${scriptPath}" "${emptyFile}"`, {
          cwd: rootDir,
          stdio: "pipe",
        });
      }).toThrow();
    } finally {
      if (fs.existsSync(emptyFile)) fs.unlinkSync(emptyFile);
    }
  });

  it("ensures restore drill fails loudly on corrupted gzip backup file", () => {
    const corruptFile = path.join(rootDir, "test-corrupt-fixture.sql.gz");
    fs.writeFileSync(corruptFile, "CORRUPTED_GARBAGE_NOT_A_VALID_GZIP_ARCHIVE_DATA");
    try {
      expect(() => {
        execSync(`bash "${scriptPath}" "${corruptFile}"`, {
          cwd: rootDir,
          stdio: "pipe",
        });
      }).toThrow();
    } finally {
      if (fs.existsSync(corruptFile)) fs.unlinkSync(corruptFile);
    }
  });

  it("verifies restore drill script asserts canonical Prisma tables", () => {
    const content = fs.readFileSync(scriptPath, "utf8");
    const requiredTables = ["User", "Account", "Payment", "Batch", "PaymentRequest", "Webhook", "ApiKey"];
    for (const table of requiredTables) {
      expect(content).toContain(`"${table}"`);
    }
  });

  it("verifies restore drill script checks prisma migration status", () => {
    const content = fs.readFileSync(scriptPath, "utf8");
    expect(content).toContain("prisma migrate status");
    expect(content).toContain("ON_ERROR_STOP=1");
    expect(content).toContain("--single-transaction");
  });

  it("verifies restore drill script registers an EXIT trap for ephemeral cleanup", () => {
    const content = fs.readFileSync(scriptPath, "utf8");
    expect(content).toContain("trap cleanup EXIT");
    expect(content).toContain("docker stop");
    expect(content).toContain("docker rm");
  });

  it("verifies .github/workflows/db-backup.yml defines scheduled and on-demand restore drills", () => {
    const workflow = fs.readFileSync(workflowPath, "utf8");
    expect(workflow).toContain("restore-drill:");
    expect(workflow).toContain("cron: \"0 3 * * *\""); // Daily backup
    expect(workflow).toContain("cron: \"0 4 * * 0\""); // Weekly Sunday restore drill
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("verify_negative_drill");
    expect(workflow).toContain("bash scripts/restore-drill.sh");
  });

  it("verifies docs/DEPLOYMENT.md documents automated backup and restore drill procedures", () => {
    const docs = fs.readFileSync(docsPath, "utf8");
    expect(docs).toContain("Automated Backups & Disaster Recovery Restore Drills");
    expect(docs).toContain("scripts/restore-drill.sh");
    expect(docs).toContain("db-backup.yml");
    expect(docs).toContain("prisma migrate status");
  });
});
