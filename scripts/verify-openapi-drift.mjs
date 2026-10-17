// SPDX-License-Identifier: MIT

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "js-yaml";

const DATA_METHODS = ["get", "post", "put", "patch", "delete"];

/**
 * Mapping between Zod schema exports in `src/lib/validation-schemas.ts`
 * and their corresponding OpenAPI component schema or route requestBody target (#1291).
 */
export const ZOD_OPENAPI_SCHEMA_MAP = [
  {
    zodName: "createPaymentSchema",
    route: "POST /api/payments",
    openApiRef: "#/components/schemas/CreatePaymentRequest",
  },
  {
    zodName: "updatePaymentSchema",
    route: "PATCH /api/payments/{id}",
    openApiOperation: { path: "/api/payments/{id}", method: "patch" },
  },
  {
    zodName: "retryPaymentSchema",
    route: "POST /api/payments/retry",
    openApiOperation: { path: "/api/payments/retry", method: "post" },
  },
  {
    zodName: "createBatchSchema",
    route: "POST /api/batches",
    openApiRef: "#/components/schemas/CreateBatchRequest",
  },
  {
    zodName: "createRecurringSchema",
    route: "POST /api/recurring",
    openApiRef: "#/components/schemas/CreateRecurrenceRequest",
  },
  {
    zodName: "createWebhookSchema",
    route: "POST /api/webhooks",
    openApiRef: "#/components/schemas/CreateWebhookRequest",
  },
  {
    zodName: "createPaymentRequestSchema",
    route: "POST /api/requests",
    openApiRef: "#/components/schemas/CreatePaymentRequestSchema",
  },
  {
    zodName: "createProposalSchema",
    route: "POST /api/governance/proposals",
    openApiOperation: { path: "/api/governance/proposals", method: "post" },
  },
  {
    zodName: "voteOnProposalSchema",
    route: "POST /api/governance/vote",
    openApiOperation: { path: "/api/governance/vote", method: "post" },
  },
  {
    zodName: "executeProposalSchema",
    route: "POST /api/governance/execute",
    openApiOperation: { path: "/api/governance/execute", method: "post" },
  },
  {
    zodName: "updateRefundStatusSchema",
    route: "PATCH /api/refunds/{id}",
    openApiOperation: { path: "/api/refunds/{id}", method: "patch" },
  },
  {
    zodName: "createHookSchema",
    route: "POST /api/hooks",
    openApiOperation: { path: "/api/hooks", method: "post" },
  },
  {
    zodName: "updateHookSchema",
    route: "PATCH /api/hooks/{id}",
    openApiOperation: { path: "/api/hooks/{id}", method: "patch" },
  },
];

/**
 * Extract top-level field names from `export const <zodName> = z.object({ ... })` in source text.
 */
export function extractZodObjectFields(schemasSource, zodName) {
  const declRegex = new RegExp(
    `export\\s+const\\s+${zodName}\\s*=\\s*z\\.object\\(\\{([\\s\\S]*?)\\}\\);`,
    "m",
  );
  const match = schemasSource.match(declRegex);
  if (!match) return null;

  const body = match[1];
  const fields = [];
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
      continue;
    }
    const propMatch = /^([a-zA-Z0-9_]+)\s*:/.exec(trimmed);
    if (propMatch) {
      fields.push(propMatch[1]);
    }
  }
  return fields;
}

function resolveRef(spec, ref) {
  return ref
    .replace(/^#\//, "")
    .split("/")
    .reduce((cur, part) => (cur && typeof cur === "object" ? cur[part] : undefined), spec);
}

function getOpenApiProperties(spec, entry) {
  let schemaObj = null;
  if (entry.openApiRef) {
    schemaObj = resolveRef(spec, entry.openApiRef);
  } else if (entry.openApiOperation) {
    const { path, method } = entry.openApiOperation;
    const op = spec?.paths?.[path]?.[method];
    schemaObj = op?.requestBody?.content?.["application/json"]?.schema;
    if (schemaObj?.$ref) {
      schemaObj = resolveRef(spec, schemaObj.$ref);
    }
  }
  if (!schemaObj || typeof schemaObj !== "object" || !schemaObj.properties) {
    return null;
  }
  return Object.keys(schemaObj.properties);
}

function listRouteFiles(dir, baseDir = dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listRouteFiles(full, baseDir));
    } else if (entry.name === "route.ts") {
      out.push(full.slice(baseDir.length + 1).split(sep).join("/"));
    }
  }
  return out;
}

function specPathForRouteFile(rel) {
  const apiRel = rel.replace(/\/route\.ts$/, "").replace(/\\/g, "/");
  return "/api/" + apiRel.replace(/\[([^\]]+)\]/g, "{$1}");
}

function exportedHandlers(source) {
  const re = /export (?:async )?(?:const|function) (GET|POST|PATCH|PUT|DELETE)\b/g;
  return [...source.matchAll(re)].map((m) => m[1]);
}

