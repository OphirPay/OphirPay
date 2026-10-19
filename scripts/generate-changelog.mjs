#!/usr/bin/env node
// SPDX-License-Identifier: MIT

/**
 * Automated conventional commit changelog generator for OphirPay (issue #1414).
 *
 * Parses conventional commits between git tags/refs, classifies them into
 * standard categories (Breaking Changes, Features, Bug Fixes, Performance,
 * Security, Changed), extracts PR references and contributor handles, and
 * generates formatted release notes matching CHANGELOG.md style.
 *
 * Usage:
 *   node scripts/generate-changelog.mjs [--from <tag>] [--to <ref>] [--version <ver>] [--write] [--dry-run] [--check]
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REPO_URL = "https://github.com/OphirPay/OphirPay";
const repoRoot = process.cwd();
const changelogPath = join(repoRoot, "CHANGELOG.md");

const CATEGORIES = [
  { key: "breaking", title: "Breaking Changes" },
  { key: "feat", title: "Features" },
  { key: "fix", title: "Bug Fixes" },
  { key: "perf", title: "Performance" },
  { key: "security", title: "Security" },
  { key: "docs", title: "Documentation" },
  { key: "changed", title: "Changed" },
];

function printHelp() {
  console.log(`
OphirPay Conventional Changelog Generator

Usage:
  node scripts/generate-changelog.mjs [options]

Options:
  --from <ref>       Starting git tag or commit (default: latest semver tag)
  --to <ref>         Ending git tag or commit (default: HEAD)
  --version <ver>    Release version title (e.g., 1.1.0, default: Unreleased)
  --write            Write the generated section directly to CHANGELOG.md
  --dry-run          Print the generated changelog to stdout without writing (default)
  --check            Verify that commit history can be parsed and formatted cleanly
  --help             Show this help message
`);
}

export function parseArgs(args) {
  const options = {
    from: "",
    to: "HEAD",
    version: "Unreleased",
    write: false,
    dryRun: true,
    check: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--write") {
      options.write = true;
      options.dryRun = false;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
      options.write = false;
    } else if (arg === "--check") {
      options.check = true;
    } else if (arg === "--from" && i + 1 < args.length) {
      options.from = args[++i];
    } else if (arg === "--to" && i + 1 < args.length) {
      options.to = args[++i];
    } else if (arg === "--version" && i + 1 < args.length) {
      options.version = args[++i];
    }
  }

  return options;
}

export function getLatestTag() {
  try {
    const stdout = execSync("git describe --tags --abbrev=0", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();
    return stdout;
  } catch {
    // If no tags reachable, try to get the first tag
    try {
      const stdout = execSync("git tag -l 'v*' | tail -n 1", {
        encoding: "utf8",
      }).trim();
      return stdout;
    } catch {
      return "";
    }
  }
}

export function getRawGitCommits(from, to) {
  const range = from ? `${from}..${to}` : to;
  const cmd = `git log ${range} --no-merges --pretty=format:"%H%x1f%h%x1f%an%x1f%ae%x1f%s%x1f%b%x1e"`;
  try {
    const stdout = execSync(cmd, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
    return stdout
      .split("\x1e")
      .map((entry) => entry.trim())
      .filter(Boolean);
  } catch (err) {
    throw new Error(`Failed to read git log: ${err.message}`);
  }
}

export function parseCommitRecord(record) {
  const parts = record.split("\x1f");
  if (parts.length < 5) return null;

  const [hash, shortHash, author, email, subject, body = ""] = parts;

  // Conventional commit parser: type(scope)!: message
  const match = subject.match(/^([a-zA-Z]+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/);
  const isBreaking =
    Boolean(match?.[3]) ||
    body.includes("BREAKING CHANGE:") ||
    subject.includes("BREAKING CHANGE:");

  let type = match ? match[1].toLowerCase() : "other";
  const scope = match ? match[2] || "" : "";
  const rawDescription = match ? match[4] : subject;

  // Extract PR number (#123) from subject or body
  let prNumber = null;
  const prMatchSubject = rawDescription.match(/\(#(\d+)\)/);
  if (prMatchSubject) {
    prNumber = prMatchSubject[1];
  } else {
    const prMatchBody = body.match(/(?:closes|fixes|resolves|pr)\s*[:#]\s*(\d+)/i);
    if (prMatchBody) {
      prNumber = prMatchBody[1];
    }
  }

  // Clean description of trailing (#123)
  const description = rawDescription.replace(/\s*\(#\d+\)\s*$/, "").trim();

  // Extract author handle
  let handle = "";
  if (author && !author.includes(" ") && !author.includes("@")) {
    handle = author;
  } else {
    const ghUserMatch = email.match(/^(\d+\+)?([^@]+)@users\.noreply\.github\.com$/);
    if (ghUserMatch) {
      handle = ghUserMatch[2];
    } else {
      handle = author;
    }
  }

  return {
    hash,
    shortHash,
    author,
    handle,
    subject,
    type,
    scope,
    description,
    prNumber,
    isBreaking,
    body,
  };
}

export function categorizeCommit(commit) {
  if (commit.isBreaking) {
    return "breaking";
  }

  if (commit.type === "security" || commit.scope.toLowerCase() === "security") {
    return "security";
  }

  switch (commit.type) {
    case "feat":
      return "feat";
    case "fix":
      return "fix";
    case "perf":
      return "perf";
    case "docs":
      return "docs";
    case "refactor":
    case "chore":
    case "build":
    case "ci":
    case "test":
    case "style":
      return "changed";
    default:
      return "changed";
  }
}

export function formatChangelogSection(commits, version, dateStr) {
  const groups = new Map(CATEGORIES.map((cat) => [cat.key, []]));

  for (const commit of commits) {
    const cat = categorizeCommit(commit);
    if (groups.has(cat)) {
      groups.get(cat).push(commit);
    } else {
      groups.get("changed").push(commit);
    }
  }

  const lines = [];
  const cleanVersion = version.replace(/^v/, "");
  const versionHeader = cleanVersion.toLowerCase() === "unreleased"
    ? `## [Unreleased] — ${dateStr}`
    : `## [${cleanVersion}] — ${dateStr}`;

  lines.push(versionHeader, "");

  for (const cat of CATEGORIES) {
    const list = groups.get(cat.key);
    if (!list || list.length === 0) continue;

    lines.push(`### ${cat.title}`);
    for (const item of list) {
      let prLink = "";
      if (item.prNumber) {
        prLink = ` ([#${item.prNumber}](${REPO_URL}/pull/${item.prNumber}))`;
      } else {
        prLink = ` ([${item.shortHash}](${REPO_URL}/commit/${item.hash}))`;
      }

      const authorLink = item.handle
        ? ` by [@${item.handle}](https://github.com/${item.handle})`
        : "";

      const prefix = item.scope ? `**${item.scope}**: ` : "";
      lines.push(`- ${prefix}${item.description}${prLink}${authorLink}`);
    }
    lines.push("");
  }

  return lines.join("\n").trim() + "\n";
}

export function updateChangelogFile(newSection) {
  const currentContent = readFileSync(changelogPath, "utf8");

  // Find insertion point right after the top header
  // Look for the first ## [ heading
  const firstSectionIndex = currentContent.indexOf("\n## [");

  let updatedContent = "";
  if (firstSectionIndex !== -1) {
    const header = currentContent.slice(0, firstSectionIndex + 1);
    const rest = currentContent.slice(firstSectionIndex + 1);
    updatedContent = `${header}${newSection}\n${rest}`;
  } else {
    updatedContent = `${currentContent.trim()}\n\n${newSection}`;
  }

  writeFileSync(changelogPath, updatedContent, "utf8");
}

export async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  let fromTag = options.from;
  if (!fromTag) {
    fromTag = getLatestTag();
  }

  const dateStr = new Date().toISOString().split("T")[0];
  const rawRecords = getRawGitCommits(fromTag, options.to);
  const commits = rawRecords
    .map(parseCommitRecord)
    .filter(Boolean);

  if (commits.length === 0) {
    console.log(`No commits found between ${fromTag || "beginning"} and ${options.to}.`);
    return;
  }

  const formatted = formatChangelogSection(commits, options.version, dateStr);

  if (options.check) {
    console.log(`Parsed ${commits.length} commits successfully.`);
    console.log("Changelog formatting check: PASSED.");
    return;
  }

  if (options.write) {
    updateChangelogFile(formatted);
    console.log(`Successfully updated ${changelogPath} with ${commits.length} commits.`);
  } else {
    console.log(formatted);
  }
}

// Execute when invoked as CLI
if (process.argv[1]?.endsWith("generate-changelog.mjs")) {
  main().catch((err) => {
    console.error("Error generating changelog:", err.message);
    process.exit(1);
  });
}
