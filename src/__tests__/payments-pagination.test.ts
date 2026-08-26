import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/payments/route";
import prisma from "@/lib/prisma";

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: vi.fn().mockResolvedValue({ userId: "user_test123", stellarAddress: "GABC" }),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    payment: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

describe("Payments API Cursor Pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the first page with nextCursor when more records exist", async () => {
    const mockPayments = [
      { id: "pay_1", createdAt: new Date("2026-08-26T12:00:00Z"), amount: "100" },
      { id: "pay_2", createdAt: new Date("2026-08-26T11:00:00Z"), amount: "200" },
      { id: "pay_3", createdAt: new Date("2026-08-26T10:00:00Z"), amount: "300" },
    ];

    // take: 3 (limit 2 + 1)
    (prisma.payment.findMany as any).mockResolvedValue(mockPayments);

    const req = new Request("http://localhost:3000/api/payments?limit=2");
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toHaveLength(2);
    expect(json.meta.hasMore).toBe(true);
    expect(json.meta.nextCursor).toBe("pay_2");
  });

  it("fetches the next page using cursor without hasMore on final page", async () => {
    const mockPayments = [
      { id: "pay_3", createdAt: new Date("2026-08-26T10:00:00Z"), amount: "300" },
    ];

    (prisma.payment.findMany as any).mockResolvedValue(mockPayments);

    const req = new Request("http://localhost:3000/api/payments?limit=2&cursor=pay_2");
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toHaveLength(1);
    expect(json.meta.hasMore).toBe(false);
    expect(json.meta.nextCursor).toBeNull();
  });

  it("handles empty pages gracefully", async () => {
    (prisma.payment.findMany as any).mockResolvedValue([]);

    const req = new Request("http://localhost:3000/api/payments?limit=10");
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toHaveLength(0);
    expect(json.meta.hasMore).toBe(false);
    expect(json.meta.nextCursor).toBeNull();
  });
});
