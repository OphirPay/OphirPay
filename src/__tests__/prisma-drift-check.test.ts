// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseSchema,
  replaySql,
  verifyPrismaDrift,
} from "../../scripts/verify-prisma-drift.mjs";

const SCHEMA_PATH = join(process.cwd(), "prisma", "schema.prisma");

describe("Prisma migration drift CI gate (#1308)", () => {
  it("verifies zero drift between committed prisma/schema.prisma and prisma/migrations/", () => {
    const result = verifyPrismaDrift();
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.tableCount).toBeGreaterThanOrEqual(16);
    expect(result.enumCount).toBeGreaterThanOrEqual(7);
  });

  it("replays multi-column ALTER TABLE ADD COLUMN statements accurately", () => {
    const state = { tables: { WebhookDelivery: { id: "TEXT" } }, enums: {} };
    replaySql(
      `ALTER TABLE "WebhookDelivery" ADD COLUMN "test" BOOLEAN NOT NULL DEFAULT false,
       ADD COLUMN "targetUrl" TEXT,
       ADD COLUMN "durationMs" INTEGER;`,
      state,
    );

    expect(state.tables.WebhookDelivery).toEqual({
      id: "TEXT",
      test: "BOOLEAN",
      targetUrl: "TEXT",
      durationMs: "INTEGER",
    });
  });

  it("strips inline comments on CRLF-terminated lines in schema.prisma", () => {
    const parsed = parseSchema(
      "model Payment {\r\n  id String @id\r\n  metadata String? // JSON string for flexible metadata\r\n}\r\n",
    );
    expect(parsed.models.Payment.fields.metadata).toEqual({
      name: "metadata",
      type: "String",
      optional: true,
      isList: false,
    });
  });

  it("detects drift when a new field is added to schema.prisma without a corresponding migration", () => {
    const rawSchema = readFileSync(SCHEMA_PATH, "utf8");
    const driftedSchema = rawSchema.replace(
      "model Payment {",
      "model Payment {\n  unmigratedAuditNote String?",
    );

    const result = verifyPrismaDrift({ schemaContent: driftedSchema });
    expect(result.ok).toBe(false);
    expect(result.issues).toContain(
      "Field 'Payment.unmigratedAuditNote' is missing from migrations.",
    );
  });
});
