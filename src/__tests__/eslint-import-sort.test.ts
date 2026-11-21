import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("ESLint Import Sort Configuration (Issue #1986)", () => {
  const root = process.cwd();
  const eslintConfigPath = join(root, "eslint.config.mjs");
  const packageJsonPath = join(root, "package.json");

  it("package.json includes eslint-plugin-simple-import-sort in devDependencies", () => {
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    expect(pkg.devDependencies).toBeDefined();
    expect(pkg.devDependencies["eslint-plugin-simple-import-sort"]).toBeDefined();
  });

  it("eslint.config.mjs imports and registers simple-import-sort plugin", () => {
    const content = readFileSync(eslintConfigPath, "utf8");
    expect(content).toContain('import simpleImportSort from "eslint-plugin-simple-import-sort"');
    expect(content).toContain('"simple-import-sort": simpleImportSort');
  });

  it("eslint.config.mjs defines simple-import-sort/imports and simple-import-sort/exports rules", () => {
    const content = readFileSync(eslintConfigPath, "utf8");
    expect(content).toContain('"simple-import-sort/imports"');
    expect(content).toContain('"simple-import-sort/exports"');
  });

  it("eslint.config.mjs configures custom import groups for built-ins, external, and internal aliases", () => {
    const content = readFileSync(eslintConfigPath, "utf8");
    // Side effects
    expect(content).toContain("^\\\\u0000");
    // Node.js built-ins
    expect(content).toContain("^(node:)?(assert|buffer|child_process");
    // External packages
    expect(content).toContain("^@?\\\\w");
    // Internal alias
    expect(content).toContain("^@/");
  });
});
