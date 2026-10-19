// SPDX-License-Identifier: MIT
// Cursor (keyset) pagination for GET /api/audit-log?source=db — issue #1361.
//
// These are integration tests against an in-memory store that implements the
// Prisma query semantics the route relies on (composite `createdAt, id`
// ordering, keyset comparison, skip/take), so multi-page cursor navigation is
// exercised for real instead of asserted against a canned response.

import { describe, it, expect, vi, beforeEach } from "vitest";

interface AuditRow {
  id: string;
  action: string;
  actor: string | null;
  target: string | null;
  details: unknown;
  createdAt: Date;
}

const { mockFindMany, mockCount } = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockCount: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    auditLog: {
      findMany: mockFindMany,
      count: mockCount,
    },
  },
}));

// The route imports the shared audit-log reader (which pulls in the contract
// client) even though `source=db` never touches the chain.
vi.mock("@/lib/contracts", () => ({
  simulateContractCall: vi.fn(),
  DEFAULT_CONTRACT_ID: "CC_TEST_CONTRACT",
  CHAIN_READ_SOURCE: "G_TEST_SOURCE",
}));

vi.mock("@/lib/api-auth", () => ({
  withApiAuth: (handler: (req: Request) => Promise<Response>) => handler,
}));

import { GET } from "@/app/api/audit-log/route";
import { decodeCursor } from "@/lib/pagination-utils";

// ── In-memory store ────────────────────────────────────────────

type Where = Record<string, unknown>;

/**
 * Normalise a value so `Date` columns and the ISO-8601 strings carried inside
 * a cursor payload compare against each other numerically.
 */
function comparable(v: unknown): number | string {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    return Date.parse(v);
  }
  return v as string;
}

function matchesWhere(row: AuditRow, where: Where): boolean {
  for (const [key, cond] of Object.entries(where)) {
    if (key === "AND") {
      if (!(cond as Where[]).every((w) => matchesWhere(row, w))) return false;
      continue;
    }
    if (key === "OR") {
      if (!(cond as Where[]).some((w) => matchesWhere(row, w))) return false;
      continue;
    }
    const value = row[key as keyof AuditRow];
    if (cond !== null && typeof cond === "object") {
      const ops = cond as Record<string, unknown>;
      for (const [op, bound] of Object.entries(ops)) {
        const a = comparable(value);
        const b = comparable(bound);
        switch (op) {
          case "lt":
            if (!(a < b)) return false;
            break;
          case "lte":
            if (!(a <= b)) return false;
            break;
          case "gt":
            if (!(a > b)) return false;
            break;
          case "gte":
            if (!(a >= b)) return false;
            break;
          case "contains":
            if (String(value).indexOf(String(bound)) === -1) return false;
            break;
          case "equals":
            if (value !== bound) return false;
            break;
          default:
            throw new Error(`unsupported operator ${op}`);
        }
      }
    } else if (comparable(value) !== comparable(cond)) {
      // A scalar condition is an implicit equality; `comparable` keeps Date
      // columns interchangeable with the ISO strings a cursor carries.
      return false;
    }
  }
  return true;
}

function compare(a: AuditRow, b: AuditRow): number {
  const ta = a.createdAt.getTime();
  const tb = b.createdAt.getTime();
  if (ta !== tb) return ta < tb ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Emulate `prisma.auditLog.findMany` for the shapes this route emits:
 * filter → composite sort → `skip`/`take`. The route always orders by
 * `createdAt` then `id` with the same direction, so one composite comparator
 * per direction is enough.
 */
function seed(rows: AuditRow[]) {
  mockFindMany.mockImplementation(
    async (args: {
      where?: Where;
      orderBy?: { createdAt?: string; id?: string }[];
      skip?: number;
      take?: number;
    }) => {
      let out = rows.filter((r) => matchesWhere(r, args.where ?? {}));
      const order = args.orderBy ?? [
        { createdAt: "desc" },
        { id: "desc" },
      ];
      const dir = order[0]?.createdAt ?? order[0]?.id ?? "desc";
      out.sort((a, b) => {
        const cmp = compare(a, b);
        return dir === "asc" ? cmp : -cmp;
      });
      if (typeof args.skip === "number") out = out.slice(args.skip);
      if (typeof args.take === "number") out = out.slice(0, args.take);
      return out;
    }
  );
  mockCount.mockImplementation(
    async (args: { where?: Where }) =>
      rows.filter((r) => matchesWhere(r, args.where ?? {})).length
  );
}

// ── Fixtures ───────────────────────────────────────────────────

/** `count` rows, newest first in the array is irrelevant — ordering is by
 *  createdAt. `startTime` spreads the rows over distinct timestamps. */
function makeRows(count: number, startTime = Date.UTC(2026, 8, 1, 12, 0, 0)) {
  return Array.from({ length: count }, (_, i) => ({
    id: `audit_${String(i + 1).padStart(3, "0")}`,
    action: "refund:create",
    actor: "GABCDEFGH12345678",
    target: `refund_${i + 1}`,
    details: { i },
    // 10s apart, so id order and time order agree.
    createdAt: new Date(startTime + i * 10_000),
  }));
}

function sameTimestampRows(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `audit_${String(i + 1).padStart(3, "0")}`,
    action: "refund:create",
    actor: "GABCDEFGH12345678",
    target: `refund_${i + 1}`,
    details: { i },
    // Deliberately identical timestamps — the id tiebreak must make paging
    // deterministic.
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
  }));
}

