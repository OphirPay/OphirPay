// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { transactionPaginationSchema } from "@/lib/validation-schemas";

const { mockPaymentFindMany, mockPaymentCount, mockGetAuthContext } = vi.hoisted(() => ({
  mockPaymentFindMany: vi.fn(),
  mockPaymentCount: vi.fn(),
  mockGetAuthContext: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    payment: {
      findMany: mockPaymentFindMany,
      count: mockPaymentCount,
    },
  },
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: mockGetAuthContext,
}));

import { GET as transactionsRoute } from "@/app/api/transactions/route";

describe("Issue #1953: Maximum pagination limit cap on transaction history route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("transactionPaginationSchema", () => {
    it("applies default limit of 20 when limit parameter is omitted", () => {
      const parsed = transactionPaginationSchema.safeParse({});
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.limit).toBe(20);
        expect(parsed.data.page).toBe(1);
      }
    });

    it("clamps limit to 100 when caller passes limit > 100", () => {
      const overLimits = [101, 150, 500, 10000];
      for (const lim of overLimits) {
        const parsed = transactionPaginationSchema.safeParse({ limit: String(lim) });
        expect(parsed.success).toBe(true);
        if (parsed.success) {
          expect(parsed.data.limit).toBe(100);
        }
      }
    });

    it("preserves valid limits within 1 and 100", () => {
      const validLimits = [1, 10, 25, 50, 100];
      for (const lim of validLimits) {
        const parsed = transactionPaginationSchema.safeParse({ limit: String(lim) });
        expect(parsed.success).toBe(true);
        if (parsed.success) {
          expect(parsed.data.limit).toBe(lim);
        }
      }
    });

    it("clamps negative or zero limit to 1", () => {
      const parsed = transactionPaginationSchema.safeParse({ limit: "0" });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.limit).toBe(1);
      }
    });
  });

  describe("GET /api/transactions route", () => {
    it("rejects unauthenticated callers with 401", async () => {
      mockGetAuthContext.mockResolvedValue(null);
      const req = new Request("http://localhost/api/transactions");
      const res = await transactionsRoute(req);
      expect(res.status).toBe(401);
    });

    it("caps limit at 100 when query parameter exceeds 100", async () => {
      mockGetAuthContext.mockResolvedValue({ userId: "user-1953" });
      mockPaymentFindMany.mockResolvedValue([]);

      const req = new Request("http://localhost/api/transactions?limit=250");
      const res = await transactionsRoute(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.meta.limit).toBe(100);
      expect(mockPaymentFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 101, // limit + 1 for keyset hasMore calculation
        })
      );
    });

    it("uses default limit 20 when limit is omitted in request", async () => {
      mockGetAuthContext.mockResolvedValue({ userId: "user-1953" });
      mockPaymentFindMany.mockResolvedValue([]);

      const req = new Request("http://localhost/api/transactions");
      const res = await transactionsRoute(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.meta.limit).toBe(20);
      expect(mockPaymentFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 21,
        })
      );
    });
  });
});
