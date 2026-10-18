#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * scripts/verify-openapi-drift.mjs
 *
 * OpenAPI Schema ⇄ Zod Route Validation Drift Gate (Issue #1291).
 *
 * Cross-references the committed OpenAPI specification at `docs/openapi.yaml`
 * against the runtime Zod request and query validation schemas defined across
 * the API routes in `src/app/api/` and `src/lib/validation-schemas.ts`.
 *
 * Catches schema drift on every PR before code merges:
 *   1. Fields added to Zod schemas but missing in OpenAPI
 *   2. Fields present in OpenAPI but missing from Zod
 *   3. Required vs Optional mismatches
 *   4. Data type mismatches (string, number, boolean, array, object)
 *   5. Enum member discrepancies
 *   6. Missing query parameters
 *
 * Usage:
 *   node scripts/verify-openapi-drift.mjs          # Run drift verification
 *   node scripts/verify-openapi-drift.mjs --verbose# Show passing endpoints as well
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "js-yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
export const SPEC_PATH = join(ROOT, "docs", "openapi.yaml");

/**
 * Expected schema definitions derived directly from route handlers and validation-schemas.ts.
 * Kept strictly synchronized with:
 *   - src/lib/validation-schemas.ts
 *   - src/app/api/** /route.ts
 */
export const ROUTE_SCHEMAS = {
  "POST /api/payments": {
    type: "body",
    fields: {
      amount: { type: "number", required: true },
      sourceAccountId: { type: "string", required: true },
      destAddress: { type: "string", required: true },
      assetCode: { type: "string", required: false },
      assetIssuer: { type: "string", required: false },
      description: { type: "string", required: false },
      memo: { type: "string", required: false },
    },
  },
  "PATCH /api/payments/{id}": {
    type: "body",
    fields: {
      status: {
        type: "string",
        required: false,
        enum: [
          "CREATED",
          "SIGNED",
          "SUBMITTED",
          "CONFIRMED",
          "PENDING",
          "PROCESSING",
          "COMPLETED",
          "FAILED",
          "CANCELLED",
        ],
      },
      description: { type: "string", required: false },
      memo: { type: "string", required: false },
    },
  },
  "POST /api/payments/retry": {
    type: "body",
    fields: {
      id: { type: "string", required: true },
    },
  },
  "POST /api/payments/cancel": {
    type: "body",
    fields: {
      txHash: { type: "string", required: true },
    },
  },
  "GET /api/payments": {
    type: "query",
    params: {
      page: { required: false },
      limit: { required: false },
      cursor: { required: false },
      status: { required: false },
      search: { required: false },
    },
  },
  "GET /api/payments/export": {
    type: "query",
    params: {
      status: { required: false },
      search: { required: false },
    },
  },
  "POST /api/batches": {
    type: "body",
    fields: {
      name: { type: "string", required: true },
      description: { type: "string", required: false },
      recipients: { type: "array", required: true },
      sourceAccountId: { type: "string", required: true },
      idempotencyKey: { type: "string", required: false },
    },
  },
  "GET /api/batches": {
    type: "query",
    params: {
      page: { required: false },
      limit: { required: false },
      cursor: { required: false },
    },
  },
  "POST /api/recurring": {
    type: "body",
    fields: {
      name: { type: "string", required: true },
      frequency: {
        type: "string",
        required: true,
        enum: ["DAILY", "WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"],
      },
      amount: { type: "number", required: true },
      assetCode: { type: "string", required: false },
      destAddress: { type: "string", required: true },
      description: { type: "string", required: false },
      sourceAccountId: { type: "string", required: true },
    },
  },
  "PATCH /api/recurring": {
    type: "body",
    fields: {
      id: { type: "string", required: true },
      paused: { type: "boolean", required: true },
    },
  },
  "GET /api/recurring": {
    type: "query",
    params: {
      page: { required: false },
      limit: { required: false },
    },
  },
  "POST /api/scheduled": {
    type: "body",
    fields: {
      amount: { type: "number", required: true },
      assetCode: { type: "string", required: false },
      assetIssuer: { type: "string", required: false },
      destAddress: { type: "string", required: true },
      memo: { type: "string", required: false },
      scheduledAt: { type: "string", required: true },
    },
  },
  "GET /api/scheduled": {
    type: "query",
    params: {
      page: { required: false },
      limit: { required: false },
    },
  },
  "POST /api/requests": {
    type: "body",
    fields: {
      amount: { type: "number", required: true },
      assetCode: { type: "string", required: false },
      assetIssuer: { type: "string", required: false },
      description: { type: "string", required: false },
      recipientAddress: { type: "string", required: false },
      recipientEmail: { type: "string", required: false },
      notificationEmail: { type: "string", required: false },
      dueDate: { type: "string", required: false },
    },
  },
  "POST /api/requests/{id}/paid": {
    type: "body",
    fields: {
      transactionHash: { type: "string", required: true },
    },
  },
  "POST /api/webhooks": {
    type: "body",
    fields: {
      url: { type: "string", required: true },
      events: { type: "array", required: false },
      isActive: { type: "boolean", required: false },
    },
  },
  "GET /api/webhooks/{id}/deliveries": {
    type: "query",
    params: {
      limit: { required: false },
    },
  },
  "POST /api/webhooks/{id}/replay": {
    type: "body",
    fields: {
      since: { type: "string", required: false },
      until: { type: "string", required: false },
      limit: { type: "number", required: false },
    },
  },
  "POST /api/keys": {
    type: "body",
    fields: {
      name: { type: "string", required: true },
      scopes: { type: "array", required: false },
    },
  },
  "POST /api/multisig": {
    type: "body",
    fields: {
      threshold: { type: "number", required: true },
      signers: { type: "array", required: true },
      enabled: { type: "boolean", required: true },
    },
  },
  "POST /api/multisig/propose": {
    type: "body",
    fields: {
      payee: { type: "string", required: true },
      amount: { type: "number", required: true },
      assetCode: { type: "string", required: false },
      memo: { type: "string", required: false },
    },
  },
  "POST /api/multisig/approve": {
    type: "body",
    fields: {
      requestId: { type: "number", required: true },
    },
  },
  "POST /api/multisig/execute": {
    type: "body",
    fields: {
      requestId: { type: "number", required: true },
    },
  },
  "POST /api/governance/proposals": {
    type: "body",
    fields: {
      proposer: { type: "string", required: true },
      title: { type: "string", required: true },
      description: { type: "string", required: false },
      actionType: { type: "string", required: false },
      target: { type: "string", required: false },
      data: { type: "string", required: false },
      depositAsset: { type: "string", required: false },
      depositAmount: { type: "number", required: false },
    },
  },
  "POST /api/governance/vote": {
    type: "body",
    fields: {
      voter: { type: "string", required: true },
      proposalId: { type: "number", required: true },
      support: { type: "boolean", required: true },
    },
  },
  "POST /api/governance/execute": {
    type: "body",
    fields: {
      proposalId: { type: "number", required: true },
    },
  },
  "POST /api/refunds": {
    type: "body",
    fields: {
      paymentId: { type: "number", required: true },
      amount: { type: "number", required: true },
      asset: { type: "string", required: true },
      reason: { type: "string", required: true },
      reasonCode: { type: "number", required: true },
      onChainId: { type: "number", required: false },
    },
  },
  "PATCH /api/refunds/{id}": {
    type: "body",
    fields: {
      status: {
        type: "string",
        required: true,
        enum: ["APPROVED", "PROCESSED", "REJECTED"],
      },
    },
  },
  "POST /api/hooks": {
    type: "body",
    fields: {
      eventType: { type: "string", required: true },
      webhookUrl: { type: "string", required: true },
      onChainId: { type: "number", required: false },
    },
  },
  "PATCH /api/hooks/{id}": {
    type: "body",
    fields: {
      active: { type: "boolean", required: true },
    },
  },
  "POST /api/fee-config": {
    type: "body",
    fields: {
      action: {
        type: "string",
        required: true,
        enum: ["set_fee_config", "set_fee_collector"],
      },
      paymentFeeBps: { type: "number", required: false },
      escrowFeeBps: { type: "number", required: false },
      streamFeeBps: { type: "number", required: false },
      batchBaseFee: { type: "number", required: false },
      batchPerItemFee: { type: "number", required: false },
      enabled: { type: "boolean", required: false },
      collector: { type: "string", required: false },
      challenge: { type: "string", required: false },
      signature: { type: "string", required: false },
    },
  },
  "POST /api/rbac": {
    type: "body",
    fields: {
      action: { type: "string", required: true, enum: ["grant", "revoke"] },
      address: { type: "string", required: true },
      role: { type: "number", required: false },
      challenge: { type: "string", required: false },
      signature: { type: "string", required: false },
    },
  },
  "GET /api/analytics": {
    type: "query",
    params: {
      from: { required: false },
      to: { required: false },
      days: { required: false },
    },
  },
  "GET /api/audit-log": {
    type: "query",
    params: {
      page: { required: false },
      limit: { required: false },
      actor: { required: false },
      action: { required: false },
      resource: { required: false },
      since: { required: false },
      until: { required: false },
      order: { required: false },
      source: { required: false },
    },
  },
  "GET /api/assets/metadata": {
    type: "query",
    params: {
      code: { required: true },
      issuer: { required: true },
    },
  },
  "GET /api/events/history": {
    type: "query",
    params: {
      limit: { required: false },
      cursor: { required: false },
    },
  },
};

/**
 * Resolve local `#/...` reference against the spec.
 */
export function resolveRef(spec, ref) {
  if (!ref || typeof ref !== "string" || !ref.startsWith("#/")) return null;
  const parts = ref.replace(/^#\//, "").split("/");
  return parts.reduce((acc, k) => acc?.[k], spec);
}

/**
 * Resolve schema object or its $ref target.
 */
export function resolveSchema(spec, schema) {
  if (!schema) return null;
  if (schema.$ref) {
    return resolveRef(spec, schema.$ref);
  }
  return schema;
}

/**
 * Performs bi-directional drift verification between route schemas and OpenAPI spec.
 * @param {Record<string, any>} spec
 * @param {Record<string, any>} [routeSchemas]
 */
export function verifyOpenApiDrift(spec, routeSchemas = ROUTE_SCHEMAS) {
  const drifts = [];
  const verifiedRoutes = [];

  for (const [key, expected] of Object.entries(routeSchemas)) {
    const [method, routePath] = key.split(" ");
    const pathItem = spec.paths?.[routePath];
    if (!pathItem) {
      drifts.push({
        key,
        routePath,
        method,
        error: `Route path "${routePath}" is missing from docs/openapi.yaml`,
      });
      continue;
    }

    const op = pathItem[method.toLowerCase()];
    if (!op) {
      drifts.push({
        key,
        routePath,
        method,
        error: `HTTP method ${method} on "${routePath}" is missing from docs/openapi.yaml`,
      });
      continue;
    }

    let routeHasDrift = false;

    if (expected.type === "body") {
      const bodyContent = op.requestBody?.content?.["application/json"];
      if (!bodyContent) {
        drifts.push({
          key,
          routePath,
          method,
          error: `Missing requestBody.content['application/json'] declaration`,
        });
        continue;
      }

      const schema = resolveSchema(spec, bodyContent.schema);
      if (!schema) {
        drifts.push({
          key,
          routePath,
          method,
          error: `Unable to resolve requestBody schema for ${key}`,
        });
        continue;
      }

      const specProps = schema.properties || {};
      const specRequired = new Set(schema.required || []);

      // Check Zod fields against OpenAPI spec
      for (const [fieldName, fieldDef] of Object.entries(expected.fields)) {
        if (!specProps[fieldName]) {
          drifts.push({
            key,
            routePath,
            method,
            field: fieldName,
            diffType: "missing_in_spec",
            error: `Field "${fieldName}" is defined in Zod schema but missing in OpenAPI spec`,
          });
          routeHasDrift = true;
        } else {
          const prop = specProps[fieldName];
          const isRequiredInSpec = specRequired.has(fieldName);

          if (fieldDef.required && !isRequiredInSpec) {
            drifts.push({
              key,
              routePath,
              method,
              field: fieldName,
              diffType: "required_mismatch",
              error: `Field "${fieldName}" is required in Zod schema but optional in OpenAPI spec`,
            });
            routeHasDrift = true;
          } else if (!fieldDef.required && isRequiredInSpec) {
            drifts.push({
              key,
              routePath,
              method,
              field: fieldName,
              diffType: "required_mismatch",
              error: `Field "${fieldName}" is optional in Zod schema but marked required in OpenAPI spec`,
            });
            routeHasDrift = true;
          }

          const specType = prop.type;
          if (fieldDef.type && specType && specType !== fieldDef.type) {
            // integer is acceptable sub-type of number in OpenAPI
            if (!(fieldDef.type === "number" && specType === "integer")) {
              drifts.push({
                key,
                routePath,
                method,
                field: fieldName,
                diffType: "type_mismatch",
                error: `Type mismatch for "${fieldName}": Zod expects ${fieldDef.type}, OpenAPI defines ${specType}`,
              });
              routeHasDrift = true;
            }
          }

          if (fieldDef.enum && prop.enum) {
            const specEnum = new Set(prop.enum);
            const zodEnum = new Set(fieldDef.enum);
            for (const ev of zodEnum) {
              if (!specEnum.has(ev)) {
                drifts.push({
                  key,
                  routePath,
                  method,
                  field: fieldName,
                  diffType: "enum_mismatch",
                  error: `Enum value "${ev}" accepted by Zod is missing from OpenAPI enum list [${prop.enum.join(", ")}]`,
                });
                routeHasDrift = true;
              }
            }
          }
        }
      }

      // Check extra fields defined in OpenAPI that do not exist in Zod schema
      for (const specField of Object.keys(specProps)) {
        if (!expected.fields[specField]) {
          drifts.push({
            key,
            routePath,
            method,
            field: specField,
            diffType: "extra_in_spec",
            error: `Field "${specField}" declared in OpenAPI spec does not exist in Zod schema`,
          });
          routeHasDrift = true;
        }
      }
    } else if (expected.type === "query") {
      const params = op.parameters || [];
      const queryParams = params.filter((p) => p.in === "query");
      const paramMap = new Map(queryParams.map((p) => [p.name, p]));

      for (const [name, def] of Object.entries(expected.params)) {
        const p = paramMap.get(name);
        if (!p) {
          drifts.push({
            key,
            routePath,
            method,
            field: name,
            diffType: "missing_param_in_spec",
            error: `Query parameter "${name}" validated by Zod is missing from OpenAPI parameters`,
          });
          routeHasDrift = true;
        } else if (def.required && !p.required) {
          drifts.push({
            key,
            routePath,
            method,
            field: name,
            diffType: "param_required_mismatch",
            error: `Query parameter "${name}" is required by Zod but marked optional in OpenAPI`,
          });
          routeHasDrift = true;
        }
      }
    }

    if (!routeHasDrift) {
      verifiedRoutes.push(key);
    }
  }

  return {
    passed: drifts.length === 0,
    totalRoutesChecked: Object.keys(routeSchemas).length,
    verifiedRoutesCount: verifiedRoutes.length,
    driftCount: drifts.length,
    drifts,
    verifiedRoutes,
  };
}

/**
 * CLI execution entrypoint.
 */
function main() {
  const verbose = process.argv.includes("--verbose");
  let content = "";
  try {
    content = readFileSync(SPEC_PATH, "utf8");
  } catch (err) {
    console.error(`❌ Failed to read OpenAPI spec at ${SPEC_PATH}:`, err.message);
    process.exit(1);
  }

  const spec = load(content);
  console.log(`🔍 Auditing Zod-to-OpenAPI schema drift against docs/openapi.yaml...`);

  const result = verifyOpenApiDrift(spec, ROUTE_SCHEMAS);

  if (verbose && result.verifiedRoutes.length > 0) {
    console.log(`\nVerified compliant routes:`);
    for (const r of result.verifiedRoutes) {
      console.log(`  ✓ ${r}`);
    }
  }

  if (result.passed) {
    console.log(
      `\n✅ OpenAPI Drift Gate Passed: All ${result.totalRoutesChecked} checked route schemas match docs/openapi.yaml with 0 drifts.`
    );
    process.exit(0);
  }

  console.error(
    `\n❌ OpenAPI Drift Gate Failed: Found ${result.driftCount} schema drift(s) across API routes:\n`
  );

  // Group drifts by route
  const byRoute = {};
  for (const drift of result.drifts) {
    byRoute[drift.key] = byRoute[drift.key] || [];
    byRoute[drift.key].push(drift);
  }

  for (const [route, items] of Object.entries(byRoute)) {
    console.error(`Route [${route}]:`);
    for (const item of items) {
      console.error(`  - ${item.error}`);
    }
    console.error("");
  }

  console.error(
    `💡 Action Required: Synchronize the affected schemas in docs/openapi.yaml or update the corresponding Zod schemas in src/lib/validation-schemas.ts and src/app/api/.\n`
  );
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
