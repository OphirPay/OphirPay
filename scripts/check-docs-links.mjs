#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

export const ALLOWLISTED_HOSTS = [
  'albedo.link',
  'codebuff.com',
  'codecov.io',
  'conventionalcommits.org',
  'developer.mozilla.org',
  'developers.stellar.org',
  'docker.com',
  'docs.rs',
  'drips.network',
  'first.org',
  'freighter.app',
  'git-scm.com',
  'github.com',
  'grafana.com',
  'helm.sh',
  'img.shields.io',
  'keepachangelog.com',
  'kubernetes.io',
  'laboratory.stellar.org',
  'ledger.com',
  'lobstr.co',
  'localhost',
  'loom.com',
  'model-checking.github.io',
  'mozilla.org',
  'neon.tech',
  'nextjs.org',
  'nodejs.org',
  'npmjs.com',
  'ophirpay.vercel.app',
  'playwright.dev',
  'prisma.io',
  'prometheus.io',
  'rabet.io',
  'raw.githubusercontent.com',
  'rfc-editor.org',
  'rust-lang.org',
  'semver.org',
  'shields.io',
  'sonarcloud.io',
  'soroban.stellar.org',
  'status.stellar.org',
  'stellar.expert',
  'stellar.org',
  'tailwindcss.com',
  'typescriptlang.org',
  'vercel.app',
  'vercel.com',
  'vitest.dev',
  'w3.org',
  'xbull.app',
  'zod.dev',
];

const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'target',
  'playwright-report',
  'dist',
  'build',
  '.husky',
]);

/**
 * Recursively find all markdown files in a directory tree.
 * @param {string} dir - Directory to search.
 * @param {string[]} [fileList] - Accumulated files.
 * @returns {string[]} Absolute paths to markdown files.
 */
export function findMarkdownFiles(dir, fileList = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry.name)) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findMarkdownFiles(fullPath, fileList);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

/**
 * Generate possible GitHub Flavored Markdown slug variations for a heading.
 * @param {string} heading - Heading text.
 * @returns {string[]} Valid slugs for the heading.
 */
export function getHeadingSlugs(heading) {
  const slugs = new Set();
  const textWithoutTags = heading.replace(/<[^>]+>/g, '').replace(/`([^`]+)`/g, '$1');
  const emojiRegex = /[\p{Extended_Pictographic}\u{2600}-\u{27BF}\u{FE0E}\u{FE0F}]/gu;
  const noPunctuation = textWithoutTags
    .toLowerCase()
    .replace(emojiRegex, '')
    .replace(/[^\p{L}\p{M}\p{N}\s\-_]/gu, '')
    .replace(/\s+$/, '');

  const standardGfm = noPunctuation.replace(/\s/g, '-');
  if (standardGfm) {
    slugs.add(standardGfm);
  }

  const noLeadingDashes = standardGfm.replace(/^-+/, '');
  if (noLeadingDashes) {
    slugs.add(noLeadingDashes);
  }

  const collapsedDashes = standardGfm.replace(/-+/g, '-');
  if (collapsedDashes) {
    slugs.add(collapsedDashes);
  }

  const collapsedNoLeading = noLeadingDashes.replace(/-+/g, '-');
  if (collapsedNoLeading) {
    slugs.add(collapsedNoLeading);
  }

  return Array.from(slugs);
}

/**
 * Extract all anchor slugs and HTML IDs declared in a markdown file.
 * @param {string} markdown - Markdown text content.
 * @returns {Set<string>} Set of valid lowercase anchor targets.
 */
export function extractAnchors(markdown) {
  const anchors = new Set();
  const lines = markdown.split('\n');

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,6}\s+(.+)$/);
    if (headingMatch) {
      const slugs = getHeadingSlugs(headingMatch[1].trim());
      for (const slug of slugs) {
        anchors.add(slug);
      }
    }

    const htmlAnchorRegex = /<(?:a|span|div|p|h[1-6])[^>]*(?:id|name)=["']([^"']+)["']/gi;
    let htmlMatch;
    while ((htmlMatch = htmlAnchorRegex.exec(line)) !== null) {
      anchors.add(htmlMatch[1].toLowerCase());
    }
  }

  return anchors;
}

/**
 * Extract markdown links with line numbers, excluding fenced code blocks.
 * @param {string} markdown - Markdown text content.
 * @returns {Array<{href: string, text: string, line: number}>} Extracted links.
 */
export function extractLinks(markdown) {
  const links = [];
  const lines = markdown.split('\n');
  let inFencedBlock = false;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const lineNumber = index + 1;

    if (/^(\s*```|\s*~~~)/.test(line)) {
      inFencedBlock = !inFencedBlock;
      continue;
    }

    if (inFencedBlock) {
      continue;
    }

    const linkRegex = /!?\[([^\]]*)\]\(([^)]+)\)/g;
    let match;
    while ((match = linkRegex.exec(line)) !== null) {
      const rawText = match[1];
      const rawTarget = match[2].trim();
      const href = rawTarget.split(/\s+"/)[0].replace(/^<|>$/g, '');
      if (href) {
        links.push({
          href,
          text: rawText,
          line: lineNumber,
        });
      }
    }
  }

  return links;
}

