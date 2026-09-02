// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Payment } from "@prisma/client";
import { encodeCursor, decodeCursor } from "@/lib/pagination-utils";
import { GET } from "@/app/api/payments/route";
import prisma from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-session";

// ── Mocks ─────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  default: {
    payment: { findMany: vi.fn(), count: vi.fn(), create: vi.fn() },
  },
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: vi.fn(),
}));

// Route-module side effects — keep them inert in tests
vi.mock("@/lib/webhook-dispatcher", () => ({
  dispatchWebhookEventAsync: vi.fn(),
}));
vi.mock("@/lib/metrics-counters", () => ({ incMetric: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { request: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const mockedAuth = vi.mocked(getAuthContext);
const mockedFindMany = vi.mocked(prisma.payment.findMany);
const mockedCount = vi.mocked(prisma.payment.count);

// ── Fixtures ──────────────────────────────────────────────────

interface PaymentRow {
  id: string;
  createdAt: Date;
  amount: number;
  assetCode: string;
  status: string;
  userId: string;
  description: string | null;
  memo: string | null;
  transactionHash: string | null;
}

function makePayment(id: string, createdAt: Date): PaymentRow {
  return {
    id,
    createdAt,
    amount: 100,
    assetCode: "XLM",
    status: "COMPLETED",
    userId: "user-1",
    description: null,
    memo: null,
    transactionHash: null,
  };
}

/** Cast row fixtures to the full Prisma model for the mocked findMany. */
function asPaymentRows(rows: PaymentRow[]): Payment[] {
  return rows as unknown as Payment[];
}

const DATE_A = new Date("2026-08-01T00:00:00.000Z");
const DATE_B = new Date("2026-08-02T00:00:00.000Z");
const DATE_C = new Date("2026-08-03T00:00:00.000Z");

const PAGE_ONE = [
  makePayment("c3", DATE_C),
  makePayment("c2", DATE_C),
  makePayment("b1", DATE_B),
];

function apiUrl(params: string): Request {
  return new Request(`http://localhost/api/payments${params ? `?${params}` : ""}`);
}

// ── Cursor encoding ───────────────────────────────────────────

describe("keyset cursor encode/decode", () => {
  it("round-trips a valid payload", () => {
    const payload = { createdAt: DATE_B.toISOString(), id: "b1" };
    const token = encodeCursor(payload);
    expect(token).not.toContain("2026"); // opaque — no plaintext date
    expect(decodeCursor(token)).toEqual(payload);
  });

  it("is URL-safe", () => {
    const token = encodeCursor({ createdAt: DATE_B.toISOString(), id: "b1" });
    expect(token).not.toMatch(/[+/=]/);
    expect(encodeURIComponent(token)).toBe(token);
  });

  it("rejects non-base64 garbage", () => {
    expect(decodeCursor("not a cursor!!!")).toBeNull();
    expect(decodeCursor("")).toBeNull();
  });

  it("rejects tampered payloads (wrong shape / types)", () => {
    const token = encodeCursor({ createdAt: DATE_B.toISOString(), id: "b1" });
    // Flip a char so the JSON is still parseable but the date is invalid
    const tampered = token.slice(0, 4) + (token[4] === "A" ? "B" : "A") + token.slice(5);
    expect(decodeCursor(tampered)).toBeNull();
    expect(decodeCursor(Buffer.from(JSON.stringify({ id: 42 })).toString("base64url"))).toBeNull();
    expect(decodeCursor(Buffer.from(JSON.stringify({ createdAt: "nope", id: "x" })).toString("base64url"))).toBeNull();
  });

  it("rejects missing fields", () => {
    const onlyId = Buffer.from(JSON.stringify({ id: "b1" })).toString("base64url");
    const onlyDate = Buffer.from(JSON.stringify({ createdAt: DATE_B.toISOString() })).toString("base64url");
    expect(decodeCursor(onlyId)).toBeNull();
    expect(decodeCursor(onlyDate)).toBeNull();
  });
});

// ── GET handler — keyset mode ─────────────────────────────────

describe("GET /api/payments — keyset pagination", () => {
  beforeEach(() => {
    mockedAuth.mockResolvedValue({ userId: "user-1" });
    mockedFindMany.mockReset();
    mockedCount.mockReset();
  });

  it("returns 401 without auth", async () => {
    mockedAuth.mockResolvedValue(null);
    const res = await GET(apiUrl("limit=20"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it("rejects an invalid limit (400)", async () => {
    const res = await GET(apiUrl("limit=200"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects cursor + page together (400)", async () => {
    const res = await GET(apiUrl(`limit=20&page=1&cursor=${encodeCursor({ createdAt: DATE_B.toISOString(), id: "b1" })}`));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(body.error.message).toMatch(/not both/i);
  });

  it("rejects an invalid cursor (400)", async () => {
    const res = await GET(apiUrl("limit=20&cursor=%24%24%24not-base64"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(body.error.message).toMatch(/cursor/i);
  });

  it("first page: keyset query shape (no skip, take=limit+1, ordered by createdAt+id desc)", async () => {
    mockedFindMany.mockResolvedValue(asPaymentRows([...PAGE_ONE, makePayment("a1", DATE_A)]));
    const res = await GET(apiUrl("limit=3"));
    expect(res.status).toBe(200);

    expect(mockedFindMany).toHaveBeenCalledWith({
      where: { AND: [{ userId: "user-1" }] },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 4,
    });
    // No COUNT in the default keyset path
    expect(mockedCount).not.toHaveBeenCalled();

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(3);
    expect(body.meta.hasMore).toBe(true);
    expect(body.meta.nextCursor).toBeTruthy();
    expect(body.meta.limit).toBe(3);
    expect(body.meta.total).toBeUndefined();
  });

  it("middle page: applies the opaque cursor as a (createdAt, id) keyset condition", async () => {
    const cursor = encodeCursor({ createdAt: DATE_B.toISOString(), id: "b1" });
    mockedFindMany.mockResolvedValue(asPaymentRows([makePayment("a2", DATE_A), makePayment("a1", DATE_A)]));
    const res = await GET(apiUrl(`limit=3&cursor=${cursor}`));
    expect(res.status).toBe(200);

    expect(mockedFindMany).toHaveBeenCalledWith({
      where: {
        AND: [
          { userId: "user-1" },
          {
            OR: [
              { createdAt: { lt: DATE_B } },
              { createdAt: DATE_B, id: { lt: "b1" } },
            ],
          },
        ],
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 4,
    });
  });

  it("last page: hasMore=false and nextCursor=null when fewer than limit+1 rows", async () => {
    mockedFindMany.mockResolvedValue(asPaymentRows([makePayment("a1", DATE_A)]));
    const res = await GET(apiUrl("limit=3"));
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.meta.hasMore).toBe(false);
    expect(body.meta.nextCursor).toBeNull();
  });

  it("empty page: empty data, hasMore=false, nextCursor=null", async () => {
    mockedFindMany.mockResolvedValue(asPaymentRows([]));
    const res = await GET(apiUrl("limit=20"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
    expect(body.meta.hasMore).toBe(false);
    expect(body.meta.nextCursor).toBeNull();
  });

  it("includeTotal=true adds meta.total (COUNT over the filtered set, no cursor)", async () => {
    mockedFindMany.mockResolvedValue(asPaymentRows([...PAGE_ONE, makePayment("a1", DATE_A)]));
    mockedCount.mockResolvedValue(4);
    const res = await GET(apiUrl("limit=3&includeTotal=true"));
    const body = await res.json();
    expect(body.meta.total).toBe(4);
    expect(mockedCount).toHaveBeenCalledWith({ where: { AND: [{ userId: "user-1" }] } });
  });

  it("applies status + search filters in keyset mode", async () => {
    mockedFindMany.mockResolvedValue(asPaymentRows([]));
    await GET(apiUrl("limit=3&status=COMPLETED&search=freelance"));
    expect(mockedFindMany).toHaveBeenCalledWith({
      where: {
        AND: [
          { userId: "user-1" },
          { status: "COMPLETED" },
          {
            OR: [
              { description: { contains: "freelance" } },
              { memo: { contains: "freelance" } },
              { transactionHash: { contains: "freelance" } },
            ],
          },
        ],
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 4,
    });
  });

  it("handles absent query params (regression: zod v4 null rejection)", async () => {
    mockedFindMany.mockResolvedValue(asPaymentRows([]));
    const res = await GET(apiUrl(""));
    expect(res.status).toBe(200); // previously 400 for missing page/status/search
    const body = await res.json();
    expect(body.meta.limit).toBe(20); // default applied
  });
});

// ── GET handler — legacy offset mode ──────────────────────────

describe("GET /api/payments — legacy offset mode (page param)", () => {
  beforeEach(() => {
    mockedAuth.mockResolvedValue({ userId: "user-1" });
    mockedFindMany.mockReset();
    mockedCount.mockReset();
  });

  it("keeps the documented offset contract (page/limit/total + navigation meta)", async () => {
    mockedFindMany.mockResolvedValue(asPaymentRows([makePayment("c3", DATE_C)]));
    mockedCount.mockResolvedValue(25);
    const res = await GET(apiUrl("page=2&limit=10"));
    expect(res.status).toBe(200);

    expect(mockedFindMany).toHaveBeenCalledWith({
      where: { AND: [{ userId: "user-1" }] },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: 10,
      take: 10,
    });
    expect(mockedCount).toHaveBeenCalledWith({ where: { AND: [{ userId: "user-1" }] } });

    const body = await res.json();
    expect(body.meta.page).toBe(2);
    expect(body.meta.limit).toBe(10);
    expect(body.meta.total).toBe(25);
    expect(body.meta.totalPages).toBe(3);
    expect(body.meta.hasNext).toBe(true);
    expect(body.meta.hasPrev).toBe(true);
  });

  it("first offset page reports hasPrev=false", async () => {
    mockedFindMany.mockResolvedValue(asPaymentRows([makePayment("c3", DATE_C)]));
    mockedCount.mockResolvedValue(25);
    const res = await GET(apiUrl("page=1&limit=10"));
    const body = await res.json();
    expect(body.meta.hasPrev).toBe(false);
  });
});
