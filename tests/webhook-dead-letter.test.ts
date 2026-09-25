// SPDX-License-Identifier: MIT

import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  default: {
    webhookDeadLetter: {
      upsert: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    },
  },
  prisma: {
    webhookDeadLetter: {
      upsert: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    },
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import prisma from '@/lib/prisma';
import { RETRY_CONFIG } from '@/lib/retry-config';
import {
  countDeadLetters,
  listDeadLetters,
  moveToDeadLetter,
  shouldDeadLetter,
} from '@/lib/webhook-dead-letter';
import { getDeadLetterSnapshot, DEAD_LETTER_ALERT_THRESHOLD } from '@/lib/webhook-dead-letter-metrics';

const dl = prisma.webhookDeadLetter as unknown as {
  upsert: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
  count: ReturnType<typeof vi.fn>;
};

describe('webhook dead-letter queue', () => {
  beforeEach(() => vi.clearAllMocks());

  it('only dead-letters once the retry budget is exhausted', () => {
    const max = RETRY_CONFIG.webhook.maxAttempts;
    expect(shouldDeadLetter(max - 1)).toBe(false);
    expect(shouldDeadLetter(max)).toBe(true);
    expect(shouldDeadLetter(max + 1)).toBe(true);
  });

  it('retains the payload, last response and failure reason', async () => {
    dl.upsert.mockResolvedValue({ id: 'dl_1' });
    await moveToDeadLetter({
      webhookId: 'wh_1',
      deliveryId: 'del_1',
      eventId: 'evt_1',
      payload: JSON.stringify({ event: 'payment.completed' }),
      attempts: 3,
      lastResponseCode: 502,
      lastErrorMessage: 'connect ETIMEDOUT',
    });

    const arg = dl.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ deliveryId: 'del_1' });
    expect(arg.create.payload).toContain('payment.completed');
    expect(arg.create.lastResponseCode).toBe(502);
    expect(arg.create.lastErrorMessage).toBe('connect ETIMEDOUT');
  });

  it('is idempotent for a repeated delivery id', async () => {
    dl.upsert.mockResolvedValue({ id: 'dl_1' });
    const input = {
      webhookId: 'wh_1',
      deliveryId: 'del_1',
      eventId: 'evt_1',
      payload: '{}',
      attempts: 3,
    };
    await moveToDeadLetter(input);
    await moveToDeadLetter(input);
    expect(dl.upsert).toHaveBeenCalledTimes(2);
    expect(dl.upsert.mock.calls[0][0].where).toEqual(dl.upsert.mock.calls[1][0].where);
  });

  it('hides replayed entries by default and clamps the page size', async () => {
    await listDeadLetters({ limit: 9999 });
    const arg = dl.findMany.mock.calls[0][0];
    expect(arg.where.replayedAt).toBeNull();
    expect(arg.take).toBe(200);
    expect(arg.orderBy).toEqual({ failedAt: 'desc' });
  });

  it('counts only un-replayed dead letters, optionally per webhook', async () => {
    await countDeadLetters('wh_1');
    expect(dl.count.mock.calls[0][0].where).toEqual({ replayedAt: null, webhookId: 'wh_1' });
  });

  it('flags an alert at the configured threshold', async () => {
    dl.count.mockResolvedValue(DEAD_LETTER_ALERT_THRESHOLD);
    expect((await getDeadLetterSnapshot('wh_1')).alerting).toBe(true);

    dl.count.mockResolvedValue(DEAD_LETTER_ALERT_THRESHOLD - 1);
    expect((await getDeadLetterSnapshot('wh_1')).alerting).toBe(false);
  });
});