/**
 * Verify that `docs/openapi.yaml` and the Zod schemas / API route handlers have no drift (#1291).
 */
export function verifyOpenApiDrift(options = {}) {
  const rootDir = options.rootDir ?? process.cwd();
  const specPath = options.specPath ?? join(rootDir, "docs", "openapi.yaml");
  const schemasPath = options.schemasPath ?? join(rootDir, "src", "lib", "validation-schemas.ts");
  const apiDir = options.apiDir ?? join(rootDir, "src", "app", "api");

  const specContent = options.specContent ?? readFileSync(specPath, "utf8");
  const schemasContent = options.schemasContent ?? readFileSync(schemasPath, "utf8");
  const spec = load(specContent);

  const diffs = [];

  // 1. Check route coverage (code -> OpenAPI spec)
  if (!options.skipRouteFileScan && existsSync(apiDir)) {
    for (const rel of listRouteFiles(apiDir)) {
      const specPathKey = specPathForRouteFile(rel);
      const pathItem = spec?.paths?.[specPathKey];
      const fullRouteFile = join(apiDir, ...rel.split("/"));
      const handlers = exportedHandlers(readFileSync(fullRouteFile, "utf8"));

      if (!pathItem) {
        diffs.push({
          routeOrSchema: specPathKey,
          reason: `Route file src/app/api/${rel} is missing path "${specPathKey}" in docs/openapi.yaml`,
        });
        continue;
      }

      for (const method of handlers) {
        if (!pathItem[method.toLowerCase()]) {
          diffs.push({
            routeOrSchema: `${method} ${specPathKey}`,
            reason: `Handler ${method} ${specPathKey} is exported in src/app/api/${rel} but missing from docs/openapi.yaml`,
          });
        }
      }
    }

    // Check OpenAPI spec -> route files
    for (const [specPathKey, pathItem] of Object.entries(spec?.paths ?? {})) {
      if (!pathItem || typeof pathItem !== "object") continue;
      for (const method of DATA_METHODS) {
        if (!pathItem[method]) continue;
        const relSegments = specPathKey
          .replace(/^\/api\//, "")
          .split("/")
          .map((seg) => (seg.startsWith("{") && seg.endsWith("}") ? `[${seg.slice(1, -1)}]` : seg));
        const routeFile = join(apiDir, ...relSegments, "route.ts");
        if (!existsSync(routeFile)) {
          diffs.push({
            routeOrSchema: `${method.toUpperCase()} ${specPathKey}`,
            reason: `Documented operation ${method.toUpperCase()} ${specPathKey} has no route file at ${routeFile}`,
          });
        }
      }
    }
  }

  // 2. Compare Zod request schema fields against OpenAPI schema properties
  for (const mapping of ZOD_OPENAPI_SCHEMA_MAP) {
    const zodFields = extractZodObjectFields(schemasContent, mapping.zodName);
    if (!zodFields) {
      diffs.push({
        routeOrSchema: mapping.route,
        reason: `Zod schema "${mapping.zodName}" was not found in src/lib/validation-schemas.ts`,
      });
      continue;
    }

    const openApiFields = getOpenApiProperties(spec, mapping);
    if (!openApiFields) {
      diffs.push({
        routeOrSchema: mapping.route,
        reason: `OpenAPI schema for ${mapping.route} (${mapping.openApiRef || mapping.openApiOperation?.path}) is missing properties in docs/openapi.yaml`,
      });
      continue;
    }

    for (const field of zodFields) {
      if (!openApiFields.includes(field)) {
        diffs.push({
          routeOrSchema: mapping.route,
          field,
          reason: `${mapping.route} (${mapping.zodName}): field "${field}" exists in Zod schema but is missing from docs/openapi.yaml`,
        });
      }
    }

    for (const field of openApiFields) {
      if (!zodFields.includes(field)) {
        diffs.push({
          routeOrSchema: mapping.route,
          field,
          reason: `${mapping.route} (${mapping.zodName}): property "${field}" is documented in docs/openapi.yaml but missing from Zod schema`,
        });
      }
    }
  }

  const formattedReport =
    diffs.length === 0
      ? "OK: 0 Zod-to-OpenAPI schema or route drift issues detected."
      : [
          `ERROR: Detected ${diffs.length} Zod-to-OpenAPI drift issue(s):`,
          ...diffs.map((d) => `  - [${d.routeOrSchema}]${d.field ? ` (field: ${d.field})` : ""} ${d.reason}`),
        ].join("\n");

  return {
    ok: diffs.length === 0,
    diffs,
    formattedReport,
  };
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url).replace(/\\/g, "/") === process.argv[1].replace(/\\/g, "/");

if (isMain) {
  const result = verifyOpenApiDrift();
  if (!result.ok) {
    console.error(result.formattedReport);
    process.exit(1);
  }
  console.log(result.formattedReport);
}
