// SPDX-License-Identifier: MIT
//
// OpenAPI schema-conformance tests.
//
// Guards `docs/openapi.yaml` against drift in BOTH directions:
//   1. every endpoint documented in the spec must have a working route handler,
//   2. every implemented route handler must be documented in the spec.
//
// It also validates spec-internal integrity (resolvable `$ref`s, declared path
// parameters, and complete request/response declarations) so a schema that
// "passes YAML" but would produce undefined requests/responses fails here.

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, sep } from "node:path";
import { load } from "js-yaml";

const SPEC_PATH = join(process.cwd(), "docs", "openapi.yaml");
const API_DIR = join(process.cwd(), "src", "app", "api");

// Data methods the framework router supports and the spec documents.
const DATA_METHODS = ["get", "post", "put", "patch", "delete"] as const;

interface Operation {
  method: string;
  path: string;
  operation: Record<string, unknown>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let spec: any;
let operations: Operation[];

// ── Helpers ───────────────────────────────────────────────────

/** Map a spec path like `/api/payments/{id}` to its route file on disk. */
function routeFileFor(specPath: string): string {
  const rel = specPath
    .replace(/^\/api\//, "")
    .split("/")
    .map((seg) =>
      seg.startsWith("{") && seg.endsWith("}") ? `[${seg.slice(1, -1)}]` : seg
    )
    .join(sep);
  return join(API_DIR, rel, "route.ts");
}

/** Map a route file path back to its spec path (e.g. `payments/[id]` → `/api/payments/{id}`). */
function specPathForRouteFile(rel: string): string {
  const apiRel = rel.replace(/\/route\.ts$/, "").replace(/\\/g, "/");
  return "/api/" + apiRel.replace(/\[([^\]]+)\]/g, "{$1}");
}

/** Extract exported HTTP handler names from a route module's source. */
function exportedHandlers(source: string): string[] {
  const re =
    /export (?:async )?(?:const|function) (GET|POST|PATCH|PUT|DELETE|OPTIONS|HEAD)\b/g;
  return [...source.matchAll(re)].map((m) => m[1]);
}

/** Recursively list every `route.ts` under src/app/api (as API-relative paths). */
function listRouteFiles(dir = API_DIR): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listRouteFiles(full));
    else if (entry.name === "route.ts")
      out.push(full.slice(API_DIR.length + 1).split(sep).join("/"));
  }
  return out;
}

/** Collect every `$ref` value in a spec subtree. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectRefs(node: any, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const n of node) collectRefs(n, out);
    return out;
  }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (k === "$ref") out.push(v as string);
      else collectRefs(v, out);
    }
  }
  return out;
}

/** Resolve a local `#/...` reference against the parsed spec. */
function resolveRef(ref: string): unknown {
  return ref
    .replace(/^#\//, "")
    .split("/")
    .reduce<unknown>((cur, part) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (cur as any)?.[part];
    }, spec);
}

