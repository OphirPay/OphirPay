#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const ignoredDirectories = new Set([
  ".git",
  ".next",
  "coverage",
  "node_modules",
  "target",
]);
const markdownFiles = [];

function collectMarkdownFiles(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        collectMarkdownFiles(path.join(directory, entry.name));
      }
    } else if (entry.isFile() && /\.mdx?$/i.test(entry.name)) {
      markdownFiles.push(path.join(directory, entry.name));
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

collectMarkdownFiles(root);

const failures = [];
for (const sourceFile of markdownFiles) {
  const markdown = fs.readFileSync(sourceFile, "utf8");
  const lineOffsets = [0];
  for (const match of markdown.matchAll(/\n/g)) lineOffsets.push(match.index + 1);

  for (const link of linksIn(markdown)) {
    const destination = link.destination.trim();
    if (
      !destination ||
      /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(destination) ||
      destination.startsWith("#")
    ) {
      if (destination.startsWith("#")) {
        let fragment = destination.slice(1);
        try {
          fragment = decodeURIComponent(fragment);
        } catch {
          // Keep the literal fragment so malformed escapes fail as missing anchors.
        }
        if (!headingAnchors(markdown).has(fragment)) {
          const line = lineOffsets.filter((offset) => offset <= link.offset).length;
          failures.push(`${path.relative(root, sourceFile)}:${line}: missing anchor #${fragment}`);
        }
      }
      continue;
    }

    const { path: target, fragment } = resolveMarkdownTarget(sourceFile, destination);
    const line = lineOffsets.filter((offset) => offset <= link.offset).length;
    if (!target) {
      failures.push(`${path.relative(root, sourceFile)}:${line}: missing file ${destination}`);
      continue;
    }
    if (fragment && /\.mdx?$/i.test(target)) {
      const anchors = headingAnchors(fs.readFileSync(target, "utf8"));
      if (!anchors.has(fragment)) {
        failures.push(
          `${path.relative(root, sourceFile)}:${line}: missing anchor ${destination}`
        );
      }
    }
  }
}

if (failures.length > 0) {
  console.error(`Found ${failures.length} broken Markdown link(s):`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Checked Markdown links in ${markdownFiles.length} files; no broken links found.`);
}
