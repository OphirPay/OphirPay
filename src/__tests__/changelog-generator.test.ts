import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  parseConventionalCommit,
  categorizeCommits,
  renderChangelogSection,
  prependReleaseSection,
  generateChangelog,
} from "../../scripts/generate-changelog.mjs";

const ROOT = path.resolve(__dirname, "../..");

describe("Automated Conventional Commit Changelog Generator (#1414)", () => {
  it("parses feat, fix, perf, and breaking conventional commits with PR and author links", () => {
    const feat = parseConventionalCommit({
      hash: "a1b2c3d4e5f6",
      subject: "feat(payments): add multi-asset batch streaming (#1401)",
      body: "",
      author: "alice-dev",
    });
    expect(feat).not.toBeNull();
    expect(feat!.type).toBe("feat");
    expect(feat!.scope).toBe("payments");
    expect(feat!.isBreaking).toBe(false);
    expect(feat!.prNumbers).toEqual(["1401"]);
    expect(feat!.linkedDescription).toContain(
      "[#1401](https://github.com/OphirPay/OphirPay/pull/1401)"
    );
    expect(feat!.authorAttribution).toBe(
      "([@alice-dev](https://github.com/alice-dev))"
    );

    const breakingBang = parseConventionalCommit({
      hash: "deadbeef1234",
      subject: "feat(contracts)!: require explicit caller address on process_refund (#1402)",
      body: "BREAKING CHANGE: process_refund now requires caller Address argument",
      author: "bob",
    });
    expect(breakingBang).not.toBeNull();
    expect(breakingBang!.isBreaking).toBe(true);
    expect(breakingBang!.breakingNote).toBe(
      "process_refund now requires caller Address argument"
    );
  });

  it("categorizes commits into Breaking Changes, Features, Bug Fixes, and Performance", () => {
    const sampleCommits = [
      {
        hash: "1111111",
        subject: "feat(escrow): support milestone release schedules (#101)",
        author: "alice",
      },
      {
        hash: "2222222",
        subject: "fix(webhooks): prevent duplicate HMAC retry dispatch (#102)",
        author: "bob",
      },
      {
        hash: "3333333",
        subject: "perf(api): index payment searchVector with GIN (#103)",
        author: "carol",
      },
      {
        hash: "4444444",
        subject: "refactor(auth)!: drop legacy v1 session token header (#104)",
        body: "BREAKING CHANGE: X-Legacy-Token header is no longer accepted.",
        author: "dave",
      },
      {
        hash: "5555555",
        subject: "chore(ci): bump actions/checkout",
        author: "bot",
      },
    ];

    const groups = categorizeCommits(sampleCommits);
    expect(groups.breaking).toHaveLength(1);
    expect(groups.feat).toHaveLength(1);
    expect(groups.fix).toHaveLength(1);
    expect(groups.perf).toHaveLength(1);

    const markdown = renderChangelogSection({
      version: "0.2.0",
      date: "2026-10-17",
      commits: sampleCommits,
    });

    expect(markdown).toContain("## [0.2.0] — 2026-10-17");
    expect(markdown).toContain("### Breaking Changes");
    expect(markdown).toContain("### Features");
    expect(markdown).toContain("### Bug Fixes");
    expect(markdown).toContain("### Performance");
    expect(markdown).toContain("[#101](https://github.com/OphirPay/OphirPay/pull/101)");
    expect(markdown).toContain("([@alice](https://github.com/alice))");
    expect(markdown).toContain("X-Legacy-Token header is no longer accepted.");
  });

  it("prepends new release sections above existing releases in CHANGELOG.md", () => {
    const existing = [
      "# Changelog",
      "",
      "All notable changes to OphirPay will be documented in this file.",
      "",
      "## [0.1.0] — 2026-08-05",
      "",
      "### Added",
      "- Initial release",
      "",
    ].join("\n");

    const section = renderChangelogSection({
      version: "0.2.0",
      date: "2026-10-17",
      commits: [
        {
          hash: "abc1234",
          subject: "feat(cli): add automated changelog generator (#1414)",
          author: "ophir-bot",
        },
      ],
    });

    const updated = prependReleaseSection(existing, section);
    const v020Idx = updated.indexOf("## [0.2.0] — 2026-10-17");
    const v010Idx = updated.indexOf("## [0.1.0] — 2026-08-05");
    expect(v020Idx).toBeGreaterThan(0);
    expect(v020Idx).toBeLessThan(v010Idx);
  });

  it("registers npm run changelog in package.json and documents usage in docs/CHANGELOG_GUIDE.md", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(ROOT, "package.json"), "utf8")
    );
    expect(pkg.scripts.changelog).toBe("node scripts/generate-changelog.mjs");

    const guide = fs.readFileSync(
      path.join(ROOT, "docs", "CHANGELOG_GUIDE.md"),
      "utf8"
    );
    expect(guide).toContain("scripts/generate-changelog.mjs");
    expect(guide).toContain("npm run changelog");

    const result = generateChangelog({
      version: "Unreleased",
      date: "2026-10-17",
      commits: [
        {
          hash: "9999999",
          subject: "feat(release): automated changelog generation (#1414)",
          author: "maintainer",
        },
      ],
      write: false,
    });
    expect(result.section).toContain("### Features");
    expect(result.commitCount).toBe(1);
  });
});
