import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import {
  runDocLinkChecker,
  getHeadingSlugs,
  extractAnchors,
  extractLinks,
  ALLOWLISTED_HOSTS,
} from '../../scripts/check-docs-links.mjs';

describe('Documentation Link Checker', () => {
  it('validates all repository markdown documentation with zero broken links or anchors', () => {
    const result = runDocLinkChecker({ checkExternal: false });
    expect(result.totalFiles).toBeGreaterThan(35);
    expect(result.totalLinks).toBeGreaterThan(100);
    expect(result.internalErrors).toEqual([]);
  });

  describe('getHeadingSlugs', () => {
    it('generates standard slug for plain alphanumeric headings', () => {
      const slugs = getHeadingSlugs('Prerequisites');
      expect(slugs).toContain('prerequisites');
    });

    it('generates both GitHub leading dash and clean slugs for emoji-prefixed headings', () => {
      const slugs = getHeadingSlugs('⚡ Quick Start');
      expect(slugs).toContain('-quick-start');
      expect(slugs).toContain('quick-start');
    });

    it('preserves multi-dash spacing for stripped punctuation and ampersands', () => {
      const slugs = getHeadingSlugs('1. Authentication & API Keys');
      expect(slugs).toContain('1-authentication--api-keys');
      expect(slugs).toContain('1-authentication-api-keys');
    });

    it('handles em-dashes and multi-dash spacing', () => {
      const slugs = getHeadingSlugs('Phase 4 — Record addresses and hashes');
      expect(slugs).toContain('phase-4--record-addresses-and-hashes');
      expect(slugs).toContain('phase-4-record-addresses-and-hashes');
    });

    it('supports accented Unicode characters in international headings', () => {
      const slugs = getHeadingSlugs('📡 Événements en Temps Réel');
      expect(slugs).toContain('-événements-en-temps-réel');
      expect(slugs).toContain('événements-en-temps-réel');
    });

    it('supports CJK characters in Japanese headings', () => {
      const slugs = getHeadingSlugs('✨ なぜOphirPay？');
      expect(slugs).toContain('-なぜophirpay');
      expect(slugs).toContain('なぜophirpay');
    });

    it('handles emojis with variation selectors', () => {
      const slugs = getHeadingSlugs('🛡️ Security Audit');
      expect(slugs.some((slug) => slug.includes('security-audit'))).toBe(true);
    });
  });

  describe('extractAnchors', () => {
    it('extracts anchors from headings and HTML tags', () => {
      const markdown = [
        '# Main Title',
        '## Section One',
        '<a id="custom-anchor"></a>',
        '<div id="container-anchor">Content</div>',
      ].join('\n');

      const anchors = extractAnchors(markdown);
      expect(anchors.has('main-title')).toBe(true);
      expect(anchors.has('section-one')).toBe(true);
      expect(anchors.has('custom-anchor')).toBe(true);
      expect(anchors.has('container-anchor')).toBe(true);
    });
  });

  describe('extractLinks', () => {
    it('extracts links with line numbers and ignores fenced code blocks', () => {
      const markdown = [
        '# Document',
        'Here is a [valid link](./guide.md).',
        '```markdown',
        'Here is a [fake link in code](./nonexistent.md)',
        '```',
        'Another [valid link](#section).',
      ].join('\n');

      const links = extractLinks(markdown);
      expect(links).toHaveLength(2);
      expect(links[0]).toEqual({
        href: './guide.md',
        text: 'valid link',
        line: 2,
      });
      expect(links[1]).toEqual({
        href: '#section',
        text: 'valid link',
        line: 6,
      });
    });
  });

  describe('Broken link detection', () => {
    it('detects broken internal file links and missing anchors with file and line reporting', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-check-test-'));
      try {
        const fileA = path.join(tempDir, 'fileA.md');
        const fileB = path.join(tempDir, 'fileB.md');

        fs.writeFileSync(
          fileA,
          [
            '# File A',
            'Link to missing file: [Missing](./fileC.md)',
            'Link to missing anchor: [Missing Anchor](./fileB.md#non-existent-heading)',
            'Link to missing same-file anchor: [Missing Self](#no-such-section)',
            'Link to valid anchor: [Valid Anchor](./fileB.md#target-heading)',
          ].join('\n')
        );

        fs.writeFileSync(
          fileB,
          [
            '# Target Heading',
            'Some content.',
          ].join('\n')
        );

        const result = runDocLinkChecker({ baseDir: tempDir });
        expect(result.internalErrors).toHaveLength(3);

        const missingFileError = result.internalErrors.find((err) => err.line === 2);
        expect(missingFileError?.message).toContain('Target file not found');
        expect(missingFileError?.href).toBe('./fileC.md');

        const missingAnchorError = result.internalErrors.find((err) => err.line === 3);
        expect(missingAnchorError?.message).toContain("Anchor '#non-existent-heading' not found");

        const missingSelfAnchorError = result.internalErrors.find((err) => err.line === 4);
        expect(missingSelfAnchorError?.message).toContain("Missing same-file anchor target '#no-such-section'");
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('External URL verification', () => {
    it('flags unallowlisted external hosts as warnings without failing internal checks', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-check-ext-'));
      try {
        const testFile = path.join(tempDir, 'external.md');
        fs.writeFileSync(
          testFile,
          [
            '# External Test',
            'Allowlisted: [Stellar](https://stellar.org)',
            'Not allowlisted: [Unknown](https://random-untrusted-host.example.com)',
          ].join('\n')
        );

        const result = runDocLinkChecker({ baseDir: tempDir, checkExternal: true });
        expect(result.internalErrors).toHaveLength(0);
        expect(result.externalWarnings).toHaveLength(1);
        expect(result.externalWarnings[0].href).toBe('https://random-untrusted-host.example.com');
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('contains trusted ecosystem domains in allowlist', () => {
      expect(ALLOWLISTED_HOSTS).toContain('stellar.org');
      expect(ALLOWLISTED_HOSTS).toContain('github.com');
      expect(ALLOWLISTED_HOSTS).toContain('vercel.app');
      expect(ALLOWLISTED_HOSTS).toContain('npmjs.com');
    });
  });
});
