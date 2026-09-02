// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before imports
vi.mock("@/lib/prisma", () => ({
  default: {
    payment: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth-session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-session")>();
  return {
    ...actual,
    getAuthContext: vi.fn(),
  };
});

import prisma from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-session";
import { GET } from "@/app/api/donations/export/route";

describe("GET /api/donations/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 unauthenticated if no session", async () => {
    vi.mocked(getAuthContext).mockResolvedValue(null);
    const req = new Request("http://localhost/api/donations/export");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns CSV of donor history scoped to the user (empty history)", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({ userId: "user-1" });
    vi.mocked(prisma.payment.findMany).mockResolvedValue([]);

    const req = new Request("http://localhost/api/donations/export");
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");

    const text = await res.text();
    // Headers only
    expect(text.trim().split("\n").length).toBe(1);
    expect(prisma.payment.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      orderBy: { createdAt: "desc" },
      take: 10001,
    });
  });

  it("returns CSV format and handles escaping", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({ userId: "user-1" });
    vi.mocked(prisma.payment.findMany).mockResolvedValue([
      {
        id: "pay-1",
        userId: "user-1",
        amount: { toFixed: () => "10.5000000" } as unknown as import("@prisma/client/runtime/library").Decimal,
        assetCode: "XLM",
        assetIssuer: null,
        description: 'Test "donation" with quotes',
        memo: "Memo, with comma",
        status: "COMPLETED",
        transactionHash: "hash123",
        sourceAccountId: "src-1",
        destAccountId: "dst-1",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      } as unknown as import("@prisma/client").Payment,
    ]);

    const req = new Request("http://localhost/api/donations/export");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Test \"\"donation\"\" with quotes");
    expect(text).toContain("\"Memo, with comma\"");
  });

  it("returns JSON via content-type negotiation", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({ userId: "user-1" });
    vi.mocked(prisma.payment.findMany).mockResolvedValue([
      { id: "pay-1", userId: "user-1" } as unknown as import("@prisma/client").Payment,
    ]);

    const req = new Request("http://localhost/api/donations/export", {
      headers: { Accept: "application/json" },
    });
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const json = await res.json();
    expect(json).toHaveLength(1);
    expect(json[0].id).toBe("pay-1");
  });

  it("prevents other-donor access by strictly querying user's own records", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({ userId: "donor-2" });
    vi.mocked(prisma.payment.findMany).mockResolvedValue([]);

    const req = new Request("http://localhost/api/donations/export");
    await GET(req);

    // Ensure the query uses the authenticated user's ID
    expect(prisma.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "donor-2" },
      })
    );
  });
});
