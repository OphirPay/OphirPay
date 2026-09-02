// SPDX-License-Identifier: MIT
//
// Content tests for the changelog maintenance guide (issue #32).
// These guard the acceptance criteria: the guide must document Keep a
// Changelog conventions with an example for each change type, describe the
// release flow, and be linked from CONTRIBUTING.md.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const guidePath = path.join(root, "docs", "CHANGELOG_GUIDE.md");
const contributingPath = path.join(root, "CONTRIBUTING.md");

/**
 * Extract the text of a `### <heading>` section from a markdown document.
 *
 * Only the ``` fence delimiters are skipped; the *content inside* fenced code
 * blocks is intentionally kept in the body, because the category examples in
 * CHANGELOG_GUIDE.md live inside ```markdown fences and the tests below
 * assert on them. Headings inside fences do not terminate the section.
 * Returns the section body (without the heading line) or "" if missing.
 */
function sectionAfter(markdown: string, heading: string): string {
  const lines = markdown.split("\n");
  let inSection = false;
  let inCodeFence = false;
  const body: string[] = [];
  for (const line of lines) {
    if (line.startsWith("```")) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (!inCodeFence && line.startsWith(`### ${heading}`)) {
      inSection = true;
      continue;
    }
    if (inSection && !inCodeFence && line.startsWith("### ")) {
      break;
    }
    if (inSection) {
      body.push(line);
    }
  }
  return body.join("\n");
}

describe("docs/CHANGELOG_GUIDE.md (changelog maintenance guide)", () => {
  it("exists", () => {
    expect(existsSync(guidePath)).toBe(true);
  });

  const guide = existsSync(guidePath) ? readFileSync(guidePath, "utf8") : "";

  it("documents Keep a Changelog conventions", () => {
    expect(guide).toMatch(/Keep a Changelog/i);
    expect(guide).toMatch(/Semantic Versioning/i);
  });

  it("documents the Added change type with an example", () => {
    const added = sectionAfter(guide, "Added");
    expect(added).toMatch(/Refunds page/);
    expect(added).toMatch(/NEXT_PUBLIC_DEMO_MODE/);
  });

  it("documents the Changed change type with an example", () => {
    const changed = sectionAfter(guide, "Changed");
    expect(changed).toMatch(/Next\.js 16 upgrade/);
    expect(changed).toMatch(/React Query rollout complete/);
  });

  it("documents the Fixed change type with an example", () => {
    const fixed = sectionAfter(guide, "Fixed");
    expect(fixed).toMatch(/Governance list renders real proposals/);
    expect(fixed).toMatch(/Timelock/);
  });

  it("documents the Removed change type with an example", () => {
    const removed = sectionAfter(guide, "Removed");
    expect(removed).toMatch(/instrumentationHook/);
    expect(removed).toMatch(/Hardcoded testnet fallbacks/);
  });

  it("documents the Security change type with an example", () => {
    const security = sectionAfter(guide, "Security");
    expect(security).toMatch(/Voting weight/);
    expect(security).toMatch(/Reentrancy guard/);
  });

  it("describes the release flow including versioning and a PR checklist", () => {
    expect(guide).toMatch(/## 6\. Release flow/);
    expect(guide).toMatch(/MAJOR/);
    expect(guide).toMatch(/MINOR/);
    expect(guide).toMatch(/PATCH/);
    expect(guide).toMatch(/PR checklist/);
  });
});

describe("CONTRIBUTING.md changelog link", () => {
  const contributing = existsSync(contributingPath)
    ? readFileSync(contributingPath, "utf8")
    : "";

  it("links to the changelog maintenance guide", () => {
    expect(contributing).toMatch(/docs\/CHANGELOG_GUIDE\.md/);
  });

  it("directs contributors to add entries under [Unreleased]", () => {
    expect(contributing).toMatch(/\[Unreleased\]/);
  });
});
