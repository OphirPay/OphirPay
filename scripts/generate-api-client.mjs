#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// Generate the operation catalogue and typed TypeScript SDK interfaces for
// @ophirpay/client from the committed `docs/openapi.yaml` (issue #822, #1301).
// The generated module keeps the published client, external SDK consumers, and
// the spec in lock-step: the client resolves every request path through
// `OPERATION_BY_NAME`, provides route-level typing through `OphirPayRoutes`, and
// `scripts/generate-api-client.test.ts` fails CI if the committed output is stale.
//
// Usage:
//   node scripts/generate-api-client.mjs           # write the generated files
//   node scripts/generate-api-client.mjs --check   # fail if they are stale

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "js-yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SPEC_PATH = join(ROOT, "docs", "openapi.yaml");
const OUT_DIR = join(ROOT, "packages", "ophirpay-client");
const OUT_JS = join(OUT_DIR, "operations.generated.js");
const OUT_DTS = join(OUT_DIR, "operations.generated.d.ts");

const DATA_METHODS = ["get", "post", "put", "patch", "delete", "options", "head"];

/** PascalCase a kebab/snake/brace path segment. */
export function pascal(segment) {
  return segment
    .replace(/^\{(.+)\}$/, "$1")
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

/** Capitalize first character. */
export function capitalize(str) {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Derive a stable, unique operation name from method + path
 * (e.g. GET /api/payments/{id} → `getApiPaymentsId`).
 */
export function deriveOperationName(method, path, taken) {
  const base =
    method.toLowerCase() +
    path
      .split("/")
      .filter(Boolean)
      .map(pascal)
      .join("");
  let name = base;
  let n = 2;
  while (taken.has(name)) {
    name = `${base}${n}`;
    n += 1;
  }
  taken.add(name);
  return name;
}

/** Build the operation catalogue from a parsed OpenAPI document. */
export function buildOperations(spec) {
  const taken = new Set();
  const operations = [];
  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    for (const [method, op] of Object.entries(pathItem ?? {})) {
      if (!DATA_METHODS.includes(method)) continue;
      operations.push({
        name: deriveOperationName(method, path, taken),
        method: method.toUpperCase(),
        path,
        summary: op?.summary ?? "",
        tags: Array.isArray(op?.tags) ? op.tags : [],
        requestBody: Boolean(op?.requestBody),
        parameters: Array.isArray(op?.parameters) ? op.parameters : [],
        rawRequestBody: op?.requestBody ?? null,
        responses: op?.responses ?? {},
      });
    }
  }
  operations.sort((a, b) => a.name.localeCompare(b.name));
  return operations;
}

/**
 * Convert an OpenAPI 3.0 schema object to TypeScript type syntax.
 */
export function schemaToTs(schema, indentLevel = 0) {
  if (!schema) return "unknown";

  // References: #/components/schemas/Name -> Name
  if (schema.$ref) {
    const refName = schema.$ref.split("/").pop();
    return schema.nullable ? `${refName} | null` : refName;
  }

  // Combined schemas: oneOf / anyOf
  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    const union = schema.oneOf.map((s) => schemaToTs(s, indentLevel)).join(" | ");
    return schema.nullable ? `(${union}) | null` : `(${union})`;
  }
  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    const union = schema.anyOf.map((s) => schemaToTs(s, indentLevel)).join(" | ");
    return schema.nullable ? `(${union}) | null` : `(${union})`;
  }
  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    const inter = schema.allOf.map((s) => schemaToTs(s, indentLevel)).join(" & ");
    return schema.nullable ? `(${inter}) | null` : `(${inter})`;
  }

  // Enum: string or number union
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    const union = schema.enum.map((val) => JSON.stringify(val)).join(" | ");
    return schema.nullable ? `${union} | null` : union;
  }

  const baseType = schema.type;

  if (baseType === "string") {
    if (schema.format === "binary") return "Blob | Buffer | string";
    return schema.nullable ? "string | null" : "string";
  }

  if (baseType === "integer" || baseType === "number") {
    return schema.nullable ? "number | null" : "number";
  }

  if (baseType === "boolean") {
    return schema.nullable ? "boolean | null" : "boolean";
  }

  if (baseType === "array") {
    const itemType = schemaToTs(schema.items, indentLevel);
    const arrType = `Array<${itemType}>`;
    return schema.nullable ? `${arrType} | null` : arrType;
  }

  if (baseType === "object" || schema.properties) {
    const props = schema.properties ?? {};
    const required = new Set(Array.isArray(schema.required) ? schema.required : []);
    const lines = [];
    const indent = "  ".repeat(indentLevel + 1);
    const closeIndent = "  ".repeat(indentLevel);

    for (const [propName, propSchema] of Object.entries(props)) {
      const isReq = required.has(propName);
      const safeProp = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(propName)
        ? propName
        : JSON.stringify(propName);
      const propTs = schemaToTs(propSchema, indentLevel + 1);
      lines.push(`${indent}${safeProp}${isReq ? "" : "?"}: ${propTs};`);
    }

    if (schema.additionalProperties) {
      const addType =
        typeof schema.additionalProperties === "object"
          ? schemaToTs(schema.additionalProperties, indentLevel + 1)
          : "unknown";
      lines.push(`${indent}[key: string]: ${addType};`);
    }

    if (lines.length === 0) {
      return schema.nullable ? "Record<string, unknown> | null" : "Record<string, unknown>";
    }

    const objType = `{\n${lines.join("\n")}\n${closeIndent}}`;
    return schema.nullable ? `${objType} | null` : objType;
  }

  return schema.nullable ? "unknown | null" : "unknown";
}

