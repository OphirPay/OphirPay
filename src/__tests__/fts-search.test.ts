// SPDX-License-Identifier: MIT

// Ranked full-text search with SQLite fallback (issue #823).

import { describe, it, expect, vi, beforeEach } from "vitest";

const queryRawMock = vi.fn();
const findManyMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  default: {
    $queryRaw: (...args: unknown[]) => queryRawMock(...args),
    payment: {
      findMany: (...args: unknown[]) => findManyMock(...args),
    },
  },
}));

import {
  isFtsAvailable,
  searchPaymentIds,
  searchAuditLogIds,
  searchPaymentsRanked,
} from "@/lib/fts-search";

beforeEach(() => {
  vi.restoreAllMocks();
  queryRawMock.mockReset();
  findManyMock.mockReset();
  vi.stubEnv("DATABASE_PROVIDER", "postgresql");
});

describe("isFtsAvailable", () => {
  it("is true on PostgreSQL and false on SQLite", () => {
    vi.stubEnv("DATABASE_PROVIDER", "postgresql");
    expect(isFtsAvailable()).toBe(true);
    vi.stubEnv("DATABASE_PROVIDER", "sqlite");
    expect(isFtsAvailable()).toBe(false);
  });
});

describe("searchPaymentIds", () => {
  it("returns ranked ids from the raw query", async () => {
    queryRawMock.mockResolvedValue([
      { id: "b", rank: 5 },
      { id: "a", rank: 1 },
    ]);

    const rows = await searchPaymentIds("user-1", "invoice");

    expect(rows).toEqual([
      { id: "b", rank: 5 },
      { id: "a", rank: 1 },
    ]);
    const sql = String(queryRawMock.mock.calls[0][0]);
    expect(sql).toMatch(/ts_rank/);
    expect(sql).toMatch(/transactionHash/);
  });
});

describe("searchAuditLogIds", () => {
  it("maps raw rows to ranked ids", async () => {
    queryRawMock.mockResolvedValue([{ id: "x", rank: 2 }]);

    await expect(searchAuditLogIds("refund")).resolves.toEqual([
      { id: "x", rank: 2 },
    ]);
  });
});

describe("searchPaymentsRanked", () => {
  it("orders rows by rank and paginates", async () => {
    queryRawMock.mockResolvedValue([
      { id: "b", rank: 5 },
      { id: "a", rank: 1 },
      { id: "c", rank: 0.5 },
    ]);
    findManyMock.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) => {
      expect(where.id.in).toEqual(expect.arrayContaining(["a", "b", "c"]));
      // DB returns its own order; ranking happens in memory.
      return [{ id: "c" }, { id: "a" }, { id: "b" }];
    });

    const page1 = await searchPaymentsRanked("user-1", "invoice", { userId: "user-1" }, { page: 1, limit: 2 });
    expect(page1.rows.map((r) => r.id)).toEqual(["b", "a"]);
    expect(page1.total).toBe(3);
    expect(page1.hasMore).toBe(true);

    const page2 = await searchPaymentsRanked("user-1", "invoice", { userId: "user-1" }, { page: 2, limit: 2 });
    expect(page2.rows.map((r) => r.id)).toEqual(["c"]);
    expect(page2.hasMore).toBe(false);
  });

  it("returns empty without touching the table when nothing ranks", async () => {
    queryRawMock.mockResolvedValue([]);

    const result = await searchPaymentsRanked("user-1", "zzz-no-match", { userId: "user-1" }, { page: 1, limit: 20 });

    expect(result).toEqual({ rows: [], total: 0, hasMore: false });
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it("keeps exact-hash matches first", async () => {
    queryRawMock.mockResolvedValue([
      { id: "exact", rank: 1000000000 },
      { id: "fuzzy", rank: 0.3 },
    ]);
    findManyMock.mockResolvedValue([{ id: "fuzzy" }, { id: "exact" }]);

    const result = await searchPaymentsRanked("user-1", "abc123", { userId: "user-1" }, { page: 1, limit: 20 });

    expect(result.rows.map((r) => r.id)).toEqual(["exact", "fuzzy"]);
  });
});
