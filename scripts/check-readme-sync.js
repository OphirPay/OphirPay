#!/usr/bin/env node
/**
 * Check that translated README files are structurally in sync with the English README.
 *
 * The script compares:
 *   - Heading hierarchy (ignoring headings marked as intentionally untranslated)
 *   - Badge count
 *   - Link targets
 *
 * If a mismatch is found, the script exits with code 1 and prints a detailed error.
 * It also updates each translation file with a sync note containing the current
 * commit hash and date.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ENGLISH_README = 'README.md';
const TRANSLATIONS = ['README.es.md', 'README.fr.md', 'README.ja.md'];
const SYNC_NOTE_REGEX = /<!--\s*Last synced to commit\s+([a-f0-9]+)\s+on\s+(\d{4}-\d{2}-\d{2})\s*-->/i;

// Helper to read file
function readFile(file) {
  return fs.readFileSync(file, 'utf8');
}

// Helper to write file
function writeFile(file, content) {
  fs.writeFileSync(file, content, 'utf8');
}

// Extract headings, ignoring intentionally untranslated ones
function extractHeadings(content) {
  const headings = [];
  const lines = content.split('\n');
  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.*)$/);
    if (match) {
      const title = match[2].trim();
      // Skip headings that contain the word "untranslated" (case-insensitive)
      if (/untranslated/i.test(title)) continue;
      headings.push(title);
    }
  }
  return headings;
}

// Count badges (image markdown)
function countBadges(content) {
  const matches = content.match(/!\[.*?\]\(.*?\)/g);
  return matches ? matches.length : 0;
}

// Extract link URLs (excluding images)
function extractLinks(content) {
  const links = [];
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  const imgRegex = /!\[.*?\]\(.*?\)/g;
  // Remove image tags first
  const cleaned = content.replace(imgRegex, '');
  let match;
  while ((match = linkRegex.exec(cleaned)) !== null) {
    links.push(match[2].trim());
  }
  return links;
}

// Get current commit hash and date
function getSyncInfo() {
  const hash = execSync('git rev-parse HEAD').toString().trim();
  const date = new Date().toISOString().split('T')[0];
  return { hash, date };
}

// Update or insert sync note at the top of the file
function updateSyncNote(content, syncInfo) {
  const note = `<!-- Last synced to commit ${syncInfo.hash} on ${syncInfo.date} -->`;
  const existing = content.match(SYNC_NOTE_REGEX);
  if (existing) {
    const existingHash = existing[1];
    const existingDate = existing[2];
    if (existingHash === syncInfo.hash && existingDate === syncInfo.date) {
      // No update needed
      return content;
    }
    // Replace existing note
    return content.replace(SYNC_NOTE_REGEX, note);
  }
  // Insert at the top
  return `${note}\n\n${content}`;
}

// Main comparison logic
function compareReadme() {
  const englishContent = readFile(ENGLISH_README);
  const englishHeadings = extractHeadings(englishContent);
  const englishBadges = countBadges(englishContent);
  const englishLinks = extractLinks(englishContent);

  let hasError = false;

  for (const file of TRANSLATIONS) {
    const content = readFile(file);
    const headings = extractHeadings(content);
    const badges = countBadges(content);
    const links = extractLinks(content);

    // Headings comparison
    const missing = englishHeadings.filter(h => !headings.includes(h));
    const extra = headings.filter(h => !englishHeadings.includes(h));

    if (missing.length || extra.length) {
      hasError = true;
      console.error(`\n❌ Structural mismatch in ${file}`);
      if (missing.length) {
        console.error(`  Missing headings (${missing.length}):`);
        missing.forEach(h => console.error(`    - ${h}`));
      }
      if (extra.length) {
        console.error(`  Extra headings (${extra.length}):`);
        extra.forEach(h => console.error(`    - ${h}`));
      }
    }

    // Badges comparison
    if (badges !== englishBadges) {
      hasError = true;
      console.error(`\n❌ Badge count mismatch in ${file}`);
      console.error(`  English: ${englishBadges}, ${file}: ${badges}`);
    }

    // Links comparison
    const missingLinks = englishLinks.filter(l => !links.includes(l));
    const extraLinks = links.filter(l => !englishLinks.includes(l));
    if (missingLinks.length || extraLinks.length) {
      hasError = true;
      console.error(`\n❌ Link target mismatch in ${file}`);
      if (missingLinks.length) {
        console.error(`  Missing links (${missingLinks.length}):`);
        missingLinks.forEach(l => console.error(`    - ${l}`));
      }
      if (extraLinks.length) {
        console.error(`  Extra links (${extraLinks.length}):`);
        extraLinks.forEach(l => console.error(`    - ${l}`));
      }
    }

    // Update sync note
    const syncInfo = getSyncInfo();
    const updatedContent = updateSyncNote(content, syncInfo);
    if (updatedContent !== content) {
      writeFile(file, updatedContent);
      console.log(`✅ Updated sync note in ${file}`);
    }
  }

  if (hasError) {
    process.exit(1);
  } else {
    console.log('\n✅ All README files are structurally in sync.');
  }
}

compareReadme();
