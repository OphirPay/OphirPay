#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execSync } from "node:child_process";

const root = process.cwd();
const ignoredDirectories = new Set([
  ".git",
  ".next",
  "coverage",
  "node_modules",
  "target",
]);

// Third-party external domains that should be ignored to avoid rate limits and false positives (Issue #1419)
const IGNORED_EXTERNAL_HOSTS = new Set([
  "stellar.org",
  "developers.stellar.org",
  "github.com",
  "raw.githubusercontent.com",
  "freighter.app",
  "npmjs.com",
  "www.npmjs.com",
  "nodejs.org",
  "rustup.rs",
  "crates.io",
  "twitter.com",
  "x.com",
  "discord.gg",
  "discord.com",
  "t.me",
  "google.com",
  "youtube.com",
  "medium.com",
  "wikipedia.org",
  "w3.org",
  "schema.org",
  "json-schema.org",
  "localhost",
]);

function isExternalUrl(destination) {
  if (!destination) return false;
  // Standard scheme (http:, https:, mailto:, ftp:, //)
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(destination)) {
    return true;
  }
  // Check if destination matches any ignored external domain without scheme
  const cleanDest = destination.split(/[?#]/)[0].toLowerCase();
  for (const host of IGNORED_EXTERNAL_HOSTS) {
    if (
      cleanDest === host ||
      cleanDest.startsWith(`${host}/`) ||
      cleanDest.startsWith(`www.${host}`) ||
      cleanDest.endsWith(`.${host}`) ||
      cleanDest.includes(`.${host}/`)
    ) {
      return true;
    }
  }
  // Host with common domain TLD without scheme (e.g. "example.com/foo")
  if (/^[a-zA-Z0-9-]+\.(?:com|org|io|dev|app|net|edu|gov|rs|sh|so|me|gg|co)(?:[/?#]|$)/i.test(destination)) {
    return true;
  }
  return false;
}

function collectMarkdownFiles(directory, collection) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        collectMarkdownFiles(path.join(directory, entry.name), collection);
      }
    } else if (entry.isFile() && /\.mdx?$/i.test(entry.name)) {
      collection.push(path.join(directory, entry.name));
    }
  }
}

function stripFencedCode(content) {
  const mask = (match) => match.replace(/[^\n]/g, " ");
  return content
    .replace(/^ {0,3}(`{3,}|~{3,}).*\n[\s\S]*?^ {0,3}\1[ \t]*$/gm, mask)
    .replace(/^(?: {4}|\t)[^\n]*$/gm, mask);
}

function stripCode(content) {
  return stripFencedCode(content).replace(/`+[^`\n]*`+/g, (match) =>
    match.replace(/[^\n]/g, " ")
  );
}

function linksIn(content) {
  const links = [];
  const references = new Map();
  const source = stripCode(content);

  for (const match of source.matchAll(
    /^\s{0,3}\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+))/gm
  )) {
    references.set(match[1].trim().toLowerCase(), match[2] ?? match[3]);
  }

  for (const match of source.matchAll(/!?\[([^\]]*)\]\((<[^>]+>|[^)]*)\)/g)) {
    const destination = match[2].trim().replace(/^<|>$/g, "").split(/\s+["']/)[0];
    if (destination) links.push({ destination, offset: match.index });
  }

  for (const match of source.matchAll(/!?\[([^\]]+)\](?:\[([^\]]*)\])?/g)) {
    const label = (match[2] || match[1]).trim().toLowerCase();
    const destination = references.get(label);
    if (destination) links.push({ destination, offset: match.index });
  }

  for (const match of source.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)) {
    links.push({ destination: match[1], offset: match.index });
  }

  return links;
}

