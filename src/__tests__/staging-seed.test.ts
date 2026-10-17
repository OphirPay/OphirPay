import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseSeedProfile,
  validateSafeSeedDatabaseUrl,
  sanitizeSeedRecord,
  buildSeedDataset,
  VALID_STELLAR_PUBLIC_KEY_REGEX,
} from "../../prisma/seed";

describe("Issue #1423: Staging Database Seed & Test Data Sanitization", () => {
  it("parses seed profiles from CLI flags and environment variables", () => {
    expect(parseSeedProfile([], undefined)).toBe("staging");
    expect(parseSeedProfile(["--profile=minimal"], undefined)).toBe("minimal");
    expect(parseSeedProfile(["--profile", "load"], undefined)).toBe("load");
    expect(parseSeedProfile([], "minimal")).toBe("minimal");
    expect(() => parseSeedProfile(["--profile=invalid"])).toThrow(/Invalid seed profile/);
  });

  it("strictly rejects production DATABASE_URLs and NODE_ENV=production", () => {
    expect(
      validateSafeSeedDatabaseUrl("postgresql://prisma:prisma@localhost:5432/ophirpay_staging", "development"),
    ).toEqual({ safe: true });
    expect(validateSafeSeedDatabaseUrl("file:./dev.db", "test")).toEqual({ safe: true });

    expect(
      validateSafeSeedDatabaseUrl("postgresql://user:pass@localhost:5432/ophirpay", "production").safe,
    ).toBe(false);
    expect(
      validateSafeSeedDatabaseUrl("postgresql://user:pass@ep-prod-123.us-east-2.aws.neon.tech/neondb", "development").safe,
    ).toBe(false);
    expect(
      validateSafeSeedDatabaseUrl("postgresql://user:pass@db.prod.rds.amazonaws.com:5432/ophirpay", "development").safe,
    ).toBe(false);
    expect(
      validateSafeSeedDatabaseUrl("postgresql://postgres:pass@db.abc.supabase.co:5432/postgres", "development").safe,
    ).toBe(false);
  });

  it("sanitizes real emails to @example.test and redacts live keys and Stellar secret seeds", () => {
    const raw = {
      email: "alice.real@company.io",
      note: "Contact bob@gmail.com with key sk_live_9876543210abcdef and seed SBU2RRGLXH3E5CQHTD3ODLDF2BWDCYUSS2Z5Q5M6Z5Q5M6Z5Q5M6Z5Q5",
      webhookSecret: "whsec_live_supersecret",
    };

    const sanitized = sanitizeSeedRecord(raw);
    expect(sanitized.email).toBe("alice.real@example.test");
    expect(sanitized.note).toContain("bob@example.test");
    expect(sanitized.note).not.toContain("sk_live_");
    expect(sanitized.note).toContain("[REDACTED_STELLAR_SECRET]");
    expect(sanitized.webhookSecret).toBe("sanitized_placeholder_do_not_use");
  });

  it("generates realistic 30-day transactions, escrows, partially vested streams, and multi-sig queues with valid Testnet keys", () => {
    const refDate = new Date("2026-10-15T12:00:00.000Z");
    const dataset = buildSeedDataset("staging", refDate);

    expect(dataset.users.length).toBe(3);
    expect(dataset.payments.length).toBe(30);
    expect(dataset.escrows.length).toBe(4);
    expect(dataset.streams.length).toBe(4);
    expect(dataset.multiSigQueue.length).toBe(3);

    for (const user of dataset.users) {
      expect(user.stellarAddress).toMatch(VALID_STELLAR_PUBLIC_KEY_REGEX);
      expect(user.email.endsWith("@example.test")).toBe(true);
    }

    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const statuses = new Set(dataset.payments.map((p) => p.status));
    expect(statuses.has("COMPLETED")).toBe(true);
    expect(statuses.has("PENDING")).toBe(true);
    expect(statuses.has("FAILED")).toBe(true);
    expect(statuses.has("PROCESSING")).toBe(true);

    for (const payment of dataset.payments) {
      const ageMs = refDate.getTime() - payment.createdAt.getTime();
      expect(ageMs).toBeGreaterThanOrEqual(0);
      expect(ageMs).toBeLessThanOrEqual(thirtyDaysMs);
    }

    for (const stream of dataset.streams) {
      expect(stream.senderAddress).toMatch(VALID_STELLAR_PUBLIC_KEY_REGEX);
      expect(stream.recipientAddress).toMatch(VALID_STELLAR_PUBLIC_KEY_REGEX);
      expect(stream.vestedAmount).toBeGreaterThan(0);
      expect(stream.vestedAmount).toBeLessThan(stream.totalAmount);
    }

    for (const item of dataset.multiSigQueue) {
      expect(item.threshold).toBeGreaterThan(item.approvalsReceived);
      expect(item.status).toBe("PENDING_APPROVALS");
    }
  });

  it("includes scripts/staging-seed.sh with production database safety guards", () => {
    const scriptContent = readFileSync(resolve(process.cwd(), "scripts/staging-seed.sh"), "utf8");
    expect(scriptContent).toContain("NODE_ENV");
    expect(scriptContent).toContain(".rds.amazonaws.com");
    expect(scriptContent).toContain(".supabase.co");
    expect(scriptContent).toContain(".aws.neon.tech");
    expect(scriptContent).toContain("npx tsx prisma/seed.ts");
  });
});
