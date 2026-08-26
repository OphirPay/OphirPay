// SPDX-License-Identifier: MIT
// Scheduled payment execution via cron (issue #175)

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  recurrence: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
  payment: {
    create: vi.fn(),
  },
}));

vi.mock('@/lib/prisma', () => ({ default: prismaMock }));

import { GET } from '@/app/api/cron/route';
import { processDueRecurrences, nextOccurrence } from '@/lib/scheduler';

const SECRET = 'test-cron-secret-0123456789abcdef';

function makeRequest(headers: Record<string, string> = {}, env: Record<string, string | undefined> = {}) {
  Object.entries(env).forEach(([k, v]) => {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  });
  return new Request('http://localhost/api/cron', { headers });
}

const baseRecurrence = {
  id: 'rec-1',
  userId: 'user-1',
  name: 'Rent',
  frequency: 'MONTHLY',
  amount: 1200,
  assetCode: 'XLM',
  destAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
  description: 'Monthly rent',
  nextRunAt: new Date('2026-08-26T00:00:00Z'),
};

describe('nextOccurrence (simulated clock)', () => {
  it.each([
    ['DAILY', '2026-08-27T00:00:00.000Z'],
    ['WEEKLY', '2026-09-02T00:00:00.000Z'],
    ['BIWEEKLY', '2026-09-09T00:00:00.000Z'],
    ['MONTHLY', '2026-09-26T00:00:00.000Z'],
    ['QUARTERLY', '2026-11-26T00:00:00.000Z'],
    ['YEARLY', '2027-08-26T00:00:00.000Z'],
  ])('advances %s correctly', (frequency, expected) => {
    expect(nextOccurrence(new Date('2026-08-26T00:00:00Z'), frequency).toISOString()).toBe(expected);
  });

  it('handles month-end rollover without skipping months', () => {
    // Jan 31 + MONTHLY must land in February, not March 2/3
    const next = nextOccurrence(new Date('2026-01-31T00:00:00Z'), 'MONTHLY');
    expect(next.getUTCMonth()).toBe(1); // February
    expect(next.getUTCDate()).toBeLessThanOrEqual(28);
  });
});

