#!/usr/bin/env node
/**
 * check-readme-sync.mjs
 *
 * Verifies that each translated README (README.*.md) stays structurally in
 * sync with the English source (README.md).
 *
 * Rules
 * -----
 * 1. Count H2 headings in README.md, subtract ALLOWLISTED sections, and
 *    require each translation to have the same count.
 * 2. Require every translation to contain a sync-stamp comment of the form:
 *       <!-- readme-sync: <commit-sha-or-date> -->
 *    placed anywhere in the file.
 * 3. Prose content, formatting, and translated heading text are ignored.
 *
 * Exit codes
 * ----------
 *   0  All checks passed.
 *   1  One or more checks failed (details printed to stderr).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');

// ── Configuration ────────────────────────────────────────────────────────────

/**
 * H2 section titles (exact English text, emoji stripped for matching) that
 * are intentionally absent from all translations.  Add entries here when a
 * new section is added to README.md but translations are not yet expected to
 * cover it.
 *
 * The script counts English H2s, subtracts ALLOWLIST.size, and compares the
 * result against the translation's H2 count.
 */
const ALLOWLIST = new Set([
  'Hackathon Quickstart (60 seconds)',   // alias — covered by Quick Start
  'New to Stellar',
  'CI/CD Pipeline',
  'Screenshots',
  'Database Schema',
  'Deployment Guide',
  'SSE Event Stream',
  'SSE Integration & Architecture',
  'Smart-contract SSE Reference',
  'Prisma CI & Testing',
  'Sharded Database E2E Runbook',
  'Smart Contract Tests',
  'Stellar Glossary',
  'Roadmap',
  'Formal Verification',
  'Security Audit',
  'Security',
  'Performance & Gas',
  'Community',
]);

// Translations to check: relative paths from repo root
const TRANSLATIONS = ['README.es.md', 'README.fr.md', 'README.ja.md'];

// Regex for the mandatory sync-stamp comment (case-insensitive)
const SYNC_STAMP_RE = /<!--\s*readme-sync\s*:\s*\S+.*?-->/i;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Strip leading emoji characters and surrounding whitespace from a heading. */
function stripEmoji(text) {
  // Remove Unicode emoji / variation selectors, then trim
  return text
    .replace(
      /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}\u{3000}-\u{303F}⚡✨🔐📡🧪📊🛠🤝📄🚀🧭🏦📑🎥🔗??]+/gu,
      '',
    )
    .trim();
}

/**
 * Extract H2 headings from Markdown source.
 * Returns an array of plain-text heading strings (emoji stripped).
 * Handles both LF and CRLF line endings.
 */
function extractH2Headings(source) {
  const headings = [];
  // Normalise CRLF → LF before splitting so \r doesn't bleed into match groups
  for (const line of source.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')) {
    const m = line.match(/^##\s+(.+)$/);
    if (m) {
      headings.push(stripEmoji(m[1].trim()));
    }
  }
  return headings;
}

/** Read a file relative to the repo root. */
function readFile(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

// ── Main ─────────────────────────────────────────────────────────────────────

let failed = false;

function fail(msg) {
  console.error(`\x1b[31m[FAIL]\x1b[0m ${msg}`);
  failed = true;
}

function pass(msg) {
  console.log(`\x1b[32m[PASS]\x1b[0m ${msg}`);
}

function info(msg) {
  console.log(`\x1b[36m[INFO]\x1b[0m ${msg}`);
}

// 1. Parse English source
const englishSource = readFile('README.md');
const englishH2s = extractH2Headings(englishSource);
const allowlistedCount = englishH2s.filter((h) => {
  // Match by checking if any allowlist entry is a substring of the heading
  // (handles emoji-stripped partial matches)
  return [...ALLOWLIST].some(
    (a) => h.toLowerCase().includes(a.toLowerCase()) || a.toLowerCase().includes(h.toLowerCase()),
  );
}).length;

const requiredH2Count = englishH2s.length - allowlistedCount;

info(`English README.md — total H2 sections: ${englishH2s.length}`);
info(`Allowlisted (intentionally untranslated): ${allowlistedCount}`);
info(`Required H2 count in each translation: ${requiredH2Count}`);
console.log('');

// 2. Check each translation
for (const relPath of TRANSLATIONS) {
  const fullPath = path.join(ROOT, relPath);

  if (!fs.existsSync(fullPath)) {
    fail(`${relPath} — file not found.`);
    continue;
  }

  const source = readFile(relPath);
  const h2s = extractH2Headings(source);

  info(`${relPath} — H2 sections found: ${h2s.length}`);

  // Check heading count
  if (h2s.length < requiredH2Count) {
    const missing = requiredH2Count - h2s.length;
    fail(
      `${relPath} — missing ${missing} H2 section(s). ` +
        `Expected at least ${requiredH2Count}, found ${h2s.length}. ` +
        `Add the missing section(s) or update the ALLOWLIST in ` +
        `scripts/check-readme-sync.mjs if a section is intentionally omitted.`,
    );
  } else if (h2s.length > requiredH2Count + allowlistedCount) {
    // Translation has MORE H2s than the English source — likely a stale extra section
    fail(
      `${relPath} — extra H2 section(s) not present in README.md. ` +
        `Found ${h2s.length}, English source has ${englishH2s.length}. ` +
        `Remove the extra section(s) or add the corresponding English section to README.md.`,
    );
  } else {
    pass(`${relPath} — H2 section count matches (${h2s.length}).`);
  }

  // Check sync-stamp comment
  if (!SYNC_STAMP_RE.test(source)) {
    fail(
      `${relPath} — missing sync-stamp comment. ` +
        `Add a comment of the form:\n` +
        `    <!-- readme-sync: <git-commit-sha-or-YYYY-MM-DD> -->\n` +
        `near the top of ${relPath} to record which English version it was translated from.`,
    );
  } else {
    const stamp = source.match(SYNC_STAMP_RE)[0];
    pass(`${relPath} — sync-stamp found: ${stamp}`);
  }

  console.log('');
}

// 3. Result
if (failed) {
  console.error(
    '\x1b[31m─────────────────────────────────────────────────────────────────\x1b[0m',
  );
  console.error(
    '\x1b[31mREADME sync check FAILED. Fix the issues above and re-run:\x1b[0m',
  );
  console.error('\x1b[31m  node scripts/check-readme-sync.mjs\x1b[0m');
  console.error(
    '\x1b[31m─────────────────────────────────────────────────────────────────\x1b[0m',
  );
  process.exit(1);
} else {
  console.log(
    '\x1b[32m─────────────────────────────────────────────────────────────────\x1b[0m',
  );
  console.log('\x1b[32mAll README sync checks passed ✓\x1b[0m');
  console.log(
    '\x1b[32m─────────────────────────────────────────────────────────────────\x1b[0m',
  );
}
