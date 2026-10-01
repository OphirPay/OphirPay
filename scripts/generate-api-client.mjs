#!/usr/bin/env node
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

function renderJs(operations) {
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
`;
}

function renderDts(operations) {
  const names = operations.map((op) => `  | "${op.name}"`).join("\n");
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
        `Generated client catalogue is stale. Run "npm run client:generate".\n  ${stale.join("\n  ")}`
      );
      process.exit(1);
    }
    console.log(`✅ client catalogue is up to date (${operations.length} operations)`);
    return;
  }

  writeFileSync(OUT_JS, js);
  writeFileSync(OUT_DTS, dts);
  console.log(`✅ wrote ${operations.length} operations to packages/ophirpay-client/`);
}

// Only run when invoked directly, so the pure helpers stay importable.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
