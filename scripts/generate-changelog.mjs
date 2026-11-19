#!/usr/bin/env node
// SPDX-License-Identifier: MIT

/**
 * scripts/generate-changelog.mjs
 *
 * Automated Conventional Commit Changelog Generator for OphirPay.
 *
 * Parses git commit history adhering to Conventional Commits (.commitlintrc.json),
 * classifies commits by type (feat, fix, perf, BREAKING CHANGE), extracts PR numbers
 * and contributor GitHub handles, and formats release notes matching CHANGELOG.md style.
 *
 * Usage:
 *   node scripts/generate-changelog.mjs [options]
 *   npm run changelog [-- options]
 *
 * Options:
 *   --from <ref>      Starting commit / tag (defaults to latest git tag or HEAD~25)
 *   --to <ref>        Ending commit (default: HEAD)
 *   --version <v>     Release version (e.g. "0.2.0"; defaults to "Unreleased")
 *   --date <date>     Release date YYYY-MM-DD (defaults to today)
 *   --repo <repo>     GitHub repo in owner/repo format (default: "OphirPay/OphirPay")
 *   --write, -w       Update CHANGELOG.md directly
 *   --dry-run         Print generated release notes to stdout without updating file
 *   --check           Verify that commits can be parsed without error
 *   --help, -h        Show help message
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const DEFAULT_REPO = "OphirPay/OphirPay";

/**
 * Parse CLI arguments into an options map.
 * @param {string[]} args
 */
export function parseArgs(args) {
  const options = {
    from: "",
    to: "HEAD",
    version: "Unreleased",
    date: new Date().toISOString().split("T")[0],
    repo: DEFAULT_REPO,
    write: false,
    dryRun: false,
    check: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--write" || arg === "-w") {
      options.write = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--check") {
      options.check = true;
    } else if (arg === "--from" && i + 1 < args.length) {
      options.from = args[++i];
    } else if (arg === "--to" && i + 1 < args.length) {
      options.to = args[++i];
    } else if (arg === "--version" && i + 1 < args.length) {
      options.version = args[++i];
    } else if (arg === "--date" && i + 1 < args.length) {
      options.date = args[++i];
    } else if (arg === "--repo" && i + 1 < args.length) {
      options.repo = args[++i];
    }
  }

  return options;
}

/**
 * Determine the git commit range to inspect.
 * @param {string} from
 * @param {string} to
 * @returns {string}
 */
