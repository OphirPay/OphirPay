// SPDX-License-Identifier: MIT

/**
 * Repository hygiene guards.
 *
 * These tests encode conventions that were previously only enforced by habit:
 *
 * - `#688` — Vitest files must live under the sanctioned test roots, never
 *   colocated inside shipped source (`src/lib`, `src/app`, …), and the Vitest
 *   include glob must not admit them.
 * - `#689` — A "Generated for Issue #N" header must cite the *same* issue
 *   number in its prose as in its link, so a copy-paste slip cannot silently
 *   send readers to an unrelated issue.
 * - `#690` — The repository root may only contain intentional documents;
 *   automation leftovers such as `docs_update.md` must not accumulate.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
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

/** Recursively collect file paths (relative to `ROOT`) below `relDir`. */
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

// ── #688: test file location convention ─────────────────────────────────────

describe("test file locations (#688)", () => {
  const TEST_FILE = /\.test\.(ts|tsx)$/;
  const SANCTIONED_ROOTS = [/^src\/__tests__\//, /^scripts\//, /^tests\//];

  it("keeps every Vitest file inside a sanctioned test root", () => {
    const testFiles = [...walk("src"), ...walk("scripts"), ...walk("tests")].filter((file) =>
      TEST_FILE.test(file)
    );

    expect(testFiles.length).toBeGreaterThan(0);

    const strays = testFiles.filter(
      (file) => !SANCTIONED_ROOTS.some((pattern) => pattern.test(file))
    );
    expect(strays, `stray test files: ${strays.join(", ")}`).toEqual([]);
  });

  it("has no *.test.ts file left inside src/lib", () => {
    const inLib = walk("src/lib").filter((file) => TEST_FILE.test(file));
    expect(inLib).toEqual([]);
  });

  it("restricts the Vitest include glob to the sanctioned test roots", () => {
    const config = readFileSync(path.join(ROOT, "vitest.config.ts"), "utf8");
    const includeArrays = [...config.matchAll(/include:\s*\[([^\]]*)\]/g)].map((match) =>
      [...match[1].matchAll(/"([^"]+)"/g)].map((inner) => inner[1])
    );

    const testsInclude = includeArrays.find((patterns) =>
      patterns.includes("src/__tests__/**/*.test.{ts,tsx}")
    );
    expect(testsInclude, "vitest test.include must cover src/__tests__").toBeDefined();
    expect(testsInclude).toEqual(
      expect.arrayContaining([
        "src/__tests__/**/*.test.{ts,tsx}",
        "scripts/**/*.test.{ts,tsx}",
        "tests/**/*.test.{ts,tsx}",
      ])
    );

    // A repo-wide glob is what allowed tests to hide inside shipped source.
    for (const patterns of includeArrays) {
      expect(patterns).not.toContain("**/*.test.{ts,tsx}");
    }
  });
});

// ── #689: audit-document provenance headers ─────────────────────────────────

describe("audit document provenance (#689)", () => {
  const PROVENANCE =
    /Generated for \[Issue #(\d+)\]\((https:\/\/github\.com\/[^)]*\/issues\/(\d+))\)/g;

  const docs = walk("docs").filter((file) => file.endsWith(".md"));

  it("cites the same issue number in prose as in the link", () => {
    const mismatches: string[] = [];

    for (const doc of docs) {
      const contents = readFileSync(path.join(ROOT, doc), "utf8");
      for (const match of contents.matchAll(PROVENANCE)) {
        const [, cited, , linked] = match;
        if (cited !== linked) {
          mismatches.push(`${doc}: prose cites #${cited} but links to #${linked}`);
        }
      }
    }

    expect(mismatches, mismatches.join("; ")).toEqual([]);
  });

  it("points each generated audit document at the issue it describes", () => {
    const expected: Record<string, number> = {
      "docs/RBAC-AUDIT.md": 392,
      "docs/CSRF-AUDIT.md": 563,
    };

    for (const [doc, issue] of Object.entries(expected)) {
      const contents = readFileSync(path.join(ROOT, doc), "utf8");
      expect(contents, `${doc} should cite #${issue}`).toContain(`Generated for [Issue #${issue}]`);
    }
  });

  it("keeps the secrets rotation runbook tied to its origin issue", () => {
    const rotation = readFileSync(path.join(ROOT, "docs/SECRETS_ROTATION.md"), "utf8");
    expect(rotation).toMatch(/issue #562\b/i);
  });
});

// ── #690: no stray automation documents at the repository root ──────────────

describe("repository root hygiene (#690)", () => {
  const rootEntries = readdirSync(ROOT).filter((entry) =>
    statSync(path.join(ROOT, entry)).isFile()
  );

  it("does not keep the automation leftover docs_update.md", () => {
    expect(existsSync(path.join(ROOT, "docs_update.md"))).toBe(false);
    expect(rootEntries).not.toContain("docs_update.md");
  });

  it("has no automation-shaped *_update.md files at the root", () => {
    const strays = rootEntries.filter((entry) => /_update\.md$/i.test(entry));
    expect(strays, `stray update docs: ${strays.join(", ")}`).toEqual([]);
  });

  it("does not link to the deleted docs_update.md from any tracked doc", () => {
    const markdown = [
      ...rootEntries.filter((entry) => entry.endsWith(".md")),
      ...walk("docs").filter((file) => file.endsWith(".md")),
    ];

    const referrers = markdown.filter((file) =>
      readFileSync(path.join(ROOT, file), "utf8").includes("docs_update")
    );
    expect(
      referrers,
      `documents still referencing docs_update.md: ${referrers.join(", ")}`
    ).toEqual([]);
  });

  it("keeps the API guide as the home of the add-an-endpoint workflow", () => {
    const guide = readFileSync(path.join(ROOT, "docs/API_GUIDE.md"), "utf8");
    expect(guide).toMatch(/adding new API endpoints/i);
    expect(guide).toContain("src/app/api/");
  });
});
