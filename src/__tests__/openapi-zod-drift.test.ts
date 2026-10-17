// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  extractZodObjectFields,
  verifyOpenApiDrift,
} from "../../scripts/verify-openapi-drift.mjs";

const SPEC_PATH = join(process.cwd(), "docs", "openapi.yaml");
const SCHEMAS_PATH = join(process.cwd(), "src", "lib", "validation-schemas.ts");

describe("Zod-to-OpenAPI schema drift detection CI gate (#1291)", () => {
  it("verifies zero drift between src/lib/validation-schemas.ts, API routes, and docs/openapi.yaml", () => {
    const result = verifyOpenApiDrift();
    expect(result.diffs, result.formattedReport).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("extracts Zod object fields accurately from validation-schemas.ts", () => {
    const schemasSource = readFileSync(SCHEMAS_PATH, "utf8");
    const fields = extractZodObjectFields(schemasSource, "createPaymentSchema");
    expect(fields).toEqual([
      "amount",
      "sourceAccountId",
      "destAddress",
      "assetCode",
      "assetIssuer",
      "description",
      "memo",
    ]);
  });

  it("produces an actionable diff identifying route path and field when a Zod schema drifts from docs/openapi.yaml", () => {
    const specContent = readFileSync(SPEC_PATH, "utf8");
    const schemasContent = readFileSync(SCHEMAS_PATH, "utf8");

    // Simulate adding an undocumented field `undocumentedFeeCap` to createPaymentSchema
    const driftedSchemas = schemasContent.replace(
      "export const createPaymentSchema = z.object({",
      "export const createPaymentSchema = z.object({\n  undocumentedFeeCap: z.number().optional(),",
    );

    const result = verifyOpenApiDrift({
      specContent,
      schemasContent: driftedSchemas,
      skipRouteFileScan: true,
    });

    expect(result.ok).toBe(false);
    expect(result.diffs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          routeOrSchema: "POST /api/payments",
          field: "undocumentedFeeCap",
        }),
      ]),
    );
    expect(result.formattedReport).toContain("POST /api/payments");
    expect(result.formattedReport).toContain("undocumentedFeeCap");
  });

  it("detects when docs/openapi.yaml documents a field removed from a Zod schema", () => {
    const specContent = readFileSync(SPEC_PATH, "utf8");
    const schemasContent = readFileSync(SCHEMAS_PATH, "utf8");

    const driftedSchemas = schemasContent.replace(
      "  assetIssuer: z.string().optional(),",
      "",
    );

    const result = verifyOpenApiDrift({
      specContent,
      schemasContent: driftedSchemas,
      skipRouteFileScan: true,
    });

    expect(result.ok).toBe(false);
    expect(result.diffs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          routeOrSchema: "POST /api/payments",
          field: "assetIssuer",
        }),
      ]),
    );
  });
});
