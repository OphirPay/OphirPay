// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import {
  parseCommitRecord,
  categorizeCommit,
  formatChangelogSection,
  parseArgs,
} from "../../scripts/generate-changelog.mjs";

describe("Conventional Changelog Generator (#1414)", () => {
  it("parses CLI arguments correctly", () => {
    const opts = parseArgs([
      "--from",
      "v1.0.0",
      "--to",
      "v1.1.0",
      "--version",
      "1.1.0",
      "--write",
    ]);

    expect(opts.from).toBe("v1.0.0");
    expect(opts.to).toBe("v1.1.0");
    expect(opts.version).toBe("1.1.0");
    expect(opts.write).toBe(true);
    expect(opts.dryRun).toBe(false);
  });

  it("parses conventional commit record with scope and PR number", () => {
    const record =
      "abc1234567890\x1fabc1234\x1fJane Doe\x1fjane@users.noreply.github.com\x1ffeat(payments): add batch streaming (#789)\x1fCloses #789";
    const commit = parseCommitRecord(record);

    expect(commit).not.toBeNull();
    expect(commit?.type).toBe("feat");
    expect(commit?.scope).toBe("payments");
    expect(commit?.description).toBe("add batch streaming");
    expect(commit?.prNumber).toBe("789");
    expect(commit?.handle).toBe("jane");
    expect(commit?.isBreaking).toBe(false);
  });

  it("detects breaking changes via exclamation mark", () => {
    const record =
      "def1234567890\x1fdef1234\x1fJohn Doe\x1fjohn@example.com\x1ffeat(api)!: redesign authentication endpoints\x1f";
    const commit = parseCommitRecord(record);

    expect(commit).not.toBeNull();
    expect(commit?.isBreaking).toBe(true);
    expect(categorizeCommit(commit)).toBe("breaking");
  });

  it("detects breaking changes via BREAKING CHANGE in body", () => {
    const record =
      "def1234567890\x1fdef1234\x1fJohn Doe\x1fjohn@example.com\x1ffix(core): update serialization format\x1fBREAKING CHANGE: old formats no longer supported";
    const commit = parseCommitRecord(record);

    expect(commit).not.toBeNull();
    expect(commit?.isBreaking).toBe(true);
    expect(categorizeCommit(commit)).toBe("breaking");
  });

  it("categorizes commits properly across all types", () => {
    const mockCommit = (type: string, scope = "") => ({
      hash: "123",
      shortHash: "123",
      author: "Test",
      handle: "test",
      subject: "test",
      type,
      scope,
      description: "test",
      prNumber: null,
      isBreaking: false,
      body: "",
    });

    expect(categorizeCommit(mockCommit("feat"))).toBe("feat");
    expect(categorizeCommit(mockCommit("fix"))).toBe("fix");
    expect(categorizeCommit(mockCommit("perf"))).toBe("perf");
    expect(categorizeCommit(mockCommit("docs"))).toBe("docs");
    expect(categorizeCommit(mockCommit("security"))).toBe("security");
    expect(categorizeCommit(mockCommit("fix", "security"))).toBe("security");
    expect(categorizeCommit(mockCommit("refactor"))).toBe("changed");
    expect(categorizeCommit(mockCommit("chore"))).toBe("changed");
    expect(categorizeCommit(mockCommit("ci"))).toBe("changed");
  });

  it("formats markdown changelog section matching Keep a Changelog style", () => {
    const commits = [
      {
        hash: "a1b2c3d4e5f6",
        shortHash: "a1b2c3d",
        author: "Alice",
        handle: "alice",
        subject: "feat(auth): add passkey authentication (#101)",
        type: "feat",
        scope: "auth",
        description: "add passkey authentication",
        prNumber: "101",
        isBreaking: false,
        body: "",
      },
      {
        hash: "b2c3d4e5f6a1",
        shortHash: "b2c3d4e",
        author: "Bob",
        handle: "bob",
        subject: "fix(webhook): handle signature clock skew (#102)",
        type: "fix",
        scope: "webhook",
        description: "handle signature clock skew",
        prNumber: "102",
        isBreaking: false,
        body: "",
      },
    ];

    const formatted = formatChangelogSection(commits, "1.2.0", "2026-10-18");

    expect(formatted).toContain("## [1.2.0] — 2026-10-18");
    expect(formatted).toContain("### Features");
    expect(formatted).toContain("- **auth**: add passkey authentication ([#101](https://github.com/OphirPay/OphirPay/pull/101)) by [@alice](https://github.com/alice)");
    expect(formatted).toContain("### Bug Fixes");
    expect(formatted).toContain("- **webhook**: handle signature clock skew ([#102](https://github.com/OphirPay/OphirPay/pull/102)) by [@bob](https://github.com/bob)");
  });

  it("runs changelog:check CLI successfully against repo commit history", () => {
    const result = spawnSync("node", ["scripts/generate-changelog.mjs", "--check"], {
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Changelog formatting check: PASSED.");
  });
});
