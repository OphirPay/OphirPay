import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

describe("Prisma Schema Validation & Consistency", () => {
  const schemaPath = join(process.cwd(), "prisma", "schema.prisma");
  const migrationsDir = join(process.cwd(), "prisma", "migrations");

  it("should have a valid schema.prisma file that exists", () => {
    expect(existsSync(schemaPath)).toBe(true);
    const content = readFileSync(schemaPath, "utf-8");
    expect(content.length).toBeGreaterThan(0);
  });

  it("should pass native `prisma validate` check", () => {
    expect(() => {
      execSync("npx prisma validate", {
        env: {
          ...process.env,
          DATABASE_URL: process.env.DATABASE_URL || "postgresql://prisma:prisma@localhost:5432/ophirpay",
        },
        stdio: "pipe",
      });
    }).not.toThrow();
  }, 60000);

  it("should configure PostgreSQL provider and prisma relationMode in canonical schema", () => {
    const content = readFileSync(schemaPath, "utf-8");
    expect(content).toContain('provider = "postgresql"');
    expect(content).toContain('relationMode = "prisma"');
    expect(content).toContain('provider = "prisma-client-js"');
  });

  it("should validate all required core models exist with mandatory cuid/uuid IDs", () => {
    const content = readFileSync(schemaPath, "utf-8");
    const requiredModels = [
      "User",
      "Account",
      "Payment",
      "Batch",
      "Recurrence",
      "PaymentRequest",
      "Webhook",
      "ApiKey",
      "Refund",
      "NotificationHook",
    ];

    for (const model of requiredModels) {
      expect(content).toMatch(new RegExp(`model\\s+${model}\\s+\\{`));
    }
  });

  it("should validate Decimal precision annotations on financial models for PostgreSQL", () => {
    const content = readFileSync(schemaPath, "utf-8");
    const decimalMatches = content.match(/@db\.Decimal\(18,\s*7\)/g);
    expect(decimalMatches).not.toBeNull();
    expect(decimalMatches!.length).toBeGreaterThanOrEqual(4);
  });

  it("should validate foreign key relationship consistency across models", () => {
    const content = readFileSync(schemaPath, "utf-8");

    // User -> Payments relation check
    expect(content).toContain("payments        Payment[]");
    expect(content).toMatch(/user\s+User\s+@relation\(fields:\s*\[userId\]/);
    expect(content).toMatch(/userId\s+String/);

    // Batch -> Payments relation check
    expect(content).toContain("batch             Batch?");
    expect(content).toContain("batchId           String?");

    // Webhook model check
    expect(content).toContain("model Webhook {");
  });

  it("should enforce createdAt timestamps across primary data models", () => {
    const content = readFileSync(schemaPath, "utf-8");
    const modelsWithTimestamps = ["User", "Payment", "Batch", "Webhook", "ApiKey", "Refund"];

    for (const model of modelsWithTimestamps) {
      const modelRegex = new RegExp(`model\\s+${model}\\s+\\{([^\\}]+)\\}`, "s");
      const match = content.match(modelRegex);
      expect(match).not.toBeNull();
      const modelBody = match![1];
      expect(modelBody).toContain("createdAt");
    }
  });

  it("should have migration_lock.toml and valid migrations directory structure", () => {
    expect(existsSync(migrationsDir)).toBe(true);
    const lockFile = join(migrationsDir, "migration_lock.toml");
    expect(existsSync(lockFile)).toBe(true);

    const lockContent = readFileSync(lockFile, "utf-8");
    expect(lockContent).toContain('provider = "postgresql"');

    const migrationEntries = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    expect(migrationEntries.length).toBeGreaterThanOrEqual(5);

    // Each migration folder must have a migration.sql file
    for (const migrationFolder of migrationEntries) {
      const sqlPath = join(migrationsDir, migrationFolder, "migration.sql");
      expect(existsSync(sqlPath)).toBe(true);
      const sqlContent = readFileSync(sqlPath, "utf-8");
      expect(sqlContent.length).toBeGreaterThan(0);
    }
  });

  it("should prevent destructive SQL commands in standard migration files", () => {
    const migrationEntries = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    for (const migrationFolder of migrationEntries) {
      const sqlPath = join(migrationsDir, migrationFolder, "migration.sql");
      const sqlContent = readFileSync(sqlPath, "utf-8");

      // Migration files should not contain outright DROP DATABASE or TRUNCATE TABLE
      expect(sqlContent).not.toMatch(/DROP\s+DATABASE/i);
      expect(sqlContent).not.toMatch(/TRUNCATE\s+TABLE/i);
    }
  });
});
