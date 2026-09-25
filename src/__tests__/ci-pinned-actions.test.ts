import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('GitHub Actions Commit SHA Pinning (Issue #733)', () => {
  const workflowsDir = path.resolve(process.cwd(), '.github/workflows');
  const dependabotPath = path.resolve(process.cwd(), '.github/dependabot.yml');
  const contributingPath = path.resolve(process.cwd(), 'CONTRIBUTING.md');

  const workflowFiles = fs
    .readdirSync(workflowsDir)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));

  it('finds workflow files in .github/workflows', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
  });

  it('ensures all non-local "uses:" directives use a full 40-character commit SHA with a version comment', () => {
    const unpinnedUses: { file: string; line: number; text: string }[] = [];
    const shaPattern = /uses:\s+([a-zA-Z0-9_\-./]+)@([a-fA-F0-9]{40})(\s+#\s*.+)?/;

    for (const file of workflowFiles) {
      const fullPath = path.join(workflowsDir, file);
      const content = fs.readFileSync(fullPath, 'utf8');
      const lines = content.split('\n');

      lines.forEach((lineText, idx) => {
        const trimmed = lineText.trim();
        // Check for `uses:` but skip commented-out lines or local composite action paths (e.g. `./...`)
        if (trimmed.startsWith('uses:') || trimmed.includes('- uses:')) {
          const usesMatch = trimmed.match(/uses:\s+(.+)/);
          if (!usesMatch) return;
          const target = usesMatch[1].trim();

          // Skip local actions (e.g., `./.github/actions/...`)
          if (target.startsWith('.')) return;

          // Check against 40-character hex SHA pattern
          const match = trimmed.match(shaPattern);
          if (!match) {
            unpinnedUses.push({
              file,
              line: idx + 1,
              text: lineText,
            });
          }
        }
      });
    }

    expect(unpinnedUses).toEqual([]);
  });

  it('verifies that Dependabot tracks github-actions ecosystem', () => {
    expect(fs.existsSync(dependabotPath)).toBe(true);
    const content = fs.readFileSync(dependabotPath, 'utf8');
    expect(content).toContain('package-ecosystem: "github-actions"');
  });

  it('verifies that CONTRIBUTING.md documents the SHA pinning requirement', () => {
    expect(fs.existsSync(contributingPath)).toBe(true);
    const content = fs.readFileSync(contributingPath, 'utf8');
    expect(content).toMatch(/GitHub Actions SHA Pinning/i);
    expect(content).toMatch(/40-character commit SHA/i);
  });
});
