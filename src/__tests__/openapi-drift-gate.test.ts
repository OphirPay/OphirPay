// SPDX-License-Identifier: MIT
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { load } from "js-yaml";
import {
  verifyOpenApiDrift,
  SPEC_PATH,
  ROUTE_SCHEMAS,
} from "../../scripts/verify-openapi-drift.mjs";

interface DriftItem {
  key: string;
  routePath?: string;
  method?: string;
  field?: string;
  diffType?: string;
  error: string;
}

interface DriftResult {
  passed: boolean;
  totalRoutesChecked: number;
  verifiedRoutesCount: number;
  driftCount: number;
  drifts: DriftItem[];
  verifiedRoutes: string[];
}

function runDrift(spec: Record<string, unknown>, schemas?: Record<string, unknown>): DriftResult {
  return verifyOpenApiDrift(spec, schemas) as unknown as DriftResult;
}

describe("OpenAPI-to-Zod schema drift detection CI gate (Issue #1291)", () => {
  const rawSpec = readFileSync(SPEC_PATH, "utf8");
  const committedSpec = load(rawSpec) as Record<string, unknown>;

  it("committed docs/openapi.yaml passes all route schema drift checks with 0 drifts", () => {
    const result = runDrift(committedSpec, ROUTE_SCHEMAS);
    expect(result.passed).toBe(true);
    expect(result.driftCount).toBe(0);
    expect(result.drifts).toEqual([]);
    expect(result.verifiedRoutesCount).toBe(Object.keys(ROUTE_SCHEMAS).length);
  });

  it("detects drift when a Zod field is missing from the OpenAPI specification", () => {
    // Clone spec and delete 'amount' from CreatePaymentRequest
    const modifiedSpec = JSON.parse(JSON.stringify(committedSpec)) as Record<string, unknown>;
    const components = modifiedSpec.components as Record<string, unknown>;
    const schemas = components.schemas as Record<string, unknown>;
    const createPayment = schemas.CreatePaymentRequest as Record<string, unknown>;
    const props = createPayment.properties as Record<string, unknown>;
    delete props.amount;

    const result = runDrift(modifiedSpec, {
      "POST /api/payments": (ROUTE_SCHEMAS as Record<string, unknown>)["POST /api/payments"],
    });

    expect(result.passed).toBe(false);
    expect(result.driftCount).toBeGreaterThan(0);
    const drift = result.drifts.find((d) => d.field === "amount");
    expect(drift).toBeDefined();
    expect(drift?.diffType).toBe("missing_in_spec");
    expect(drift?.error).toContain('Field "amount" is defined in Zod schema but missing in OpenAPI spec');
  });

  it("detects required vs optional drift when a field required by Zod is optional in OpenAPI", () => {
    const modifiedSpec = JSON.parse(JSON.stringify(committedSpec)) as Record<string, unknown>;
    const components = modifiedSpec.components as Record<string, unknown>;
    const schemas = components.schemas as Record<string, unknown>;
    const createPayment = schemas.CreatePaymentRequest as Record<string, unknown>;
    createPayment.required = ["sourceAccountId", "destAddress"];

    const result = runDrift(modifiedSpec, {
      "POST /api/payments": (ROUTE_SCHEMAS as Record<string, unknown>)["POST /api/payments"],
    });

    expect(result.passed).toBe(false);
    const drift = result.drifts.find((d) => d.field === "amount" && d.diffType === "required_mismatch");
    expect(drift).toBeDefined();
    expect(drift?.error).toContain('Field "amount" is required in Zod schema but optional in OpenAPI spec');
  });

  it("detects required vs optional drift when an optional Zod field is marked required in OpenAPI", () => {
    const modifiedSpec = JSON.parse(JSON.stringify(committedSpec)) as Record<string, unknown>;
    const components = modifiedSpec.components as Record<string, unknown>;
    const schemas = components.schemas as Record<string, unknown>;
    const createPayment = schemas.CreatePaymentRequest as Record<string, unknown>;
    const required = createPayment.required as string[];
    required.push("description");

    const result = runDrift(modifiedSpec, {
      "POST /api/payments": (ROUTE_SCHEMAS as Record<string, unknown>)["POST /api/payments"],
    });

    expect(result.passed).toBe(false);
    const drift = result.drifts.find((d) => d.field === "description" && d.diffType === "required_mismatch");
    expect(drift).toBeDefined();
    expect(drift?.error).toContain('Field "description" is optional in Zod schema but marked required in OpenAPI spec');
  });

  it("detects data type mismatches between Zod schema and OpenAPI spec", () => {
    const modifiedSpec = JSON.parse(JSON.stringify(committedSpec)) as Record<string, unknown>;
    const components = modifiedSpec.components as Record<string, unknown>;
    const schemas = components.schemas as Record<string, unknown>;
    const createPayment = schemas.CreatePaymentRequest as Record<string, unknown>;
    const props = createPayment.properties as Record<string, unknown>;
    const amountProp = props.amount as Record<string, unknown>;
    amountProp.type = "boolean";

    const result = runDrift(modifiedSpec, {
      "POST /api/payments": (ROUTE_SCHEMAS as Record<string, unknown>)["POST /api/payments"],
    });

    expect(result.passed).toBe(false);
    const drift = result.drifts.find((d) => d.field === "amount" && d.diffType === "type_mismatch");
    expect(drift).toBeDefined();
    expect(drift?.error).toContain("Zod expects number, OpenAPI defines boolean");
  });

  it("detects enum member drift when Zod accepts values not documented in OpenAPI", () => {
    const modifiedSpec = JSON.parse(JSON.stringify(committedSpec)) as Record<string, unknown>;
    const paths = modifiedSpec.paths as Record<string, unknown>;
    const paymentItem = paths["/api/payments/{id}"] as Record<string, unknown>;
    const patchOp = paymentItem.patch as Record<string, unknown>;
    const reqBody = patchOp.requestBody as Record<string, unknown>;
    const content = reqBody.content as Record<string, unknown>;
    const appJson = content["application/json"] as Record<string, unknown>;
    const schema = appJson.schema as Record<string, unknown>;
    const props = schema.properties as Record<string, unknown>;
    const statusProp = props.status as { enum: string[] };
    statusProp.enum = statusProp.enum.filter((v: string) => v !== "SIGNED");

    const result = runDrift(modifiedSpec, {
      "PATCH /api/payments/{id}": (ROUTE_SCHEMAS as Record<string, unknown>)["PATCH /api/payments/{id}"],
    });

    expect(result.passed).toBe(false);
    const drift = result.drifts.find((d) => d.diffType === "enum_mismatch");
    expect(drift).toBeDefined();
    expect(drift?.error).toContain('Enum value "SIGNED" accepted by Zod is missing from OpenAPI enum list');
  });

  it("detects extra fields documented in OpenAPI that are not accepted by Zod", () => {
    const modifiedSpec = JSON.parse(JSON.stringify(committedSpec)) as Record<string, unknown>;
    const components = modifiedSpec.components as Record<string, unknown>;
    const schemas = components.schemas as Record<string, unknown>;
    const createPayment = schemas.CreatePaymentRequest as Record<string, unknown>;
    const props = createPayment.properties as Record<string, unknown>;
    props.unknownExtraField = { type: "string" };

    const result = runDrift(modifiedSpec, {
      "POST /api/payments": (ROUTE_SCHEMAS as Record<string, unknown>)["POST /api/payments"],
    });

    expect(result.passed).toBe(false);
    const drift = result.drifts.find((d) => d.field === "unknownExtraField" && d.diffType === "extra_in_spec");
    expect(drift).toBeDefined();
    expect(drift?.error).toContain('Field "unknownExtraField" declared in OpenAPI spec does not exist in Zod schema');
  });

  it("detects query parameter drift when validated params are missing from OpenAPI", () => {
    const modifiedSpec = JSON.parse(JSON.stringify(committedSpec)) as Record<string, unknown>;
    const paths = modifiedSpec.paths as Record<string, unknown>;
    const analytics = paths["/api/analytics"] as Record<string, unknown>;
    const getOp = analytics.get as Record<string, unknown>;
    const params = getOp.parameters as Array<{ name: string }>;
    getOp.parameters = params.filter((p) => p.name !== "days");

    const result = runDrift(modifiedSpec, {
      "GET /api/analytics": (ROUTE_SCHEMAS as Record<string, unknown>)["GET /api/analytics"],
    });

    expect(result.passed).toBe(false);
    const drift = result.drifts.find((d) => d.field === "days" && d.diffType === "missing_param_in_spec");
    expect(drift).toBeDefined();
    expect(drift?.error).toContain('Query parameter "days" validated by Zod is missing from OpenAPI parameters');
  });
});
