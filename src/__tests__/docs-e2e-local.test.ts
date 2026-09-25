// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const DOC_PATH = path.join(ROOT, "docs/testing/e2e-local.md");
const SCRIPT_PATH = path.join(ROOT, "scripts/e2e-local.sh");
const PKG_PATH = path.join(ROOT, "package.json");
const CONFIG_PATH = path.join(ROOT, "playwright.config.ts");

describe("Local E2E Documentation & Convenience Runner (Issue #780)", () => {
  it("docs/testing/e2e-local.md exists and contains substantial guidance", () => {
    expect(fs.existsSync(DOC_PATH)).toBe(true);
    const content = fs.readFileSync(DOC_PATH, "utf-8");
    expect(content.length).toBeGreaterThan(1500);
  });

  it("documents the live server requirement and E2E_BASE_URL", () => {
    const content = fs.readFileSync(DOC_PATH, "utf-8");
    expect(content).toContain("webServer");
    expect(content).toContain("E2E_BASE_URL");
    expect(content).toContain("http://localhost:3000");
    expect(content).toContain("/api/health");
  });

  it("distinguishes the three Playwright configurations and commands", () => {
    const content = fs.readFileSync(DOC_PATH, "utf-8");
    // Functional E2E
    expect(content).toContain("playwright.config.ts");
    expect(content).toContain("npm run test:e2e");
    // Visual regression
    expect(content).toContain("playwright.visual.config.ts");
    expect(content).toContain("npm run test:visual");
    // Accessibility
    expect(content).toContain("accessibility.spec.ts");
    expect(content).toContain("npm run test:a11y");
  });

  it("identifies which specs require mocked Stellar and SSE helpers", () => {
    const content = fs.readFileSync(DOC_PATH, "utf-8");
    expect(content).toContain("e2e/helpers/stellar-mock.ts");
    expect(content).toContain("e2e/helpers/sse-mock.ts");
    expect(content).toContain("e2e/helpers/admin-mocks.ts");
    expect(content).toContain("e2e/helpers/refunds-mock.ts");
    expect(content).toContain("multisig-flow.spec.ts");
    expect(content).toContain("notifications.spec.ts");
    expect(content).toContain("refunds.spec.ts");
  });

  it("documents database seeding and teardown", () => {
    const content = fs.readFileSync(DOC_PATH, "utf-8");
    expect(content).toContain("npx prisma db push");
    expect(content).toContain("npm run db:seed");
  });

  it("verifies scripts/e2e-local.sh exists and is executable", () => {
    expect(fs.existsSync(SCRIPT_PATH)).toBe(true);
    const content = fs.readFileSync(SCRIPT_PATH, "utf-8");
    expect(content).toContain("/api/health");
    expect(content).toContain("trap cleanup EXIT");
    expect(content).toContain("npx playwright test");
  });

  it("verifies package.json exposes test:e2e:local", () => {
    const pkg = JSON.parse(fs.readFileSync(PKG_PATH, "utf-8"));
    expect(pkg.scripts["test:e2e:local"]).toBeDefined();
    expect(pkg.scripts["test:e2e:local"]).toContain("scripts/e2e-local.sh");
  });

  it("verifies playwright.config.ts references the documentation", () => {
    const config = fs.readFileSync(CONFIG_PATH, "utf-8");
    expect(config).toContain("docs/testing/e2e-local.md");
    expect(config).toContain("test:e2e:local");
  });
});
