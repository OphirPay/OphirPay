// SPDX-License-Identifier: MIT

/**
 * Streaming chunked CSV export integration test suite (Issue #1369).
 *
 * Verifies that GET /api/payments/export:
 * 1. Streams records incrementally in 250-row chunks instead of buffering in memory.
 * 2. Uses Prisma cursor-based pagination across batch boundaries.
 * 3. Sets Transfer-Encoding: chunked and Content-Disposition headers.
 * 4. Cancels stream cleanly when client disconnects (abort signal).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma, type Payment } from "@prisma/client";
import { parseCsvText } from "@/lib/csv-import";

const { mockFindMany, mockCount, mockGetAuthContext } = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockCount: vi.fn(),
  mockGetAuthContext: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: { payment: { findMany: mockFindMany, count: mockCount } },
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: mockGetAuthContext,
}));

import { GET } from "@/app/api/payments/export/route";
import {
  EXPORT_CHUNK_SIZE,
  PAYMENT_EXPORT_COLUMNS,
  PAYMENT_EXPORT_HEADER,
} from "@/lib/payment-export";

function makePayment(id: number, overrides: Partial<Payment> = {}): Payment {
  return {
    id: `payment_${String(id).padStart(6, "0")}`,
    userId: "user-1",
    amount: new Prisma.Decimal("10.50"),
    assetCode: "XLM",
    assetIssuer: null,
    description: `Payout #${id}`,
    memo: `payout-${id}`,
    status: "COMPLETED",
    transactionHash: `txhash_${id}_0000000000000000000000000000000000000000`,
    stellarOpId: null,
    sourceAccountId: "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U",
    destAccountId: "GDHJ3K2LQ7F5XQZPX6YWNMYKXWQXVZKBJZQFYX3F6KRLV4WDXHJMB2UY",
    batchId: null,
    recurrenceId: null,
    metadata: null,
    errorMessage: null,
    createdAt: new Date(1700000000000 + id * 1000),
    updatedAt: new Date(1700000000000 + id * 1000),
    completedAt: null,
    deletedAt: null,
    ...overrides,
  } as Payment;
}

/** Read the response body chunk by chunk via ReadableStream reader. */
async function readStreamChunks(res: Response): Promise<string[]> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(decoder.decode(value, { stream: true }));
  }
  return chunks;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthContext.mockResolvedValue({ userId: "user-1" });
  mockCount.mockResolvedValue(0);
});

describe("GET /api/payments/export — Streaming Chunked Integration (Issue #1369)", () => {
  it("streams CSV header followed by 250-row chunks for large datasets", async () => {
    // Simulate 600 records (250 + 250 + 100)
    const totalRecords = 600;
    const allRecords = Array.from({ length: totalRecords }, (_, i) =>
      makePayment(totalRecords - i)
    );

    mockFindMany.mockImplementation(async (args: { take: number; cursor?: { id: string } }) => {
      let startIndex = 0;
      if (args.cursor) {
        startIndex = allRecords.findIndex((r) => r.id === args.cursor!.id) + 1;
      }
      return allRecords.slice(startIndex, startIndex + args.take);
    });

    const res = await GET(new Request("http://localhost/api/payments/export"));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Transfer-Encoding")).toBe("chunked");
    expect(res.headers.get("Content-Disposition")).toContain("ophirpay-payments-");

    const chunks = await readStreamChunks(res);

    // First chunk is the pre-rendered CSV header
    expect(chunks[0]).toBe(PAYMENT_EXPORT_HEADER);

    // Chunks 1 and 2 each contain 250 records; Chunk 3 contains remaining 100 records
    expect(chunks.length).toBe(4); // 1 header chunk + 3 data chunks

    // Parse full text
    const fullCsv = chunks.join("");
    const parsedRows = parseCsvText(fullCsv);

    expect(parsedRows).toHaveLength(totalRecords + 1);
    expect(parsedRows[0]).toEqual(PAYMENT_EXPORT_COLUMNS.map((c) => c.header));
    expect(parsedRows[1]![0]).toBe("payment_000600");
    expect(parsedRows[totalRecords]![0]).toBe("payment_000001");

    // Verify cursor-based findMany calls
    expect(mockFindMany).toHaveBeenCalledTimes(3);
    expect(mockFindMany.mock.calls[0]![0].take).toBe(EXPORT_CHUNK_SIZE);
    expect(mockFindMany.mock.calls[1]![0].cursor).toEqual({ id: "payment_000351" });
    expect(mockFindMany.mock.calls[1]![0].skip).toBe(1);
    expect(mockFindMany.mock.calls[2]![0].cursor).toEqual({ id: "payment_000101" });
  });

  it("handles empty database results by returning only the header chunk", async () => {
    mockFindMany.mockResolvedValue([]);

    const res = await GET(new Request("http://localhost/api/payments/export"));
    expect(res.status).toBe(200);

    const chunks = await readStreamChunks(res);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(PAYMENT_EXPORT_HEADER);
  });

  it("cancels database iteration when client aborts the download stream", async () => {
    const controller = new AbortController();
    let findManyCalls = 0;

    mockFindMany.mockImplementation(async () => {
      findManyCalls++;
      // Simulate client aborting during the first batch fetch
      if (findManyCalls === 1) {
        controller.abort();
      }
      return Array.from({ length: 250 }, (_, i) => makePayment(findManyCalls * 1000 + i));
    });

    const res = await GET(
      new Request("http://localhost/api/payments/export", { signal: controller.signal })
    );

    const reader = res.body!.getReader();

    // Read header chunk
    const first = await reader.read();
    expect(first.done).toBe(false);

    // Read first batch of 250 items
    const second = await reader.read();
    expect(second.done).toBe(false);

    // Allow stream loop to exit
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Subsequent findMany calls must have been aborted
    expect(findManyCalls).toBe(1);
  });
});
