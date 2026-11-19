// SPDX-License-Identifier: MIT

/**
 * Issue #1423 — Automated staging database seed and test data sanitization script.
 *
 * Validates:
 * 1. CLI profile parsing (--profile=staging, --profile=minimal, --profile=load).
 * 2. Production database URL safety detection and assertion guards.
 * 3. scripts/staging-seed.sh script existence, safety check definitions, and staging execution.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  parseProfile,
  isProductionDatabaseUrl,
  assertSafeDatabaseUrl,
} from "../../prisma/seed";

const repoRoot = process.cwd();
const stagingSeedScriptPath = join(repoRoot, "scripts", "staging-seed.sh");

describe("Staging Seed & Data Sanitization (issue #1423)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.SEED_PROFILE;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("Profile Argument Parsing", () => {
    it("defaults to minimal when no arguments are provided", () => {
      expect(parseProfile([])).toBe("minimal");
      expect(parseProfile(["node", "prisma/seed.ts"])).toBe("minimal");
    });

    it("parses --profile=staging flag", () => {
      expect(parseProfile(["node", "prisma/seed.ts", "--profile=staging"])).toBe(
        "staging"
      );
    });

    it("parses --profile staging flag", () => {
      expect(
        parseProfile(["node", "prisma/seed.ts", "--profile", "staging"])
      ).toBe("staging");
    });

    it("parses --profile=load flag", () => {
      expect(parseProfile(["node", "prisma/seed.ts", "--profile=load"])).toBe(
        "load"
      );
    });

    it("parses --profile=minimal flag", () => {
      expect(parseProfile(["node", "prisma/seed.ts", "--profile=minimal"])).toBe(
        "minimal"
      );
    });

    it("reads SEED_PROFILE environment variable as fallback", () => {
      process.env.SEED_PROFILE = "staging";
      expect(parseProfile([])).toBe("staging");

      process.env.SEED_PROFILE = "load";
      expect(parseProfile([])).toBe("load");
    });
  });

  describe("Production Database URL Safety Checks", () => {
    it("flags AWS RDS production URLs as unsafe", () => {
      expect(
        isProductionDatabaseUrl(
          "postgresql://admin:secret@prod-db.c123.us-east-1.rds.amazonaws.com:5432/ophirpay"
        )
      ).toBe(true);
    });

    it("flags Supabase production URLs as unsafe", () => {
      expect(
        isProductionDatabaseUrl(
          "postgresql://postgres:secret@db.xyz.supabase.co:5432/postgres"
        )
      ).toBe(true);
    });

    it("flags Neon production branches as unsafe", () => {
      expect(
        isProductionDatabaseUrl(
          "postgresql://user:pass@ep-cool-flower-123.us-east-2.aws.neon.tech/ophirpay"
        )
      ).toBe(true);
    });

    it("flags URLs with prod keywords as unsafe", () => {
      expect(
        isProductionDatabaseUrl("postgresql://user:pass@db.internal:5432/prod_db")
      ).toBe(true);
      expect(
        isProductionDatabaseUrl("postgresql://user:pass@prod.db.internal:5432/ophirpay")
      ).toBe(true);
      expect(
        isProductionDatabaseUrl("postgresql://user:pass@mainnet-db.internal:5432/live")
      ).toBe(true);
    });

    it("allows local SQLite databases", () => {
      expect(isProductionDatabaseUrl("file:./dev.db")).toBe(false);
      expect(isProductionDatabaseUrl("file:./prisma/dev.db")).toBe(false);
    });

    it("allows localhost and 127.0.0.1 PostgreSQL instances", () => {
      expect(
        isProductionDatabaseUrl("postgresql://ophirpay:ophirpay@localhost:5432/ophirpay")
      ).toBe(false);
      expect(
        isProductionDatabaseUrl("postgresql://ophirpay:ophirpay@127.0.0.1:5432/ophirpay")
      ).toBe(false);
    });

    it("allows staging-tagged cloud database URLs", () => {
      expect(
        isProductionDatabaseUrl(
          "postgresql://user:pass@staging-db.c123.us-east-1.rds.amazonaws.com:5432/staging"
        )
      ).toBe(false);
      expect(
        isProductionDatabaseUrl(
          "postgresql://user:pass@ep-staging-branch-123.us-east-2.aws.neon.tech/ophirpay_staging"
        )
      ).toBe(false);
      expect(
        isProductionDatabaseUrl(
          "postgresql://user:pass@db.staging.supabase.co:5432/staging"
        )
      ).toBe(false);
    });

    it("assertSafeDatabaseUrl throws error on production URLs and permits safe URLs", () => {
      expect(() =>
        assertSafeDatabaseUrl(
          "postgresql://admin:secret@prod-db.c123.us-east-1.rds.amazonaws.com:5432/ophirpay"
        )
      ).toThrowError(/\[SAFETY HALT\]/);

      expect(() =>
        assertSafeDatabaseUrl(
          "postgresql://ophirpay:ophirpay@localhost:5432/ophirpay"
        )
      ).not.toThrow();
    });
  });

  describe("scripts/staging-seed.sh Script Validation", () => {
    it("exists and is non-empty", () => {
      const stats = statSync(stagingSeedScriptPath);
      expect(stats.size).toBeGreaterThan(0);
    });

    it("contains bash shebang and safety checks", () => {
      const content = readFileSync(stagingSeedScriptPath, "utf8");
      expect(content).toMatch(/^#!\/usr\/bin\/env bash/);
      expect(content).toContain("set -euo pipefail");
      expect(content).toContain("SAFETY HALT");
      expect(content).toContain("--profile=staging");
    });
  });
});
