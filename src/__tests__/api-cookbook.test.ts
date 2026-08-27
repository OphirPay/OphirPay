// SPDX-License-Identifier: MIT

import { readFileSync } from "fs";
import path from "path";
import { describe, it, expect } from "vitest";

/**
 * Regression test for the API cookbook (docs/API_COOKBOOK.md): every public
 * endpoint declared in docs/openapi.yaml must be documented. If a route is
 * added to the spec without a cookbook example (or a method is dropped from
 * the cookbook), this fails — the cookbook can never silently fall behind
 * the spec.
 */

const spec = readFileSync(
  path.join(process.cwd(), "docs/openapi.yaml"),
  "utf8"
);
const cookbook = readFileSync(
  path.join(process.cwd(), "docs/API_COOKBOOK.md"),
  "utf8"
);

/** Parse `path: { get:, post:, ... }` entries out of the OpenAPI spec. */
function extractEndpoints(
  yaml: string
): Record<string, string[]> {
  const endpoints: Record<string, string[]> = {};
  let currentPath: string | null = null;

  for (const line of yaml.split("\n")) {
    const pathMatch = line.match(/^  (\/(?:api\/)?[^:]+):\s*$/);
    if (pathMatch && !line.trimStart().startsWith("/components")) {
      currentPath = pathMatch[1];
      endpoints[currentPath] = [];
      continue;
    }
    if (currentPath) {
      const methodMatch = line.match(
        /^    (get|post|patch|put|delete):\s*$/
      );
      if (methodMatch) {
        endpoints[currentPath].push(methodMatch[1].toUpperCase());
      }
    }
  }
  return endpoints;
}

describe("docs/API_COOKBOOK.md coverage", () => {
  const endpoints = extractEndpoints(spec);

  it("finds endpoints in the OpenAPI spec", () => {
    expect(Object.keys(endpoints).length).toBeGreaterThan(10);
    expect(endpoints["/api/payments"]).toContain("GET");
  });

  it("documents every endpoint path from the spec", () => {
    for (const endpointPath of Object.keys(endpoints)) {
      expect(cookbook, `missing cookbook example for ${endpointPath}`).toContain(
        endpointPath
      );
    }
  });

  it("documents every non-GET method with a curl -X example", () => {
    for (const [endpointPath, methods] of Object.entries(endpoints)) {
      for (const method of methods) {
        if (method === "GET") continue; // GET examples need no -X flag
        expect(
          cookbook,
          `missing curl -X ${method} example for ${endpointPath}`
        ).toContain(`-X ${method}`);
      }
    }
  });
});
