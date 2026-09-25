// SPDX-License-Identifier: MIT

/**
 * Issue #764 — Suppression guard and explicit `any` elimination tests.
 *
 * Verifies that:
 * 1. Zero explicit `any` types remain in `src/` (excluding third-party / generated files).
 * 2. `@typescript-eslint/no-explicit-any` is enabled as `"error"` in `eslint.config.mjs`.
 * 3. Every `eslint-disable` directive in the repository carries a documented `-- <reason>` justification.
 * 4. The `suppression-guard/require-description` ESLint rule catches unjustified directives.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import path from "path";

const ROOT = process.cwd();

const SKIP_DIRS = new Set([
  ".git",
  ".next",
  "node_modules",
  "coverage",
  "target",
  "dist",
  "build",
  "playwright-report",
  "test-results",
  ".turbo",
]);

function walk(relDir: string): string[] {
  const absDir = path.join(ROOT, relDir);
  if (!existsSync(absDir)) return [];

  const found: string[] = [];
  for (const entry of readdirSync(absDir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const rel = relDir ? path.join(relDir, entry) : entry;
    const abs = path.join(ROOT, rel);
    if (statSync(abs).isDirectory()) {
      found.push(...walk(rel));
    } else {
      found.push(rel.split(path.sep).join("/"));
    }
  }
  return found;
}

describe("ESLint & TypeScript type safety guards (Issue #764)", () => {
  it("enforces no-explicit-any as error in eslint.config.mjs", () => {
    const eslintConfig = readFileSync(path.join(ROOT, "eslint.config.mjs"), "utf8");
    expect(eslintConfig).toMatch(/"@typescript-eslint\/no-explicit-any":\s*"error"/);
  });

  it("enforces suppression-guard/require-description as error in eslint.config.mjs", () => {
    const eslintConfig = readFileSync(path.join(ROOT, "eslint.config.mjs"), "utf8");
    expect(eslintConfig).toMatch(/"suppression-guard\/require-description":\s*"error"/);
    expect(eslintConfig).toContain("suppressionGuardPlugin");
  });

  it("has zero explicit any types across src/ (excluding comments)", () => {
    const srcFiles = walk("src").filter(
      (f) =>
        (f.endsWith(".ts") || f.endsWith(".tsx")) &&
        !f.includes(".d.ts") &&
        f !== "src/__tests__/suppression-guard.test.ts"
    );

    const filesWithExplicitAny: { file: string; line: number; text: string }[] = [];
    const ANY_REGEX = /(:\s*any\b|<any>|as\s+any\b|any\[\])/;

    for (const file of srcFiles) {
      const content = readFileSync(path.join(ROOT, file), "utf8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        // Ignore single-line comments or doc comment lines
        if (
          trimmed.startsWith("//") ||
          trimmed.startsWith("*") ||
          trimmed.startsWith("/*")
        ) {
          continue;
        }
        if (ANY_REGEX.test(line)) {
          filesWithExplicitAny.push({ file, line: i + 1, text: trimmed });
        }
      }
    }

    expect(
      filesWithExplicitAny,
      `Found explicit any types:\n${filesWithExplicitAny
        .map((e) => `  ${e.file}:${e.line} -> ${e.text}`)
        .join("\n")}`
    ).toEqual([]);
  });

  it("ensures every surviving eslint-disable comment has a documented justification", () => {
    const trackedFiles = [...walk("src"), ...walk("scripts"), ...walk("tests")].filter(
      (f) =>
        (f.endsWith(".ts") || f.endsWith(".tsx") || f.endsWith(".js") || f.endsWith(".mjs")) &&
        f !== "src/__tests__/suppression-guard.test.ts"
    );

    const unjustifiedDisables: { file: string; line: number; text: string }[] = [];
    const DISABLE_PATTERN = /(?:\/\/|\/\*|\{\/\*)\s*eslint-disable(-next-line|-line)?(\s|$)/;
    const JUSTIFICATION_PATTERN = /--\s*\S+/;

    for (const file of trackedFiles) {
      const content = readFileSync(path.join(ROOT, file), "utf8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (DISABLE_PATTERN.test(line)) {
          if (!JUSTIFICATION_PATTERN.test(line)) {
            unjustifiedDisables.push({
              file,
              line: i + 1,
              text: line.trim(),
            });
          }
        }
      }
    }

    expect(
      unjustifiedDisables,
      `Unjustified eslint-disable comments found:\n${unjustifiedDisables
        .map((e) => `  ${e.file}:${e.line} -> ${e.text}`)
        .join("\n")}`
    ).toEqual([]);
  });
});
