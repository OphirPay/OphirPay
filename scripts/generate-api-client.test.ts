// SPDX-License-Identifier: MIT

/**
 * Keeps `packages/ophirpay-client/operations.generated.*` in lock-step with the
 * committed OpenAPI spec (issues #822, #1301). If someone edits `docs/openapi.yaml`
 * without regenerating, this fails CI with the exact command to run.
 */

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { pascal, deriveOperationName, schemaToTs } from "./generate-api-client.mjs";

const SCRIPT = join(process.cwd(), "scripts", "generate-api-client.mjs");

describe("generated API client catalogue and typed SDK", () => {
  it("is up to date with docs/openapi.yaml", () => {
    const out = execFileSync(process.execPath, [SCRIPT, "--check"], {
      encoding: "utf8",
    });
    expect(out).toContain("up to date");
  });

  it("contains a callable operation for every spec path", () => {
    const js = readFileSync(
      join(process.cwd(), "packages", "ophirpay-client", "operations.generated.js"),
      "utf8"
    );
    expect(js).toContain("GENERATED FROM docs/openapi.yaml");
    expect(js).toMatch(/"name": "postApiPayments"/);
    expect(js).toMatch(/"name": "getApiPaymentsId"/);
    expect(js).toMatch(/"path": "\/api\/payments\/\{id\}"/);
  });

  it("exports comprehensive typed interfaces matching all 40+ API routes", () => {
    const dts = readFileSync(
      join(process.cwd(), "packages", "ophirpay-client", "operations.generated.d.ts"),
      "utf8"
    );

    // Verify Components Schemas are generated
    expect(dts).toContain("export interface AssetMetadata");
    expect(dts).toContain("export interface PaymentResponse");
    expect(dts).toContain("export interface BatchResponse");
    expect(dts).toContain("export interface ProblemDetails");

    // Verify Operation interfaces and route maps
    expect(dts).toContain("export interface OperationTypesMap");
    expect(dts).toContain("export interface OphirPayRoutes");
    expect(dts).toContain('"GET /api/payments":');
    expect(dts).toContain('"POST /api/payments":');
    expect(dts).toContain('"GET /api/health":');

    // Count route definitions in OphirPayRoutes
    const routeMatches = dts.match(/"(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD) \/api\/[^"]+":/g);
    expect(routeMatches).not.toBeNull();
    expect(routeMatches!.length).toBeGreaterThanOrEqual(40);
  });

  describe("pure helpers", () => {
    it("pascal cases segments with braces and dashes", () => {
      expect(pascal("{id}")).toBe("Id");
      expect(pascal("fee-config")).toBe("FeeConfig");
      expect(pascal("payments")).toBe("Payments");
    });

    it("derives distinct operation names", () => {
      const taken = new Set();
      const op1 = deriveOperationName("get", "/api/payments/{id}", taken);
      const op2 = deriveOperationName("get", "/api/payments/{id}", taken);
      expect(op1).toBe("getApiPaymentsId");
      expect(op2).toBe("getApiPaymentsId2");
    });

    it("converts OpenAPI schemas to TypeScript", () => {
      expect(schemaToTs({ type: "string" })).toBe("string");
      expect(schemaToTs({ type: "integer" })).toBe("number");
      expect(schemaToTs({ type: "boolean" })).toBe("boolean");
      expect(schemaToTs({ $ref: "#/components/schemas/ProblemDetails" })).toBe("ProblemDetails");
      expect(
        schemaToTs({ type: "string", enum: ["CREATED", "PENDING"] })
      ).toBe('"CREATED" | "PENDING"');
      expect(
        schemaToTs({
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        })
      ).toContain("id: string;");
    });
  });
});
