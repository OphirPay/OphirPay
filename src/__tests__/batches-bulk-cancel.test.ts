// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockTxFindFirst, mockTxUpdateMany, mockGetAuthContext } = vi.hoisted(
  () => ({
    mockTxFindFirst: vi.fn(),
    mockTxUpdateMany: vi.fn(),
    mockGetAuthContext: vi.fn(),
  })
);

vi.mock("@/lib/prisma", () => ({
  default: {
    // The bulk-cancel route reads the batch and flips its payments inside one
    // `$transaction`; run the callback with a fake `tx` client.
    $transaction: (fn: (tx: unknown) => unknown) =>
      fn({
        batch: { findFirst: mockTxFindFirst },
        payment: { updateMany: mockTxUpdateMany },
      }),
  },
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: mockGetAuthContext,
}));

import { POST } from "@/app/api/batches/[id]/route";

const USER_ID = "user-1";
const BATCH_ID = "cm0bt0000000000000000001";

const makeRequest = () =>
  new Request("http://localhost/api/batches/cm0bt0000000000000000001", {
    method: "POST",
  });

function makePayment(id: string, status: string) {
  return {
    id,
    userId: USER_ID,
    amount: 100,
    assetCode: "XLM",
    status,
    batchId: BATCH_ID,
    createdAt: new Date("2026-08-26T10:00:00.000Z"),
  };
}

function makeBatch(payments: ReturnType<typeof makePayment>[]) {
  return {
    id: BATCH_ID,
    userId: USER_ID,
    name: "August payroll",
    status: "CREATED",
    payments,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthContext.mockResolvedValue({ userId: USER_ID });
  mockTxUpdateMany.mockResolvedValue({ count: 0 });
});

describe("POST /api/batches/[id] — bulk-cancel pending payments (Issue #158)", () => {
  it("cancels all payments when every payment in the batch is PENDING", async () => {
    mockTxFindFirst.mockResolvedValue(
      makeBatch([
        makePayment("cm0py0000000000000000010", "PENDING"),
        makePayment("cm0py0000000000000000011", "PENDING"),
        makePayment("cm0py0000000000000000012", "PENDING"),
      ])
    );
    mockTxUpdateMany.mockResolvedValue({ count: 3 });

    const res = await POST(makeRequest(), {
      params: Promise.resolve({ id: BATCH_ID }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({
      batchId: BATCH_ID,
      cancelled: 3,
      skipped: 0,
      total: 3,
    });
    // The update is scoped to this batch + PENDING only, and flips to CANCELLED.
    expect(mockTxUpdateMany).toHaveBeenCalledWith({
      where: { batchId: BATCH_ID, status: "PENDING" },
      data: { status: "CANCELLED" },
    });
  });

  it("skips already-submitted payments and reports both counts (partial cancel)", async () => {
    mockTxFindFirst.mockResolvedValue(
      makeBatch([
        makePayment("cm0py0000000000000000010", "PENDING"),
        makePayment("cm0py0000000000000000011", "PENDING"),
        makePayment("cm0py0000000000000000012", "COMPLETED"),
        makePayment("cm0py0000000000000000013", "SUBMITTED"),
      ])
    );
    mockTxUpdateMany.mockResolvedValue({ count: 2 });

    const res = await POST(makeRequest(), {
      params: Promise.resolve({ id: BATCH_ID }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    // Only the two PENDING rows are cancelled; the 2 already-submitted rows are
    // left untouched but reported so callers see the split.
    expect(body.data).toEqual({
      batchId: BATCH_ID,
      cancelled: 2,
      skipped: 2,
      total: 4,
    });
    // COMPLETED / SUBMITTED rows are never included in the update's `where`.
    expect(mockTxUpdateMany).toHaveBeenCalledTimes(1);
    expect(mockTxUpdateMany.mock.calls[0][0].where).toEqual({
      batchId: BATCH_ID,
      status: "PENDING",
    });
  });

  it("is a no-op with counts when no payments are PENDING", async () => {
    mockTxFindFirst.mockResolvedValue(
      makeBatch([
        makePayment("cm0py0000000000000000012", "COMPLETED"),
        makePayment("cm0py0000000000000000013", "CANCELLED"),
      ])
    );

    const res = await POST(makeRequest(), {
      params: Promise.resolve({ id: BATCH_ID }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({
      batchId: BATCH_ID,
      cancelled: 0,
      skipped: 2,
      total: 2,
    });
    // No pending rows → the update is skipped entirely.
    expect(mockTxUpdateMany).not.toHaveBeenCalled();
  });

  it("returns 404 when the batch does not exist or belongs to another user", async () => {
    mockTxFindFirst.mockResolvedValue(null);

    const res = await POST(makeRequest(), {
      params: Promise.resolve({ id: BATCH_ID }),
    });

    expect(res.status).toBe(404);
    expect(mockTxUpdateMany).not.toHaveBeenCalled();
  });

  it("scopes the batch lookup to the authenticated user (no cross-user cancel)", async () => {
    mockTxFindFirst.mockResolvedValue(makeBatch([]));

    await POST(makeRequest(), {
      params: Promise.resolve({ id: BATCH_ID }),
    });

    expect(mockTxFindFirst).toHaveBeenCalledWith({
      where: { id: BATCH_ID, userId: USER_ID },
      include: { payments: true },
    });
  });

  it("rejects unauthenticated callers with 401 and never touches the DB", async () => {
    mockGetAuthContext.mockResolvedValue(null);

    const res = await POST(makeRequest(), {
      params: Promise.resolve({ id: BATCH_ID }),
    });

    expect(res.status).toBe(401);
    expect(mockTxFindFirst).not.toHaveBeenCalled();
  });
});