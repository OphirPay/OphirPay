// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted ensures these exist before the mocked modules are imported
// (ESM imports are hoisted above the const declarations otherwise).
const { mockFindMany, mockCount, mockGetAuthContext } = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockCount: vi.fn(),
  mockGetAuthContext: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    payment: { findMany: mockFindMany, count: mockCount },
  },
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: mockGetAuthContext,
}));

import { GET } from "@/app/api/payments/route";
import { buildPaymentWhere } from "@/lib/payment-filters";

const USER_ID = "user-1";

function makeRequest(url = "http://localhost/api/payments"): Request {
  return new Request(url);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthContext.mockResolvedValue({ userId: USER_ID });
  mockFindMany.mockResolvedValue([]);
  mockCount.mockResolvedValue(0);
});

describe("buildPaymentWhere — Issue #157 search semantics", () => {
  it("matches memo with a case-insensitive substring (Postgres ILIKE)", () => {
    const where = buildPaymentWhere(USER_ID, { search: "invoice" });

    expect(where.OR).toContainEqual({
      memo: { contains: "invoice", mode: "insensitive" },
    });
  });

  it("matches the transaction hash EXACTLY (no partial / case-insensitive hash)", () => {
    const where = buildPaymentWhere(USER_ID, { search: "abc" });

    // Exact equality, not `contains`.
    expect(where.OR).toContainEqual({ transactionHash: { equals: "abc" } });
    expect(where.OR).not.toContainEqual(
      expect.objectContaining({ transactionHash: { contains: expect.anything() } })
    );
    expect(where.OR).not.toContainEqual(
      expect.objectContaining({
        transactionHash: { equals: "abc", mode: "insensitive" },
      })
    );
  });

  it("keeps the free-text description as a plain substring match", () => {
    const where = buildPaymentWhere(USER_ID, { search: "invoice" });

    expect(where.OR).toContainEqual({ description: { contains: "invoice" } });
  });

  it("emits no OR when there is no search query", () => {
    const where = buildPaymentWhere(USER_ID, {});
    expect(where).toEqual({ userId: USER_ID });
  });

  it("always scopes to the authenticated userId — never cross-user", () => {
    const where = buildPaymentWhere(USER_ID, { search: "x" });
    expect(where.userId).toBe(USER_ID);
  });
});

describe("GET /api/payments — search combined with filters & pagination", () => {
  it("applies a memo search (ILIKE) alongside the existing status filter", async () => {
    const res = await GET(
      makeRequest(
        "http://localhost/api/payments?search=invoice&status=COMPLETED&page=2&limit=10"
      )
    );

    expect(res.status).toBe(200);
    expect(mockFindMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        userId: USER_ID,
        status: "COMPLETED",
        deletedAt: null,
        OR: expect.arrayContaining([
          { memo: { contains: "invoice", mode: "insensitive" } },
        ]),
      }),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: 10,
      take: 10,
    });
  });

  it("applies an exact transaction-hash search", async () => {
    const HASH =
      "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    await GET(makeRequest(`http://localhost/api/payments?search=${HASH}`));

    const [args] = mockFindMany.mock.calls[0];
    expect(args.where.OR).toContainEqual({ transactionHash: { equals: HASH } });
  });

  it("searches are shareable through the URL and optional (no search → no OR)", async () => {
    await GET(makeRequest("http://localhost/api/payments?page=1&limit=20"));

    const [args] = mockFindMany.mock.calls[0];
    expect(args.where.OR).toBeUndefined();
    expect(args.where).toEqual({ userId: USER_ID, deletedAt: null });
  });

  it("still counts the full filtered set for pagination metadata", async () => {
    await GET(makeRequest("http://localhost/api/payments?search=hash"));

    expect(mockCount).toHaveBeenCalledWith({
      where: expect.objectContaining({
        userId: USER_ID,
        deletedAt: null,
        OR: expect.arrayContaining([
          { transactionHash: { equals: "hash" } },
        ]),
      }),
    });
  });
});