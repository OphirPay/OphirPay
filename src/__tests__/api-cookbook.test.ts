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

  it("verifies every endpoint and HTTP method in openapi.yaml is present in the cookbook", () => {
    const openapiContent = fs.readFileSync(openapiPath, "utf-8");
    const cookbookContent = fs.readFileSync(cookbookPath, "utf-8");

    // Match each endpoint and its HTTP methods
    const endpointRegex =
      /^ {2}(\/api\/[a-zA-Z0-9_\-\/{}:]+):\s*\n((?: {4}[a-z]+:[\s\S]*?(?=\n {2}\/|\n {0,2}[a-zA-Z]|$))+)/gm;
    const methodRegex = /^ {4}(get|post|put|patch|delete):/gm;

    let operationCount = 0;
    for (const match of openapiContent.matchAll(endpointRegex)) {
      const apiPath = match[1];
      const operationsBlock = match[2];
      for (const methodMatch of operationsBlock.matchAll(methodRegex)) {
        const method = methodMatch[1].toUpperCase();
        operationCount++;
        // Check that cookbook documents this specific method and endpoint path pair
        expect(cookbookContent).toContain(`\`${method} ${apiPath}\``);
      }
    }

    expect(operationCount).toBeGreaterThanOrEqual(40);
  });

  it("verifies runnable curl blocks and JSON response snippets are included", () => {
    const content = fs.readFileSync(cookbookPath, "utf-8");
    const curlCount = (content.match(/```bash[\s\S]*?curl /g) || []).length;
    const jsonCount = (content.match(/```json/g) || []).length;

    expect(curlCount).toBeGreaterThanOrEqual(40);
    expect(jsonCount).toBeGreaterThanOrEqual(40);
  });
});
