// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";

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

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthContext.mockResolvedValue({ userId: "user-1" });
  mockFindMany.mockResolvedValue([]);
  mockCount.mockResolvedValue(0);
});

describe("GET /api/payments", () => {
  it("accepts a bare list request (regression: absent params were null, failing Zod .optional())", async () => {
    const res = await GET(new Request("http://localhost/api/payments"));

    expect(res.status).toBe(200);
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 51,
    });
  });

  it("accepts page/limit without status/search filters", async () => {
    const res = await GET(
      new Request("http://localhost/api/payments?page=2&limit=10")
    );

    expect(res.status).toBe(200);
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: 10,
      take: 10,
    });
  });

  it("still applies status and search filters when provided", async () => {
    const res = await GET(
      new Request(
        "http://localhost/api/payments?status=COMPLETED&search=invoice"
      )
    );

    expect(res.status).toBe(200);
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
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 51,
    });
  });
});