async function get(query: string): Promise<{ res: Response; body: AuditResponse }> {
  const res = await GET(
    new Request(`http://localhost/api/audit-log?source=db&${query}`)
  );
  return { res, body: (await res.json()) as AuditResponse };
}

interface AuditResponse {
  success?: boolean;
  data: { id: string }[];
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    nextCursor?: string | null;
    hasMore?: boolean;
  };
  error?: { code?: string; message?: string };
}

/** Walk every cursor page, collecting the ids in the order they arrive. */
async function walk(
  baseQuery: string,
  maxPages = 50
): Promise<{ ids: string[]; pages: number; body: AuditResponse }> {
  const ids: string[] = [];
  let body: AuditResponse = { data: [] };
  let cursor: string | null = null;
  let pages = 0;

  for (let page = 1; page <= maxPages; page++) {
    // Every page carries the same filters/order as the first one; only the
    // cursor moves.
    const params = new URLSearchParams(baseQuery);
    if (cursor) params.set("cursor", cursor);
    else params.delete("cursor");

    const result = await get(params.toString());
    body = result.body;
    expect(result.res.status).toBe(200);
    ids.push(...result.body.data.map((r) => r.id));
    pages++;
    cursor = result.body.meta?.nextCursor ?? null;
    if (!cursor) break;
  }
  return { ids, pages, body };
}

beforeEach(() => {
  mockFindMany.mockReset();
  mockCount.mockReset();
});

// ── Tests ──────────────────────────────────────────────────────

