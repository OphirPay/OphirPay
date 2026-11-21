// SPDX-License-Identifier: MIT
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

describe("Markdown links check workflow (#1985)", () => {
  const repoRoot = join(__dirname, "../..");
  const workflowPath = join(repoRoot, ".github/workflows/links.yml");
  const ignorePath = join(repoRoot, ".lycheeignore");

  it("defines the links.yml workflow file and valid YAML", () => {
    expect(existsSync(workflowPath)).toBe(true);
    const content = readFileSync(workflowPath, "utf8");
    const parsed = load(content) as Record<string, unknown>;
    expect(parsed).toBeDefined();
    expect(parsed.name).toBe("Check Markdown Links");
  });

  it("triggers on pull requests modifying markdown files and README", () => {
    const content = readFileSync(workflowPath, "utf8");
    const parsed = load(content) as {
      on: {
        pull_request?: { paths?: string[] };
      };
    };
    const paths = parsed.on?.pull_request?.paths ?? [];
    expect(paths).toContain("docs/**/*.md");
    expect(paths).toContain("README.md");
  });

  it("uses lycheeverse/lychee-action with localhost/loopback exclusion", () => {
    const content = readFileSync(workflowPath, "utf8");
    expect(content).toContain("lycheeverse/lychee-action");
    expect(content).toContain("--exclude-loopback");
    expect(content).toContain("localhost");
  });

  it("defines .lycheeignore with sensible default exclusions", () => {
    expect(existsSync(ignorePath)).toBe(true);
    const content = readFileSync(ignorePath, "utf8");
    expect(content).toContain("localhost");
    expect(content).toMatch(/127\\?\.0\\?\.0\\?\.1/);
  });
});
