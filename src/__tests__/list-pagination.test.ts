// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET as getPayments } from "@/app/api/payments/route";
import { GET as getBatches } from "@/app/api/batches/route";

// ── Mocks ──────────────────────────────────────────────────────

const prismaMock = vi.hoisted(() => ({
  payment: { findMany: vi.fn(), count: vi.fn() },
  batch: { findMany: vi.fn(), count: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: vi.fn(async () => ({ userId: "user-1" })),
}));

// ── In-memory row store simulating a 10k+ table ────────────────

interface Row {
  id: string;
  userId: string;
  createdAt: Date;
  status?: string;
  description?: string | null;
  name?: string;
}

function makePayments(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `pay-${String(i).padStart(6, "0")}`,
    userId: "user-1",
    createdAt: new Date(Date.UTC(2026, 0, 1) + i * 60_000),
    status: "COMPLETED",
    amount: i + 1,
    assetCode: "XLM",
    description: `Payment ${i}`,
  }));
}

function makeBatches(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `batch-${String(i).padStart(6, "0")}`,
    userId: "user-1",
    name: `Batch ${i}`,
    status: "COMPLETED",
    createdAt: new Date(Date.UTC(2026, 0, 1) + i * 60_000),
    description: null,
  }));
}

/** Apply the base filter (userId scope, status, search OR). */
function filterBase(where: Record<string, unknown>, rows: Row[]): Row[] {
  let out = rows;
  if (where.userId) out = out.filter((r) => r.userId === where.userId);
  if (where.status) out = out.filter((r) => r.status === where.status);
  const or = where.OR as Record<string, { contains?: string }>[] | undefined;
  const search = or?.[0]?.description?.contains ?? or?.[0]?.name?.contains;
  if (search) {
    out = out.filter((r) => (r.description ?? r.name)?.includes(search));
  }
  return out;
}

/**
 * Miniature Prisma: interprets the where clause (base filter + optional
 * keyset AND), orders by createdAt desc / id desc, then applies skip/take.
 * ISO string comparison is chronological for UTC timestamps.
 */
function applyQuery(
  rows: Row[],
  args: { where?: unknown; skip?: number; take?: number }
): Row[] {
  let out = rows;
  const where = (args?.where ?? {}) as Record<string, unknown>;

  if (Array.isArray(where.AND)) {
    const [base, keyset] = where.AND as [
      Record<string, unknown>,
      { OR?: Record<string, unknown>[] }
    ];
    out = filterBase(base, out);
    const keysetOr = keyset?.OR;
    if (keysetOr) {
      const lt = (keysetOr[0].createdAt as { lt: string }).lt;
      const eqCreated = keysetOr[1].createdAt as string;
      const ltId = (keysetOr[1].id as { lt: string }).lt;
      out = out.filter((r) => {
        const t = r.createdAt.toISOString();
        return t < lt || (t === eqCreated && r.id < ltId);
      });
    }
  } else {
    out = filterBase(where, out);
  }

  out = [...out].sort(
    (a, b) =>
      b.createdAt.getTime() - a.createdAt.getTime() ||
      (a.id < b.id ? 1 : -1)
  );
  const skip = args?.skip ?? 0;
  const take = args?.take ?? out.length;
  return out.slice(skip, skip + take);
}

// ── Tests ──────────────────────────────────────────────────────