function headingAnchors(markdown) {
  const anchors = new Set();
  const counts = new Map();
  const source = stripFencedCode(markdown);

  for (const match of source.matchAll(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/gm)) {
    const rawHeading = match[2];
    const customId = rawHeading.match(/\s*\{#([^}]+)\}\s*$/)?.[1];
    const heading = rawHeading
      .replace(/\s*\{#[^}]+\}\s*$/, "")
      .replace(/<[^>]*>/g, "")
      .replace(/!?\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/&(?:amp|lt|gt|quot|#39);/g, " ")
      .replace(/[^\p{L}\p{N}_ -]/gu, "")
      .replace(/[ \t]+$/g, "")
      .toLowerCase()
      .replace(/ /g, "-");
    const base = customId ?? heading;
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }

  for (const match of source.matchAll(/\b(?:id|name)\s*=\s*["']([^"']+)["']/gi)) {
    anchors.add(match[1]);
  }
  return anchors;
}

function resolveMarkdownTarget(sourceFile, rawDestination) {
  let destination;
  try {
    destination = decodeURIComponent(rawDestination);
  } catch {
    destination = rawDestination;
  }

  const [pathAndQuery, rawFragment] = destination.split("#", 2);
  const rawPath = pathAndQuery.split("?", 1)[0];
  let fragment = "";
  try {
    fragment = rawFragment ? decodeURIComponent(rawFragment) : "";
  } catch {
    fragment = rawFragment ?? "";
  }
  const sourceDirectory = path.relative(root, path.dirname(sourceFile)) || ".";
  const target = rawPath
    ? path.resolve(
        root,
        rawPath.startsWith("/")
          ? rawPath.slice(1)
          : path.join(sourceDirectory, rawPath)
      )
    : sourceFile;

  const candidates = [target];
  if (!path.extname(target)) {
    candidates.push(`${target}.md`, `${target}.mdx`);
  }

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const stat = fs.statSync(candidate);
    if (stat.isDirectory()) {
      for (const index of ["README.md", "index.md"]) {
        const indexPath = path.join(candidate, index);
        if (fs.existsSync(indexPath)) return { path: indexPath, fragment };
      }
      return { path: candidate, fragment };
    }
    return { path: candidate, fragment };
  }

  return { path: undefined, fragment };
}

function getChangedMarkdownFiles(customBase) {
  const candidates = customBase
    ? [customBase]
    : [
        "origin/integration/staging",
        "upstream/integration/staging",
        "origin/main",
        "HEAD~1",
      ];

  for (const target of candidates) {
    try {
      const output = execSync(
        `git diff --name-only ${target}...HEAD -- "*.md" "*.mdx"`,
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
      );
      const files = output
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s && (s.endsWith(".md") || s.endsWith(".mdx")))
        .filter((s) => fs.existsSync(path.resolve(root, s)));
      return files;
    } catch {
      // try next candidate
    }
  }

  // Also try working tree changed/untracked markdown files
  try {
    const output = execSync(
      `git status --porcelain -- "*.md" "*.mdx"`,
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    );
    const files = output
      .split("\n")
      .map((s) => s.trim().slice(3).trim())
      .filter((s) => s && (s.endsWith(".md") || s.endsWith(".mdx")))
      .filter((s) => fs.existsSync(path.resolve(root, s)));
    return files;
  } catch {
    return null;
  }
}

// ── CLI Execution ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let changedMode = false;
let baseRef = null;
const positionalFiles = [];

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--changed") {
    changedMode = true;
    if (args[i + 1] && !args[i + 1].startsWith("-")) {
      baseRef = args[++i];
    }
  } else if (arg.startsWith("--changed=")) {
    changedMode = true;
    baseRef = arg.split("=")[1];
  } else if (arg === "--files") {
    while (i + 1 < args.length && !args[i + 1].startsWith("-")) {
      positionalFiles.push(args[++i]);
    }
  } else if (arg === "--annotations" || arg === "--check-external") {
    // optional flags
  } else if (!arg.startsWith("-")) {
    positionalFiles.push(arg);
  }
}

const markdownFiles = [];

if (positionalFiles.length > 0) {
  for (const f of positionalFiles) {
    const absPath = path.resolve(root, f);
    if (fs.existsSync(absPath)) {
      if (fs.statSync(absPath).isDirectory()) {
        collectMarkdownFiles(absPath, markdownFiles);
      } else if (/\.mdx?$/i.test(absPath)) {
        markdownFiles.push(absPath);
      }
    } else {
      console.warn(`Warning: Specified file does not exist: ${f}`);
    }
  }
} else if (changedMode) {
  const changed = getChangedMarkdownFiles(baseRef);
  if (changed !== null) {
    if (changed.length === 0) {
      console.log("No changed Markdown files detected; link integrity check passed.");
      process.exit(0);
    }
    console.log(`Detected ${changed.length} changed Markdown file(s) to verify:`);
    for (const f of changed) {
      console.log(`  • ${f}`);
      markdownFiles.push(path.resolve(root, f));
    }
  } else {
    console.warn("Could not determine changed files from git diff; falling back to checking all documentation files.");
    collectMarkdownFiles(root, markdownFiles);
  }
} else {
  collectMarkdownFiles(root, markdownFiles);
}

const failures = [];
for (const sourceFile of markdownFiles) {
  const markdown = fs.readFileSync(sourceFile, "utf8");
  const lineOffsets = [0];
  for (const match of markdown.matchAll(/\n/g)) lineOffsets.push(match.index + 1);

  for (const link of linksIn(markdown)) {
    const destination = link.destination.trim();
    if (
      !destination ||
      isExternalUrl(destination) ||
      destination.startsWith("#")
    ) {
      if (destination.startsWith("#")) {
        let fragment = destination.slice(1);
        try {
          fragment = decodeURIComponent(fragment);
        } catch {
          // Keep literal fragment
        }
        if (!headingAnchors(markdown).has(fragment)) {
          const line = lineOffsets.filter((offset) => offset <= link.offset).length;
          failures.push({
            file: path.relative(root, sourceFile).replace(/\\/g, "/"),
            line,
            message: `missing anchor #${fragment}`,
          });
        }
      }
      continue;
    }

    const { path: target, fragment } = resolveMarkdownTarget(sourceFile, destination);
    const line = lineOffsets.filter((offset) => offset <= link.offset).length;
    if (!target) {
      failures.push({
        file: path.relative(root, sourceFile).replace(/\\/g, "/"),
        line,
        message: `missing file ${destination}`,
      });
      continue;
    }
    if (fragment && /\.mdx?$/i.test(target)) {
      const anchors = headingAnchors(fs.readFileSync(target, "utf8"));
      if (!anchors.has(fragment)) {
        failures.push({
          file: path.relative(root, sourceFile).replace(/\\/g, "/"),
          line,
          message: `missing anchor ${destination}`,
        });
      }
    }
  }
}

if (failures.length > 0) {
  console.error(`Found ${failures.length} broken Markdown link(s):`);
  const isCI = process.env.GITHUB_ACTIONS === "true" || process.argv.includes("--annotations");
  for (const failure of failures) {
    console.error(`  ${failure.file}:${failure.line}: ${failure.message}`);
    if (isCI) {
      console.log(`::error file=${failure.file},line=${failure.line},title=Broken Markdown Link::${failure.message}`);
    }
  }
  process.exitCode = 1;
} else {
  console.log(`Checked Markdown links in ${markdownFiles.length} file(s); no broken links found.`);
}
