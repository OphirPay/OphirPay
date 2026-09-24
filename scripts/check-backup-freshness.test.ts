// SPDX-License-Identifier: MIT
//
// Exercises scripts/check-backup-freshness.sh against mocked `aws s3 ls`
// listings (BACKUP_LISTING_FILE) with a frozen clock (NOW_EPOCH), so the
// freshness policy is covered without any AWS credentials or a real bucket.

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const SCRIPT = path.join(process.cwd(), "scripts", "check-backup-freshness.sh");
// Frozen "now": 2026-09-24T12:00:00Z — the freshness job's scheduled hour.
const NOW = Math.floor(Date.parse("2026-09-24T12:00:00Z") / 1000);

function bashAvailable(): boolean {
  try {
    execFileSync("bash", ["--version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

interface Result {
  status: number;
  output: string;
}

function runCheck(listing: string, maxAgeHours = 26): Result {
  const dir = mkdtempSync(path.join(tmpdir(), "backup-freshness-"));
  const listingFile = path.join(dir, "listing.txt");
  writeFileSync(listingFile, listing);

  try {
    const output = execFileSync("bash", [SCRIPT], {
      encoding: "utf8",
      env: {
        ...process.env,
        BACKUP_LISTING_FILE: listingFile,
        BACKUP_MAX_AGE_HOURS: String(maxAgeHours),
        NOW_EPOCH: String(NOW),
      },
    });
    return { status: 0, output };
  } catch (err) {
    const e = err as { status?: number | null; stdout?: string; stderr?: string };
    return { status: e.status ?? -1, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// The shapes `aws s3 ls` prints: object rows plus "PRE" pseudo-directories.
const DECOYS = [
  "PRE scratch/",
  "2026-09-24 08:00:00         12 README.txt",
  "",
].join("\n");

const FRESH_LISTING =
  DECOYS +
  [
    "2026-09-24 07:00:11       4212 ophirpay-2026-09-24T07-00-11Z.sql.gz",
    "2026-09-23 07:00:07       4188 ophirpay-2026-09-23T07-00-07Z.sql.gz",
  ].join("\n");

const STALE_LISTING =
  DECOYS +
  [
    "2026-09-23 07:00:07       4188 ophirpay-2026-09-23T07-00-07Z.sql.gz",
    "2026-09-22 07:00:09       4100 ophirpay-2026-09-22T07-00-09Z.sql.gz",
  ].join("\n");

describe.skipIf(!bashAvailable())("scripts/check-backup-freshness.sh", () => {
  it("passes when the newest backup is within the budget", () => {
    const { status, output } = runCheck(FRESH_LISTING);
    expect(status).toBe(0);
    expect(output).toContain("✓ FRESH");
    expect(output).toContain("ophirpay-2026-09-24T07-00-11Z.sql.gz");
    expect(output).toContain("Backups found:    2");
  });

  it("fails when the newest backup is older than the budget", () => {
    const { status, output } = runCheck(STALE_LISTING);
    expect(status).toBe(1);
    expect(output).toContain("✕ STALE");
    expect(output).toContain("::error::");
  });

  it("treats a backup exactly at the budget as fresh (strictly older fails)", () => {
    const exactlyAtBudget = `${DECOYS}2026-09-23 10:00:00       4200 ophirpay-2026-09-23T10-00-00Z.sql.gz`;
    const { status, output } = runCheck(exactlyAtBudget);
    expect(status).toBe(0);
    expect(output).toContain("✓ FRESH");
  });

  it("fails when no canonical backup object exists", () => {
    const manualDump = `${DECOYS}2026-09-24 09:00:00       9000 manual-dump.sql.gz`;
    const { status, output } = runCheck(manualDump);
    expect(status).toBe(1);
    expect(output).toContain("No backup objects matching");
  });

  it("honours a custom budget", () => {
    // The newest backup in FRESH_LISTING is ~4h old; a 2h budget must fail.
    const { status, output } = runCheck(FRESH_LISTING, 2);
    expect(status).toBe(1);
    expect(output).toContain("✕ STALE");
  });
});
