// SPDX-License-Identifier: MIT

/**
 * Audit-document provenance guards (#689).
 *
 * Generated documents open with a `> Generated for [Issue #N](link)` header.
 * The base hygiene suite (`repo-hygiene.test.ts`) already asserts that a
 * single header's prose number matches its own link. This suite closes the
 * remaining gaps that allowed #689 to reach review:
 *
 * - a document carrying a provenance header must declare its origin issue in
 *   `PINNED_PROVENANCE`, so a newly generated audit document cannot ship with
 *   an unpinned (or semantically wrong) origin number; and
 * - every provenance link must resolve to *this* repository, so a copy-paste
 *   slip cannot silently point readers at another repository's issue.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import path from "path";

const ROOT = process.cwd();

const PROVENANCE =
  /Generated for \[Issue #(\d+)\]\((https:\/\/github\.com\/[^)]*\/issues\/(\d+))\)/g;

const REPO_ISSUE_PREFIX = "https://github.com/OphirPay/OphirPay/issues/";

/** The issue each provenance-bearing document declares as its origin. */
const PINNED_PROVENANCE: Record<string, number> = {
  "docs/RBAC-AUDIT.md": 392,
  "docs/CSRF-AUDIT.md": 563,
};

const SKIP_DIRS = new Set([".git", ".next", "node_modules", "coverage", "dist", "build"]);

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

const docs = walk("docs").filter((file) => file.endsWith(".md"));

describe("audit document provenance (#689)", () => {
  it("pins the origin issue for every document carrying a provenance header", () => {
    const unpinned: string[] = [];
    const drifted: string[] = [];

    for (const doc of docs) {
      const contents = readFileSync(path.join(ROOT, doc), "utf8");
      for (const match of contents.matchAll(PROVENANCE)) {
        const cited = match[1];
        const pinned = PINNED_PROVENANCE[doc];
        if (pinned === undefined) {
          unpinned.push(doc);
        } else if (String(pinned) !== cited) {
          drifted.push(`${doc}: header cites #${cited} but is pinned to #${pinned}`);
        }
      }
    }

    expect(unpinned, `provenance docs missing a pinned origin: ${unpinned.join(", ")}`).toEqual([]);
    expect(drifted, drifted.join("; ")).toEqual([]);
  });

  it("resolves every provenance header to this repository", () => {
    const foreign: string[] = [];

    for (const doc of docs) {
      const contents = readFileSync(path.join(ROOT, doc), "utf8");
      for (const match of contents.matchAll(PROVENANCE)) {
        if (!match[2].startsWith(REPO_ISSUE_PREFIX)) {
          foreign.push(`${doc}: ${match[2]}`);
        }
      }
    }

    expect(foreign, `provenance links pointing outside this repo: ${foreign.join(", ")}`).toEqual(
      []
    );
  });
});
