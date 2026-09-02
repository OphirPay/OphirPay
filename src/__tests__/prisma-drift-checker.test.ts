// SPDX-License-Identifier: MIT
//
// Unit tests for scripts/verify-prisma-drift.mjs — the no-database Prisma
// schema ⇄ migration drift checker (issue #404).

import { describe, it, expect } from "vitest";
import {
  parseSchema,
  parseMigrations,
  replaySql,
  diffSchemaAndMigrations,
} from "../../scripts/verify-prisma-drift.mjs";

// The drift checker is a plain .mjs script (no TS types); the shapes below
// are the ones it actually produces/consumes.
type Schema = {
  models: Record<string, { fields: Record<string, { type: string }> }>;
  enums: Record<string, Set<string>>;
};
type MigrationState = {
  tables: Record<string, Record<string, string>>;
  enums: Record<string, Set<string>>;
};

describe("parseSchema", () => {
  it("parses models, scalar fields, and enum references", () => {
    const schema = parseSchema(`
model User {
  id        String   @id @default(cuid())
  email     String?  @unique
  status    PaymentStatus @default(CREATED)
  payments  Payment[]
  createdAt DateTime @default(now())
}

model Payment {
  id String @id
}

enum PaymentStatus {
  CREATED
  PENDING
  COMPLETED
}
`) as Schema;
    expect(Object.keys(schema.models).sort()).toEqual(["Payment", "User"]);
    expect(Object.keys(schema.models.User.fields).sort()).toEqual([
      "createdAt",
      "email",
      "id",
      "status",
    ]);
    // Relation fields are dropped.
    expect(schema.models.User.fields.payments).toBeUndefined();
    expect(schema.models.User.fields.status.type).toBe("PaymentStatus");
    expect(schema.enums.PaymentStatus.has("COMPLETED")).toBe(true);
  });

  it("handles forward model references", () => {
    const schema = parseSchema(`
model Payment {
  id     String @id
  batch  Batch?
}
model Batch {
  id       String @id
  payments Payment[]
}
`) as Schema;
    expect(Object.keys(schema.models.Payment.fields)).toEqual(["id"]);
    expect(Object.keys(schema.models.Batch.fields)).toEqual(["id"]);
  });
});

describe("replaySql / parseMigrations", () => {
  it("replays CREATE TABLE with columns and quoted enum types", () => {
    const state: MigrationState = { tables: {}, enums: {} };
    replaySql(
      `CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'PENDING', 'COMPLETED');
       CREATE TABLE "Payment" (
         "id" TEXT NOT NULL,
         "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
         CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
       );`,
      state
    );
    expect(state.enums.PaymentStatus.has("PENDING")).toBe(true);
    expect(state.tables.Payment).toEqual({ id: "TEXT", status: "PaymentStatus" });
  });

  it("replays ALTER TABLE ADD COLUMN and ALTER COLUMN TYPE", () => {
    const state: MigrationState = {
      tables: { Payment: { amount: "DOUBLE PRECISION" } },
      enums: {},
    };
    replaySql(
      `ALTER TABLE "Payment" ADD COLUMN "onChainId" INTEGER;
       ALTER TABLE "Payment" ALTER COLUMN "amount" TYPE DECIMAL(18,7);`,
      state
    );
    expect(state.tables.Payment.onChainId).toBe("INTEGER");
    expect(state.tables.Payment.amount).toBe("DECIMAL(18,7)");
  });

  it("semicolons inside comments do not split statements", () => {
    const state: MigrationState = { tables: { Refund: {} }, enums: {} };
    replaySql(
      `-- The contract's request_refund / register_hook return a u64 id; storing it
       -- lets the UI call the correct record instead of every row.
       ALTER TABLE "Refund" ADD COLUMN "onChainId" INTEGER;`,
      state
    );
    expect(state.tables.Refund.onChainId).toBe("INTEGER");
  });

  it("replays DROP TABLE and enum value additions", () => {
    const state: MigrationState = {
      tables: { Old: { id: "TEXT" } },
      enums: { S: new Set(["A"]) },
    };
    replaySql(
      `DROP TABLE "Old";
       ALTER TYPE "S" ADD VALUE 'B';`,
      state
    );
    expect(state.tables.Old).toBeUndefined();
    expect(state.enums.S.has("B")).toBe(true);
  });

  it("sorts migration directories in order", () => {
    const dir = "__no_such_dir__";
    expect(parseMigrations(dir).tables).toEqual({});
  });
});

describe("diffSchemaAndMigrations", () => {
  it("reports no issues when schema and migrations are in sync", () => {
    const schema = parseSchema(`
model User {
  id   String @id
  name String?
}
enum E {
  A
  B
}
`) as Schema;
    const migrations: MigrationState = {
      tables: { User: { id: "TEXT", name: "TEXT" } },
      enums: { E: new Set(["A", "B"]) },
    };
    expect(diffSchemaAndMigrations(schema, migrations)).toEqual([]);
  });

  it("reports missing models, fields, enums, and enum values", () => {
    const schema = parseSchema(`
model User {
  id   String @id
  name String?
}
enum E {
  A
  B
}
`) as Schema;
    const migrations: MigrationState = { tables: {}, enums: { E: new Set(["A"]) } };
    const issues = diffSchemaAndMigrations(schema, migrations);
    expect(issues.some((i) => i.includes("Model 'User' is missing"))).toBe(true);
    expect(issues.some((i) => i.includes("missing value 'B'"))).toBe(true);
  });

  it("reports stale tables and type mismatches", () => {
    const schema = parseSchema(`
model User {
  id   String @id
  age  Int
}
`) as Schema;
    const migrations: MigrationState = {
      tables: { User: { id: "TEXT", age: "DOUBLE PRECISION" }, OldTable: { x: "TEXT" } },
      enums: {},
    };
    const issues = diffSchemaAndMigrations(schema, migrations);
    expect(issues.some((i) => i.includes("'OldTable' exists in migrations"))).toBe(true);
    expect(issues.some((i) => i.includes("'User.age' type mismatch"))).toBe(true);
  });
});