/** Path parameters declared (path-level + operation-level) for an operation. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function declaredPathParams(op: any, pathItem: any): string[] {
  const all = [
    ...(pathItem.parameters ?? []),
    ...(op.parameters ?? []),
  ] as Array<{ name?: string; in?: string; required?: boolean }>;
  return all
    .filter((p) => p.in === "path" && p.required === true)
    .map((p) => String(p.name));
}

beforeAll(() => {
  spec = load(readFileSync(SPEC_PATH, "utf8"));
  operations = [];
  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    const item = (pathItem ?? {}) as Record<string, unknown>;
    for (const [method, op] of Object.entries(item)) {
      if ((DATA_METHODS as readonly string[]).includes(method)) {
        operations.push({
          method: method.toUpperCase(),
          path,
          operation: op as Record<string, unknown>,
        });
      }
    }
  }
});

describe("OpenAPI schema-conformance", () => {
  it("loads docs/openapi.yaml as a valid OpenAPI 3.x document", () => {
    expect(spec).toBeDefined();
    expect(String(spec.openapi)).toMatch(/^3\./);
    expect(spec.info?.title).toBeTruthy();
    expect(Object.keys(spec.paths ?? {})).not.toHaveLength(0);
    expect(Object.keys(spec.components?.schemas ?? {})).not.toHaveLength(0);
    expect(spec.components?.securitySchemes).toBeDefined();
    // The security schemes referenced at the document level must exist.
    for (const scheme of Object.keys(spec.security?.[0] ?? {})) {
      expect(spec.components?.securitySchemes?.[scheme]).toBeDefined();
    }
  });

  it("implements every endpoint documented in the spec (spec → code)", () => {
    const failures: string[] = [];
    for (const { method, path } of operations) {
      const routeFile = routeFileFor(path);
      if (!existsSync(routeFile)) {
        failures.push(`${method} ${path}: no route at ${routeFile}`);
        continue;
      }
      const handlers = exportedHandlers(readFileSync(routeFile, "utf8"));
      if (!handlers.includes(method)) {
        failures.push(
          `${method} ${path}: route does not export a ${method} handler (has ${handlers.join(", ") || "none"})`
        );
      }
    }
    expect(failures).toEqual([]);
  });

  it("documents every implemented route handler in the spec (code → spec)", () => {
    const failures: string[] = [];
    for (const rel of listRouteFiles()) {
      const specPath = specPathForRouteFile(rel);
      const pathItem = (spec.paths ?? {})[specPath] as
        | Record<string, unknown>
        | undefined;
      if (!pathItem) {
        failures.push(`route ${rel} has no path "${specPath}" in docs/openapi.yaml`);
        continue;
      }
      const handlers = exportedHandlers(
        readFileSync(join(API_DIR, ...rel.split("/")), "utf8")
      );
      for (const handler of handlers) {
        // OPTIONS/HEAD are framework-automated; only data methods are documented.
        if (!["OPTIONS", "HEAD"].includes(handler)) {
          if (pathItem[handler.toLowerCase()] === undefined) {
            failures.push(
              `${handler} ${specPath} is implemented but missing from docs/openapi.yaml`
            );
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("declares path parameters for every templated path and maps them to route dirs", () => {
    const failures: string[] = [];
    for (const { method, path, operation } of operations) {
      const templated = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
      if (templated.length === 0) continue;

      const declared = declaredPathParams(
        operation,
        (spec.paths as Record<string, unknown>)[path]
      );
      for (const param of templated) {
        if (!declared.includes(param)) {
          failures.push(
            `${method} ${path}: path parameter "{${param}}" is not declared as required`
          );
        }
      }

      const routeFile = routeFileFor(path);
      const rel = routeFile.slice(API_DIR.length + 1).split(sep).join("/");
      for (const param of templated) {
        if (!rel.includes(`[${param}]`)) {
          failures.push(
            `${method} ${path}: route file "${rel}" does not use a [${param}] segment`
          );
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("resolves every $ref in the spec (no dangling schema/reference drift)", () => {
    const unresolved: string[] = [];
    for (const ref of collectRefs(spec)) {
      const resolved = resolveRef(ref);
      if (resolved === undefined || resolved === null) unresolved.push(ref);
    }
    expect(unresolved).toEqual([]);
  });

  it("declares complete request/response shapes for every operation", () => {
    const failures: string[] = [];
    for (const { method, path, operation } of operations) {
      const responses = operation.responses as
        | Record<string, { description?: string; $ref?: string }>
        | undefined;

      if (!responses || Object.keys(responses).length === 0) {
        failures.push(`${method} ${path}: no responses declared`);
        continue;
      }
      const hasSuccess = Object.keys(responses).some(
        (code) => /^2\d\d$/.test(code) || code === "default"
      );
      if (!hasSuccess) {
        failures.push(`${method} ${path}: no 2xx (or default) success response`);
      }
      for (const [code, resp] of Object.entries(responses)) {
        if (resp.$ref === undefined && !resp.description) {
          failures.push(`${method} ${path} ${code}: response missing description`);
        }
      }

      const requestBody = operation.requestBody as
        | { content?: Record<string, unknown>; $ref?: string }
        | undefined;
      if (requestBody && requestBody.$ref === undefined) {
        const content = requestBody.content;
        if (!content || Object.keys(content).length === 0) {
          failures.push(`${method} ${path}: requestBody declares no content type`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});
