// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFindMany, mockCount, mockFindFirst, mockUpdateMany, mockGetAuthContext } =
  vi.hoisted(() => ({
    mockFindMany: vi.fn(),
    mockCount: vi.fn(),
    mockFindFirst: vi.fn(),
    mockUpdateMany: vi.fn(),
    mockGetAuthContext: vi.fn(),
  }));

vi.mock("@/lib/prisma", () => ({
  default: {
    payment: {
      findMany: mockFindMany,
      count: mockCount,
      findFirst: mockFindFirst,
      updateMany: mockUpdateMany,
    },
  },
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: mockGetAuthContext,
}));

import { GET as ListGET } from "@/app/api/payments/route";
import { GET, PATCH, DELETE } from "@/app/api/payments/[id]/route";

const USER_ID = "user-1";
const PAYMENT_ID = "cm0py0000000000000000001";

function makeRequest(url = "http://localhost/api/payments"): Request {
  return new Request(url);
}

// The list route on main requires explicit page/limit (pre-existing Zod
// null-param issue, fixed separately in #161) — keep the soft-delete tests
// focused by always passing them.
const LIST_URL = "http://localhost/api/payments?page=1&limit=20";

function makePayment(overrides: Record<string, unknown> = {}) {
  return {
    id: PAYMENT_ID,
    userId: USER_ID,
    amount: 100.25,
    assetCode: "XLM",
    description: "Invoice #42",
    memo: "invoice-42",
    status: "COMPLETED",
    transactionHash: null,
    createdAt: new Date("2026-08-24T09:12:00.000Z"),
    deletedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthContext.mockResolvedValue({ userId: USER_ID });
  mockFindMany.mockResolvedValue([]);
  mockCount.mockResolvedValue(0);
  mockFindFirst.mockResolvedValue(makePayment());
  mockUpdateMany.mockResolvedValue({ count: 1 });
});

describe("DELETE /api/payments/{id} (soft delete)", () => {
  it("marks deletedAt instead of hard-deleting the row", async () => {
    const res = await DELETE(makeRequest(), {
      params: Promise.resolve({ id: PAYMENT_ID }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({ deleted: true });
    // updateMany is used (not deleteMany) — the row stays in the DB.
    expect(mockUpdateMany).toHaveBeenCalledTimes(1);
    const [args] = mockUpdateMany.mock.calls[0];
    expect(args.where).toEqual({ id: PAYMENT_ID, userId: USER_ID, deletedAt: null });
    expect(args.data.deletedAt).toBeInstanceOf(Date);
  });

  it("returns 404 for a missing or foreign payment", async () => {
    mockUpdateMany.mockResolvedValue({ count: 0 });

    const res = await DELETE(makeRequest(), {
      params: Promise.resolve({ id: PAYMENT_ID }),
    });

    expect(res.status).toBe(404);
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: PAYMENT_ID, userId: USER_ID, deletedAt: null },
      data: expect.objectContaining({ deletedAt: expect.any(Date) }),
    });
  });

  it("rejects unauthenticated callers with 401", async () => {
    mockGetAuthContext.mockResolvedValue(null);

    const res = await DELETE(makeRequest(), {
      params: Promise.resolve({ id: PAYMENT_ID }),
    });

    expect(res.status).toBe(401);
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });
});

describe("accessing a soft-deleted payment", () => {
  it("GET returns 404 — soft-deleted payments behave like they don't exist", async () => {
    // The row is still in the DB (deletedAt set) but hidden from reads.
    mockFindFirst.mockResolvedValue(null);

    const res = await GET(makeRequest(), {
      params: Promise.resolve({ id: PAYMENT_ID }),
    });

    expect(res.status).toBe(404);
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { id: PAYMENT_ID, userId: USER_ID, deletedAt: null },
    });
  });

  it("PATCH returns 404 for soft-deleted payments", async () => {
    mockUpdateMany.mockResolvedValue({ count: 0 });

    const res = await PATCH(
      new Request("http://localhost/api/payments", {
        method: "PATCH",
        body: JSON.stringify({ status: "COMPLETED" }),
      }),
      { params: Promise.resolve({ id: PAYMENT_ID }) }
    );

    expect(res.status).toBe(404);
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: PAYMENT_ID, userId: USER_ID, deletedAt: null },
      })
    );
  });
});

describe("list queries exclude soft-deleted rows", () => {
  it("GET /api/payments filters deletedAt: null by default", async () => {
    const res = await ListGET(makeRequest(LIST_URL));

    expect(res.status).toBe(200);
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: USER_ID, deletedAt: null },
      })
    );
    expect(mockCount).toHaveBeenCalledWith({
      where: { userId: USER_ID, deletedAt: null },
    });
  });

  it("GET /api/payments?includeDeleted=true shows soft-deleted rows (admin opt-in)", async () => {
    const res = await ListGET(
      makeRequest("http://localhost/api/payments?page=1&limit=20&includeDeleted=true")
    );

    expect(res.status).toBe(200);
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: USER_ID },
      })
    );
    // No deletedAt filter applied.
    const [args] = mockFindMany.mock.calls[0];
    expect(args.where.deletedAt).toBeUndefined();
  });

  it("only 'true' enables includeDeleted — anything else keeps the filter", async () => {
    await ListGET(
      makeRequest("http://localhost/api/payments?page=1&limit=20&includeDeleted=false")
    );
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: USER_ID, deletedAt: null } })
    );

    mockFindMany.mockClear();
    await ListGET(
      makeRequest("http://localhost/api/payments?page=1&limit=20&includeDeleted=1")
    );
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: USER_ID, deletedAt: null } })
    );
  });

  it("cancel → hidden from lists → still present in DB (acceptance flow)", async () => {
    // 1. Cancel (soft-delete) the payment.
    await DELETE(makeRequest(), {
      params: Promise.resolve({ id: PAYMENT_ID }),
    });
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      })
    );

    // 2. The row still exists in the DB (updateMany, not deleteMany).
    expect(mockUpdateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: PAYMENT_ID, userId: USER_ID } })
    );
  });
});