function renderJs(operations) {
  const minimalOps = operations.map((op) => ({
    name: op.name,
    method: op.method,
    path: op.path,
    summary: op.summary,
    tags: op.tags,
    requestBody: op.requestBody,
  }));

  return `// SPDX-License-Identifier: MIT
// GENERATED FROM docs/openapi.yaml — DO NOT EDIT BY HAND.
// Regenerate with: npm run client:generate (or npm run generate:sdk)
//
// ${operations.length} operations extracted from the committed OpenAPI spec.

/** @typedef {{ name: string, method: string, path: string, summary: string, tags: string[], requestBody: boolean }} ApiOperation */

/** @type {ReadonlyArray<ApiOperation>} */
export const API_OPERATIONS = ${JSON.stringify(minimalOps, null, 2)};

/** @type {Record<string, ApiOperation>} */
export const OPERATION_BY_NAME = Object.fromEntries(
  API_OPERATIONS.map((op) => [op.name, op])
);
`;
}

function renderDts(operations, spec) {
  const names = operations.map((op) => `  | "${op.name}"`).join("\n");

  // 1. Render Component Schemas
  const schemaDeclarations = [];
  const schemas = spec.components?.schemas ?? {};
  for (const [schemaName, schemaObj] of Object.entries(schemas)) {
    const tsDefinition = schemaToTs(schemaObj, 0);
    if (tsDefinition.startsWith("{")) {
      schemaDeclarations.push(
        `export interface ${schemaName} ${tsDefinition}\n`
      );
    } else {
      schemaDeclarations.push(
        `export type ${schemaName} = ${tsDefinition};\n`
      );
    }
  }

  // 2. Render Per-Operation Request / Response Types
  const operationTypeBlocks = [];
  const routeEntries = [];
  const opMapEntries = [];

  for (const op of operations) {
    const typeBase = capitalize(op.name);

    // Path parameters
    const pathParams = op.parameters.filter((p) => p.in === "path");
    let hasParams = false;
    if (pathParams.length > 0) {
      hasParams = true;
      const paramFields = pathParams.map((p) => {
        const opt = p.required ? "" : "?";
        return `  ${p.name}${opt}: ${schemaToTs(p.schema, 1)};`;
      });
      operationTypeBlocks.push(
        `export interface ${typeBase}Params {\n${paramFields.join("\n")}\n}`
      );
    }

    // Query parameters
    const queryParams = op.parameters.filter((p) => p.in === "query");
    let hasQuery = false;
    if (queryParams.length > 0) {
      hasQuery = true;
      const queryFields = queryParams.map((p) => {
        const opt = p.required ? "" : "?";
        const safeName = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(p.name)
          ? p.name
          : JSON.stringify(p.name);
        return `  ${safeName}${opt}: ${schemaToTs(p.schema, 1)};`;
      });
      operationTypeBlocks.push(
        `export interface ${typeBase}Query {\n${queryFields.join("\n")}\n}`
      );
    }

    // Request body
    let hasBody = false;
    const bodyContent = op.rawRequestBody?.content?.["application/json"]?.schema;
    if (bodyContent) {
      hasBody = true;
      operationTypeBlocks.push(
        `export type ${typeBase}Body = ${schemaToTs(bodyContent, 0)};`
      );
    }

    // Response type (200 / 201 / 204 / default)
    const successResp =
      op.responses["200"] ||
      op.responses["201"] ||
      op.responses["204"] ||
      op.responses["default"];
    const respSchema = successResp?.content?.["application/json"]?.schema;
    let respTypeStr = "unknown";
    if (op.responses["204"] && !respSchema) {
      respTypeStr = "void";
    } else if (respSchema) {
      respTypeStr = schemaToTs(respSchema, 0);
    }
    operationTypeBlocks.push(
      `export type ${typeBase}Response = ${respTypeStr};`
    );

    const paramTypeRef = hasParams ? `${typeBase}Params` : "never";
    const queryTypeRef = hasQuery ? `${typeBase}Query` : "never";
    const bodyTypeRef = hasBody ? `${typeBase}Body` : "never";
    const respTypeRef = `${typeBase}Response`;

    opMapEntries.push(
      `  "${op.name}": {\n` +
        `    method: "${op.method}";\n` +
        `    path: "${op.path}";\n` +
        `    params: ${paramTypeRef};\n` +
        `    query: ${queryTypeRef};\n` +
        `    body: ${bodyTypeRef};\n` +
        `    response: ${respTypeRef};\n` +
        `  };`
    );

    routeEntries.push(
      `  "${op.method} ${op.path}": {\n` +
        `    operation: "${op.name}";\n` +
        `    params: ${paramTypeRef};\n` +
        `    query: ${queryTypeRef};\n` +
        `    body: ${bodyTypeRef};\n` +
        `    response: ${respTypeRef};\n` +
        `  };`
    );
  }

  return `// SPDX-License-Identifier: MIT
// GENERATED FROM docs/openapi.yaml — DO NOT EDIT BY HAND.
// Regenerate with: npm run client:generate (or npm run generate:sdk)

// ══════════════════════════════════════════════════════════════════
// 1. Operation Metadata & Catalogue
// ══════════════════════════════════════════════════════════════════

export interface ApiOperation {
  name: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD";
  path: string;
  summary: string;
  tags: string[];
  requestBody: boolean;
}

export type ApiOperationName =
${names};

export declare const API_OPERATIONS: ReadonlyArray<ApiOperation>;
export declare const OPERATION_BY_NAME: Record<ApiOperationName, ApiOperation>;

// ══════════════════════════════════════════════════════════════════
// 2. Components Schemas (OpenAPI Models)
// ══════════════════════════════════════════════════════════════════

${schemaDeclarations.join("\n")}

// ══════════════════════════════════════════════════════════════════
// 3. Typed Request / Response Interfaces (${operations.length} Operations)
// ══════════════════════════════════════════════════════════════════

${operationTypeBlocks.join("\n\n")}

// ══════════════════════════════════════════════════════════════════
// 4. Unified Operation & Route Type Maps
// ══════════════════════════════════════════════════════════════════

export interface OperationTypesMap {
${opMapEntries.join("\n")}
}

export interface OphirPayRoutes {
${routeEntries.join("\n")}
}
`;
}

export function generateClient() {
  const spec = load(readFileSync(SPEC_PATH, "utf8"));
  const operations = buildOperations(spec);
  const js = renderJs(operations);
  const dts = renderDts(operations, spec);
  return { operations, js, dts };
}

function main() {
  const check = process.argv.includes("--check");
  const { operations, js, dts } = generateClient();

  if (check) {
    const stale = [];
    for (const [file, expected] of [
      [OUT_JS, js],
      [OUT_DTS, dts],
    ]) {
      let actual = "";
      try {
        actual = readFileSync(file, "utf8");
      } catch {
        /* missing */
      }
      if (actual !== expected) stale.push(file);
    }
    if (stale.length > 0) {
      console.error(
        `Generated client catalogue is stale. Run "npm run generate:sdk" (or "npm run client:generate").\n  ${stale.join("\n  ")}`
      );
      process.exit(1);
    }
    console.log(`✅ client catalogue and typed SDK are up to date (${operations.length} operations)`);
    return;
  }

  writeFileSync(OUT_JS, js);
  writeFileSync(OUT_DTS, dts);
  console.log(`✅ wrote ${operations.length} operations and typed SDK interfaces to packages/ophirpay-client/`);
}

// Only run when invoked directly, so the pure helpers stay importable.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
