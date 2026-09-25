// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';

interface WorkflowDef {
  on?: Record<string, unknown>;
  True?: Record<string, unknown>;
  concurrency?: {
    group?: string;
    'cancel-in-progress'?: boolean;
    cancel_in_progress?: boolean;
  };
}

describe('Workflow Concurrency Policy (Issue #753)', () => {
  const root = process.cwd();
  const workflowsDir = join(root, '.github/workflows');
  const workflowFiles = readdirSync(workflowsDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));

  it('finds at least 15 workflow files to audit', () => {
    expect(workflowFiles.length).toBeGreaterThanOrEqual(15);
  });

  for (const filename of workflowFiles) {
    describe(`Workflow: ${filename}`, () => {
      const fullPath = join(workflowsDir, filename);
      const rawContent = readFileSync(fullPath, 'utf8');
      const parsed = yaml.load(rawContent) as WorkflowDef;

      it('parses as valid YAML', () => {
        expect(parsed).toBeDefined();
        expect(typeof parsed).toBe('object');
      });

      it('declares a top-level concurrency block', () => {
        expect(parsed.concurrency).toBeDefined();
        expect(parsed.concurrency.group).toBeDefined();
        const cancelVal = parsed.concurrency['cancel-in-progress'] ?? parsed.concurrency.cancel_in_progress;
        expect(typeof cancelVal).toBe('boolean');
      });

      it('adopts the standardized comment template', () => {
        expect(rawContent).toMatch(/# ── Global Concurrency — (?:cancel stale runs on same ref|singleton, never cancelled) ────────/);
      });

      const triggers = parsed.on ?? parsed.True;
      const isScheduledOnly =
        triggers &&
        (triggers.schedule !== undefined || filename === 'stale.yml' || filename === 'db-backup.yml' || filename === 'scheduled-payments-cron.yml') &&
        triggers.pull_request === undefined &&
        triggers.pull_request_target === undefined;

      if (isScheduledOnly && filename !== 'prompt-promotion-pr.yml') {
        it('scheduled workflows do not cancel in progress to avoid partial sweeps/backups', () => {
          const cancelInProgress = parsed.concurrency['cancel-in-progress'] ?? parsed.concurrency.cancel_in_progress;
          expect(cancelInProgress).toBe(false);
        });
      }

      const isInteractive =
        triggers &&
        (triggers.pull_request !== undefined ||
          triggers.pull_request_target !== undefined ||
          (triggers.push !== undefined && triggers.push.branches !== undefined));

      if (isInteractive && filename !== 'prompt-promotion-pr.yml') {
        it('interactive workflows cancel stale runs on the same ref or PR', () => {
          const cancelInProgress = parsed.concurrency['cancel-in-progress'] ?? parsed.concurrency.cancel_in_progress;
          expect(cancelInProgress).toBe(true);
        });
      }
    });
  }
});
