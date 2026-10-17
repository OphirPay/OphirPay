// SPDX-License-Identifier: MIT
//
// Generate the operation catalogue for @ophirpay/client from the committed
// `docs/openapi.yaml`. The generated module is what keeps the published client
// and the spec from drifting: the client resolves every request path through
// `OPERATION_BY_NAME`, and `scripts/typed-client.test.ts` fails CI if the
// committed output is stale.
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
function pascal(segment) {
  return segment
    .replace(/^\{(.+)\}$/, "$1")
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
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
      });
    }
  }
  operations.sort((a, b) => a.name.localeCompare(b.name));
  return operations;
}

/**
 * Convert an OpenAPI 3.0/3.1 schema node into a TypeScript type expression.
 */
export function schemaToTypeScript(schema, indent = "  ") {
  if (!schema || typeof schema !== "object") {
    return "unknown";
  }

  if (typeof schema.$ref === "string") {
    const match = /^#\/components\/schemas\/([A-Za-z0-9_]+)$/.exec(schema.$ref);
    if (match) {
      return `OpenApiSchemas["${match[1]}"]`;
    }
    return "unknown";
  }

  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    return schema.oneOf.map((s) => schemaToTypeScript(s, indent)).join(" | ");
  }
  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    return schema.anyOf.map((s) => schemaToTypeScript(s, indent)).join(" | ");
  }

  if (schema.const !== undefined) {
    return JSON.stringify(schema.const);
  }

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum.map((v) => JSON.stringify(v)).join(" | ");
  }

  if (Array.isArray(schema.type)) {
    return schema.type
      .map((t) => (t === "null" ? "null" : schemaToTypeScript({ ...schema, type: t }, indent)))
      .join(" | ");
  }

  const nullableSuffix = schema.nullable === true ? " | null" : "";

  switch (schema.type) {
    case "string":
      return `string${nullableSuffix}`;
    case "integer":
    case "number":
      return `number${nullableSuffix}`;
    case "boolean":
      return `boolean${nullableSuffix}`;
    case "null":
      return "null";
    case "array": {
      const itemType = schemaToTypeScript(schema.items, indent);
      const wrapped = itemType.includes(" | ") ? `(${itemType})[]` : `${itemType}[]`;
      return `${wrapped}${nullableSuffix}`;
    }
    case "object":
    default: {
      const props = schema.properties ? Object.entries(schema.properties) : [];
      if (props.length === 0) {
        if (schema.type === "object") {
          return `Record<string, unknown>${nullableSuffix}`;
        }
        return "unknown";
      }
      const requiredSet = new Set(Array.isArray(schema.required) ? schema.required : []);
      const nextIndent = `${indent}  `;
      const lines = props.map(([propName, propSchema]) => {
        const safeKey = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(propName)
          ? propName
          : JSON.stringify(propName);
        const optional = requiredSet.has(propName) ? "" : "?";
        const propType = schemaToTypeScript(propSchema, nextIndent);
        return `${nextIndent}${safeKey}${optional}: ${propType};`;
      });
      return `{\n${lines.join("\n")}\n${indent}}${nullableSuffix}`;
    }
  }
}

/**
 * Extract sorted component schemas from `components.schemas`.
 */
export function buildComponentSchemas(spec) {
  const rawSchemas = spec?.components?.schemas ?? {};
  return Object.keys(rawSchemas)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({
      name,
      schema: rawSchemas[name],
    }));
}

/**
 * Extract per-operation requestBody and response TypeScript types from the spec.
 */
export function buildOperationTypeEntries(spec) {
  const taken = new Set();
  const entries = [];
  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    for (const [method, op] of Object.entries(pathItem ?? {})) {
      if (!DATA_METHODS.includes(method)) continue;
      const name = deriveOperationName(method, path, taken);
      const reqSchema = op?.requestBody?.content?.["application/json"]?.schema;
      const resContent =
        op?.responses?.["200"]?.content ??
        op?.responses?.["201"]?.content ??
        null;
      const resSchema = resContent?.["application/json"]?.schema ?? null;

      entries.push({
        name,
        method: method.toUpperCase(),
        path,
        requestType: reqSchema ? schemaToTypeScript(reqSchema, "    ") : "never",
        responseType: resSchema ? schemaToTypeScript(resSchema, "    ") : "unknown",
      });
    }
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}

