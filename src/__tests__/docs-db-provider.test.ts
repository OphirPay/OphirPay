import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("Database Provider Documentation and Matrix (Issue #784)", () => {
  const rootDir = path.resolve(__dirname, "../..");
  const schemaPath = path.join(rootDir, "prisma/schema.prisma");
  const migrationsDocPath = path.join(rootDir, "docs/DATABASE_SCHEMA_MIGRATIONS.md");
  const localDevDocPath = path.join(rootDir, "docs/LOCAL_DEV.md");
  const envExamplePath = path.join(rootDir, ".env.example");
  const migrationLockPath = path.join(rootDir, "prisma/migrations/migration_lock.toml");

  it("verifies prisma/schema.prisma has exactly 5 @db.Decimal(18, 7) model fields", () => {
    const schemaContent = fs.readFileSync(schemaPath, "utf-8");
    // Find all active field definitions (not in comments)
    const fieldMatches = schemaContent
      .split("\n")
      .filter((line) => !line.trim().startsWith("//") && line.includes("@db.Decimal(18, 7)"));
    expect(fieldMatches.length).toBe(5);

    // Verify each expected model contains amount Decimal @db.Decimal(18, 7)
    expect(schemaContent).toMatch(/model Payment {[\s\S]*?amount\s+Decimal\s+@db\.Decimal\(18,\s*7\)/);
    expect(schemaContent).toMatch(/model Recurrence {[\s\S]*?amount\s+Decimal\s+@db\.Decimal\(18,\s*7\)/);
    expect(schemaContent).toMatch(/model ScheduledPayment {[\s\S]*?amount\s+Decimal\s+@db\.Decimal\(18,\s*7\)/);
    expect(schemaContent).toMatch(/model PaymentRequest {[\s\S]*?amount\s+Decimal\s+@db\.Decimal\(18,\s*7\)/);
    expect(schemaContent).toMatch(/model Refund {[\s\S]*?amount\s+Decimal\s+@db\.Decimal\(18,\s*7\)/);
  });

  it("verifies migration_lock.toml enforces postgresql provider", () => {
    const lockContent = fs.readFileSync(migrationLockPath, "utf-8");
    expect(lockContent).toContain('provider = "postgresql"');
  });

  it("verifies docs/DATABASE_SCHEMA_MIGRATIONS.md documents provider matrix, differences, and commands", () => {
    const doc = fs.readFileSync(migrationsDocPath, "utf-8");

    // Section title
    expect(doc).toContain("PostgreSQL vs. SQLite Provider Comparison & Limitations");

    // Supported matrix
    expect(doc).toContain("Supported Provider Matrix");
    expect(doc).toContain("PostgreSQL only");
    expect(doc).toContain("SQLITE_BUSY");

    // Concurrency & Locking
    expect(doc).toContain("MVCC");
    expect(doc).toContain("row-level lock");

    // Decimal precision
    expect(doc).toContain("Decimal Precision");
    expect(doc).toContain("Payment.amount");
    expect(doc).toContain("Recurrence.amount");
    expect(doc).toContain("ScheduledPayment.amount");
    expect(doc).toContain("PaymentRequest.amount");
    expect(doc).toContain("Refund.amount");

    // Enums
    expect(doc).toContain("CREATE TYPE");

    // Migration command matrix
    expect(doc).toContain("npx prisma migrate deploy");
    expect(doc).toContain("npx prisma db push");
    expect(doc).toContain("Zero (0) of the migrations apply cleanly on SQLite");

    // Data movement
    expect(doc).toContain("Moving Data Between PostgreSQL and SQLite");
    expect(doc).toContain("npm run db:seed");

    // Fresh setup paths
    expect(doc).toContain("Recommended Fresh Local Setup Paths");
  });

  it("verifies docs/LOCAL_DEV.md documents dropping all 5 @db.Decimal annotations and links to migrations guide", () => {
    const doc = fs.readFileSync(localDevDocPath, "utf-8");
    expect(doc).toContain("Drop all five `@db.Decimal(18, 7)` annotations");
    expect(doc).toContain("Payment.amount");
    expect(doc).toContain("Recurrence.amount");
    expect(doc).toContain("ScheduledPayment.amount");
    expect(doc).toContain("PaymentRequest.amount");
    expect(doc).toContain("Refund.amount");
    expect(doc).toContain("docs/DATABASE_SCHEMA_MIGRATIONS.md");
  });

  it("verifies .env.example explains PostgreSQL and SQLite workflows and links to migrations guide", () => {
    const envExample = fs.readFileSync(envExamplePath, "utf-8");
    expect(envExample).toContain("DATABASE_PROVIDER=postgresql");
    expect(envExample).toContain("SQLite is supported for local dev only");
    expect(envExample).toContain("npx prisma db push");
    expect(envExample).toContain("docs/DATABASE_SCHEMA_MIGRATIONS.md");
  });
});
