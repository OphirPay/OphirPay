// SPDX-License-Identifier: MIT
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const E2E_WORKFLOW_PATH = path.resolve(
  process.cwd(),
  ".github/workflows/e2e-nightly.yml"
);
const DOCKER_SMOKE_WORKFLOW_PATH = path.resolve(
  process.cwd(),
  ".github/workflows/docker-smoke.yml"
);
const E2E_DOCS_PATH = path.resolve(process.cwd(), "docs/E2E_TESTING.md");
const MIGRATIONS_DIR = path.resolve(process.cwd(), "prisma/migrations");

export function validateMigrationsIntegrity(migrationsDir = MIGRATIONS_DIR) {
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Prisma migrations directory not found: ${migrationsDir}`);
  }

  const entries = fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  if (entries.length === 0) {
    throw new Error(`No Prisma migrations found in ${migrationsDir}`);
  }

  for (const folder of entries) {
    const sqlPath = path.join(migrationsDir, folder, "migration.sql");
    if (!fs.existsSync(sqlPath)) {
      throw new Error(`Missing migration.sql in directory: ${folder}`);
    }
    const content = fs.readFileSync(sqlPath, "utf8").trim();
    if (content.length === 0) {
      throw new Error(`Empty migration.sql detected in directory: ${folder}`);
    }
  }

  return entries;
}

describe("E2E and Docker smoke Prisma migration deployment (#1325)", () => {
  it("enforces prisma migrate deploy in e2e-nightly.yml and bans db push", () => {
    const content = fs.readFileSync(E2E_WORKFLOW_PATH, "utf8");
    expect(content).toContain("npx prisma migrate deploy");
    expect(content).not.toContain("prisma db push");
  });

  it("enforces prisma migrate deploy in docker-smoke.yml and bans db push", () => {
    const content = fs.readFileSync(DOCKER_SMOKE_WORKFLOW_PATH, "utf8");
    expect(content).toContain("npx prisma migrate deploy");
    expect(content).not.toContain("prisma db push");
  });

  it("documents prisma migrate deploy standard and CI behavior in docs/E2E_TESTING.md", () => {
    const content = fs.readFileSync(E2E_DOCS_PATH, "utf8");
    expect(content).toContain("npx prisma migrate deploy");
    expect(content).toContain("Database Migration & Schema Readiness");
    expect(content).toContain("prisma/migrations/");
  });

  it("successfully validates all existing Prisma migrations in the repository", () => {
    const migrations = validateMigrationsIntegrity();
    expect(migrations.length).toBeGreaterThan(0);
    expect(migrations).toContain("20260810210941_initial_migration");
  });

  it("fails fast with clear error when a migration directory is corrupted or missing migration.sql", () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "test-prisma-broken-mig-")
    );
    try {
      const badFolder = path.join(tempDir, "20261018000000_broken");
      fs.mkdirSync(badFolder, { recursive: true });

      // Missing migration.sql
      expect(() => validateMigrationsIntegrity(tempDir)).toThrow(
        /Missing migration\.sql/
      );

      // Empty migration.sql
      fs.writeFileSync(path.join(badFolder, "migration.sql"), "   \n\t  ");
      expect(() => validateMigrationsIntegrity(tempDir)).toThrow(
        /Empty migration\.sql/
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
