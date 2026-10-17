// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const workflowPath = join(process.cwd(), ".github", "workflows", "docs-lint.yml");
const scriptPath = join(process.cwd(), "scripts", "check-markdown-links.mjs");

describe("Documentation Lint Workflow & Link Check Script (#1419)", () => {
  it("ships .github/workflows/docs-lint.yml", () => {
    expect(existsSync(workflowPath)).toBe(true);
    const raw = readFileSync(workflowPath, "utf8");
    const doc = load(raw) as {
      name: string;
      on: {
        pull_request?: { paths?: string[] };
        push?: { branches?: string[]; paths?: string[] };
      };
      jobs?: Record<string, { steps?: Array<{ run?: string }> }>;
    };

    expect(doc.name).toBe("Documentation Link Integrity");
    expect(doc.on.pull_request?.paths).toEqual(
      expect.arrayContaining(["**.md", "**.mdx"])
    );
    expect(doc.on.push?.branches).toEqual(
      expect.arrayContaining(["main", "integration/staging"])
    );
    expect(doc.jobs?.["docs-lint"]).toBeDefined();
  });

  describe("scripts/check-markdown-links.mjs CLI behavior", () => {
    it("checks explicit files passed via command line", async () => {
      const { stdout } = await execFileAsync(
        process.execPath,
        [scriptPath, "README.md", "CONTRIBUTING.md"],
        { cwd: process.cwd() }
      );
      expect(stdout).toContain("Checked Markdown links in 2 file(s)");
      expect(stdout).toContain("no broken links found");
    });

    it("emits GitHub Actions workflow annotations and exits 1 on broken link", async () => {
      const testDir = join(process.cwd(), "tmp-docs-test");
      mkdirSync(testDir, { recursive: true });
      const testFile = join(testDir, "test-broken.md");
      writeFileSync(testFile, "# Title\n\n[Broken Link](./non-existent-file.md)\n", "utf8");

      try {
        await execFileAsync(
          process.execPath,
          [scriptPath, testFile],
          {
            cwd: process.cwd(),
            env: { ...process.env, GITHUB_ACTIONS: "true" },
          }
        );
        expect.unreachable("script should have failed on broken link");
      } catch (err: unknown) {
        const error = err as { code: number; stderr: string };
        expect(error.code).toBe(1);
        expect(error.stderr).toContain("Found 1 broken Markdown link(s)");
        expect(error.stderr).toContain("::error file=");
        expect(error.stderr).toContain("line=3");
        expect(error.stderr).toContain("missing file ./non-existent-file.md");
      } finally {
        try {
          unlinkSync(testFile);
        } catch {
          // ignore
        }
      }
    });
  });
});
