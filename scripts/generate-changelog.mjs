// SPDX-License-Identifier: MIT
/**
 * Automated conventional commit changelog generator for OphirPay.
 *
 * Parses conventional git commits, groups them by type (Features, Fixes,
 * Performance, Security, Breaking Changes), formats them matching the
 * Keep a Changelog standard used in CHANGELOG.md, and links PRs & authors.
 *
 * Usage:
 *   node scripts/generate-changelog.mjs [options]
 *
 * Options:
 *   --write          Prepend the generated section into CHANGELOG.md
 *   --tag <tag>      Release tag version (defaults to Unreleased)
 *   --since <ref>    Git revision/tag to parse from (defaults to previous tag or last 50 commits)
 *   --dry-run        Print formatted notes without writing to file (default)
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const CHANGELOG_PATH = path.join(ROOT, "CHANGELOG.md");

export function parseCommit(record) {
  const [hash, subject, body = "", author = "", email = ""] = record.split("\x1f");
  if (!hash || !subject) return null;

  const cleanSubject = subject.trim();
  const cleanHash = hash.trim();
  const shortHash = cleanHash.slice(0, 7);

  // Skip merge commits like "Merge branch..." unless they contain PR attribution
  if (cleanSubject.startsWith("Merge branch") || cleanSubject.startsWith("Merge remote-tracking")) {
    return null;
  }

  // Extract PR from "Merge pull request #1234 from username/branch"
  let prNumber;
  const mergePrMatch = cleanSubject.match(/Merge pull request #(\d+)/i);
  if (mergePrMatch) {
    prNumber = mergePrMatch[1];
  } else {
    // Extract PR from "(#1234)" at end of subject
    const subjectPrMatch = cleanSubject.match(/\(#(\d+)\)$/);
    if (subjectPrMatch) {
      prNumber = subjectPrMatch[1];
    }
  }

  // Extract issue reference from body ("Resolves #1234", "Fixes #1234", etc.)
  const issueMatch = body.match(/(?:resolves|fixes|closes)\s+#(\d+)/i);
  const issueNumber = issueMatch ? issueMatch[1] : undefined;

  // Check for breaking changes
  const isBreaking =
    cleanSubject.includes("!:") ||
    body.includes("BREAKING CHANGE:") ||
    cleanSubject.startsWith("BREAKING CHANGE:");

  // Parse conventional commit pattern: type(scope)?: description
  const convMatch = cleanSubject.match(/^([a-zA-Z]+)(?:\(([^)]+)\))?!?:\s*(.+)$/);
  let type = "other";
  let scope;
  let description = cleanSubject;

  if (convMatch) {
    type = convMatch[1].toLowerCase();
    scope = convMatch[2];
    description = convMatch[3].trim();
  }

  return {
    hash: cleanHash,
    shortHash,
    subject: cleanSubject,
    body: body.trim(),
    author: author.trim(),
    email: email.trim(),
    type,
    scope,
    isBreaking,
    description,
    prNumber,
    issueNumber,
  };
}

export function fetchCommits(since) {
  let range = "-n 50";
  if (since) {
    range = `${since}..HEAD`;
  } else {
    // Try to find the latest git tag
    try {
      const latestTag = execSync("git describe --tags --abbrev=0", {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "ignore"],
      }).trim();
      if (latestTag) {
        range = `${latestTag}..HEAD`;
      }
    } catch {
      // Default to last 50 commits if no tags exist
      range = "-n 50";
    }
  }

  const raw = execSync(`git log ${range} --pretty=format:"%H%x1f%s%x1f%b%x1f%an%x1f%ae%x1e"`, {
    encoding: "utf8",
    cwd: ROOT,
  });

  const records = raw.split("\x1e").filter((r) => r.trim().length > 0);
  const commits = [];

  for (const r of records) {
    const c = parseCommit(r);
    if (c) commits.push(c);
  }

  return commits;
}

export function groupCommits(commits) {
  const groups = {
    breaking: [],
    added: [],
    fixed: [],
    security: [],
    performance: [],
    changed: [],
  };

  for (const commit of commits) {
    if (commit.isBreaking) {
      groups.breaking.push(commit);
      continue;
    }

    if (
      commit.type === "sec" ||
      commit.scope === "security" ||
      commit.subject.toLowerCase().includes("security")
    ) {
      groups.security.push(commit);
      continue;
    }

    switch (commit.type) {
      case "feat":
        groups.added.push(commit);
        break;
      case "fix":
        groups.fixed.push(commit);
        break;
      case "perf":
        groups.performance.push(commit);
        break;
      case "refactor":
      case "chore":
      case "style":
      case "docs":
      case "build":
      case "ci":
        groups.changed.push(commit);
        break;
      default:
        // Ignore unclassified or other noise
        break;
    }
  }

  return groups;
}

export function formatEntry(commit) {
  const ref = commit.prNumber
    ? `(#${commit.prNumber})`
    : commit.issueNumber
      ? `(#${commit.issueNumber})`
      : `(${commit.shortHash})`;

  const authorTag = commit.author ? ` (@${commit.author})` : "";
  const prefix = commit.scope ? `**${commit.scope}**: ` : "";
  return `- ${prefix}${commit.description} ${ref}${authorTag}`;
}

export function formatSection(groups, tag = "Unreleased", dateString) {
  const date = dateString ?? new Date().toISOString().slice(0, 10);
  let section = `## [${tag}] — ${date}\n\n`;

  if (groups.breaking.length > 0) {
    section += `### Breaking Changes\n`;
    for (const c of groups.breaking) {
      section += `${formatEntry(c)}\n`;
    }
    section += `\n`;
  }

  if (groups.added.length > 0) {
    section += `### Added\n`;
    for (const c of groups.added) {
      section += `${formatEntry(c)}\n`;
    }
    section += `\n`;
  }

  if (groups.fixed.length > 0) {
    section += `### Fixed\n`;
    for (const c of groups.fixed) {
      section += `${formatEntry(c)}\n`;
    }
    section += `\n`;
  }

  if (groups.security.length > 0) {
    section += `### Security\n`;
    for (const c of groups.security) {
      section += `${formatEntry(c)}\n`;
    }
    section += `\n`;
  }

  if (groups.performance.length > 0) {
    section += `### Performance\n`;
    for (const c of groups.performance) {
      section += `${formatEntry(c)}\n`;
    }
    section += `\n`;
  }

  if (groups.changed.length > 0) {
    section += `### Changed\n`;
    for (const c of groups.changed) {
      section += `${formatEntry(c)}\n`;
    }
    section += `\n`;
  }

  return section;
}

export function prependChangelog(newSection) {
  if (!fs.existsSync(CHANGELOG_PATH)) {
    fs.writeFileSync(
      CHANGELOG_PATH,
      `# Changelog\n\nAll notable changes to OphirPay will be documented in this file.\n\n${newSection}`
    );
    return;
  }

  const existing = fs.readFileSync(CHANGELOG_PATH, "utf8");
  // Find where the first '## [' heading starts
  const firstHeadingIdx = existing.indexOf("## [");

  if (firstHeadingIdx === -1) {
    fs.writeFileSync(CHANGELOG_PATH, `${existing.trim()}\n\n${newSection}`);
    return;
  }

  const before = existing.slice(0, firstHeadingIdx);
  const after = existing.slice(firstHeadingIdx);
  fs.writeFileSync(CHANGELOG_PATH, `${before}${newSection}${after}`);
}

function parseCliArgs(argv) {
  const args = {
    write: false,
    tag: "Unreleased",
    since: undefined,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--write":
        args.write = true;
        break;
      case "--tag":
        args.tag = argv[++i];
        break;
      case "--since":
        args.since = argv[++i];
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
    }
  }

  return args;
}

function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const commits = fetchCommits(args.since);

  if (commits.length === 0) {
    console.log("No conventional commits found in the specified range.");
    return;
  }

  const groups = groupCommits(commits);
  const formatted = formatSection(groups, args.tag);

  if (args.write && !args.dryRun) {
    prependChangelog(formatted);
    console.log(`✅ Changelog updated at ${CHANGELOG_PATH}`);
  } else {
    console.log("--- Generated Changelog Section ---");
    console.log(formatted);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
