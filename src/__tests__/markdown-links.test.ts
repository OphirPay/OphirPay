// SPDX-License-Identifier: MIT
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SCRIPT_PATH = path.join(ROOT, "scripts", "check-markdown-links.mjs");

describe("Markdown link integrity checker (scripts/check-markdown-links.mjs)", () => {
  it("passes when checking a valid markdown file with internal anchors", () => {
    const tmpFile = path.join(ROOT, "test-valid-links.md");
    fs.writeFileSync(
      tmpFile,
      `# Test Document\n\n## Section One {#sec-1}\n\nLink to [Section One](#sec-1) or [Relative README](README.md).\n`
    );
    try {
      const output = execFileSync(process.execPath, [SCRIPT_PATH, tmpFile], {
        encoding: "utf8",
      });
      expect(output).toContain("no broken links found");
    } finally {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
  });

  it("ignores external third-party domains (stellar.org, github.com, crates.io) with zero false positives", () => {
    const tmpFile = path.join(ROOT, "test-external-links.md");
    fs.writeFileSync(
      tmpFile,
      `# External Links\n\n- [Stellar Documentation](https://stellar.org/docs)\n- [Developers Stellar](developers.stellar.org)\n- [GitHub Repo](https://github.com/OphirPay/OphirPay)\n- [Crates.io](crates.io)\n`
    );
    try {
      const output = execFileSync(process.execPath, [SCRIPT_PATH, tmpFile], {
        encoding: "utf8",
      });
      expect(output).toContain("no broken links found");
    } finally {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
  });

  it("detects broken file targets and reports line numbers and workflow annotations", () => {
    const tmpFile = path.join(ROOT, "test-broken-links.md");
    fs.writeFileSync(
      tmpFile,
      `# Broken Links\n\nLine 3 has [Broken Link](non-existent-target-file.md).\n`
    );
    try {
      let threw = false;
      try {
        execFileSync(process.execPath, [SCRIPT_PATH, tmpFile, "--annotations"], {
          encoding: "utf8",
        });
      } catch (err: unknown) {
        threw = true;
        const errorOutput = (err as { stdout?: string; stderr?: string }).stderr || (err as { stdout?: string }).stdout || "";
        expect(errorOutput).toContain("test-broken-links.md:3: missing file non-existent-target-file.md");
        const stdout = (err as { stdout?: string }).stdout || "";
        expect(stdout).toContain("::error file=test-broken-links.md,line=3,title=Broken Markdown Link::missing file non-existent-target-file.md");
      }
      expect(threw).toBe(true);
    } finally {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
  });

  it("detects broken heading anchors within the same file", () => {
    const tmpFile = path.join(ROOT, "test-broken-anchor.md");
    fs.writeFileSync(
      tmpFile,
      `# Header One\n\nLink to [Non-existent Anchor](#missing-section).\n`
    );
    try {
      let threw = false;
      try {
        execFileSync(process.execPath, [SCRIPT_PATH, tmpFile], {
          encoding: "utf8",
        });
      } catch (err: unknown) {
        threw = true;
        const errorOutput = (err as { stdout?: string; stderr?: string }).stderr || (err as { stdout?: string }).stdout || "";
        expect(errorOutput).toContain("missing anchor #missing-section");
      }
      expect(threw).toBe(true);
    } finally {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
  });

  it("handles --changed gracefully when no files changed", () => {
    const output = execFileSync(
      process.execPath,
      [SCRIPT_PATH, "--changed"],
      { encoding: "utf8" }
    );
    expect(output).toMatch(/(No changed Markdown files detected|Checked Markdown links)/);
  });
});