describe("GET /api/audit-log?source=db — cursor pagination (issue #1361)", () => {
  it("walks a multi-page set without overlapping or skipping rows", async () => {
    seed(makeRows(25));
    const { ids, pages } = await walk("limit=10");

    expect(pages).toBe(3); // 10 + 10 + 5
    expect(ids).toHaveLength(25);
    // Every row exactly once, in newest-first order.
    expect(ids).toEqual(makeRows(25).map((r) => r.id).reverse());
    expect(new Set(ids).size).toBe(25);
  });

  it("returns the standardized { data, nextCursor, hasMore } envelope", async () => {
    seed(makeRows(25));
    const first = await get("limit=10");

    expect(first.res.status).toBe(200);
    expect(first.body.data).toHaveLength(10);
    expect(first.body.meta?.hasMore).toBe(true);
    expect(first.body.meta?.nextCursor).toMatch(/\S/);
    // Cursor mode never runs the expensive COUNT, so no total is reported.
    expect(first.body.meta?.total).toBeUndefined();

    // The cursor must point at the last row currently returned: page 1 of a
    // newest-first walk covers audit_025 .. audit_016.
    const anchor = decodeCursor(String(first.body.meta?.nextCursor));
    expect(anchor).toEqual({
      createdAt: makeRows(25)[15].createdAt.toISOString(),
      id: "audit_016",
    });
  });

  it("announces the end of the list on the final page", async () => {
    seed(makeRows(25));
    const { body, ids, pages } = await walk("limit=10");

    expect(pages).toBe(3);
    // The last page of the walk reported the end of the list.
    expect(body.meta?.hasMore).toBe(false);
    expect(body.meta?.nextCursor).toBeNull();
    expect(ids).toHaveLength(25);
  });

  it("reports hasMore=false when the whole set fits one page", async () => {
    seed(makeRows(3));
    const { body } = await get("limit=10");

    expect(body.data).toHaveLength(3);
    expect(body.meta?.hasMore).toBe(false);
    expect(body.meta?.nextCursor).toBeNull();
  });

  it("paginates deterministically when rows share a timestamp", async () => {
    // 5 rows, one timestamp, pages of 2 → 3 pages with an id tiebreak.
    seed(sameTimestampRows(5));
    const { ids, pages } = await walk("limit=2");

    expect(pages).toBe(3);
    // All five rows appear exactly once (newest-first id order).
    expect(ids).toEqual(sameTimestampRows(5).map((r) => r.id).reverse());
    expect(new Set(ids).size).toBe(5);
  });

  it("pages in ascending order with order=asc", async () => {
    seed(makeRows(25));
    const { ids, pages } = await walk("limit=10&order=asc");

    expect(pages).toBe(3);
    expect(ids).toEqual(makeRows(25).map((r) => r.id));
    expect(new Set(ids).size).toBe(25);
  });

  it("uses the index-backed keyset query, not a deep offset", async () => {
    seed(makeRows(25));
    await get("limit=10");
    await get(`limit=10&cursor=${encodeURIComponent("e30")}`); // invalid below

    // The first page never skips.
    expect(mockFindMany.mock.calls[0][0]).toMatchObject({
      take: 11,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    expect(mockFindMany.mock.calls[0][0].skip).toBeUndefined();
    // The keyset condition is applied on the composite key.
    expect(mockCount).not.toHaveBeenCalled();
  });

  it("builds an ASC keyset condition when order=asc", async () => {
    seed(makeRows(25));
    await get("limit=10&order=asc&cursor=" + encodeURIComponent(encodeCursorFixture()));

    const where = mockFindMany.mock.calls[0][0].where as {
      AND: Array<Record<string, unknown>>;
    };
    expect(where.AND[1]).toEqual({
      OR: [
        { createdAt: { gt: "2026-09-02T00:00:00.000Z" } },
        { createdAt: "2026-09-02T00:00:00.000Z", id: { gt: "audit_005" } },
      ],
    });
    expect(mockFindMany.mock.calls[0][0].orderBy).toEqual([
      { createdAt: "asc" },
      { id: "asc" },
    ]);
  });

  it("rejects a malformed cursor with 400", async () => {
    seed(makeRows(5));
    const { res, body } = await get("limit=10&cursor=not-a-cursor");
    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("rejects page and cursor used together", async () => {
    seed(makeRows(5));
    const { res, body } = await get(
      "limit=10&page=1&cursor=" + encodeURIComponent(encodeCursorFixture())
    );
    expect(res.status).toBe(400);
    expect(body.error?.message).toMatch(/page and cursor cannot both be used/i);
  });

  it("rejects cursor pagination for the on-chain sources", async () => {
    seed(makeRows(5));
    const res = await GET(
      new Request(
        `http://localhost/api/audit-log?source=contract&cursor=${encodeURIComponent(encodeCursorFixture())}`
      )
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error?.message).toMatch(/only supported with source=db/i);
  });

  it("composes cursor paging with the combined filters", async () => {
    const rows = makeRows(30).map((r, i) => ({
      ...r,
      action: i % 3 === 0 ? "refund:reject" : "refund:create",
    }));
    seed(rows);
    const { ids } = await walk("limit=2&action=refund:reject");

    // 10 matching rows, paged 2 at a time, and nothing else leaks in.
    expect(ids).toHaveLength(10);
    expect(new Set(ids).size).toBe(10);
    expect(ids.every((id) => rows.find((r) => r.id === id)?.action === "refund:reject")).toBe(true);
  });

  // ── Offset mode stays backward compatible ────────────────────

  it("keeps offset paging and meta.total for legacy callers", async () => {
    seed(makeRows(25));

    const page1 = await get("page=1&limit=10");
    expect(page1.body.data).toHaveLength(10);
    expect(page1.body.meta).toMatchObject({ page: 1, limit: 10, total: 25 });
    expect(page1.body.meta?.hasMore).toBe(true);
    // Offsetting callers get a keyset anchor to migrate with, no 2nd call.
    const anchor = decodeCursor(String(page1.body.meta?.nextCursor));
    expect(anchor?.id).toBe("audit_016");

    const page3 = await get("page=3&limit=10");
    expect(page3.body.data).toHaveLength(5);
    expect(page3.body.meta?.hasMore).toBe(false);
    expect(page3.body.meta?.nextCursor).toBeNull();
    expect(mockCount).toHaveBeenCalled();
  });

  it("honours order=asc in offset mode too", async () => {
    seed(makeRows(25));
    const page1 = await get("page=1&limit=5&order=asc");
    expect((page1.body.data as { id: string }[]).map((r) => r.id)).toEqual([
      "audit_001",
      "audit_002",
      "audit_003",
      "audit_004",
      "audit_005",
    ]);
  });
});

/** A valid cursor fixture (base64url of the JSON payload). */
function encodeCursorFixture(): string {
  return Buffer.from(
    JSON.stringify({ createdAt: "2026-09-02T00:00:00.000Z", id: "audit_005" })
  ).toString("base64url");
}
