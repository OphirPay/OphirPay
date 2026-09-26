// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/contracts", () => ({
  fetchOnChainPayments: vi.fn(),
}));

import * as contracts from "@/lib/contracts";
import { GET as getEventsHistory } from "@/app/api/events/history/route";
import { encodeCursor } from "@/lib/pagination-utils";

function mockPayments(startId: number, endId: number) {
  // startId down to endId (descending order)
  const payments = [];
  for (let id = startId; id >= endId; id--) {
    payments.push({
      id,
      payer: `G_PAYER_${id}`,
      payee: `G_PAYEE_${id}`,
      amountStroops: id * 1000,
      txHash: `tx_${id}`,
      timestamp: 1700000000 + id,
      metadata: `memo_${id}`,
    });
  }
  return payments;
}

describe("GET /api/events/history — Keyset Cursor Pagination (#746)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns default page of events with nextCursor and hasMore when more data exists", async () => {
    // 100 total payments on-chain, requesting limit=2 (route asks for limit+1 = 3)
    vi.mocked(contracts.fetchOnChainPayments).mockResolvedValueOnce({
      payments: mockPayments(100, 98), // 100, 99, 98 (3 items)
      total: 100,
    });

    const req = new Request("http://localhost/api/events/history?limit=2");
    const res = await getEventsHistory(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);

    // Visible items should be capped at limit = 2
    expect(json.data.events).toHaveLength(2);
    expect(json.data.events[0].id).toBe("evt_100");
    expect(json.data.events[1].id).toBe("evt_99");
    expect(json.data.events[0].createdAt).toBeDefined();

    // Keyset pagination metadata
    expect(json.data.hasMore).toBe(true);
    expect(json.data.nextCursor).toBeTypeOf("string");
    expect(json.data.total).toBe(100);

    // Meta object matches
    expect(json.meta.limit).toBe(2);
    expect(json.meta.hasMore).toBe(true);
    expect(json.meta.nextCursor).toBe(json.data.nextCursor);
    expect(json.meta.total).toBe(100);

    // fetchOnChainPayments called with limit + 1
    expect(contracts.fetchOnChainPayments).toHaveBeenCalledWith(3, undefined, undefined);
  });

  it("fetches the next page using cursor and maintains stable descending ordering", async () => {
    // Client passes cursor for evt_99
    const cursor = encodeCursor({
      createdAt: new Date(1700000099 * 1000).toISOString(),
      id: "evt_99",
    });

    // Mock returns items before 99: 98, 97, 96 (3 items for limit=2 + 1)
    vi.mocked(contracts.fetchOnChainPayments).mockResolvedValueOnce({
      payments: mockPayments(98, 96),
      total: 100,
    });

    const req = new Request(`http://localhost/api/events/history?limit=2&cursor=${cursor}`);
    const res = await getEventsHistory(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data.events).toHaveLength(2);
    expect(json.data.events[0].id).toBe("evt_98");
    expect(json.data.events[1].id).toBe("evt_97");
    expect(json.data.hasMore).toBe(true);
    expect(json.data.nextCursor).toBeTypeOf("string");

    // cursorId = 99 extracted and passed to fetchOnChainPayments
    expect(contracts.fetchOnChainPayments).toHaveBeenCalledWith(3, undefined, 99);
  });

  it("reports terminal page with hasMore: false and nextCursor: null", async () => {
    // Terminal page: only 2 payments left (2, 1) when limit=2 + 1 was requested
    vi.mocked(contracts.fetchOnChainPayments).mockResolvedValueOnce({
      payments: mockPayments(2, 1),
      total: 100,
    });

    const cursor = encodeCursor({
      createdAt: new Date(1700000003 * 1000).toISOString(),
      id: "evt_3",
    });

    const req = new Request(`http://localhost/api/events/history?limit=2&cursor=${cursor}`);
    const res = await getEventsHistory(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data.events).toHaveLength(2);
    expect(json.data.events[0].id).toBe("evt_2");
    expect(json.data.events[1].id).toBe("evt_1");
    expect(json.data.hasMore).toBe(false);
    expect(json.data.nextCursor).toBeNull();
    expect(json.meta.nextCursor).toBeNull();
    expect(json.meta.hasMore).toBe(false);
  });

  it("returns empty list when cursor reaches beyond available items", async () => {
    // When cursor is evt_1, no items remain before it
    vi.mocked(contracts.fetchOnChainPayments).mockResolvedValueOnce({
      payments: [],
      total: 100,
    });

    const cursor = encodeCursor({
      createdAt: new Date(1700000001 * 1000).toISOString(),
      id: "evt_1",
    });

    const req = new Request(`http://localhost/api/events/history?limit=10&cursor=${cursor}`);
    const res = await getEventsHistory(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data.events).toEqual([]);
    expect(json.data.hasMore).toBe(false);
    expect(json.data.nextCursor).toBeNull();
  });

  it("defaults limit to 50 when omitted", async () => {
    vi.mocked(contracts.fetchOnChainPayments).mockResolvedValueOnce({
      payments: [],
      total: 0,
    });

    const req = new Request("http://localhost/api/events/history");
    const res = await getEventsHistory(req);
    expect(res.status).toBe(200);

    // Limit 50 defaults to take = 51
    expect(contracts.fetchOnChainPayments).toHaveBeenCalledWith(51, undefined, undefined);
  });

  it("rejects invalid non-base64 or malformed cursor with 400", async () => {
    const req = new Request("http://localhost/api/events/history?cursor=invalid_cursor_string");
    const res = await getEventsHistory(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error.message).toBe("Invalid cursor");
  });

  it("rejects cursor with non-numeric id payload with 400", async () => {
    const tamperedCursor = encodeCursor({
      createdAt: new Date().toISOString(),
      id: "evt_abc_not_numeric",
    });

    const req = new Request(`http://localhost/api/events/history?cursor=${tamperedCursor}`);
    const res = await getEventsHistory(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error.message).toBe("Invalid cursor");
  });

  it("rejects simultaneous page and cursor with 400", async () => {
    const cursor = encodeCursor({
      createdAt: new Date().toISOString(),
      id: "evt_10",
    });

    const req = new Request(`http://localhost/api/events/history?page=2&cursor=${cursor}`);
    const res = await getEventsHistory(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error.message).toBe("page and cursor cannot both be used");
  });

  it("rejects out-of-bounds limit (> 100 or < 1) with 400 validation error", async () => {
    const reqTooHigh = new Request("http://localhost/api/events/history?limit=150");
    const resTooHigh = await getEventsHistory(reqTooHigh);
    expect(resTooHigh.status).toBe(400);

    const jsonTooHigh = await resTooHigh.json();
    expect(jsonTooHigh.error.message).toBe("Request validation failed");

    const reqTooLow = new Request("http://localhost/api/events/history?limit=0");
    const resTooLow = await getEventsHistory(reqTooLow);
    expect(resTooLow.status).toBe(400);

    const reqNaN = new Request("http://localhost/api/events/history?limit=notanumber");
    const resNaN = await getEventsHistory(reqNaN);
    expect(resNaN.status).toBe(400);
  });

  it("handles contract RPC errors with 500", async () => {
    vi.mocked(contracts.fetchOnChainPayments).mockRejectedValueOnce(
      new Error("Soroban RPC connection timeout")
    );

    const req = new Request("http://localhost/api/events/history");
    const res = await getEventsHistory(req);
    expect(res.status).toBe(500);

    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error.message).toContain("Soroban RPC connection timeout");
  });
});
