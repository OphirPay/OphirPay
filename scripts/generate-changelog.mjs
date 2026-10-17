#!/usr/bin/env node
/**
 * Automated Conventional Commit Changelog Generator (Issue #1414)
 *
 * Parses git commit history between tags/refs, categorizes conventional commits
 * into Breaking Changes, Features, Bug Fixes, and Performance, links PR numbers
 * (#123) and contributor handles (@author), and prepends the formatted Markdown
 * release section to CHANGELOG.md.
 *
 * Usage:
 *   npm run changelog -- --dry-run
 *   npm run changelog -- --version 0.2.0 --date 2026-10-17 --write
 *   node scripts/generate-changelog.mjs --from v0.1.0 --to HEAD --dry-run
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_REPO_URL = "https://github.com/OphirPay/OphirPay";

const CONVENTIONAL_HEADER_RE =
  /^(?<type>[a-zA-Z]+)(?:\((?<scope>[^)]+)\))?(?<breaking>!)?:\s*(?<subject>.+)$/;

/**
 * Replace (#123) or #123 PR references with Markdown links to GitHub pulls.
 */
export function linkPullRequests(text, repoUrl = DEFAULT_REPO_URL) {
  return text.replace(/(?<![/\w])#(\d+)\b/g, `[#$1](${repoUrl}/pull/$1)`);
}

/**
 * Format contributor handle as a GitHub profile link when available.
 */
export function formatAuthorAttribution(author, repoUrl = DEFAULT_REPO_URL) {
  if (!author) return "";
  const normalized = String(author).trim().replace(/^@/, "");
  if (!normalized) return "";
  const githubRoot = new URL(repoUrl).origin;
  if (/^[a-zA-Z0-9-]+$/.test(normalized)) {
    return `([@${normalized}](${githubRoot}/${normalized}))`;
  }
  return `(@${normalized})`;
}

/**
 * Parse a single commit record into a structured Conventional Commit entry.
 *
 * @param {{ hash?: string, subject: string, body?: string, author?: string }} raw
 * @param {{ repoUrl?: string }} [options]
 */
export function parseConventionalCommit(raw, options = {}) {
  const repoUrl = options.repoUrl || DEFAULT_REPO_URL;
  const subjectLine = (raw.subject || "").trim();
  const body = (raw.body || "").trim();
  const match = subjectLine.match(CONVENTIONAL_HEADER_RE);

  if (!match || !match.groups) {
    return null;
  }

  const type = match.groups.type.toLowerCase();
  const scope = match.groups.scope ? match.groups.scope.trim() : null;
  const headerBreaking = Boolean(match.groups.breaking);
  const rawDescription = match.groups.subject.trim();

  const breakingBodyMatch = body.match(/BREAKING[ -]CHANGE:\s*(.+)/i);
  const isBreaking = headerBreaking || Boolean(breakingBodyMatch);
  const breakingNote = breakingBodyMatch ? breakingBodyMatch[1].trim() : null;

  // Extract PR numbers mentioned in subject or body
  const prNumbers = [];
  const prRe = /#(\d+)\b/g;
  let m;
  while ((m = prRe.exec(`${subjectLine} ${body}`)) !== null) {
    if (!prNumbers.includes(m[1])) {
      prNumbers.push(m[1]);
    }
  }

  const linkedDescription = linkPullRequests(rawDescription, repoUrl);
  const authorAttr = formatAuthorAttribution(raw.author, repoUrl);

  return {
    hash: raw.hash ? raw.hash.slice(0, 7) : undefined,
    type,
    scope,
    subject: rawDescription,
    linkedDescription,
    body,
    author: raw.author || undefined,
    authorAttribution: authorAttr,
    prNumbers,
    isBreaking,
    breakingNote,
  };
}

/**
 * Group parsed commits into the 4 canonical release categories:
 * - breaking ("Breaking Changes")
 * - feat ("Features")
 * - fix ("Bug Fixes")
 * - perf ("Performance")
 */
export function categorizeCommits(commits, options = {}) {
  const groups = {
    breaking: [],
    feat: [],
    fix: [],
    perf: [],
  };

  for (const item of commits) {
    const parsed =
      item && typeof item === "object" && "isBreaking" in item
        ? item
        : parseConventionalCommit(item, options);

    if (!parsed) continue;

    if (parsed.isBreaking) {
      groups.breaking.push(parsed);
    }

    if (parsed.type === "feat") {
      groups.feat.push(parsed);
    } else if (parsed.type === "fix") {
      groups.fix.push(parsed);
    } else if (parsed.type === "perf") {
      groups.perf.push(parsed);
    }
  }

  return groups;
}

function formatBullet(entry, { isBreakingSection = false, repoUrl = DEFAULT_REPO_URL } = {}) {
  const scopePrefix = entry.scope ? `**${entry.scope}**: ` : "";
  const desc =
    isBreakingSection && entry.breakingNote
      ? `${entry.linkedDescription} — ${linkPullRequests(entry.breakingNote, repoUrl)}`
      : entry.linkedDescription;
  const hashSuffix = entry.hash ? ` (\`${entry.hash}\`)` : "";
  const authorSuffix = entry.authorAttribution ? ` ${entry.authorAttribution}` : "";
  return `- ${scopePrefix}${desc}${hashSuffix}${authorSuffix}`;
}

/**
 * Render a Markdown release section for CHANGELOG.md.
 */
export function renderChangelogSection({
  version = "Unreleased",
  date = new Date().toISOString().slice(0, 10),
  commits = [],
  repoUrl = DEFAULT_REPO_URL,
} = {}) {
  const groups =
    commits && !Array.isArray(commits)
      ? commits
      : categorizeCommits(commits, { repoUrl });

  const heading =
    version === "Unreleased"
      ? `## [Unreleased] — ${date}`
      : `## [${version.replace(/^v/, "")}] — ${date}`;

  const sections = [];

  if (groups.breaking && groups.breaking.length > 0) {
    sections.push(
      "### Breaking Changes\n" +
        groups.breaking
          .map((c) => formatBullet(c, { isBreakingSection: true, repoUrl }))
          .join("\n")
    );
  }

  if (groups.feat && groups.feat.length > 0) {
    sections.push(
      "### Features\n" +
        groups.feat.map((c) => formatBullet(c, { repoUrl })).join("\n")
    );
  }

  if (groups.fix && groups.fix.length > 0) {
    sections.push(
      "### Bug Fixes\n" +
        groups.fix.map((c) => formatBullet(c, { repoUrl })).join("\n")
    );
  }

  if (groups.perf && groups.perf.length > 0) {
    sections.push(
      "### Performance\n" +
        groups.perf.map((c) => formatBullet(c, { repoUrl })).join("\n")
    );
  }

  if (sections.length === 0) {
    sections.push("_No user-facing conventional commits recorded in this range._");
  }

  return `${heading}\n\n${sections.join("\n\n")}\n`;
}

/**
 * Prepend a newly rendered release section above the first `## [` section in CHANGELOG.md.
 */
export function prependReleaseSection(existingChangelog, newSection) {
  const normalizedExisting = existingChangelog.replace(/\r\n/g, "\n");
  const normalizedSection = newSection.trim() + "\n\n";
  const firstReleaseIdx = normalizedExisting.search(/^## \[/m);

  if (firstReleaseIdx === -1) {
    return `${normalizedExisting.trimEnd()}\n\n${normalizedSection}`;
  }

  const headerPart = normalizedExisting.slice(0, firstReleaseIdx);
  const restPart = normalizedExisting.slice(firstReleaseIdx);
  return `${headerPart}${normalizedSection}${restPart}`;
}

/**
 * Read commits from git log between `from` and `to`.
 */
export function getGitCommits({ from, to = "HEAD", cwd = process.cwd() } = {}) {
  let resolvedFrom = from;
  if (!resolvedFrom) {
    try {
      resolvedFrom = execFileSync("git", ["describe", "--tags", "--abbrev=0"], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      resolvedFrom = "";
    }
  }

  const rangeArg = resolvedFrom ? `${resolvedFrom}..${to}` : `-n 50`;
  const args =
    resolvedFrom
      ? ["log", rangeArg, "--pretty=format:%H%x1f%s%x1f%b%x1f%an%x1e"]
      : ["log", "-n", "50", "--pretty=format:%H%x1f%s%x1f%b%x1f%an%x1e"];

  const output = execFileSync("git", args, {
    cwd,
    encoding: "utf8",
  });

  return output
    .split("\x1e")
    .map((rec) => rec.trim())
    .filter(Boolean)
    .map((rec) => {
      const [hash, subject, body, author] = rec.split("\x1f");
      return {
        hash: (hash || "").trim(),
        subject: (subject || "").trim(),
        body: (body || "").trim(),
        author: (author || "").trim(),
      };
    });
}

/**
 * End-to-end changelog generator helper.
 */
export function generateChangelog({
  version = "Unreleased",
  date = new Date().toISOString().slice(0, 10),
  from,
  to = "HEAD",
  commits,
  changelogPath = path.resolve(process.cwd(), "CHANGELOG.md"),
  write = false,
  repoUrl = DEFAULT_REPO_URL,
  cwd = process.cwd(),
} = {}) {
  const rawCommits = commits ?? getGitCommits({ from, to, cwd });
  const section = renderChangelogSection({
    version,
    date,
    commits: rawCommits,
    repoUrl,
  });

  let updatedChangelog = null;
  if (write && fs.existsSync(changelogPath)) {
    const current = fs.readFileSync(changelogPath, "utf8");
    updatedChangelog = prependReleaseSection(current, section);
    fs.writeFileSync(changelogPath, updatedChangelog, "utf8");
  }

  return {
    section,
    updatedChangelog,
    commitCount: rawCommits.length,
    categories: categorizeCommits(rawCommits, { repoUrl }),
  };
}

function parseCliArgs(argv) {
  const opts = {
    version: "Unreleased",
    date: new Date().toISOString().slice(0, 10),
    from: undefined,
    to: "HEAD",
    write: false,
    dryRun: true,
    changelogPath: path.resolve(process.cwd(), "CHANGELOG.md"),
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--version" && argv[i + 1]) {
      opts.version = argv[++i];
    } else if (arg === "--date" && argv[i + 1]) {
      opts.date = argv[++i];
    } else if (arg === "--from" && argv[i + 1]) {
      opts.from = argv[++i];
    } else if (arg === "--to" && argv[i + 1]) {
      opts.to = argv[++i];
    } else if (arg === "--output" && argv[i + 1]) {
      opts.changelogPath = path.resolve(process.cwd(), argv[++i]);
    } else if (arg === "--write") {
      opts.write = true;
      opts.dryRun = false;
    } else if (arg === "--dry-run" || arg === "--stdout") {
      opts.dryRun = true;
      opts.write = false;
    } else if (arg === "-h" || arg === "--help") {
      console.log(
        "Usage: node scripts/generate-changelog.mjs [--version <ver>] [--date <YYYY-MM-DD>] [--from <ref>] [--to <ref>] [--dry-run | --write]"
      );
      process.exit(0);
    }
  }

  return opts;
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const cliOpts = parseCliArgs(process.argv.slice(2));
  const result = generateChangelog(cliOpts);
  process.stdout.write(result.section);
  if (cliOpts.write) {
    console.error(`✅ Prepended release section [${cliOpts.version}] to ${cliOpts.changelogPath}`);
  }
}