describe("GET /api/payments — cursor pagination over 10,050 rows", () => {
  const ROWS = makePayments(10050);
  const findManyCalls: { skip?: number; take?: number; where?: unknown }[] = [];

  beforeEach(() => {
    findManyCalls.length = 0;
    prismaMock.payment.findMany.mockReset();
    prismaMock.payment.count.mockReset();
    prismaMock.payment.findMany.mockImplementation(async (args: never) => {
      findManyCalls.push(args as never);
      return applyQuery(ROWS, args as never);
    });
    prismaMock.payment.count.mockResolvedValue(ROWS.length);
  });

  it("pages the entire dataset via cursors with zero duplicates and zero deep offsets", async () => {
    const limit = 50;
    let cursor: string | null = null;
    let pages = 0;
    let totalFetched = 0;
    const seen = new Set<string>();

    do {
      const url = cursor
        ? `http://localhost/api/payments?limit=${limit}&cursor=${encodeURIComponent(cursor)}`
        : `http://localhost/api/payments?limit=${limit}`;
      const res: Response = await getPayments(new Request(url));
      expect(res.status).toBe(200);
      const json = await res.json();

      for (const row of json.data) {
        expect(seen.has(row.id)).toBe(false);
        seen.add(row.id);
      }
      totalFetched += json.data.length;
      cursor = json.meta.nextCursor;
      expect(json.meta.hasMore).toBe(cursor !== null);
      pages += 1;
      expect(pages).toBeLessThanOrEqual(250); // safety net
    } while (cursor);

    expect(totalFetched).toBe(10050);
    expect(pages).toBe(201); // ceil(10050 / 50)

    // Every page used the keyset path: take = limit + 1 and never skip.
    const cursorCalls = findManyCalls.filter((c) => c.take === limit + 1);
    expect(cursorCalls.length).toBe(201);
    for (const c of cursorCalls) {
      expect(c.skip).toBeUndefined();
    }
  });

  it("keeps offset pagination working for backward compatibility", async () => {
    const res = await getPayments(
      new Request("http://localhost/api/payments?page=3&limit=50")
    );
    const json = await res.json();
    expect(json.data).toHaveLength(50);
    expect(json.meta.page).toBe(3);
    expect(json.meta.nextCursor).toBeNull();
    expect(json.meta.hasMore).toBe(true); // 3*50 = 150 < 10050

    const lastCall = findManyCalls.at(-1);
    expect(lastCall?.skip).toBe(100);
    expect(lastCall?.take).toBe(50);
  });

  it("combines cursor pagination with filters without duplicates", async () => {
    const first = await getPayments(
      new Request("http://localhost/api/payments?limit=50&search=Payment+9")
    );
    const j1 = await first.json();
    expect(j1.data.length).toBe(50);
    expect(j1.meta.hasMore).toBe(true);

    const second = await getPayments(
      new Request(
        `http://localhost/api/payments?limit=50&search=Payment+9&cursor=${encodeURIComponent(j1.meta.nextCursor)}`
      )
    );
    const j2 = await second.json();
    expect(j2.data.length).toBe(50);

    const firstIds = new Set(j1.data.map((r: { id: string }) => r.id));
    for (const row of j2.data as { id: string }[]) {
      expect(firstIds.has(row.id)).toBe(false);
    }
  });

  it("rejects a malformed cursor with 400", async () => {
    const res = await getPayments(
      new Request("http://localhost/api/payments?cursor=%%%not-a-cursor%%%")
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("BAD_REQUEST");
  });
});

describe("GET /api/batches — cursor pagination", () => {
  const BATCH_ROWS = makeBatches(120);
  const findManyCalls: { skip?: number; take?: number }[] = [];

  beforeEach(() => {
    findManyCalls.length = 0;
    prismaMock.batch.findMany.mockReset();
    prismaMock.batch.count.mockReset();
    prismaMock.batch.findMany.mockImplementation(async (args: never) => {
      findManyCalls.push(args as never);
      return applyQuery(BATCH_ROWS, args as never);
    });
    prismaMock.batch.count.mockResolvedValue(BATCH_ROWS.length);
  });

  it("pages 120 batches as 50/50/20 with correct hasMore flags", async () => {
    let cursor: string | null = null;
    const pageSizes: number[] = [];
    const hasMoreFlags: boolean[] = [];

    do {
      const url = cursor
        ? `http://localhost/api/batches?limit=50&cursor=${encodeURIComponent(cursor)}`
        : "http://localhost/api/batches?limit=50";
      const res: Response = await getBatches(new Request(url));
      expect(res.status).toBe(200);
      const json = await res.json();
      pageSizes.push(json.data.length);
      hasMoreFlags.push(json.meta.hasMore);
      cursor = json.meta.nextCursor;
    } while (cursor);

    expect(pageSizes).toEqual([50, 50, 20]);
    expect(hasMoreFlags).toEqual([true, true, false]);

    const cursorCalls = findManyCalls.filter((c) => c.take === 51);
    expect(cursorCalls.length).toBe(3);
    for (const c of cursorCalls) expect(c.skip).toBeUndefined();
  });
});
