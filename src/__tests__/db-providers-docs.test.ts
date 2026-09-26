// SPDX-License-Identifier: MIT
//
// Content tests for the database provider guide (issue #784).
//
// The guide's whole value is that its numbers match the repository. A guide that
// says "four annotations" while the schema has eight is worse than no guide: it
// sends a contributor away believing the job is done. So these tests read both
// the document and the files it describes, and fail when they drift apart.
//
// When a new migration with PostgreSQL-only syntax is added, or a
// @db.Decimal(18, 7) annotation is added or removed, the guide must be updated in
// the same PR — that is what the assertions below enforce.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const docPath = path.join(root, "docs", "DATABASE_PROVIDERS.md");
const schemaPath = path.join(root, "prisma", "schema.prisma");
const migrationsDir = path.join(root, "prisma", "migrations");
const localDevPath = path.join(root, "docs", "LOCAL_DEV.md");
const envExamplePath = path.join(root, ".env.example");

const doc = existsSync(docPath) ? readFileSync(docPath, "utf8") : "";
const schema = readFileSync(schemaPath, "utf8");
const localDev = readFileSync(localDevPath, "utf8");
const envExample = readFileSync(envExamplePath, "utf8");

/** Migrations whose SQL uses syntax SQLite cannot parse. */
const PG_ONLY_PATTERN = /ALTER TYPE|TEXT\[\]|JSONB|CREATE INDEX CONCURRENTLY/;

function migrationNames(): string[] {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

function pgOnlyMigrations(): string[] {
  return migrationNames().filter((name) => {
    const sqlPath = path.join(migrationsDir, name, "migration.sql");
    return existsSync(sqlPath) && PG_ONLY_PATTERN.test(readFileSync(sqlPath, "utf8"));
  });
}

function countMatches(haystack: string, needle: RegExp): number {
  return (haystack.match(needle) ?? []).length;
}

describe("docs/DATABASE_PROVIDERS.md (issue #784)", () => {
  it("exists", () => {
    expect(existsSync(docPath)).toBe(true);
  });

  it("states the supported combinations as a matrix", () => {
    expect(doc).toMatch(/## Supported combinations/);
    expect(doc).toMatch(/PostgreSQL/);
    expect(doc).toMatch(/SQLite/);
    // SQLite in production must be called out as unsupported, not left implied.
    expect(doc).toMatch(/[Nn]ot supported/);
  });

  it("warns that migrations cannot be replayed on SQLite", () => {
    expect(doc).toMatch(/prisma\/migrations/);
    expect(doc).toMatch(/db push/);
  });

  it("gives migration commands for both providers, including the deploy path", () => {
    expect(doc).toMatch(/npx prisma migrate deploy/);
    expect(doc).toMatch(/npx prisma db push/);
    expect(doc).toMatch(/npx prisma generate/);
    expect(doc).toMatch(/DIRECT_DATABASE_URL/);
  });

  it("names each PostgreSQL-only migration and the construct that makes it so", () => {
    const pgOnly = pgOnlyMigrations();
    expect(pgOnly.length).toBeGreaterThan(0);
    for (const name of pgOnly) {
      expect(doc, `${name} uses PostgreSQL-only syntax and is not named in the guide`).toContain(name);
    }
  });

  it("does not name a PostgreSQL-only migration that no longer exists", () => {
    // Guards the reverse drift: a migration is rewritten to be portable and the
    // guide keeps claiming it is PostgreSQL-only.
    const all = migrationNames();
    const named = all.filter((name) => doc.includes(name));
    const stillPgOnly = new Set(pgOnlyMigrations());
    for (const name of named) {
      expect(stillPgOnly.has(name), `${name} is named as PostgreSQL-only but its SQL is portable`).toBe(true);
    }
  });

  it("states the migration count that the repository actually has", () => {
    const total = migrationNames().length;
    expect(doc, `guide must state the real migration count (${total})`).toContain(`**${total} migrations**`);
  });

  it("states the real @db.Decimal annotation count", () => {
    const count = countMatches(schema, /@db\.Decimal\(18, 7\)/g);
    expect(count).toBeGreaterThan(0);
    // The guide spells the number as a word; map the realistic range.
    const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
    const word = words[count] ?? String(count);
    expect(doc, `guide must state the real annotation count (${count})`).toMatch(
      new RegExp(`\\b${word}\\b`)
    );
  });

  it("explains that DATABASE_PROVIDER does not select the datasource", () => {
    expect(doc).toMatch(/DATABASE_PROVIDER/);
    expect(doc).toMatch(/datasource/i);
    // The trap worth naming: setting the variable alone is not enough.
    expect(doc).toMatch(/does \*\*not\*\*|not select|alone/i);
  });

  it("calls out the behavioural differences individually", () => {
    expect(doc).toMatch(/relationMode/i);
    expect(doc).toMatch(/Decimal/);
    expect(doc).toMatch(/[Ee]num/);
  });
});

describe("provider docs stay in sync (issue #784)", () => {
  it("LOCAL_DEV.md links to the provider guide", () => {
    expect(localDev).toContain("DATABASE_PROVIDERS.md");
  });

  it(".env.example points at the provider guide", () => {
    expect(envExample).toContain("DATABASE_PROVIDERS.md");
  });

  it("no document still claims four @db.Decimal annotations", () => {
    // The committed schema has eight. The old text said four and was wrong.
    const declared = countMatches(schema, /@db\.Decimal\(18, 7\)/g);
    if (declared !== 4) {
      expect(schema, "prisma/schema.prisma still says 'four' annotations").not.toMatch(/all four/);
      expect(localDev, "docs/LOCAL_DEV.md still says 'four' annotations").not.toMatch(/all four/);
    }
  });
});
