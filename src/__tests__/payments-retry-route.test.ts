// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFindFirst, mockFindUnique, mockUpdateMany, mockGetAuthContext } =
  vi.hoisted(() => ({
    mockFindFirst: vi.fn(),
    mockFindUnique: vi.fn(),
    mockUpdateMany: vi.fn(),
    mockGetAuthContext: vi.fn(),
  }));

vi.mock("@/lib/prisma", () => ({
  default: {
    payment: {
      findFirst: mockFindFirst,
      findUnique: mockFindUnique,
      updateMany: mockUpdateMany,
    },
  },
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: mockGetAuthContext,
}));

import { POST } from "@/app/api/payments/retry/route";

const USER_ID = "user-1";
const PAYMENT_ID = "cm0py0000000000000000001";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/payments/retry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makePayment(overrides: Record<string, unknown> = {}) {
  return {
    id: PAYMENT_ID,
    userId: USER_ID,
    amount: 25.5,
    assetCode: "XLM",
    assetIssuer: null,
    description: "Freelance payout",
    memo: "payout-jul",
    status: "FAILED",
    transactionHash: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    sourceAccountId: "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U",
    destAccountId: null,
    idempotencyKey: "11111111-1111-4111-8111-111111111111",
    errorMessage: "Insufficient balance",
    createdAt: new Date("2026-08-26T10:00:00.000Z"),
    deletedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthContext.mockResolvedValue({ userId: USER_ID });
  mockFindFirst.mockResolvedValue(makePayment());
  mockUpdateMany.mockResolvedValue({ count: 1 });
  mockFindUnique.mockResolvedValue(
    makePayment({
      status: "PENDING",
      errorMessage: null,
      transactionHash: null,
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
    })
  );
});

describe("POST /api/payments/retry", () => {
  it("rejects unauthenticated callers with 401", async () => {
    mockGetAuthContext.mockResolvedValue(null);

    const res = await POST(makeRequest({ id: PAYMENT_ID }));

    expect(res.status).toBe(401);
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("validates the request body", async () => {
    const res = await POST(makeRequest({}));

    expect(res.status).toBe(400);
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown or foreign payment", async () => {
    mockFindFirst.mockResolvedValue(null);

    const res = await POST(makeRequest({ id: PAYMENT_ID }));

    expect(res.status).toBe(404);
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { id: PAYMENT_ID, userId: USER_ID, deletedAt: null },
    });
  });

  it("returns 404 for soft-deleted payments", async () => {
    mockFindFirst.mockResolvedValue(null);

    const res = await POST(makeRequest({ id: PAYMENT_ID }));

    expect(res.status).toBe(404);
    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: PAYMENT_ID, userId: USER_ID, deletedAt: null } })
    );
  });

  it("rejects retrying a payment that is not FAILED (409, no duplicate)", async () => {
    mockFindFirst.mockResolvedValue(makePayment({ status: "COMPLETED" }));

    const res = await POST(makeRequest({ id: PAYMENT_ID }));

    expect(res.status).toBe(409);
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("resets a failed payment to PENDING with a NEW idempotency key", async () => {
    const res = await POST(makeRequest({ id: PAYMENT_ID }));

    expect(res.status).toBe(200);
    const body = await res.json();

    // The row is reused — the original amount/recipient/memo survive.
    expect(body.data.amount).toBe(25.5);
    expect(body.data.memo).toBe("payout-jul");
    expect(body.data.sourceAccountId).toBe(
      "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U"
    );
    // Status back to PENDING, failure details cleared.
    expect(body.data.status).toBe("PENDING");
    expect(body.data.errorMessage).toBeNull();
    expect(body.data.transactionHash).toBeNull();
    // A NEW idempotency key — never the previous attempt's key.
    expect(body.data.idempotencyKey).not.toBe(
      "11111111-1111-4111-8111-111111111111"
    );
    expect(body.data.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );

    // The retry updates in place: status, cleared error/hash, fresh key.
    const [args] = mockUpdateMany.mock.calls[0];
    expect(args.where).toEqual({ id: PAYMENT_ID, userId: USER_ID });
    expect(args.data.status).toBe("PENDING");
    expect(args.data.errorMessage).toBeNull();
    expect(args.data.transactionHash).toBeNull();
    expect(typeof args.data.idempotencyKey).toBe("string");
  });

  it("never creates a duplicate payment on retry", async () => {
    await POST(makeRequest({ id: PAYMENT_ID }));

    // updateMany reuses the row — no create/delete, exactly one update.
    expect(mockUpdateMany).toHaveBeenCalledTimes(1);
    expect(mockFindUnique).toHaveBeenCalledWith({ where: { id: PAYMENT_ID } });
  });
});
