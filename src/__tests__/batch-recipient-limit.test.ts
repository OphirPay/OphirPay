// SPDX-License-Identifier: MIT
// Tests for createBatchSchema recipients limit — issue #1946

import { describe, it, expect } from 'vitest';
import { createBatchSchema } from '@/lib/validation-schemas';

const addr = (i: number) => `G${'A'.repeat(55 - String(i).length)}${i}`;

describe('createBatchSchema > recipients', () => {
  const base = {
    name: 'Test batch',
    sourceAccountId: 'acc1',
  };

  it('accepts exactly 100 recipients', () => {
    const recipients = Array.from({ length: 100 }, (_, i) => ({ address: addr(i), amount: 1 }));
    const result = createBatchSchema.safeParse({ ...base, recipients });
    expect(result.success).toBe(true);
  });

  it('rejects 101 recipients with an issue on the recipients path', () => {
    const recipients = Array.from({ length: 101 }, (_, i) => ({ address: addr(i), amount: 1 }));
    const result = createBatchSchema.safeParse({ ...base, recipients });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes('recipients'));
      expect(issue).toBeDefined();
    }
  });

  it('rejects an empty recipients array', () => {
    const result = createBatchSchema.safeParse({ ...base, recipients: [] });
    expect(result.success).toBe(false);
  });

  it('rejects a malformed recipient address', () => {
    const result = createBatchSchema.safeParse({ ...base, recipients: [{ address: 'not-an-address', amount: 1 }] });
    expect(result.success).toBe(false);
  });
});
