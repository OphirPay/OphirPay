// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const REPO_ROOT = path.resolve(__dirname, "../..");
const ACTION_PATH = path.join(REPO_ROOT, ".github/actions/setup-node-prisma/action.yml");
const WORKFLOWS_DIR = path.join(REPO_ROOT, ".github/workflows");

describe("setup-node-prisma Composite Action", () => {
  it("exists and defines a valid composite action schema", () => {
    expect(fs.existsSync(ACTION_PATH)).toBe(true);
    const content = fs.readFileSync(ACTION_PATH, "utf-8");

    expect(content).toContain('using: "composite"');
    expect(content).toContain("node-version-file");
    expect(content).toContain("prisma-generate");
    expect(content).toContain("actions/setup-node@");
    expect(content).toContain("npm ci");
    expect(content).toContain("npx prisma generate");
  });

  it("pins external actions to full commit SHAs with version comments", () => {
    const content = fs.readFileSync(ACTION_PATH, "utf-8");
    // Verify commit SHA pinning (40 hex chars)
    expect(content).toMatch(/actions\/checkout@[0-9a-f]{40}\s+#\s+v\d+/);
    expect(content).toMatch(/actions\/setup-node@[0-9a-f]{40}\s+#\s+v\d+/);
  });

  it("references a valid .nvmrc file present in the repo", () => {
    const nvmrcPath = path.join(REPO_ROOT, ".nvmrc");
    expect(fs.existsSync(nvmrcPath)).toBe(true);
    const nvmrcContent = fs.readFileSync(nvmrcPath, "utf-8").trim();
    expect(nvmrcContent).toMatch(/^\d+/);
  });

  it("is consumed across all standard Node.js workflow jobs", () => {
    const ciContent = fs.readFileSync(path.join(WORKFLOWS_DIR, "ci.yml"), "utf-8");
    expect(ciContent).toContain("./.github/actions/setup-node-prisma");

    const prismaCiContent = fs.readFileSync(path.join(WORKFLOWS_DIR, "prisma-ci.yml"), "utf-8");
    expect(prismaCiContent).toContain("./.github/actions/setup-node-prisma");

    const e2eNightlyContent = fs.readFileSync(path.join(WORKFLOWS_DIR, "e2e-nightly.yml"), "utf-8");
    expect(e2eNightlyContent).toContain("./.github/actions/setup-node-prisma");

    const depScanContent = fs.readFileSync(path.join(WORKFLOWS_DIR, "dependency-scan.yml"), "utf-8");
    expect(depScanContent).toContain("./.github/actions/setup-node-prisma");
  });
});