export function getGitRange(from, to = "HEAD") {
  if (from) {
    return `${from}..${to}`;
  }

  // Attempt to find the most recent tag
  try {
    const latestTag = execSync("git describe --tags --abbrev=0", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();
    if (latestTag) {
      return `${latestTag}..${to}`;
    }
  } catch {
    // If no tags exist or git describe fails, fall back to recent commits
  }

  return `HEAD~30..${to}`;
}

/**
 * Parse raw git log output into structured commit objects.
 * Uses ASCII control characters \x1e (record separator) and \x1f (unit separator).
 * @param {string} gitOutput
 * @returns {Array<object>}
 */
export function parseRawGitLog(gitOutput) {
  if (!gitOutput || !gitOutput.trim()) return [];

  const rawCommits = gitOutput.split("\x1e").filter(Boolean);
  const commits = [];

  for (const raw of rawCommits) {
    const parts = raw.split("\x1f");
    if (parts.length < 6) continue;

    const [hash, shortHash, authorName, authorEmail, date, subject, body = ""] =
      parts.map((s) => s.trim());

    commits.push({
      hash,
      shortHash,
      authorName,
      authorEmail,
      date,
      subject,
      body,
    });
  }

  return commits;
}

/**
 * Extract GitHub handle from commit metadata.
 * Strips leading ID numbers e.g. "297354017+Username" -> "Username".
 * @param {string} authorName
 * @param {string} authorEmail
 * @param {string} body
 * @returns {string}
 */
export function extractGitHubHandle(authorName, authorEmail, body = "") {
  // Check Co-authored-by headers first
  const coAuthorMatch = body.match(/Co-authored-by:\s*([^\s<]+)\s*<([^>]+)>/i);
  if (coAuthorMatch) {
    const email = coAuthorMatch[2];
    const match = email.match(/(?:^|\+)([^@]+)@users\.noreply\.github\.com/i);
    if (match && match[1] && !match[1].includes("bot")) {
      return match[1].replace(/^\d+\+/, "");
    }
  }

  // Check noreply email pattern: [number+]username@users.noreply.github.com
  const emailMatch = authorEmail.match(
    /(?:^|\+)([^@]+)@users\.noreply\.github\.com/i
  );
  if (emailMatch && emailMatch[1]) {
    return emailMatch[1].replace(/^\d+\+/, "");
  }

  // Common bot filters
  if (/bot|actions|codebuff/i.test(authorName)) {
    return "";
  }

  return (authorName || "").replace(/^\d+\+/, "").trim();
}

/**
 * Extract pull request number from commit subject or body.
 * @param {string} subject
 * @param {string} body
 * @returns {string|null}
 */
export function extractPrNumber(subject, body = "") {
  // 1. Direct (#123) in subject
  const subjectPr = subject.match(/\(#(\d+)\)/);
  if (subjectPr) return subjectPr[1];

  // 2. Merge pull request #123
  const mergePr = subject.match(/Merge pull request #(\d+)/i);
  if (mergePr) return mergePr[1];

  // 3. Closes #123 or Fixes #123 in body
  const bodyClose = body.match(/(?:closes|fixes|resolves)\s+#(\d+)/i);
  if (bodyClose) return bodyClose[1];

  // 4. Any standalone #123 in subject
  const standalonePr = subject.match(/#(\d+)/);
  if (standalonePr) return standalonePr[1];

  return null;
}

/**
 * Parse a commit's conventional commit format.
 * Matches: type(scope)!: subject
 * @param {object} commit
 * @returns {object|null}
 */
export function parseConventionalCommit(commit) {
  const { subject, body } = commit;

  // Check for merge commit referencing a PR
  const mergeMatch = subject.match(
    /^Merge pull request #(\d+) from ([^/]+)\/([^\s]+)/i
  );
  if (mergeMatch) {
    // If the merge commit has a conventional subject inside the body
    const bodyLines = body.split("\n").map((l) => l.trim()).filter(Boolean);
    const firstBodyLine = bodyLines[0] || "";
    const parsedInner = parseConventionalCommit({
      ...commit,
      subject: firstBodyLine,
      body: bodyLines.slice(1).join("\n"),
    });

    if (parsedInner) {
      return {
        ...parsedInner,
        prNumber: parsedInner.prNumber || mergeMatch[1],
        authorHandle: parsedInner.authorHandle || mergeMatch[2],
      };
    }
  }

  // Standard conventional commit regex
  const match = subject.match(
    /^(?<type>feat|fix|perf|docs|style|refactor|test|build|ci|chore|revert)(?:\((?<scope>[^)]+)\))?(?<breaking>!)?:\s*(?<description>.+)$/i
  );

  if (!match || !match.groups) {
    return null;
  }

  const { type, scope, breaking, description } = match.groups;
  const isBreaking =
    Boolean(breaking) ||
    /BREAKING[\s-]CHANGE:/i.test(body) ||
    /BREAKING[\s-]CHANGE:/i.test(subject);

  // Clean description of trailing PR numbers e.g. "foo (#123)" -> "foo"
  const cleanDescription = description.replace(/\s*\([^)]*#\d+[^)]*\)\s*$/, "").trim();

  const prNumber = extractPrNumber(subject, body);
  const authorHandle = extractGitHubHandle(
    commit.authorName,
    commit.authorEmail,
    body
  );

  return {
    type: type.toLowerCase(),
    scope: scope ? scope.trim() : "",
    isBreaking,
    description: cleanDescription,
    prNumber,
    authorHandle,
    hash: commit.hash,
    shortHash: commit.shortHash,
    rawSubject: subject,
    rawBody: body,
  };
}

/**
 * Group classified commits into standard CHANGELOG sections.
 * @param {Array<object>} parsedCommits
 * @returns {Record<string, Array<object>>}
 */
export function groupCommits(parsedCommits) {
  const groups = {
    breaking: [],
    added: [],
    fixed: [],
    perf: [],
    changed: [],
    security: [],
    docs: [],
  };

  const seenKeys = new Set();

  for (const c of parsedCommits) {
    // Deduplicate commits that share the same description and PR
    const dedupeKey = `${c.type}:${c.scope}:${c.description}:${c.prNumber || c.shortHash}`;
    if (seenKeys.has(dedupeKey)) continue;
    seenKeys.add(dedupeKey);

    if (c.isBreaking) {
      groups.breaking.push(c);
      continue;
    }

    if (c.scope && c.scope.toLowerCase() === "security") {
      groups.security.push(c);
      continue;
    }

    switch (c.type) {
      case "feat":
        groups.added.push(c);
        break;
      case "fix":
        groups.fixed.push(c);
        break;
      case "perf":
        groups.perf.push(c);
        break;
      case "docs":
        groups.docs.push(c);
        break;
      case "refactor":
      case "chore":
      case "build":
      case "ci":
      case "style":
      case "revert":
      default:
        groups.changed.push(c);
        break;
    }
  }

  return groups;
}

/**
 * Format a single commit item into CHANGELOG markdown entry.
 * Style matches:
 * - **<Scope/Title> (#<PR>)**: <Description> by [@<Author>](https://github.com/<Author>) in [#<PR>](...)
 * @param {object} item
 * @param {string} repo
 * @returns {string}
 */
export function formatChangelogItem(item, repo = DEFAULT_REPO) {
  const scopePrefix = item.scope
    ? item.scope.charAt(0).toUpperCase() + item.scope.slice(1)
    : "";
  
  // Format title
  const title = scopePrefix
    ? `${scopePrefix}: ${item.description}`
    : item.description.charAt(0).toUpperCase() + item.description.slice(1);

  const prRef = item.prNumber ? ` (#${item.prNumber})` : "";
  const prLink = item.prNumber
    ? ` ([#${item.prNumber}](https://github.com/${repo}/pull/${item.prNumber}))`
    : ` (\`${item.shortHash}\`)`;

  const authorRef = item.authorHandle
    ? ` by [@${item.authorHandle}](https://github.com/${item.authorHandle})`
    : "";

  return `- **${title}${prRef}**: ${item.description}${authorRef}${prLink}.`;
}

/**
 * Generate full Markdown release notes section.
 * @param {object} grouped
 * @param {object} options
 * @returns {string}
 */
export function generateChangelogMarkdown(grouped, options) {
  const { version, date, repo } = options;
  const lines = [];

  lines.push(`## [${version}] — ${date}`);
  lines.push("");

  const sectionOrder = [
    { key: "breaking", title: "Breaking Changes" },
    { key: "security", title: "Security" },
    { key: "added", title: "Added" },
    { key: "fixed", title: "Fixed" },
    { key: "perf", title: "Performance" },
    { key: "changed", title: "Changed" },
    { key: "docs", title: "Documentation" },
  ];

  let hasEntries = false;

  for (const { key, title } of sectionOrder) {
    const items = grouped[key];
    if (items && items.length > 0) {
      hasEntries = true;
      lines.push(`### ${title}`);
      for (const item of items) {
        lines.push(formatChangelogItem(item, repo));
      }
      lines.push("");
    }
  }

  if (!hasEntries) {
    lines.push("### Changed");
    lines.push("- Maintenance updates and internal refactoring.");
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Insert or prepend the new changelog section into existing CHANGELOG.md content.
 * @param {string} existingContent
 * @param {string} newSection
 * @returns {string}
 */
export function updateChangelogContent(existingContent, newSection) {
  const firstSectionMatch = existingContent.search(/\n##\s+/);
  if (firstSectionMatch === -1) {
    return `# Changelog\n\nAll notable changes to OphirPay will be documented in this file.\n\n${newSection.trim()}\n\n${existingContent.trim()}\n`;
  }

  const before = existingContent.slice(0, firstSectionMatch);
  const after = existingContent.slice(firstSectionMatch);

  return `${before.trim()}\n\n${newSection.trim()}\n\n${after.trim()}\n`;
}

/**
 * Main execution handler.
 */
export async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(`
OphirPay Conventional Commit Changelog Generator

Usage:
  node scripts/generate-changelog.mjs [options]
  npm run changelog [-- options]

Options:
  --from <ref>      Starting commit / tag (defaults to latest git tag or HEAD~25)
  --to <ref>        Ending commit (default: HEAD)
  --version <v>     Release version (e.g. "1.1.0"; defaults to "Unreleased")
  --date <date>     Release date YYYY-MM-DD (defaults to today)
  --repo <repo>     GitHub repository (default: "${DEFAULT_REPO}")
  --write, -w       Update CHANGELOG.md directly
  --dry-run         Print generated release notes to stdout without modifying file
  --check           Verify parsing without modifying file
  --help, -h        Show this help message
`);
    return;
  }

  const range = getGitRange(options.from, options.to);

  let rawLog = "";
  try {
    rawLog = execSync(
      `git log ${range} --format="%x1e%H%x1f%h%x1f%an%x1f%ae%x1f%ad%x1f%s%x1f%b"`,
      { encoding: "utf8" }
    );
  } catch (error) {
    // If range fails (e.g. shallow clone or invalid tag), try last 30 commits
    try {
      rawLog = execSync(
        `git log -n 30 --format="%x1e%H%x1f%h%x1f%an%x1f%ae%x1f%ad%x1f%s%x1f%b"`,
        { encoding: "utf8" }
      );
    } catch (innerError) {
      console.error(`Error reading git log: ${innerError.message}`);
      process.exit(1);
    }
  }

  const rawCommits = parseRawGitLog(rawLog);
  const parsedCommits = rawCommits
    .map((c) => parseConventionalCommit(c))
    .filter(Boolean);

  const grouped = groupCommits(parsedCommits);
  const markdown = generateChangelogMarkdown(grouped, options);

  if (options.check) {
    console.log(
      `✅ Checked ${rawCommits.length} commits (${parsedCommits.length} conventional). Successfully generated changelog section.`
    );
    return;
  }

  if (options.write) {
    const changelogPath = path.resolve("CHANGELOG.md");
    let existingContent = "";
    if (fs.existsSync(changelogPath)) {
      existingContent = fs.readFileSync(changelogPath, "utf8");
    }

    const updated = updateChangelogContent(existingContent, markdown);
    fs.writeFileSync(changelogPath, updated, "utf8");
    console.log(`✅ Successfully updated ${changelogPath} for version [${options.version}].`);
  } else {
    // Default or --dry-run: output markdown to stdout
    console.log(markdown);
  }
}

// Execute main if run directly
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main().catch((err) => {
    console.error("Failed to generate changelog:", err);
    process.exit(1);
  });
}
