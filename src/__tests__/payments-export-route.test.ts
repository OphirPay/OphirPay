// SPDX-License-Identifier: MIT

/**
 * Streaming CSV export of payments (issue #1369).
 *
 * The route used to `findMany()` every matching row and join the result into a
 * single string. These tests pin the replacement contract:
 *
 *   • the header is flushed before the first page is read,
 *   • rows arrive as 250-row chunks, before the next page has been fetched,
 *   • pages are walked with a Prisma cursor (never `skip`),
 *   • a database failure mid-stream *errors* the stream instead of closing it,
 *   • each chunk is assembled with the shared CSV escaper.
 *
 * Failure modes that used to be impossible now that headers are already sent
 * (an aborted client, a page that throws) are asserted explicitly, because
 * they are the ones a naive streaming rewrite gets wrong.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma, type Payment } from "@prisma/client";

const { mockFindMany, mockGetAuthContext, mockLoggerError } = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockGetAuthContext: vi.fn(),
  mockLoggerError: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: { payment: { findMany: mockFindMany } },
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: mockGetAuthContext,
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: mockLoggerError,
    request: vi.fn(),
    metric: vi.fn(),
    timing: vi.fn(),
  },
}));

import { GET } from "@/app/api/payments/export/route";
import {
  PAYMENT_EXPORT_COLUMNS,
  PAYMENT_EXPORT_PAGE_SIZE,
} from "@/lib/payment-export";

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: "cm0pymt00000000000000001",
    userId: "user-1",
    amount: new Prisma.Decimal("100.25"),
    assetCode: "XLM",
    assetIssuer: null,
    description: "Invoice #42",
    memo: "invoice-42",
    status: "COMPLETED",
    transactionHash:
      "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    stellarOpId: null,
    sourceAccountId: null,
    destAccountId: null,
    batchId: null,
    recurrenceId: null,
    metadata: null,
    errorMessage: null,
    createdAt: new Date("2026-08-26T10:00:00.000Z"),
    updatedAt: new Date("2026-08-26T10:00:00.000Z"),
    completedAt: null,
    deletedAt: null,
    ...overrides,
  } as Payment;
}

/** Read a response body chunk by chunk, exactly as a browser would. */
async function readChunks(res: Response): Promise<string[]> {
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

function exportRequest(query = "", signal?: AbortSignal) {
  return GET(
    new Request(`http://localhost/api/payments/export${query}`, { signal })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthContext.mockResolvedValue({ userId: "user-1" });
  mockFindMany.mockResolvedValue([]);
});

describe("GET /api/payments/export — streaming", () => {
  it("rejects unauthenticated callers with a 401 problem document", async () => {
    mockGetAuthContext.mockResolvedValue(null);

    const res = await exportRequest();

    expect(res.status).toBe(401);
    expect(res.headers.get("Content-Type")).toBe("application/problem+json");
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("sets attachment, chunked-transfer and no-store headers", async () => {
    const res = await exportRequest();

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Transfer-Encoding")).toBe("chunked");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Content-Disposition")).toMatch(
      /attachment; filename="ophirpay-payments-\d{4}-\d{2}-\d{2}\.csv"/
    );
  });

  it("flushes the header before reading any rows", async () => {
    const res = await exportRequest();
    const reader = res.body!.getReader();

    const first = await reader.read();
    const header = PAYMENT_EXPORT_COLUMNS.map((c) => c.header).join(",");
    expect(new TextDecoder().decode(first.value)).toBe(`${header}\n`);

    await reader.cancel();
  });

  it("streams a page before fetching the next one", async () => {
    const page = Array.from({ length: PAYMENT_EXPORT_PAGE_SIZE }, (_, i) =>
      makePayment({ id: `p${i}` })
    );
    let releasePage2: ((rows: Payment[]) => void) | undefined;
    mockFindMany
      .mockResolvedValueOnce(page)
      .mockImplementationOnce(
        () => new Promise<Payment[]>((resolve) => (releasePage2 = resolve))
      );

    const res = await exportRequest();
    const reader = res.body!.getReader();

    const [, rowsChunk] = [
      await reader.read(),
      await reader.read(),
    ];

    // The first page is already on the wire while page 2 is still pending:
    // that is what makes the memory footprint independent of the dataset.
    expect(mockFindMany).toHaveBeenCalledTimes(2);
    const rowsText = new TextDecoder().decode(rowsChunk.value);
    expect(rowsText.trimEnd().split("\n")).toHaveLength(
      PAYMENT_EXPORT_PAGE_SIZE
    );

    releasePage2?.([]);
    expect((await reader.read()).done).toBe(true);
  });

  it("walks pages with a Prisma cursor, ordered like the list route", async () => {
    const page = Array.from({ length: PAYMENT_EXPORT_PAGE_SIZE }, (_, i) =>
      makePayment({ id: `p${i}` })
    );
    mockFindMany.mockResolvedValueOnce(page).mockResolvedValueOnce([]);

    const res = await exportRequest("?status=COMPLETED&search=invoice");
    await res.text();

    const firstCall = mockFindMany.mock.calls[0][0];
    expect(firstCall).toMatchObject({
      where: {
        userId: "user-1",
        status: "COMPLETED",
        OR: [
          { description: { contains: "invoice" } },
          { memo: { contains: "invoice", mode: "insensitive" } },
          { transactionHash: { equals: "invoice" } },
        ],
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PAYMENT_EXPORT_PAGE_SIZE,
    });
    // No cursor on the first page, and never `skip`-based deep pagination.
    expect(firstCall.cursor).toBeUndefined();
    expect(firstCall.skip).toBeUndefined();

    const secondCall = mockFindMany.mock.calls[1][0];
    expect(secondCall.cursor).toEqual({ id: "p249" });
    expect(secondCall.skip).toBe(1);
  });

  it("stops after a short page instead of querying again", async () => {
    mockFindMany.mockResolvedValueOnce([makePayment()]);

    const res = await exportRequest();
    await res.text();

    expect(mockFindMany).toHaveBeenCalledTimes(1);
  });

  it("serializes every row with a trailing newline and the shared escaper", async () => {
    mockFindMany.mockResolvedValueOnce([
      makePayment({ memo: 'needs, "quoting"' }),
      makePayment({ id: "p2", memo: "=cmd|calc" }),
    ]);

    const res = await exportRequest();
    const chunks = await readChunks(res);
    const text = chunks.join("");

    // One header line + two data rows, terminated by a newline so the file is
    // not left in the middle of a record.
    expect(text.endsWith("\n")).toBe(true);
    expect(text.split("\n")).toHaveLength(4);
    // RFC 4180 quoting for the comma/quote cell.
    expect(text).toContain('"needs, ""quoting"""');
    // OWASP CSV-injection guard for a formula-looking cell.
    expect(text).toContain("'=cmd|calc");
  });

  it("errors the stream when the database fails mid-export", async () => {
    // A *full* first page is what makes the route ask for a second one.
    mockFindMany
      .mockResolvedValueOnce(
        Array.from({ length: PAYMENT_EXPORT_PAGE_SIZE }, (_, i) =>
          makePayment({ id: `p${i}` })
        )
      )
      .mockRejectedValueOnce(new Error("connection terminated"));

    const res = await exportRequest();
    const reader = res.body!.getReader();

    // Header + first page arrive…
    await reader.read();
    await reader.read();

    // …then the stream faults instead of closing, so the client's download
    // fails rather than leaving a file that looks complete.
    await expect(reader.read()).rejects.toThrow("connection terminated");
    expect(mockLoggerError).toHaveBeenCalledWith(
      "Payment export failed mid-stream",
      expect.objectContaining({ reason: "connection terminated" })
    );
  });

  it("does not query at all when the client already disconnected", async () => {
    const controller = new AbortController();
    controller.abort();

    const res = await exportRequest("", controller.signal);
    const chunks = await readChunks(res);

    // Only the header was enqueued; the aborted signal stops the loop before
    // the first page is read, so no work is done for a dead connection.
    expect(chunks.join("")).toBe(
      PAYMENT_EXPORT_COLUMNS.map((c) => c.header).join(",") + "\n"
    );
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("rejects an invalid status filter with a 400 problem document", async () => {
    const res = await exportRequest("?status=BOGUS");

    expect(res.status).toBe(400);
    expect(res.headers.get("Content-Type")).toBe("application/problem+json");
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("no longer caps the export, so nothing is silently withheld", async () => {
    // Two full pages and a short one: the route must deliver all of it.
    const fullPage = (offset: number) =>
      Array.from({ length: PAYMENT_EXPORT_PAGE_SIZE }, (_, i) =>
        makePayment({ id: `p${offset + i}` })
      );
    mockFindMany
      .mockResolvedValueOnce(fullPage(0))
      .mockResolvedValueOnce(fullPage(PAYMENT_EXPORT_PAGE_SIZE))
      .mockResolvedValueOnce([makePayment({ id: "last" })]);

    const res = await exportRequest();
    const text = (await readChunks(res)).join("");

    expect(res.headers.get("X-Export-Truncated")).toBeNull();
    // Header line + 501 data rows + the trailing empty segment after the final
    // newline.
    expect(text.split("\n")).toHaveLength(PAYMENT_EXPORT_PAGE_SIZE * 2 + 3);
  });
});
