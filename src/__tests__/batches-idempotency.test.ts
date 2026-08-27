// SPDX-License-Identifier: MIT
// Idempotent batch re-submission tests (issue #170)

import { describe, it, expect, vi, beforeEach } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  batch: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  payment: {
    createMany: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ default: prismaMock }));

vi.mock('@/lib/auth-session', () => ({
  getAuthContext: vi.fn().mockResolvedValue({ userId: 'user-1' }),
}));

import { POST } from '@/app/api/batches/route';

const validBody = {
  name: 'Test Batch',
  description: 'desc',
  sourceAccountId: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
  recipients: [
    {
      address: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      amount: 10,
      assetCode: 'XLM',
    },
  ],
};

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/batches', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('POST /api/batches — idempotency', () => {
  beforeEach(() => {
    prismaMock.batch.findUnique.mockReset();
    prismaMock.batch.create.mockReset();
    prismaMock.payment.createMany.mockReset();
    // Interactive transaction: run the callback against the same mocks
    prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn(prismaMock)
    );
  });

  it('creates a new batch when no idempotency key is provided', async () => {
    const batch = { id: 'b1', payments: [] };
    prismaMock.batch.findUnique
      .mockResolvedValueOnce({ ...batch }) // post-create fetch
      .mockReturnValue(undefined);
    prismaMock.batch.create.mockResolvedValue(batch);
    prismaMock.payment.createMany.mockResolvedValue({ count: 1 });

    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(201);
    expect(prismaMock.batch.create).toHaveBeenCalledTimes(1);
  });

  it('returns the original batch on replay with the same key (header)', async () => {
    const existing = { id: 'b-original', name: 'Test Batch', payments: [{ id: 'p1' }] };
    prismaMock.batch.findUnique.mockResolvedValue(existing);

    const res = await POST(
      makeRequest(validBody, { 'idempotency-key': 'key-12345678' })
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.meta.deduplicated).toBe(true);
    expect(json.data.id).toBe('b-original');
    // No new batch or payments created
    expect(prismaMock.batch.create).not.toHaveBeenCalled();
    expect(prismaMock.payment.createMany).not.toHaveBeenCalled();
  });

  it('accepts the key from the body as fallback', async () => {
    const existing = { id: 'b-body-key', payments: [] };
    prismaMock.batch.findUnique.mockResolvedValue(existing);

    const res = await POST(makeRequest({ ...validBody, idempotencyKey: 'key-body-1' }));
    expect(res.status).toBe(200);
    expect(prismaMock.batch.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_idempotencyKey: { userId: 'user-1', idempotencyKey: 'key-body-1' } },
      })
    );
    expect(prismaMock.batch.create).not.toHaveBeenCalled();
  });

  it('prefers the header over a body key', async () => {
    prismaMock.batch.findUnique.mockResolvedValue(null); // dedupe miss
    prismaMock.batch.create.mockResolvedValue({ id: 'b2' });
    prismaMock.payment.createMany.mockResolvedValue({ count: 1 });

    await POST(
      makeRequest({ ...validBody, idempotencyKey: 'key-body-xx' }, { 'idempotency-key': 'key-head-1' })
    );

    expect(prismaMock.batch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ idempotencyKey: 'key-head-1' }),
      })
    );
  });

  it('stores the idempotency key when creating', async () => {
    prismaMock.batch.findUnique.mockResolvedValue(null);
    prismaMock.batch.create.mockResolvedValue({ id: 'b3' });
    prismaMock.payment.createMany.mockResolvedValue({ count: 1 });

    const res = await POST(makeRequest(validBody, { 'idempotency-key': 'fresh-key-99' }));

    expect(res.status).toBe(201);
    expect(prismaMock.batch.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ idempotencyKey: 'fresh-key-99' }),
    });
  });

  it('resolves the race by returning the winning batch on P2002', async () => {
    const winner = { id: 'b-winner', payments: [] };
    prismaMock.batch.findUnique
      .mockResolvedValueOnce(null) // pre-create lookup misses
      .mockResolvedValue(winner); // post-conflict lookup finds winner
    prismaMock.batch.create.mockRejectedValue({ code: 'P2002' });

    const res = await POST(makeRequest(validBody, { 'idempotency-key': 'race-key-01' }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.id).toBe('b-winner');
    expect(json.meta.deduplicated).toBe(true);
    expect(prismaMock.payment.createMany).not.toHaveBeenCalled();
  });

  it('converts non-P2002 create errors into a server error response', async () => {
    prismaMock.batch.findUnique.mockResolvedValue(null);
    prismaMock.batch.create.mockRejectedValue(new Error('db down'));

    const res = await POST(makeRequest(validBody, { 'idempotency-key': 'err-key-001' }));
    expect(res.status).toBe(500);
  });

  it('rejects a header key shorter than 8 characters', async () => {
    const res = await POST(makeRequest(validBody, { 'idempotency-key': 'short' }));
    expect(res.status).toBe(400);
    expect(prismaMock.batch.create).not.toHaveBeenCalled();
  });

  it('rejects an oversized header key', async () => {
    const res = await POST(
      makeRequest(validBody, { 'idempotency-key': 'k'.repeat(256) })
    );
    expect(res.status).toBe(400);
  });

  it('does not return a deduplicated success when payment insertion fails', async () => {
    // Batch row commits but payments fail -> transaction rolls back -> the
    // replay path can never serve a keyed batch without its payments.
    prismaMock.batch.findUnique.mockResolvedValue(null);
    prismaMock.batch.create.mockResolvedValue({ id: 'b-partial' });
    prismaMock.payment.createMany.mockRejectedValue(new Error('insert failed'));

    const res = await POST(
      makeRequest(validBody, { 'idempotency-key': 'atomic-key-1' })
    );
    expect(res.status).toBe(500);
  });

  it('does not dedupe different keys for the same user', async () => {
    const batchA = { id: 'bA', payments: [] };
    prismaMock.batch.findUnique
      .mockResolvedValueOnce(null) // dedupe miss
      .mockResolvedValue(batchA); // post-create fetch
    prismaMock.batch.create.mockResolvedValue(batchA);
    prismaMock.payment.createMany.mockResolvedValue({ count: 1 });

    const res = await POST(makeRequest(validBody, { 'idempotency-key': 'first-key-A' }));
    expect(res.status).toBe(201);
    expect(prismaMock.batch.create).toHaveBeenCalledTimes(1);
  });
});