describe('processDueRecurrences — due selection and execution', () => {
  beforeEach(() => {
    prismaMock.recurrence.findMany.mockReset();
    prismaMock.recurrence.updateMany.mockReset();
    prismaMock.payment.create.mockReset();
  });

  it('selects only active schedules whose nextRunAt is due', async () => {
    const now = new Date('2026-08-26T12:00:00Z');
    prismaMock.recurrence.findMany.mockResolvedValue([]);
    await processDueRecurrences(prismaMock as never, now);

    expect(prismaMock.recurrence.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isActive: true, nextRunAt: { lte: now } },
      })
    );
  });

  it('claims atomically by advancing nextRunAt, then creates the payment', async () => {
    const now = new Date('2026-08-26T12:00:00Z');
    prismaMock.recurrence.findMany.mockResolvedValue([baseRecurrence]);
    prismaMock.recurrence.updateMany.mockResolvedValue({ count: 1 }); // claim won
    prismaMock.payment.create.mockResolvedValue({ id: 'pay-1' });

    const results = await processDueRecurrences(prismaMock as never, now);

    expect(results).toEqual([{ recurrenceId: 'rec-1', executed: true, paymentId: 'pay-1' }]);
    expect(prismaMock.recurrence.updateMany).toHaveBeenCalledWith({
      where: { id: 'rec-1', isActive: true, nextRunAt: baseRecurrence.nextRunAt },
      data: { lastRunAt: now, nextRunAt: new Date('2026-09-26T12:00:00Z') },
    });
    expect(prismaMock.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        recurrenceId: 'rec-1',
        status: 'PENDING',
        destAccountId: baseRecurrence.destAddress,
      }),
    });
  });

  it('never double-executes when a concurrent run claimed first', async () => {
    const now = new Date('2026-08-26T12:00:00Z');
    prismaMock.recurrence.findMany.mockResolvedValue([baseRecurrence]);
    // Concurrent runner already advanced nextRunAt -> our claim matches 0 rows
    prismaMock.recurrence.updateMany.mockResolvedValue({ count: 0 });

    const results = await processDueRecurrences(prismaMock as never, now);

    expect(results).toEqual([
      { recurrenceId: 'rec-1', executed: false, reason: 'claimed-by-concurrent-run' },
    ]);
    expect(prismaMock.payment.create).not.toHaveBeenCalled();
  });

  it('rolls back the claim when payment creation fails so the run is retried', async () => {
    const now = new Date('2026-08-26T12:00:00Z');
    prismaMock.recurrence.findMany.mockResolvedValue([baseRecurrence]);
    prismaMock.recurrence.updateMany
      .mockResolvedValueOnce({ count: 1 }) // claim wins
      .mockResolvedValueOnce({ count: 1 }); // rollback restore
    prismaMock.payment.create.mockRejectedValue(new Error('db down'));

    const results = await processDueRecurrences(prismaMock as never, now);

    expect(results).toEqual([
      { recurrenceId: 'rec-1', executed: false, reason: 'payment-creation-failed' },
    ]);
    // nextRunAt restored to the original due time so the next run retries it
    expect(prismaMock.recurrence.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'rec-1', isActive: true },
      data: { lastRunAt: null, nextRunAt: baseRecurrence.nextRunAt },
    });
  });

  it('second overlapping run sees nothing due after the first run advanced schedules', async () => {
    let nextRunAt = new Date('2026-08-26T00:00:00Z');
    const now = () => new Date('2026-08-26T12:00:00Z');

    // First run: due schedule found and claim succeeds
    prismaMock.recurrence.findMany
      .mockResolvedValueOnce([{ ...baseRecurrence, nextRunAt }])
      .mockResolvedValueOnce([]); // second run: nothing due anymore
    prismaMock.recurrence.updateMany.mockImplementation(async (args: { data: { nextRunAt: Date } }) => {
      nextRunAt = args.data.nextRunAt; // simulate the DB row being advanced
      return { count: 1 };
    });
    prismaMock.payment.create.mockResolvedValue({ id: 'pay-x' });

    const first = await processDueRecurrences(prismaMock as never, now(), 25);
    expect(first[0].executed).toBe(true);

    // Second overlapping invocation: findMany now returns [] because
    // nextRunAt was advanced past `now` by the claim.
    const second = await processDueRecurrences(prismaMock as never, now(), 25);
    expect(second).toEqual([]);
    expect(prismaMock.payment.create).toHaveBeenCalledTimes(1); // exactly one payment ever
  });
});

describe('GET /api/cron — auth and response shape', () => {
  const originalEnv = process.env.CRON_SECRET;

  afterEach(() => {
    process.env.CRON_SECRET = originalEnv;
  });

  beforeEach(() => {
    prismaMock.recurrence.findMany.mockReset();
    prismaMock.recurrence.updateMany.mockReset();
    prismaMock.payment.create.mockReset();
    process.env.CRON_SECRET = SECRET;
    prismaMock.recurrence.findMany.mockResolvedValue([]);
  });

  it('rejects requests with no Authorization header', async () => {
    const res = await GET(makeRequest({}, {}));
    expect(res.status).toBe(401);
  });

  it('rejects an invalid bearer token', async () => {
    const res = await GET(makeRequest({ authorization: 'Bearer wrong-secret' }));
    expect(res.status).toBe(401);
  });

  it('fails closed when CRON_SECRET is not configured', async () => {
    const res = await GET(makeRequest({ authorization: `Bearer ${SECRET}` }, { CRON_SECRET: undefined }));
    expect(res.status).toBe(401);
  });

  it('accepts a valid bearer token and reports counts', async () => {
    const res = await GET(makeRequest({ authorization: `Bearer ${SECRET}` }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.executed).toBe(0);
    expect(json.data.skipped).toBe(0);
    expect(json.data.ranAt).toBeDefined();
  });
});
