// SPDX-License-Identifier: MIT

/**
 * Keeps every generated artefact in `packages/ophirpay-client/` in lock-step
 * with the committed OpenAPI spec (issues #822, #1439). If someone edits
 * `docs/openapi.yaml` without regenerating, this fails CI with the exact
 * command to run.
 */

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import ts from "typescript";

const SCRIPT = join(process.cwd(), "scripts", "generate-api-client.mjs");
const CLIENT_DIR = join(process.cwd(), "packages", "ophirpay-client");
const TYPES_FILE = join(CLIENT_DIR, "api-types.generated.d.ts");

function operationNames(): string[] {
  const js = readFileSync(join(CLIENT_DIR, "operations.generated.js"), "utf8");
  return [...js.matchAll(/"name": "([^"]+)"/g)].map((m) => m[1]);
}

describe("generated API client catalogue", () => {
  it("is up to date with docs/openapi.yaml", () => {
    const out = execFileSync(process.execPath, [SCRIPT, "--check"], {
      encoding: "utf8",
    });
    expect(out).toContain("up to date");
  });

  it("contains a callable operation for every spec path", () => {
    const js = readFileSync(join(CLIENT_DIR, "operations.generated.js"), "utf8");
    expect(js).toContain("GENERATED FROM docs/openapi.yaml");
    expect(js).toMatch(/"name": "postApiPayments"/);
    expect(js).toMatch(/"name": "getApiPaymentsId"/);
    expect(js).toMatch(/"path": "\/api\/payments\/\{id\}"/);
  });
});

describe("generated typed SDK (issue #1439)", () => {
  it("maps all documented operations and component schemas", () => {
    const types = readFileSync(TYPES_FILE, "utf8");
    const names = operationNames();

    // The issue requires "all 40+ API routes"; the committed spec has more.
    expect(names.length).toBeGreaterThanOrEqual(40);

    expect(types).toContain("GENERATED FROM docs/openapi.yaml");
    for (const interfaceName of [
      "ApiRequestBodies",
      "ApiResponseBodies",
      "ApiPathParams",
      "ApiQueryParams",
      "ApiHeaderParams",
    ]) {
      expect(types).toContain(`export interface ${interfaceName} {`);
    }

    // Every operation is a member of the request/response maps, so a call can
    // be typed end-to-end without consulting the spec by hand.
    for (const name of names) {
      expect(types).toContain(`  ${name}: `);
    }

    // Concrete, spot-checkable typings.
    expect(types).toMatch(/postApiPayments: CreatePaymentRequest;/);
    expect(types).toMatch(/postApiBatches: CreateBatchRequest;/);
    // The header is required on every money-moving POST (issue #1440).
    expect(types).toMatch(/"Idempotency-Key": string;/);
    expect(types).toMatch(/export interface PaymentResponse \{/);
  });

  it("emits declarations that compile under strict TypeScript", () => {
    // `skipLibCheck` is false on purpose: the point is that the generated
    // declarations themselves are valid, not that the rest of the repo hides
    // their errors.
    const program = ts.createProgram([TYPES_FILE], {
      strict: true,
      noEmit: true,
      skipLibCheck: false,
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      // The generated shapes only need the ES2020 lib (`Array`, `Record`),
      // and no ambient @types package — skipping both the default lib chain
      // and @types/node keeps this test fast without weakening the check on
      // the generated declarations themselves.
      lib: ["lib.es2020.d.ts"],
      types: [],
    });
    const diagnostics = ts.getPreEmitDiagnostics(program);
    const messages = diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
    expect(messages).toEqual([]);
    // Compiler startup dominates; the assertion itself is instant.
  }, 30_000);

  it("keeps the spec-derived shapes readable and type-safe", () => {
    const types = readFileSync(TYPES_FILE, "utf8");
    // Nullable OpenAPI 3.1 type arrays become unions…
    expect(types).toMatch(/name\?: string \| null;/);
    // …string enums become literal unions…
    expect(types).toMatch(/source\?: "toml" \| "cache" \| "fallback";/);
    // …and `$ref`ed schemas are referenced by name, not inlined.
    expect(types).toMatch(/payments\?: Array<PaymentResponse>;/);
  });
});
