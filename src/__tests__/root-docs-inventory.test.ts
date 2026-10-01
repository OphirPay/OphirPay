// SPDX-License-Identifier: MIT

/**
 * Repository-root document inventory guard (#690).
 *
 * `docs_update.md` was an automation artifact left at the repository root. The
 * base hygiene suite (`repo-hygiene.test.ts`) rejects that specific leftover
 * and any `*_update.md` file, but that check is name-shaped: an automation
 * artifact called anything else slips straight through.
 *
 * This guard treats the root as an inventory instead. A markdown document may
 * only live at the repository root if it is deliberately listed in
 * `ALLOWED_ROOT_MARKDOWN`, so automation-created markdown cannot accumulate
 * unnoticed.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, statSync } from "fs";
import path from "path";

const ROOT = process.cwd();

/** Root-level markdown that is intentionally part of the project. */
const ALLOWED_ROOT_MARKDOWN = new Set([
  "CHANGELOG.md",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "GLOSSARY.md",
  "GOVERNANCE.md",
  "MAINTAINERS.md",
  "README.md",
  "README.es.md",
  "README.fr.md",
  "README.ja.md",
  "RELEASE.md",
  "ROADMAP.md",
  "SECURITY.md",
]);

describe("repository root document inventory (#690)", () => {
  it("keeps only intentional markdown documents at the repository root", () => {
    const rootEntries = readdirSync(ROOT).filter((entry) =>
      statSync(path.join(ROOT, entry)).isFile()
    );
    const rootMarkdown = rootEntries.filter((entry) => entry.toLowerCase().endsWith(".md"));
    const unexpected = rootMarkdown.filter((entry) => !ALLOWED_ROOT_MARKDOWN.has(entry));

    expect(
      unexpected,
      `unexpected root-level markdown (add it to ALLOWED_ROOT_MARKDOWN if intentional): ${unexpected.join(", ")}`
    ).toEqual([]);
  });

  it("does not keep the automation leftover docs_update.md", () => {
    expect(existsSync(path.join(ROOT, "docs_update.md"))).toBe(false);
  });
});
