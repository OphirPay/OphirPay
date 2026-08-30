// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockFindFirst,
  mockFindUnique,
  mockCreateMany,
  mockBatchCreate,
  mockTransaction,
  mockGetAuthContext,
} = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockFindUnique: vi.fn(),
  mockCreateMany: vi.fn(),
  mockBatchCreate: vi.fn(),
  mockTransaction: vi.fn(),
  mockGetAuthContext: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    batch: { findFirst: mockFindFirst, findUnique: mockFindUnique },
    payment: { createMany: mockCreateMany },
    $transaction: mockTransaction,
  },
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: mockGetAuthContext,
}));

import { POST } from "@/app/api/batches/route";

const USER_ID = "user-1";
const BATCH_ID = "cm0bt0000000000000000001";
const KEY_HEADER = "batch-key-12345";
const KEY_BODY = "body-key-67890";

const VALID_RECIPIENTS = [
  {
    address: "GDHJ3K2LQ7F5XQZPX6YWNMYKXWQXVZKBJZQFYX3F6KRLV4WDXHJMB2UY",
    amount: 1200,
    assetCode: "XLM",
    memo: "aug-1",
  },
  {
    address: "GA5AZNWWOW5PXPNHBVRJOB2ZPZO3PXN5VTXTXOIJTACZZHE5ZA7CAH7H",
    amount: 800,
    assetCode: "XLM",
    memo: "aug-2",
  },
];

function makeBody(overrides: Record<string, unknown> = {}) {
  return {
    name: "August payroll",
    description: "Monthly contractor payouts",
    sourceAccountId: "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U",
    recipients: VALID_RECIPIENTS,
    ...overrides,
  };
}

function makeRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/batches", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function makeBatch(overrides: Record<string, unknown> = {}) {
  return {
    id: BATCH_ID,
    userId: USER_ID,
    name: "August payroll",
    description: "Monthly contractor payouts",
    idempotencyKey: KEY_HEADER,
    status: "CREATED",
    createdAt: new Date("2026-08-26T10:30:00.000Z"),
    updatedAt: new Date("2026-08-26T10:30:00.000Z"),
    payments: VALID_RECIPIENTS.map((r, i) => ({
      id: `cm0py000000000000000000${10 + i}`,
      batchId: BATCH_ID,
      userId: USER_ID,
      amount: r.amount,
      assetCode: r.assetCode,
      memo: r.memo,
      status: "CREATED",
    })),
    ...overrides,
  };
}

function makeTx() {
  return {
    batch: { create: mockBatchCreate, findUnique: mockFindUnique },
    payment: { createMany: mockCreateMany },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthContext.mockResolvedValue({ userId: USER_ID });
  mockFindFirst.mockResolvedValue(null);
  mockFindUnique.mockResolvedValue(makeBatch());
  mockCreateMany.mockResolvedValue({ count: VALID_RECIPIENTS.length });
  mockBatchCreate.mockResolvedValue(makeBatch({ payments: undefined }));
  mockTransaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
    callback(makeTx())
  );
});

