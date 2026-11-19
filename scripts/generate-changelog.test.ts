// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  parseArgs,
  parseRawGitLog,
  extractGitHubHandle,
  extractPrNumber,
  parseConventionalCommit,
  groupCommits,
  formatChangelogItem,
  generateChangelogMarkdown,
  updateChangelogContent,
} from "./generate-changelog.mjs";

describe("generate-changelog script", () => {
  describe("parseArgs", () => {
    it("parses defaults correctly", () => {
      const opts = parseArgs([]);
      expect(opts.version).toBe("Unreleased");
      expect(opts.write).toBe(false);
      expect(opts.dryRun).toBe(false);
      expect(opts.repo).toBe("OphirPay/OphirPay");
    });

    it("parses custom flags", () => {
      const opts = parseArgs([
        "--from",
        "v1.0.0",
        "--to",
        "HEAD",
        "--version",
        "1.1.0",
        "--write",
        "--date",
        "2026-10-19",
      ]);
      expect(opts.from).toBe("v1.0.0");
      expect(opts.to).toBe("HEAD");
      expect(opts.version).toBe("1.1.0");
      expect(opts.write).toBe(true);
      expect(opts.date).toBe("2026-10-19");
    });
  });

  describe("extractGitHubHandle", () => {
    it("extracts handle from noreply email with numeric prefix", () => {
      const handle = extractGitHubHandle(
        "297354017+CodingAngel1",
        "297354017+CodingAngel1@users.noreply.github.com"
      );
      expect(handle).toBe("CodingAngel1");
    });

    it("extracts handle from standard name and normal email", () => {
      const handle = extractGitHubHandle("ZuLu0890", "user@example.com");
      expect(handle).toBe("ZuLu0890");
    });

    it("extracts handle from Co-authored-by trailer in body", () => {
      const body = "Some body\n\nCo-authored-by: Praiz089017 <12345+Praiz089017@users.noreply.github.com>";
      const handle = extractGitHubHandle("BotName", "bot@noreply.github.com", body);
      expect(handle).toBe("Praiz089017");
    });

    it("ignores bot accounts", () => {
      const handle = extractGitHubHandle("dependabot[bot]", "bot@example.com");
      expect(handle).toBe("");
    });
  });

  describe("extractPrNumber", () => {
    it("extracts PR number from subject parentheses", () => {
      expect(extractPrNumber("feat(api): add new route (#1412)")).toBe("1412");
    });

    it("extracts PR number from merge pull request subject", () => {
      expect(extractPrNumber("Merge pull request #1715 from user/branch")).toBe("1715");
    });

    it("extracts PR number from Closes #PR in body", () => {
      expect(extractPrNumber("feat: add feature", "Fixes #1414")).toBe("1414");
    });

    it("returns null when no PR number exists", () => {
      expect(extractPrNumber("chore: update README")).toBeNull();
    });
  });

  describe("parseConventionalCommit", () => {
    it("parses feat commit with scope and PR", () => {
      const commit = {
        hash: "abcdef1234567890",
        shortHash: "abcdef1",
        authorName: "ZuLu0890",
        authorEmail: "zulu@example.com",
        date: "2026-10-19",
        subject: "feat(streams): add vesting timeline and claim simulator (#1377)",
        body: "Detailed description",
      };

      const parsed = parseConventionalCommit(commit) as any;
      expect(parsed).not.toBeNull();
      expect(parsed?.type).toBe("feat");
      expect(parsed?.scope).toBe("streams");
      expect(parsed?.description).toBe("add vesting timeline and claim simulator");
      expect(parsed?.prNumber).toBe("1377");
      expect(parsed?.authorHandle).toBe("ZuLu0890");
      expect(parsed?.isBreaking).toBe(false);
    });

    it("detects breaking change via exclamation mark", () => {
      const commit = {
        hash: "abcdef1234567890",
        shortHash: "abcdef1",
        authorName: "Author",
        authorEmail: "author@example.com",
        date: "2026-10-19",
        subject: "feat(auth)!: replace legacy cookie auth with bearer tokens",
        body: "",
      };

      const parsed = parseConventionalCommit(commit) as any;
      expect(parsed).not.toBeNull();
      expect(parsed?.isBreaking).toBe(true);
    });

    it("detects breaking change in commit body", () => {
      const commit = {
        hash: "abcdef1234567890",
        shortHash: "abcdef1",
        authorName: "Author",
        authorEmail: "author@example.com",
        date: "2026-10-19",
        subject: "feat(payments): update payment response schema",
        body: "BREAKING CHANGE: response format changed to RFC 9457",
      };

      const parsed = parseConventionalCommit(commit) as any;
      expect(parsed).not.toBeNull();
      expect(parsed?.isBreaking).toBe(true);
    });
  });

  describe("groupCommits", () => {
    it("groups commits into Added, Fixed, Breaking, and Security", () => {
      const commits = [
        {
          type: "feat",
          scope: "send",
          description: "live fee selector",
          prNumber: "1373",
          authorHandle: "ZuLu0890",
          shortHash: "3740e96",
          isBreaking: false,
        },
        {
          type: "fix",
          scope: "security",
          description: "rate limit api keys",
          prNumber: "1370",
          authorHandle: "ZuLu0890",
          shortHash: "4975ad2",
          isBreaking: false,
        },
        {
          type: "fix",
          scope: "cache",
          description: "invalidate subject sub-keys",
          prNumber: null,
          authorHandle: "CodingAngel1",
          shortHash: "9a7041e",
          isBreaking: false,
        },
        {
          type: "feat",
          scope: "api",
          description: "drop old endpoint",
          prNumber: "1000",
          authorHandle: "Admin",
          shortHash: "1111111",
          isBreaking: true,
        },
      ];

      const grouped = groupCommits(commits as any);
      expect(grouped.breaking).toHaveLength(1);
      expect(grouped.added).toHaveLength(1);
      expect(grouped.security).toHaveLength(1);
      expect(grouped.fixed).toHaveLength(1);
    });
  });

  describe("formatChangelogItem", () => {
    it("formats markdown item matching existing CHANGELOG.md style", () => {
      const item = {
        scope: "streams",
        description: "add vesting timeline and claim simulator",
        prNumber: "1377",
        authorHandle: "ZuLu0890",
        shortHash: "575c425",
      };

      const formatted = formatChangelogItem(item, "OphirPay/OphirPay");
      expect(formatted).toBe(
        "- **Streams: add vesting timeline and claim simulator (#1377)**: add vesting timeline and claim simulator by [@ZuLu0890](https://github.com/ZuLu0890) ([#1377](https://github.com/OphirPay/OphirPay/pull/1377))."
      );
    });
  });

  describe("generateChangelogMarkdown and updateChangelogContent", () => {
    it("generates markdown with correct heading", () => {
      const grouped = {
        breaking: [],
        added: [
          {
            scope: "payments",
            description: "SEP-7 payment request QR codes",
            prNumber: "1375",
            authorHandle: "ZuLu0890",
            shortHash: "4714db7",
          },
        ],
        fixed: [],
        perf: [],
        changed: [],
        security: [],
        docs: [],
      };

      const md = generateChangelogMarkdown(grouped, {
        version: "Unreleased",
        date: "2026-10-19",
        repo: "OphirPay/OphirPay",
      });

      expect(md).toContain("## [Unreleased] — 2026-10-19");
      expect(md).toContain("### Added");
      expect(md).toContain("SEP-7 payment request QR codes (#1375)");
    });

    it("inserts new section under # Changelog", () => {
      const existing = "# Changelog\n\nAll notable changes to OphirPay will be documented in this file.\n\n## [0.1.0] — 2026-08-06\n- Initial release";
      const newSection = "## [Unreleased] — 2026-10-19\n\n### Added\n- New feature";

      const updated = updateChangelogContent(existing, newSection);
      expect(updated).toContain("# Changelog");
      expect(updated).toContain("## [Unreleased] — 2026-10-19");
      expect(updated).toContain("## [0.1.0] — 2026-08-06");
      expect(updated.indexOf("## [Unreleased]")).toBeLessThan(updated.indexOf("## [0.1.0]"));
    });
  });
});
