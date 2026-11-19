#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// Generate the @ophirpay/client artefacts from the committed
// `docs/openapi.yaml`:
//
//   operations.generated.{js,d.ts}  — the operation catalogue the client
//                                    resolves every request path through.
//   api-types.generated.d.ts        — typed request/response/path/query/header
//                                    maps for every documented operation, plus
//                                    an interface per `components.schemas`
//                                    entry (issue #1439). Integrators can type
//                                    both sides of a call without hand-copying
//                                    shapes out of the spec.
//
// Committed output is what keeps the published client and the spec from
// drifting: `--check` fails CI when either file is stale, so a spec edit that
// is not regenerated cannot merge.
//
// Usage:
//   node scripts/generate-api-client.mjs           # write the generated files
//   node scripts/generate-api-client.mjs --check   # fail if they are stale
//   npm run generate:sdk                           # same as the first form

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
const OUT_TYPES = join(OUT_DIR, "api-types.generated.d.ts");

const DATA_METHODS = ["get", "post", "put", "patch", "delete", "options", "head"];

const HEADER = `// SPDX-License-Identifier: MIT
// GENERATED FROM docs/openapi.yaml — DO NOT EDIT BY HAND.
// Regenerate with: npm run generate:sdk`;

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

/**
 * Walk the spec once and pair every operation with the raw document node it
 * came from. `buildOperations` and the type generator both consume this, so a
 * name can never mean one operation in the catalogue and another in the types.
 */
function collectOperations(spec) {
  const taken = new Set();
  const collected = [];
  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    for (const [method, op] of Object.entries(pathItem ?? {})) {
      if (!DATA_METHODS.includes(method)) continue;
      collected.push({
        name: deriveOperationName(method, path, taken),
        method: method.toUpperCase(),
        path,
        summary: op?.summary ?? "",
        tags: Array.isArray(op?.tags) ? op.tags : [],
        requestBody: Boolean(op?.requestBody),
        operation: op ?? {},
        // Path-level parameters apply to every method on that path.
        parameters: [...(pathItem.parameters ?? []), ...(op?.parameters ?? [])],
      });
    }
  }
  return collected.sort((a, b) => a.name.localeCompare(b.name));
}

/** Build the operation catalogue from a parsed OpenAPI document. */
export function buildOperations(spec) {
  return collectOperations(spec).map(
    ({ name, method, path, summary, tags, requestBody }) => ({
      name,
      method,
      path,
      summary,
      tags,
      requestBody,
    })
  );
}

// ── Type generation (issue #1439) ─────────────────────────────

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** A property name, quoted only when it is not a plain identifier. */
function propKey(name) {
  return IDENTIFIER.test(name) ? name : JSON.stringify(name);
}

/** Resolve a local `#/…` JSON pointer against the parsed spec. */
function resolveRef(ref, spec) {
  if (typeof ref !== "string" || !ref.startsWith("#/")) return undefined;
  return ref
    .slice(2)
    .split("/")
    .reduce((node, part) => (node == null ? node : node[part]), spec);
}

function literal(value) {
  if (value === null) return "null";
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

/**
 * Render one OpenAPI schema as a TypeScript type expression.
 *
 * Covers what the committed spec actually uses: `$ref`, `type` arrays for
 * nullability, `enum`/`const`, scalar/array/object types, inline `properties`,
 * `additionalProperties`, `oneOf`/`anyOf`/`allOf`. Anything unrecognised
 * degrades to `unknown` rather than emitting invalid TypeScript — a stale or
 * incomplete spec must never break the build that consumes it.
 */
export function schemaToType(schema, spec, indent = 0) {
  if (!schema || typeof schema !== "object") return "unknown";
  if (typeof schema.$ref === "string") {
    const name = schema.$ref.split("/").pop();
    return name ? name.replace(/[^A-Za-z0-9_$]/g, "_") : "unknown";
  }
  if (schema.const !== undefined) return literal(schema.const);
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum.map(literal).join(" | ");
  }
  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    return schema.oneOf.map((s) => schemaToType(s, spec, indent)).join(" | ");
  }
  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    return schema.anyOf.map((s) => schemaToType(s, spec, indent)).join(" | ");
  }
  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    return schema.allOf
      .map((s) => schemaToType(s, spec, indent))
      .join(" & ");
  }
  if (Array.isArray(schema.type)) {
    return schema.type
      .map((t) => schemaToType({ ...schema, type: t }, spec, indent))
      .join(" | ");
  }

  switch (schema.type) {
    case "string":
      return "string";
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "array":
      return `Array<${schemaToType(schema.items, spec, indent)}>`;
    default:
      break;
  }

  const properties = schema.properties ?? {};
  const keys = Object.keys(properties);
  if (keys.length > 0) {
    const required = new Set(schema.required ?? []);
    const pad = "  ".repeat(indent + 1);
    const lines = keys.map((key) => {
      const optional = required.has(key) ? "" : "?";
      const type = schemaToType(properties[key], spec, indent + 1);
      return `${pad}${propKey(key)}${optional}: ${type};`;
    });
    if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
      lines.push(`${pad}[key: string]: ${schemaToType(schema.additionalProperties, spec, indent + 1)};`);
    }
    return `{\n${lines.join("\n")}\n${"  ".repeat(indent)}}`;
  }

  if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
    return `Record<string, ${schemaToType(schema.additionalProperties, spec, indent)}>`;
  }
  return "Record<string, unknown>";
}

/** Pick the schema of a response body, following response-level `$ref`s. */
function responseSchema(response, spec) {
  const node = response?.$ref ? resolveRef(response.$ref, spec) : response;
  const content = node?.content ?? {};
  const media =
    content["application/json"] ??
    content["application/problem+json"] ??
    content["text/csv"] ??
    Object.values(content)[0];
  return media?.schema;
}