describe("POST /api/batches — idempotent re-submission", () => {
  it("rejects unauthenticated callers with 401", async () => {
    mockGetAuthContext.mockResolvedValue(null);

    const res = await POST(makeRequest(makeBody()));

    expect(res.status).toBe(401);
    expect(mockBatchCreate).not.toHaveBeenCalled();
    expect(mockCreateMany).not.toHaveBeenCalled();
  });

  it("creates a batch on first submission with the supplied key (201)", async () => {
    const res = await POST(makeRequest(makeBody({ idempotencyKey: KEY_BODY })));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.id).toBe(BATCH_ID);
    expect(body.meta.deduplicated).toBeUndefined();

    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { userId: USER_ID, idempotencyKey: KEY_BODY },
      include: { payments: true },
    });
    // `tx.batch.create({ data })` is a single-argument call.
    const [createArgs] = mockBatchCreate.mock.calls[0];
    expect(createArgs.data).toMatchObject({
      name: "August payroll",
      userId: USER_ID,
      idempotencyKey: KEY_BODY,
    });
  });

  it("generates a server-side key when the client sends none", async () => {
    const res = await POST(makeRequest(makeBody()));

    expect(res.status).toBe(201);
    const [createArgs] = mockBatchCreate.mock.calls[0];
    expect(createArgs.data.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it("returns the original batch on a full retry with the same key (no duplicates)", async () => {
    const original = makeBatch();
    mockFindFirst.mockResolvedValue(original);

    const res = await POST(
      makeRequest(makeBody(), { "Idempotency-Key": KEY_HEADER })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe(BATCH_ID);
    expect(body.meta.deduplicated).toBe(true);
    expect(body.meta.resumed).toBeUndefined();

    // No new batch and no new payments were written.
    expect(mockBatchCreate).not.toHaveBeenCalled();
    expect(mockCreateMany).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("resumes pending items only when a previous attempt left the batch without payments", async () => {
    const withoutPayments = makeBatch({ payments: [] });
    mockFindFirst.mockResolvedValue(withoutPayments);
    // The refetch after resuming returns the batch with its payments.
    mockFindUnique.mockResolvedValue(makeBatch());

    const res = await POST(
      makeRequest(makeBody(), { "Idempotency-Key": KEY_HEADER })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.meta.deduplicated).toBe(true);
    expect(body.meta.resumed).toBe(true);
    expect(body.data.payments).toHaveLength(2);

    // Only the missing child payments are inserted, on the existing batch.
    expect(mockCreateMany).toHaveBeenCalledTimes(1);
    const [createArgs] = mockCreateMany.mock.calls[0];
    expect(createArgs.data).toHaveLength(2);
    expect(
      (createArgs.data as Array<{ batchId: string }>).every(
        (p) => p.batchId === BATCH_ID
      )
    ).toBe(true);
    expect(mockBatchCreate).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("gives the Idempotency-Key header precedence over the body key", async () => {
    const original = makeBatch({ idempotencyKey: KEY_HEADER });
    mockFindFirst.mockResolvedValue(original);

    const res = await POST(
      makeRequest(makeBody({ idempotencyKey: KEY_BODY }), {
        "Idempotency-Key": KEY_HEADER,
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.meta.deduplicated).toBe(true);
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { userId: USER_ID, idempotencyKey: KEY_HEADER },
      include: { payments: true },
    });
  });

  it("rejects a whitespace-only Idempotency-Key header with 400", async () => {
    const res = await POST(
      makeRequest(makeBody(), { "Idempotency-Key": "   " })
    );

    expect(res.status).toBe(400);
    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockBatchCreate).not.toHaveBeenCalled();
  });

  it("rejects a short Idempotency-Key header with 400", async () => {
    const res = await POST(
      makeRequest(makeBody(), { "Idempotency-Key": "short" })
    );

    expect(res.status).toBe(400);
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it("rejects an oversized Idempotency-Key header with 400", async () => {
    const res = await POST(
      makeRequest(makeBody(), { "Idempotency-Key": "k".repeat(256) })
    );

    expect(res.status).toBe(400);
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it("trims and validates the body key before deduplicating", async () => {
    const original = makeBatch({ idempotencyKey: KEY_BODY });
    mockFindFirst.mockResolvedValue(original);

    const res = await POST(
      makeRequest(makeBody({ idempotencyKey: `  ${KEY_BODY}  ` }))
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.meta.deduplicated).toBe(true);
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { userId: USER_ID, idempotencyKey: KEY_BODY },
      include: { payments: true },
    });
  });

  it("rejects a body key that is short after trimming", async () => {
    const res = await POST(makeRequest(makeBody({ idempotencyKey: "  short  " })));

    expect(res.status).toBe(400);
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it("handles a concurrent dup submission: a P2002 race serves the winner", async () => {
    const winner = makeBatch();
    mockFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
    mockTransaction.mockImplementation(async () => {
      throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    });

    const res = await POST(
      makeRequest(makeBody(), { "Idempotency-Key": KEY_HEADER })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.meta.deduplicated).toBe(true);
    expect(body.data.id).toBe(BATCH_ID);
    // Both the pre-check and the post-race lookup ran.
    expect(mockFindFirst).toHaveBeenCalledTimes(2);
  });

  it("returns 409 when a unique violation has no recoverable winner", async () => {
    // Pre-check and the race lookup both find nothing, so deduping is
    // impossible — the route surfaces a 409 conflict for the orphaned key.
    mockFindFirst.mockResolvedValue(null);
    mockTransaction.mockImplementation(async () => {
      throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    });

    const res = await POST(
      makeRequest(makeBody(), { "Idempotency-Key": KEY_HEADER })
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("CONFLICT");
  });

  it("returns 400 for an invalid batch body (regression: not affected by the key work)", async () => {
    const res = await POST(makeRequest({ name: "", recipients: [] }));

    expect(res.status).toBe(400);
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});