// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  parseCommit,
  groupCommits,
  formatEntry,
  formatSection,
} from "./generate-changelog.mjs";

describe("Automated Changelog Generator (scripts/generate-changelog.mjs)", () => {
  it("parses conventional commits with scope and PR number", () => {
    const raw = "abc1234567890\x1ffeat(payments): add instant QR payment flow (#1234)\x1fResolves #1000\x1fAlice\x1falice@example.com";
    const commit = parseCommit(raw);

    expect(commit).not.toBeNull();
    expect(commit?.type).toBe("feat");
    expect(commit?.scope).toBe("payments");
    expect(commit?.description).toBe("add instant QR payment flow (#1234)");
    expect(commit?.prNumber).toBe("1234");
    expect(commit?.issueNumber).toBe("1000");
    expect(commit?.author).toBe("Alice");
    expect(commit?.isBreaking).toBe(false);
  });

  it("detects breaking changes via subject and body markers", () => {
    const raw1 = "abc1234567890\x1ffeat!: change payment ID format\x1f\x1fBob\x1fbob@example.com";
    const commit1 = parseCommit(raw1);
    expect(commit1?.isBreaking).toBe(true);

    const raw2 = "def1234567890\x1ffix: update auth header\x1fBREAKING CHANGE: token format changed\x1fBob\x1fbob@example.com";
    const commit2 = parseCommit(raw2);
    expect(commit2?.isBreaking).toBe(true);
  });

  it("detects security fixes by type or scope", () => {
    const raw = "abc1234567890\x1ffix(security): prevent timing side-channel attacks on webhook signature\x1f\x1fCarol\x1fcarol@example.com";
    const commit = parseCommit(raw);
    expect(commit).not.toBeNull();

    const groups = groupCommits([commit!]);
    expect(groups.security.length).toBe(1);
    expect(groups.security[0].scope).toBe("security");
  });

  it("groups commits into Added, Fixed, Performance, Security, and Changed", () => {
    const commits = [
      parseCommit("111\x1ffeat: new webhook retry endpoint (#101)\x1f\x1fUser1\x1f"),
      parseCommit("222\x1ffix: resolve memory leak in stream listener (#102)\x1f\x1fUser2\x1f"),
      parseCommit("333\x1fperf: speed up batch payment simulation (#103)\x1f\x1fUser3\x1f"),
      parseCommit("444\x1frefactor: simplify database queries (#104)\x1f\x1fUser4\x1f"),
    ].filter(Boolean);

    const groups = groupCommits(commits as any[]);
    expect(groups.added.length).toBe(1);
    expect(groups.fixed.length).toBe(1);
    expect(groups.performance.length).toBe(1);
    expect(groups.changed.length).toBe(1);
  });

  it("formats markdown sections matching Keep a Changelog standard", () => {
    const commits = [
      parseCommit("111\x1ffeat(streams): add interactive vesting chart (#1488)\x1f\x1flilian\x1f"),
      parseCommit("222\x1ffix(webhooks): timing-safe HMAC verification (#1492)\x1f\x1flilian\x1f"),
    ].filter(Boolean);

    const groups = groupCommits(commits as any[]);
    const markdown = formatSection(groups, "0.3.0", "2026-10-15");

    expect(markdown).toContain("## [0.3.0] — 2026-10-15");
    expect(markdown).toContain("### Added");
    expect(markdown).toContain("### Fixed");
    expect(markdown).toContain("**streams**: add interactive vesting chart (#1488)");
    expect(markdown).toContain("**webhooks**: timing-safe HMAC verification (#1492)");
  });
});
