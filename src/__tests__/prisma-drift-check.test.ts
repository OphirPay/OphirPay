import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import { join } from "path";
import {
  parseSchema,
  replaySql,
  diffSchemaAndMigrations,
  verifyPrismaDrift,
} from "../../scripts/verify-prisma-drift.mjs";

interface ParsedField {
  name: string;
  type: string;
  optional: boolean;
  isList: boolean;
}

interface ParsedModel {
  fields: Record<string, ParsedField>;
}

interface ParsedSchema {
  models: Record<string, ParsedModel>;
  enums: Record<string, Set<string>>;
}

interface MigrationState {
  tables: Record<string, Record<string, string>>;
  enums: Record<string, Set<string>>;
}

interface DriftResult {
  ok: boolean;
  issues: string[];
  schema: ParsedSchema;
  migrationState: MigrationState;
}

describe("Prisma Static Migration Drift Gate (#1308)", () => {
  describe("parseSchema", () => {
    it("correctly parses models, enums and ignores inline CRLF comments", () => {
      const sampleSchema = `
        datasource db {
          provider = "postgresql"
          url      = env("DATABASE_URL")
        }

        enum PaymentStatus {
          PENDING
          COMPLETED
          FAILED
        }

        model User {
          id        String   @id @default(cuid())
          email     String   @unique
          payments  Payment[]
          createdAt DateTime @default(now())
        }

        model Payment {
          id          String        @id @default(cuid())
          amount      Decimal       @db.Decimal(18, 7)
          status      PaymentStatus
          metadata    String?       // JSON string for flexible metadata\r
          userId      String
          user        User          @relation(fields: [userId], references: [id])
          tags        String[]
        }
      `;

      const parsed = parseSchema(sampleSchema) as ParsedSchema;
      expect(parsed.enums.PaymentStatus).toBeDefined();
      expect(Array.from(parsed.enums.PaymentStatus)).toEqual([
        "PENDING",
        "COMPLETED",
        "FAILED",
      ]);

      expect(parsed.models.User).toBeDefined();
      expect(parsed.models.User.fields.email).toEqual({
        name: "email",
        type: "String",
        optional: false,
        isList: false,
      });
      // Relation fields pointing to another model are filtered out
      expect(parsed.models.User.fields.payments).toBeUndefined();

      expect(parsed.models.Payment.fields.metadata).toEqual({
        name: "metadata",
        type: "String",
        optional: true,
        isList: false,
      });
      expect(parsed.models.Payment.fields.tags).toEqual({
        name: "tags",
        type: "String",
        optional: false,
        isList: true,
      });
      expect(parsed.models.Payment.fields.user).toBeUndefined();
    });
  });

  describe("replaySql", () => {
    it("handles multi-column ADD COLUMN statements with comments and CRLF", () => {
      const state: MigrationState = { tables: {}, enums: {} };
      const sql = `
        CREATE TABLE "Invoice" (
          "id" TEXT NOT NULL,
          "total" DECIMAL(18, 7) NOT NULL
        );

        -- Add multi-column deadlines
        ALTER TABLE "Invoice"
          ADD COLUMN "recipientEmail" TEXT,
          ADD COLUMN "dueDate" TIMESTAMP(3),
          ADD COLUMN "reminderSent" BOOLEAN NOT NULL DEFAULT false;
      `;

      replaySql(sql, state);

      expect(state.tables["Invoice"]).toBeDefined();
      expect(state.tables["Invoice"]["id"]).toBe("TEXT");
      expect(state.tables["Invoice"]["total"]).toBe("DECIMAL(18, 7)");
      expect(state.tables["Invoice"]["recipientEmail"]).toBe("TEXT");
      expect(state.tables["Invoice"]["dueDate"]).toBe("TIMESTAMP(3)");
      expect(state.tables["Invoice"]["reminderSent"]).toBe("BOOLEAN");
    });

    it("handles DROP COLUMN and ALTER TYPE ADD VALUE", () => {
      const state = {
        tables: {
          Account: { id: "TEXT", legacyField: "TEXT" },
        },
        enums: {
          Role: new Set(["ADMIN"]),
        },
      };

      const sql = `
        ALTER TABLE "Account" DROP COLUMN "legacyField";
        ALTER TYPE "Role" ADD VALUE 'SUPERADMIN';
      `;

      replaySql(sql, state);

      expect(state.tables["Account"]["legacyField"]).toBeUndefined();
      expect(state.tables["Account"]["id"]).toBe("TEXT");
      expect(state.enums["Role"].has("SUPERADMIN")).toBe(true);
    });
  });

  describe("diffSchemaAndMigrations", () => {
    it("detects missing models, missing fields and enum value drift", () => {
      const schema = {
        models: {
          User: {
            fields: {
              id: { name: "id", type: "String", optional: false, isList: false },
              name: { name: "name", type: "String", optional: false, isList: false },
              role: { name: "role", type: "Role", optional: false, isList: false },
            },
          },
          MissingModel: {
            fields: {
              id: { name: "id", type: "String", optional: false, isList: false },
            },
          },
        },
        enums: {
          Role: new Set(["USER", "ADMIN", "NEW_VALUE"]),
        },
      };

      const migrationState = {
        tables: {
          User: {
            id: "TEXT",
            // missing 'name' and 'role'
          },
        },
        enums: {
          Role: new Set(["USER", "ADMIN"]), // missing 'NEW_VALUE'
        },
      };

      const issues = diffSchemaAndMigrations(schema, migrationState);

      expect(issues.some((i: string) => i.includes("MissingModel"))).toBe(true);
      expect(issues.some((i: string) => i.includes("User.name"))).toBe(true);
      expect(issues.some((i: string) => i.includes("User.role"))).toBe(true);
      expect(issues.some((i: string) => i.includes("NEW_VALUE"))).toBe(true);
    });
  });

  describe("Repository Live Verification", () => {
    it("passes static drift verification on the live repository codebase", () => {
      const result = verifyPrismaDrift() as DriftResult;
      expect(result.ok).toBe(true);
      expect(result.issues).toEqual([]);
      expect(Object.keys(result.migrationState.tables).length).toBeGreaterThanOrEqual(16);
      expect(Object.keys(result.migrationState.enums).length).toBeGreaterThanOrEqual(7);
    });

    it("verifies CLI script exit code is 0", () => {
      const scriptPath = join(process.cwd(), "scripts", "verify-prisma-drift.mjs");
      expect(() => {
        execSync(`node "${scriptPath}"`, {
          encoding: "utf-8",
          stdio: "pipe",
        });
      }).not.toThrow();
    });
  });
});
