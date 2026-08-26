// SPDX-License-Identifier: MIT
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("API Cookbook Documentation Conformance", () => {
  const rootDir = path.resolve(__dirname, "../../");
  const cookbookPath = path.join(rootDir, "docs/API_COOKBOOK.md");
  const openapiPath = path.join(rootDir, "docs/openapi.yaml");

  it("ensures docs/API_COOKBOOK.md exists and has substantial content", () => {
    expect(fs.existsSync(cookbookPath)).toBe(true);
    const content = fs.readFileSync(cookbookPath, "utf-8");
    expect(content.length).toBeGreaterThan(10000);
    expect(content).toContain("# OphirPay API Cookbook");
  });

  it("covers authentication mechanisms in the overview", () => {
    const content = fs.readFileSync(cookbookPath, "utf-8");
    expect(content).toContain("Authorization: Bearer");
    expect(content).toContain("X-API-Key:");
    expect(content).toContain("Cookie: ophirpay_session=");
  });

  it("documents standard error codes and status codes", () => {
    const content = fs.readFileSync(cookbookPath, "utf-8");
    expect(content).toContain("400 Bad Request");
    expect(content).toContain("401 Unauthorized");
    expect(content).toContain("403 Forbidden");
    expect(content).toContain("404 Not Found");
    expect(content).toContain("409 Conflict");
    expect(content).toContain("500 Internal Error");
  });

  it("verifies every endpoint in openapi.yaml is present in the cookbook", () => {
    const openapiContent = fs.readFileSync(openapiPath, "utf-8");
    const cookbookContent = fs.readFileSync(cookbookPath, "utf-8");

    // Extract paths from openapi.yaml
    const pathRegex = /^ {2}(\/api\/[a-zA-Z0-9_\-\/{}:]+):/gm;
    const matches = Array.from(openapiContent.matchAll(pathRegex));
    const documentedPaths = matches.map((m) => m[1]);

    expect(documentedPaths.length).toBeGreaterThan(30);

    for (const apiPath of documentedPaths) {
      expect(cookbookContent).toContain(apiPath);
    }
  });

  it("verifies runnable curl blocks and JSON response snippets are included", () => {
    const content = fs.readFileSync(cookbookPath, "utf-8");
    const curlCount = (content.match(/```bash[\s\S]*?curl /g) || []).length;
    const jsonCount = (content.match(/```json/g) || []).length;

    expect(curlCount).toBeGreaterThanOrEqual(40);
    expect(jsonCount).toBeGreaterThanOrEqual(40);
  });
});
