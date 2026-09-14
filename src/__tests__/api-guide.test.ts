// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import path from "path";

const ROOT = process.cwd();

function readDoc(relPath: string): string {
  const full = path.join(ROOT, relPath);
  expect(existsSync(full), `${relPath} must exist`).toBe(true);
  return readFileSync(full, "utf8");
}

const GUIDE = "docs/API_GUIDE.md";

describe("docs/API_GUIDE.md", () => {
  const guide = readDoc(GUIDE);

  it("documents the file structure convention", () => {
    expect(guide).toMatch(/How API routes are organized/i);
    expect(guide).toContain("src/app/api/");
    expect(guide).toContain("route.ts");
    expect(guide).toContain("[id]");
  });

  it("documents the Zod validation pattern", () => {
    expect(guide).toMatch(/Zod validation/i);
    expect(guide).toContain("safeParse");
    expect(guide).toContain("validationError");
    expect(guide).toContain("validation-schemas.ts");
    expect(guide).toContain("z.coerce");
  });

  it("documents the error-handling pattern", () => {
    expect(guide).toMatch(/Error-handling pattern/i);
    expect(guide).toContain("handleApiError");
    expect(guide).toContain("unauthorizedError");
    expect(guide).toContain("notFoundError");
    expect(guide).toContain("conflictError");
    expect(guide).toContain("serverError");
    expect(guide).toContain("error-codes.ts");
  });

  it("documents auth middleware usage", () => {
    expect(guide).toMatch(/Auth middleware usage/i);
    expect(guide).toContain("getAuthContext");
    expect(guide).toContain("requireAuth");
    expect(guide).toContain("withApiAuth");
    expect(guide).toContain("Authorization: Bearer");
  });

  it("documents the response envelope", () => {
    expect(guide).toMatch(/Response envelope/i);
    expect(guide).toContain("successResponse");
    expect(guide).toContain("success");
    expect(guide).toContain("jsonSafe");
    expect(guide).toContain("timestamp");
  });

  it("documents rate-limit integration", () => {
    expect(guide).toMatch(/Rate-limit integration/i);
    expect(guide).toContain("src/proxy.ts");
    expect(guide).toContain("RATE_LIMIT_RPM");
    expect(guide).toContain("getRateLimitStore");
    expect(guide).toContain("X-RateLimit");
  });

  it("includes a complete, copy-pasteable worked example", () => {
    expect(guide).toMatch(/Worked example/i);
    // A full route file with handler exports
    expect(guide).toContain("export async function GET(request: Request)");
    expect(guide).toContain("export async function POST(request: Request)");
    // Copy-pasteable code fence
    expect(guide).toMatch(/```ts[\s\S]*```/);
    expect(guide).toContain("src/app/api/counterparties/route.ts");
  });

  it("includes a merge checklist", () => {
    expect(guide).toMatch(/Checklist/);
    expect(guide).toContain("npm run typecheck");
    expect(guide).toContain("npm run lint");
    expect(guide).toContain("npm test");
    expect(guide).toContain("docs/openapi.yaml");
  });
});

describe("guide links", () => {
  it("CONTRIBUTING.md links to the API guide", () => {
    const contributing = readDoc("CONTRIBUTING.md");
    expect(contributing).toMatch(/docs\/API_GUIDE\.md/);
  });

  it("docs/integration-guide.md links to the API guide", () => {
    const integration = readDoc("docs/integration-guide.md");
    expect(integration).toMatch(/API_GUIDE\.md/);
  });

  it("docs/openapi.yaml references the API guide", () => {
    const openapi = readDoc("docs/openapi.yaml");
    expect(openapi).toMatch(/API_GUIDE\.md/);
  });
});