/** Request body schema for an operation, if it has one. */
function requestSchema(operation) {
  const content = operation.requestBody?.content ?? {};
  return content["application/json"]?.schema;
}

/** Indent every line but the first — keeps the generated map readable. */
function indentBlock(type, by = 2) {
  const pad = " ".repeat(by);
  return type
    .split("\n")
    .map((line, index) => (index === 0 ? line : `${pad}${line}`))
    .join("\n");
}

/** Render `{ param: type }` for the parameters of one `in:` location. */
function parameterMap(operation, location, spec) {
  const params = (operation.parameters ?? []).filter(
    (p) => p && p.in === location && typeof p.name === "string"
  );
  if (params.length === 0) return "Record<string, never>";
  const lines = params.map((p) => {
    const optional = p.required ? "" : "?";
    return `  ${propKey(p.name)}${optional}: ${indentBlock(
      schemaToType(p.schema, spec)
    )};`;
  });
  return `{\n${lines.join("\n")}\n}`;
}

function responseMap(operation, spec) {
  const statuses = Object.keys(operation.responses ?? {});
  if (statuses.length === 0) return "Record<string, unknown>";
  const lines = statuses.map((status) => {
    const schema = responseSchema(operation.responses[status], spec);
    const type = schema ? schemaToType(schema, spec) : "unknown";
    return `  ${propKey(status)}: ${indentBlock(type)};`;
  });
  return `{\n${lines.join("\n")}\n}`;
}

function renderTypes(spec) {
  const operations = collectOperations(spec);
  const schemas = spec.components?.schemas ?? {};
  const schemaNames = Object.keys(schemas).sort();
  const chunks = [
    HEADER,
    "//",
    `// ${operations.length} operations and ${schemaNames.length} component schemas from`,
    "// the committed OpenAPI document. Regenerate after editing the spec.",
    "",
    "// ── Component schemas ─────────────────────────────────────────",
  ];

  for (const name of schemaNames) {
    const schema = schemas[name] ?? {};
    const alias = name.replace(/[^A-Za-z0-9_$]/g, "_");
    const type = schemaToType(schema, spec);
    const isObjectShape =
      type.startsWith("{") && !Array.isArray(schema.enum) && !schema.$ref;
    chunks.push(
      isObjectShape
        ? `export interface ${alias} ${type}`
        : `export type ${alias} = ${type};`
    );
    chunks.push("");
  }

  const maps = [
    [
      "ApiRequestBodies",
      "Request body type per operation (issue #1439).",
      (op) => {
        const schema = requestSchema(op.operation);
        return schema ? indentBlock(schemaToType(schema, spec)) : "undefined";
      },
    ],
    [
      "ApiResponseBodies",
      "Response body type per operation, keyed by HTTP status code.",
      (op) => responseMap(op.operation, spec),
    ],
    [
      "ApiPathParams",
      "Path parameters per operation.",
      (op) => parameterMap(op.operation, "path", spec),
    ],
    [
      "ApiQueryParams",
      "Query parameters per operation (required ones are non-optional).",
      (op) => parameterMap(op.operation, "query", spec),
    ],
    [
      "ApiHeaderParams",
      "Header parameters per operation (e.g. `Idempotency-Key`).",
      (op) => parameterMap(op.operation, "header", spec),
    ],
  ];

  for (const [interfaceName, description, render] of maps) {
    chunks.push(
      "// ── Typed operation maps ──────────────────────────────────────",
      `/** ${description} */`,
      `export interface ${interfaceName} {`
    );
    for (const op of operations) {
      chunks.push(`  ${propKey(op.name)}: ${indentBlock(render(op))};`);
    }
    chunks.push("}", "");
  }

  return `${chunks.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
}

function renderJs(operations) {
  return `${HEADER}
//
// ${operations.length} operations extracted from the committed OpenAPI spec.

/** @typedef {{ name: string, method: string, path: string, summary: string, tags: string[], requestBody: boolean }} ApiOperation */

/** @type {ReadonlyArray<ApiOperation>} */
export const API_OPERATIONS = ${JSON.stringify(operations, null, 2)};

/** @type {Record<string, ApiOperation>} */
export const OPERATION_BY_NAME = Object.fromEntries(
  API_OPERATIONS.map((op) => [op.name, op])
);
`;
}

function renderDts(operations) {
  const names = operations.map((op) => `  | "${op.name}"`).join("\n");
  return `${HEADER}

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
`;
}

function main() {
  const check = process.argv.includes("--check");
  const spec = load(readFileSync(SPEC_PATH, "utf8"));
  const operations = buildOperations(spec);
  const js = renderJs(operations);
  const dts = renderDts(operations);
  const types = renderTypes(spec);

  if (check) {
    const stale = [];
    for (const [file, expected] of [
      [OUT_JS, js],
      [OUT_DTS, dts],
      [OUT_TYPES, types],
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
        `Generated client catalogue is stale. Run "npm run client:generate".\n  ${stale.join("\n  ")}`
      );
      process.exit(1);
    }
    console.log(
      `✅ client catalogue is up to date (${operations.length} operations, ` +
        `${Object.keys(spec.components?.schemas ?? {}).length} typed schemas)`
    );
    return;
  }

  writeFileSync(OUT_JS, js);
  writeFileSync(OUT_DTS, dts);
  writeFileSync(OUT_TYPES, types);
  console.log(
    `✅ wrote ${operations.length} operations and ` +
      `${Object.keys(spec.components?.schemas ?? {}).length} typed schemas to ` +
      "packages/ophirpay-client/"
  );
}

// Only run when invoked directly, so the pure helpers stay importable.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
