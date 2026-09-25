// SPDX-License-Identifier: MIT
//
// Content and functional tests for database backup alerting, retention,
// freshness assertion, and failure notification policy (issue #752).

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import yaml from "js-yaml";

const root = path.resolve(__dirname, "../..");
const workflowPath = path.join(root, ".github", "workflows", "db-backup.yml");
const scriptPath = path.join(root, "scripts", "assert-backup-freshness.sh");
const restoreDrillPath = path.join(root, "scripts", "restore-drill.sh");
const drDocPath = path.join(root, "docs", "DISASTER_RECOVERY.md");

interface WorkflowYaml {
  name: string;
  on: {
    schedule?: Array<{ cron: string }>;
    workflow_dispatch?: Record<string, unknown>;
  };
  env: {
    BACKUP_BUCKET?: string;
    BACKUP_RETENTION_DAYS?: number;
    MAX_BACKUP_AGE_HOURS?: number;
  };
  permissions?: {
    issues?: string;
    contents?: string;
  };
}

describe("Database backup workflow (.github/workflows/db-backup.yml)", () => {
  it("exists and is valid YAML", () => {
    expect(existsSync(workflowPath)).toBe(true);
    const content = readFileSync(workflowPath, "utf8");
    const parsed = yaml.load(content) as WorkflowYaml;
    expect(parsed).toBeDefined();
    expect(parsed.name).toBe("Database Backup");
  });

  it("schedules daily at 03:00 UTC and provides workflow_dispatch", () => {
    const content = readFileSync(workflowPath, "utf8");
    const parsed = yaml.load(content) as WorkflowYaml;
    expect(parsed.on.schedule).toEqual([{ cron: "0 3 * * *" }]);
    expect(parsed.on.workflow_dispatch).toBeDefined();
  });

  it("defines 30-day retention and 26-hour freshness thresholds", () => {
    const content = readFileSync(workflowPath, "utf8");
    const parsed = yaml.load(content) as WorkflowYaml;
    expect(parsed.env.BACKUP_RETENTION_DAYS).toBe(30);
    expect(parsed.env.MAX_BACKUP_AGE_HOURS).toBe(26);
    expect(parsed.env.BACKUP_BUCKET).toBe("ophirpay-backups");
  });

  it("configures issues:write permissions for automated failure issue tracking", () => {
    const content = readFileSync(workflowPath, "utf8");
    const parsed = yaml.load(content) as WorkflowYaml;
    expect(parsed.permissions).toBeDefined();
    expect(parsed.permissions?.issues).toBe("write");
  });

  it("includes an explicit freshness assertion step using scripts/assert-backup-freshness.sh", () => {
    const content = readFileSync(workflowPath, "utf8");
    expect(content).toMatch(/assert-backup-freshness\.sh/);
    expect(content).toMatch(/--bucket "\$\{BACKUP_BUCKET\}"/);
    expect(content).toMatch(/--max-age-hours "\$\{MAX_BACKUP_AGE_HOURS\}"/);
  });

  it("includes a visible failure notification step that reports to Slack and creates/updates GitHub tracking issues", () => {
    const content = readFileSync(workflowPath, "utf8");
    expect(content).toMatch(/name:\s*Notify on failure/);
    expect(content).toMatch(/if:\s*failure\(\)/);
    expect(content).toMatch(/SLACK_WEBHOOK_URL/);
    expect(content).toMatch(/gh issue list/);
    expect(content).toMatch(/gh issue create/);
    expect(content).toMatch(/gh issue comment/);
    expect(content).toMatch(/\[Incident\] Automated Database Backup Failure/);
  });
});

