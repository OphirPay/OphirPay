// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma, type Payment } from "@prisma/client";

// vi.hoisted ensures these exist before the mocked modules are imported
// (ESM imports are hoisted above the const declarations otherwise).
const { mockFindMany, mockGetAuthContext } = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockGetAuthContext: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: { payment: { findMany: mockFindMany } },
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: mockGetAuthContext,
}));

import { GET } from "@/app/api/payments/export/route";
import {
  MAX_EXPORT_ROWS,
  PAYMENT_EXPORT_COLUMNS,
} from "@/lib/payment-export";

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: "cm0pymt00000000000000001",
    userId: "user-1",
    amount: new Prisma.Decimal("100.25"),
    assetCode: "XLM",
    assetIssuer: null,
    description: "Invoice #42",
    memo: "invoice-42",
    status: "COMPLETED",
    transactionHash:
      "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    stellarOpId: null,
    sourceAccountId: null,
    destAccountId: null,
    batchId: null,
    recurrenceId: null,
    metadata: null,
    errorMessage: null,
    createdAt: new Date("2026-08-26T10:00:00.000Z"),
    updatedAt: new Date("2026-08-26T10:00:00.000Z"),
    completedAt: null,
    deletedAt: null,
    ...overrides,
  } as Payment;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/payments/export", () => {
  it("rejects unauthenticated callers with 401", async () => {
    mockGetAuthContext.mockResolvedValue(null);

    const res = await GET(
      new Request("http://localhost/api/payments/export")
    );

    expect(res.status).toBe(401);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("queries the full filtered set with the shared, user-scoped where clause", async () => {
    mockGetAuthContext.mockResolvedValue({ userId: "user-1" });
    mockFindMany.mockResolvedValue([
      makePayment(),
      makePayment({ id: "cm0pymt00000000000000002", memo: null }),
    ]);

    const res = await GET(
      new Request(
        "http://localhost/api/payments/export?search=invoice&status=COMPLETED"
      )
    );

    expect(mockFindMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        status: "COMPLETED",
        OR: [
          { description: { contains: "invoice" } },
          { memo: { contains: "invoice" } },
          { transactionHash: { contains: "invoice" } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: MAX_EXPORT_ROWS + 1,
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("X-Export-Truncated")).toBe("false");
    expect(res.headers.get("Content-Disposition")).toContain(
      "ophirpay-payments-"
    );

    const text = await res.text();
    const header = PAYMENT_EXPORT_COLUMNS.map((c) => c.header).join(",");
    expect(text.startsWith(header)).toBe(true);
    expect(text).toContain("invoice-42");
    expect(text).toContain("100.25");
  });

  it("handles a bare request with no filter params (null → undefined)", async () => {
    mockGetAuthContext.mockResolvedValue({ userId: "user-1" });
    mockFindMany.mockResolvedValue([]);

    const res = await GET(
      new Request("http://localhost/api/payments/export")
    );

    expect(res.status).toBe(200);
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1" },
        orderBy: { createdAt: "desc" },
      })
    );
  });

  it("returns a dated filename", async () => {
    mockGetAuthContext.mockResolvedValue({ userId: "user-1" });
    mockFindMany.mockResolvedValue([]);

    const res = await GET(
      new Request("http://localhost/api/payments/export")
    );

    expect(res.headers.get("Content-Disposition")).toMatch(
      /ophirpay-payments-\d{4}-\d{2}-\d{2}\.csv/
    );
  });

  it("caps rows at MAX_EXPORT_ROWS and reports truncation via header", async () => {
    mockGetAuthContext.mockResolvedValue({ userId: "user-1" });
    const rows = Array.from({ length: MAX_EXPORT_ROWS + 5 }, (_, i) =>
      makePayment({ id: `p${i}` })
    );
    mockFindMany.mockResolvedValue(rows);

    const res = await GET(
      new Request("http://localhost/api/payments/export")
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Export-Truncated")).toBe("true");

    const text = await res.text();
    // Header line + exactly MAX_EXPORT_ROWS data rows.
    expect(text.split("\n")).toHaveLength(MAX_EXPORT_ROWS + 1);
  });

  it("rejects an invalid status filter with 400", async () => {
    mockGetAuthContext.mockResolvedValue({ userId: "user-1" });

    const res = await GET(
      new Request("http://localhost/api/payments/export?status=BOGUS")
    );

    expect(res.status).toBe(400);
    expect(mockFindMany).not.toHaveBeenCalled();
  });
});
