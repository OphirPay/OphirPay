import { computeClaimableAmount } from '@/lib/utils';
import { expect, test } from 'vitest';

test('computeClaimableAmount matches contract logic', () => {
  const stream = {
    total: 1000n * 10n ** 18n, // 1000 tokens
    vested: 0n,
    claimed: 0n,
    startTime: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
    endTime: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
  };

  // Mock current time to be exactly halfway
  const originalDate = global.Date;
  global.Date = class extends Date {
    constructor() {
      super();
      return new Date(stream.startTime + (stream.endTime - stream.startTime) / 2);
    }
  } as any;

  const claimable = computeClaimableAmount(stream);
  expect(claimable).toBe(500n * 10n ** 18n);

  global.Date = originalDate;
});

test('claimable amount cannot exceed remaining', () => {
  const stream = {
    total: 1000n * 10n ** 18n,
    vested: 1000n * 10n ** 18n,
    claimed: 500n * 10n ** 18n,
    startTime: Math.floor(Date.now() / 1000) - 3600,
    endTime: Math.floor(Date.now() / 1000) + 3600,
  };

  const claimable = computeClaimableAmount(stream);
  expect(claimable).toBe(500n * 10n ** 18n);
});