describe("Backup freshness script (scripts/assert-backup-freshness.sh)", () => {
  it("exists and is marked executable", () => {
    expect(existsSync(scriptPath)).toBe(true);
    const mode = statSync(scriptPath).mode;
    expect(mode & 0o111).toBeGreaterThan(0);
  });

  it("passes when the newest backup is within the freshness threshold", () => {
    const tmpListing = path.join(root, "temp-mock-listing-pass.txt");
    try {
      writeFileSync(
        tmpListing,
        "2026-09-25 03:00:00   1024 ophirpay-2026-09-25T03-00-00Z.sql.gz\n"
      );
      // 10 hours later
      const nowEpoch = 1790341200; // 2026-09-25T13:00:00Z
      const stdout = execFileSync("bash", [
        scriptPath,
        "--mock-listing",
        tmpListing,
        "--now-epoch",
        String(nowEpoch),
        "--max-age-hours",
        "26",
      ], { encoding: "utf8" });

      expect(stdout).toMatch(/assertion PASSED/);
      expect(stdout).toMatch(/ophirpay-2026-09-25T03-00-00Z\.sql\.gz/);
    } finally {
      if (existsSync(tmpListing)) {
        unlinkSync(tmpListing);
      }
    }
  });

  it("fails when the newest backup is older than the max allowed age", () => {
    const tmpListing = path.join(root, "temp-mock-listing-stale.txt");
    try {
      writeFileSync(
        tmpListing,
        "2026-09-25 03:00:00   1024 ophirpay-2026-09-25T03-00-00Z.sql.gz\n"
      );
      // 30 hours later
      const nowEpoch = 1790413200; // 2026-09-26T09:00:00Z
      expect(() => {
        execFileSync("bash", [
          scriptPath,
          "--mock-listing",
          tmpListing,
          "--now-epoch",
          String(nowEpoch),
          "--max-age-hours",
          "26",
        ], { encoding: "utf8" });
      }).toThrow();
    } finally {
      if (existsSync(tmpListing)) {
        unlinkSync(tmpListing);
      }
    }
  });

  it("fails when no backup files exist in the listing", () => {
    const tmpListing = path.join(root, "temp-mock-listing-empty.txt");
    try {
      writeFileSync(tmpListing, "2026-09-25 03:00:00  OTHER_FILE.txt\n");
      expect(() => {
        execFileSync("bash", [
          scriptPath,
          "--mock-listing",
          tmpListing,
          "--max-age-hours",
          "26",
        ], { encoding: "utf8" });
      }).toThrow();
    } finally {
      if (existsSync(tmpListing)) {
        unlinkSync(tmpListing);
      }
    }
  });
});

describe("scripts/restore-drill.sh integration", () => {
  it("executes the freshness assertion before restoring", () => {
    const drillScript = readFileSync(restoreDrillPath, "utf8");
    expect(drillScript).toMatch(/assert-backup-freshness\.sh/);
    expect(drillScript).toMatch(/MAX_BACKUP_AGE_HOURS/);
  });
});

describe("Disaster recovery documentation (docs/DISASTER_RECOVERY.md)", () => {
  const doc = readFileSync(drDocPath, "utf8");

  it("documents S3 storage location and archive naming convention", () => {
    expect(doc).toMatch(/s3:\/\/\$\{BACKUP_BUCKET\}/);
    expect(doc).toMatch(/STANDARD_IA/);
    expect(doc).toMatch(/ophirpay-<YYYY-MM-DDTHH-MM-SSZ>\.sql\.gz/);
  });

  it("documents retention policy, 30 daily copies, and automated pruning", () => {
    expect(doc).toMatch(/BACKUP_RETENTION_DAYS:\s*30/);
    expect(doc).toMatch(/30\s*[Dd]ays/);
    expect(doc).toMatch(/CUTOFF=\$\(date -d "-\$\{BACKUP_RETENTION_DAYS\} days"/);
    expect(doc).toMatch(/aws s3 rm/);
  });

  it("documents freshness policy, 26-hour SLO, and freshness assertion script", () => {
    expect(doc).toMatch(/26\s*hours/i);
    expect(doc).toMatch(/Freshness is asserted rather than assumed/i);
    expect(doc).toMatch(/scripts\/assert-backup-freshness\.sh/);
  });

  it("documents failure notification path via GitHub tracking issues and Slack alerts", () => {
    expect(doc).toMatch(/\[Incident\] Automated Database Backup Failure/);
    expect(doc).toMatch(/SLACK_WEBHOOK_URL/);
    expect(doc).toMatch(/issues:\s*write/);
    expect(doc).toMatch(/gh workflow run db-backup\.yml/);
  });
});
