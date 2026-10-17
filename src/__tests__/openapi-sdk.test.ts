import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
import {
  buildComponentSchemas,
  buildOperationTypeEntries,
  schemaToTypeScript,
} from "../../scripts/generate-api-client.mjs";
import {
  OphirPayClient,
  OphirPayError,
  API_OPERATIONS,
  OPERATION_BY_NAME,
  COMPONENT_SCHEMA_NAMES,
} from "../../packages/ophirpay-client/index.js";

const ROOT = process.cwd();

describe("OpenAPI TypeScript SDK generator (#1301)", () => {
  it("converts OpenAPI schema primitives, enums, refs, arrays, and objects to TypeScript", () => {
    expect(schemaToTypeScript({ type: "string" })).toBe("string");
    expect(schemaToTypeScript({ type: "integer", nullable: true })).toBe("number | null");
    expect(schemaToTypeScript({ type: ["string", "null"] })).toBe("string | null");
    expect(schemaToTypeScript({ type: "string", enum: ["PENDING", "COMPLETED"] })).toBe(
      '"PENDING" | "COMPLETED"'
    );
    expect(schemaToTypeScript({ $ref: "#/components/schemas/PaymentResponse" })).toBe(
      'OpenApiSchemas["PaymentResponse"]'
    );
    expect(
      schemaToTypeScript({
        type: "array",
        items: { $ref: "#/components/schemas/PaymentResponse" },
      })
    ).toBe('OpenApiSchemas["PaymentResponse"][]');
    expect(
      schemaToTypeScript(
        {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string" },
            amount: { type: "number" },
          },
        },
        "  "
      )
    ).toContain("id: string;");
  });

  it("extracts all component schemas and operation type entries from docs/openapi.yaml", () => {
    const spec = load(readFileSync(join(ROOT, "docs", "openapi.yaml"), "utf8")) as Record<
      string,
       unknown
    >;
    const schemas = buildComponentSchemas(spec);
    const schemaNames = schemas.map((s: { name: string }) => s.name);

    expect(schemaNames).toContain("PaymentResponse");
    expect(schemaNames).toContain("BatchResponse");
    expect(schemaNames).toContain("CreatePaymentRequest");
    expect(schemaNames).toContain("CreateBatchRequest");
    expect(schemaNames).toContain("HealthResponse");
    expect(schemaNames).toContain("ErrorResponse");
    expect(COMPONENT_SCHEMA_NAMES).toEqual(schemaNames);

    const opEntries = buildOperationTypeEntries(spec);
    expect(opEntries.length).toBe(API_OPERATIONS.length);
    const postPayments = opEntries.find((e: { name: string }) => e.name === "postApiPayments");
    expect(postPayments).toBeDefined();
    expect(postPayments?.method).toBe("POST");
    expect(postPayments?.path).toBe("/api/payments");
  });

  it("emits OpenApiSchemas and ApiOperationMap in operations.generated.d.ts", () => {
    const dts = readFileSync(
      join(ROOT, "packages", "ophirpay-client", "operations.generated.d.ts"),
      "utf8"
    );
    expect(dts).toContain("export interface OpenApiSchemas {");
    expect(dts).toContain("export interface ApiOperationMap {");
    expect(dts).toContain("export type PaymentResponse = OpenApiSchemas[\"PaymentResponse\"];");
    expect(dts).toContain("export type CreatePaymentRequest = OpenApiSchemas[\"CreatePaymentRequest\"];");
    expect(dts).toContain("export declare const COMPONENT_SCHEMA_NAMES:");
  });

  it("executes operations by generated ApiOperationName via OphirPayClient.callOperation", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          success: true,
          data: { id: "pay_99", amount: 50, assetCode: "XLM", status: "COMPLETED" },
        }),
    });

    const client = new OphirPayClient({
      baseUrl: "https://api.ophirpay.test",
      apiKey: "oph_sdk_key",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const result = await client.callOperation("getApiPaymentsId", {
      pathParams: { id: "pay_99" },
    });

    expect(result).toEqual({
      id: "pay_99",
      amount: 50,
      assetCode: "XLM",
      status: "COMPLETED",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.ophirpay.test/api/payments/pay_99");
    expect(OPERATION_BY_NAME.getApiPaymentsId.path).toBe("/api/payments/{id}");
    expect(() => client.callOperation("invalidOp" as never)).toThrow(OphirPayError);
  });

  it("registers npm run generate:sdk in package.json", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.["generate:sdk"]).toBe("node scripts/generate-api-client.mjs");
    expect(pkg.scripts?.["client:check"]).toBe("node scripts/generate-api-client.mjs --check");
  });
});
