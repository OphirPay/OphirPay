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

import { GET } from "@/app/api/donations/export/route";
import {
  MAX_DONATION_EXPORT_ROWS,
  DONATION_EXPORT_COLUMNS,
} from "@/lib/donation-export";

const CSV_HEADER = DONATION_EXPORT_COLUMNS.map((c) => c.header).join(",");

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: "cm0donation0000000000001",
    userId: "donor-a",
    amount: new Prisma.Decimal("50"),
    assetCode: "XLM",
    assetIssuer: null,
    description: "Monthly support",
    memo: "donation",
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

describe("GET /api/donations/export", () => {
  it("rejects unauthenticated callers with 401", async () => {
    mockGetAuthContext.mockResolvedValue(null);

    const res = await GET(
      new Request("http://localhost/api/donations/export")
    );

    expect(res.status).toBe(401);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("scopes the query strictly to the calling donor", async () => {
    mockGetAuthContext.mockResolvedValue({ userId: "donor-a" });
    mockFindMany.mockResolvedValue([makePayment()]);

    // Hostile params that would select another donor on a sloppy endpoint —
    // none of these may influence the query.
    const res = await GET(
      new Request(
        "http://localhost/api/donations/export?userId=donor-b&donor=donor-b&address=donor-b"
      )
    );

    expect(res.status).toBe(200);
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { userId: "donor-a", deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: MAX_DONATION_EXPORT_ROWS + 1,
    });

    const text = await res.text();
    expect(text).not.toContain("donor-b");
  });

  it("never returns another donor's rows even if the DB mock leaks them", async () => {
    mockGetAuthContext.mockResolvedValue({ userId: "donor-a" });
    // findMany is mocked, so the route cannot see donor-b rows — but assert
    // the response body reflects only what belongs to the calling donor.
    mockFindMany.mockResolvedValue([
      makePayment(),
      makePayment({ id: "cm0donation0000000000002", userId: "donor-a" }),
    ]);

    const res = await GET(
      new Request("http://localhost/api/donations/export")
    );

    const text = await res.text();
    expect(text).toContain("cm0donation0000000000001");
    expect(text).toContain("cm0donation0000000000002");
    expect(text).not.toContain("donor-b");
  });

  it("returns CSV by default with a stable header and dated filename", async () => {
    mockGetAuthContext.mockResolvedValue({ userId: "donor-a" });
    mockFindMany.mockResolvedValue([makePayment()]);

    const res = await GET(
      new Request("http://localhost/api/donations/export")
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toMatch(
      /attachment; filename="ophirpay-donations-\d{4}-\d{2}-\d{2}\.csv"/
    );
    expect(res.headers.get("X-Export-Truncated")).toBe("false");

    const text = await res.text();
    const lines = text.split("\n");
    expect(lines[0]).toBe(CSV_HEADER);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("50.0000000");
    expect(lines[1]).toContain("donation");
  });

  it("escapes CSV values with commas, quotes, and newlines", async () => {
    mockGetAuthContext.mockResolvedValue({ userId: "donor-a" });
    mockFindMany.mockResolvedValue([
      makePayment({
        description: 'Donation "big", urgent',
        memo: "line1\nline2",
      }),
    ]);

    const res = await GET(
      new Request("http://localhost/api/donations/export")
    );

    const text = await res.text();
    expect(text).toContain('"Donation ""big"", urgent"');
    expect(text).toContain('"line1\nline2"');
  });

  it("returns a header-only CSV for a donor with no history", async () => {
    mockGetAuthContext.mockResolvedValue({ userId: "donor-a" });
    mockFindMany.mockResolvedValue([]);

    const res = await GET(
      new Request("http://localhost/api/donations/export")
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    const text = await res.text();
    expect(text).toBe(CSV_HEADER);
  });

  it("returns JSON when ?format=json is passed", async () => {
    mockGetAuthContext.mockResolvedValue({ userId: "donor-a" });
    mockFindMany.mockResolvedValue([makePayment()]);

    const res = await GET(
      new Request("http://localhost/api/donations/export?format=json")
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/json");

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toEqual({
      id: "cm0donation0000000000001",
      amount: "50.0000000",
      assetCode: "XLM",
      assetIssuer: "",
      description: "Monthly support",
      memo: "donation",
      status: "COMPLETED",
      transactionHash:
        "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
      createdAt: "2026-08-26T10:00:00.000Z",
    });
    expect(body.meta.total).toBe(1);
  });

  it("returns JSON when Accept: application/json is negotiated", async () => {
    mockGetAuthContext.mockResolvedValue({ userId: "donor-a" });
    mockFindMany.mockResolvedValue([makePayment()]);

    const res = await GET(
      new Request("http://localhost/api/donations/export", {
        headers: { Accept: "application/json" },
      })
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
  });

  it("keeps CSV as the default when Accept is a wildcard", async () => {
    mockGetAuthContext.mockResolvedValue({ userId: "donor-a" });
    mockFindMany.mockResolvedValue([makePayment()]);

    const res = await GET(
      new Request("http://localhost/api/donations/export", {
        headers: { Accept: "*/*" },
      })
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
  });

  it("returns an empty JSON array for a donor with no history", async () => {
    mockGetAuthContext.mockResolvedValue({ userId: "donor-a" });
    mockFindMany.mockResolvedValue([]);

    const res = await GET(
      new Request("http://localhost/api/donations/export?format=json")
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
    expect(body.meta.total).toBe(0);
  });

  it("rejects an unknown format with 400", async () => {
    mockGetAuthContext.mockResolvedValue({ userId: "donor-a" });

    const res = await GET(
      new Request("http://localhost/api/donations/export?format=xml")
    );

    expect(res.status).toBe(400);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("caps rows at MAX_DONATION_EXPORT_ROWS and reports truncation", async () => {
    mockGetAuthContext.mockResolvedValue({ userId: "donor-a" });
    const rows = Array.from({ length: MAX_DONATION_EXPORT_ROWS + 5 }, (_, i) =>
      makePayment({ id: `d${i}` })
    );
    mockFindMany.mockResolvedValue(rows);

    const res = await GET(
      new Request("http://localhost/api/donations/export")
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Export-Truncated")).toBe("true");

    const text = await res.text();
    // Header line + exactly MAX_DONATION_EXPORT_ROWS data rows.
    expect(text.split("\n")).toHaveLength(MAX_DONATION_EXPORT_ROWS + 1);
  });
});