/**
 * Run link and anchor checks across markdown documents in the target directory.
 * @param {Object} [options] - Configuration options.
 * @param {string} [options.baseDir] - Base directory to scan.
 * @param {boolean} [options.checkExternal=false] - Whether to validate external URLs.
 * @param {boolean} [options.failOnExternal=false] - Whether external issues fail the check.
 * @returns {{totalFiles: number, totalLinks: number, internalErrors: Array<{file: string, line: number, href: string, message: string}>, externalWarnings: Array<{file: string, line: number, href: string, message: string}>}} Results of the link check.
 */
export function runDocLinkChecker(options = {}) {
  const baseDir = options.baseDir || REPO_ROOT;
  const checkExternal = Boolean(options.checkExternal);
  const files = findMarkdownFiles(baseDir);

  const fileAnchorsMap = new Map();
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    fileAnchorsMap.set(path.resolve(file), extractAnchors(content));
  }

  const internalErrors = [];
  const externalWarnings = [];
  let totalLinks = 0;

  for (const file of files) {
    const absFile = path.resolve(file);
    const relFile = path.relative(REPO_ROOT, absFile);
    const content = fs.readFileSync(absFile, 'utf8');
    const links = extractLinks(content);
    totalLinks += links.length;

    for (const link of links) {
      const { href, line } = link;

      if (href.startsWith('mailto:') || href.startsWith('tel:')) {
        continue;
      }

      if (/^https?:\/\//i.test(href)) {
        if (checkExternal) {
          try {
            const parsed = new URL(href);
            const isAllowlisted = ALLOWLISTED_HOSTS.some(
              (host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`)
            );
            if (!isAllowlisted) {
              externalWarnings.push({
                file: relFile,
                line,
                href,
                message: `Host '${parsed.hostname}' is not in the ecosystem allowlist`,
              });
            }
          } catch {
            externalWarnings.push({
              file: relFile,
              line,
              href,
              message: 'Invalid external URL format',
            });
          }
        }
        continue;
      }

      if (href.startsWith('#')) {
        const anchor = href.slice(1).toLowerCase();
        if (!anchor) {
          continue;
        }

        const fileAnchors = fileAnchorsMap.get(absFile);
        if (!fileAnchors || !fileAnchors.has(anchor)) {
          internalErrors.push({
            file: relFile,
            line,
            href,
            message: `Missing same-file anchor target '#${anchor}'`,
          });
        }
        continue;
      }

      const [targetFilePath, anchorFragment] = href.split('#');
      if (!targetFilePath) {
        continue;
      }

      const resolvedPath = targetFilePath.startsWith('/')
        ? path.resolve(REPO_ROOT, targetFilePath.slice(1))
        : path.resolve(path.dirname(absFile), targetFilePath);

      if (!fs.existsSync(resolvedPath)) {
        internalErrors.push({
          file: relFile,
          line,
          href,
          message: `Target file not found: '${targetFilePath}' (resolved to ${path.relative(REPO_ROOT, resolvedPath)})`,
        });
        continue;
      }

      if (anchorFragment && resolvedPath.endsWith('.md')) {
        let targetAnchors = fileAnchorsMap.get(resolvedPath);
        if (!targetAnchors) {
          targetAnchors = extractAnchors(fs.readFileSync(resolvedPath, 'utf8'));
          fileAnchorsMap.set(resolvedPath, targetAnchors);
        }

        const normalizedAnchor = anchorFragment.toLowerCase();
        if (!targetAnchors.has(normalizedAnchor)) {
          internalErrors.push({
            file: relFile,
            line,
            href,
            message: `Anchor '#${anchorFragment}' not found in target file '${path.relative(REPO_ROOT, resolvedPath)}'`,
          });
        }
      }
    }
  }

  return {
    totalFiles: files.length,
    totalLinks,
    internalErrors,
    externalWarnings,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const checkExternal = process.argv.includes('--check-external');
  const failOnExternal = process.argv.includes('--fail-on-external');

  console.log('Scanning documentation markdown files for valid links and anchors...');
  const result = runDocLinkChecker({ checkExternal, failOnExternal });

  console.log(`Checked ${result.totalLinks} links across ${result.totalFiles} markdown files.`);

  if (result.externalWarnings.length > 0) {
    console.warn(`\nWarnings: ${result.externalWarnings.length} unallowlisted external link(s):`);
    for (const item of result.externalWarnings) {
      console.warn(`  ${item.file}:${item.line} -> ${item.href} (${item.message})`);
    }
  }

  if (result.internalErrors.length > 0) {
    console.error(`\nErrors: ${result.internalErrors.length} broken internal link(s) or anchor(s):`);
    for (const item of result.internalErrors) {
      console.error(`  ${item.file}:${item.line} -> "${item.href}": ${item.message}`);
    }
    process.exit(1);
  }

  if (failOnExternal && result.externalWarnings.length > 0) {
    console.error(`\nFailed due to ${result.externalWarnings.length} external warning(s) with --fail-on-external.`);
    process.exit(1);
  }

  console.log('All markdown documentation links and anchors are valid.');
  process.exit(0);
}