function renderJs(operations, componentSchemas) {
  const schemaNames = componentSchemas.map((s) => s.name);
  return `// SPDX-License-Identifier: MIT
// GENERATED FROM docs/openapi.yaml — DO NOT EDIT BY HAND.
// Regenerate with: npm run client:generate
//
// ${operations.length} operations extracted from the committed OpenAPI spec.

/** @typedef {{ name: string, method: string, path: string, summary: string, tags: string[], requestBody: boolean }} ApiOperation */

/** @type {ReadonlyArray<ApiOperation>} */
export const API_OPERATIONS = ${JSON.stringify(operations, null, 2)};

/** @type {Record<string, ApiOperation>} */
export const OPERATION_BY_NAME = Object.fromEntries(
  API_OPERATIONS.map((op) => [op.name, op])
);

/** @type {ReadonlyArray<string>} */
export const COMPONENT_SCHEMA_NAMES = ${JSON.stringify(schemaNames, null, 2)};
`;
}

function renderDts(operations, componentSchemas, operationTypeEntries) {
  const names = operations.map((op) => `  | "${op.name}"`).join("\n");
  const schemaEntries = componentSchemas
    .map(({ name, schema }) => `  ${name}: ${schemaToTypeScript(schema, "  ")};`)
    .join("\n");
  const schemaAliases = componentSchemas
    .map(({ name }) => `export type ${name} = OpenApiSchemas["${name}"];`)
    .join("\n");
  const opMapEntries = operationTypeEntries
    .map(
      (entry) =>
        `  ${entry.name}: {\n    method: "${entry.method}";\n    path: "${entry.path}";\n    requestBody: ${entry.requestType};\n    response: ${entry.responseType};\n  };`
    )
    .join("\n");

  return `// SPDX-License-Identifier: MIT
// GENERATED FROM docs/openapi.yaml — DO NOT EDIT BY HAND.
// Regenerate with: npm run client:generate

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

export interface OpenApiSchemas {
${schemaEntries}
}

${schemaAliases}

export interface ApiOperationMap {
${opMapEntries}
}

export declare const API_OPERATIONS: ReadonlyArray<ApiOperation>;
export declare const OPERATION_BY_NAME: Record<ApiOperationName, ApiOperation>;
export declare const COMPONENT_SCHEMA_NAMES: ReadonlyArray<keyof OpenApiSchemas>;
`;
}

function normalizeLineEndings(str) {
  return str.replace(/\r\n/g, "\n");
}

function main() {
  const check = process.argv.includes("--check");
  const spec = load(readFileSync(SPEC_PATH, "utf8"));
  const operations = buildOperations(spec);
  const componentSchemas = buildComponentSchemas(spec);
  const operationTypeEntries = buildOperationTypeEntries(spec);
  const js = renderJs(operations, componentSchemas);
  const dts = renderDts(operations, componentSchemas, operationTypeEntries);

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
      if (normalizeLineEndings(actual) !== normalizeLineEndings(expected)) {
        stale.push(file);
      }
    }
    if (stale.length > 0) {
      console.error(
        `Generated client catalogue is stale. Run "npm run client:generate".\n  ${stale.join("\n  ")}`
      );
      process.exit(1);
    }
    console.log(
      `✅ client catalogue is up to date (${operations.length} operations, ${componentSchemas.length} schemas)`
    );
    return;
  }

  writeFileSync(OUT_JS, js);
  writeFileSync(OUT_DTS, dts);
  console.log(
    `✅ wrote ${operations.length} operations and ${componentSchemas.length} schemas to packages/ophirpay-client/`
  );
}

// Only run when invoked directly, so the pure helpers stay importable.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}

