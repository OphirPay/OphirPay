// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/contracts", () => ({
  fetchOnChainPayments: vi.fn(),
}));

import * as contracts from "@/lib/contracts";
import { GET } from "@/app/api/events/history/route";
import { decodeCursor } from "@/lib/pagination-utils";
import type { OnChainPayment } from "@/lib/contracts";

/** Build a payment fixture whose on-chain id is `id`. */
function payment(id: number): OnChainPayment {
  return {
    id,
    payer: "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567",
    payee: "GBCDEFGHIJKLMNOPQRSTUVWXYZ2345678",
    amountStroops: id * 10_000_000,
    txHash: `tx_${id}`,
    timestamp: 1_700_000_000 + id,
  };
}

/**
 * Emulate the on-chain reader: payments newest-first, honoring the `beforeId`
 * keyset anchor and the requested `limit`.
 */
function mockReader(): void {
  const all = [5, 4, 3, 2, 1].map(payment); // newest-first by id
  vi.mocked(contracts.fetchOnChainPayments).mockImplementation(
    async (limit = 20, _src?: string, options?: { beforeId?: number }) => {
      const eligible =
        options?.beforeId === undefined
          ? all
          : all.filter((p) => p.id < (options.beforeId as number));
      return { payments: eligible.slice(0, limit), total: all.length };
    }
  );
}

function request(query: string): Request {
  return new Request(`http://localhost/api/events/history${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockReader();
});

describe("GET /api/events/history — cursor pagination", () => {
  it("returns a first page ordered newest-first with a nextCursor", async () => {
    const res = await GET(request("?limit=2"));
    expect(res.status).toBe(200);

    // Fetches limit + 1 to detect the next page, with no keyset anchor.
    expect(contracts.fetchOnChainPayments).toHaveBeenCalledWith(3, undefined, {
      beforeId: undefined,
    });

    const body = await res.json();
    expect(body.data.events.map((e: { id: string }) => e.id)).toEqual([
      "evt_5",
      "evt_4",
    ]);
    expect(body.meta.limit).toBe(2);
    expect(body.meta.hasMore).toBe(true);

    // Cursor anchors on the last visible event.
    expect(decodeCursor(body.meta.nextCursor)?.id).toBe("evt_4");
  });

  it("resumes strictly below the cursor on the next page", async () => {
    const first = await (await GET(request("?limit=2"))).json();

    const res = await GET(
      request(`?limit=2&cursor=${encodeURIComponent(first.meta.nextCursor)}`)
    );
    expect(res.status).toBe(200);

    expect(contracts.fetchOnChainPayments).toHaveBeenLastCalledWith(3, undefined, {
      beforeId: 4,
    });

    const body = await res.json();
    expect(body.data.events.map((e: { id: string }) => e.id)).toEqual([
      "evt_3",
      "evt_2",
    ]);
    expect(body.meta.hasMore).toBe(true);
    expect(decodeCursor(body.meta.nextCursor)?.id).toBe("evt_2");
  });

  it("reports the last page with nextCursor=null and hasMore=false", async () => {
    const body = await (
      await GET(request(`?limit=3&cursor=${encodeURIComponent(
        Buffer.from(
          JSON.stringify({ createdAt: new Date(1700000000 * 1000).toISOString(), id: "evt_2" })
        ).toString("base64url")
      )}`))
    ).json();

    expect(body.data.events.map((e: { id: string }) => e.id)).toEqual(["evt_1"]);
    expect(body.meta.hasMore).toBe(false);
    expect(body.meta.nextCursor).toBeNull();
  });

  it("rejects an invalid cursor with 400", async () => {
    const res = await GET(request("?limit=2&cursor=not-a-cursor"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it("rejects a limit above the documented maximum with 400", async () => {
    const res = await GET(request("?limit=200"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("defaults to a limit of 50", async () => {
    await GET(request(""));
    expect(contracts.fetchOnChainPayments).toHaveBeenCalledWith(51, undefined, {
      beforeId: undefined,
    });
  });
});
