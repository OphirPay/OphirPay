// SPDX-License-Identifier: MIT

/**
 * Streaming CSV export of the audit log (issue #720).
 *
 * The route streams rows out of a `ReadableStream` instead of building one
 * in-memory string, so the interesting behaviour lives in the streaming path:
 * the header must appear exactly once, rows must survive chunk boundaries, and
 * both a source failure and a client disconnect must be handled explicitly
 * instead of by closing the stream early.
 *
 * By default the mocked iterator delegates to the *real* one, so most tests
 * drive the production pipeline end to end; individual tests override it to
 * simulate a source that throws mid-stream or to observe iterator release.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseCsvText } from "@/lib/csv-import";

const mocks = vi.hoisted(() => ({
  iterateAuditLogEntries: vi.fn(),
  simulateContractCall: vi.fn(),
  loggerError: vi.fn(),
  realIterateAuditLogEntries: null as null | ((...args: never[]) => unknown),
}));

vi.mock("@/lib/api-auth", () => ({
  withApiAuth: (handler: (req: Request) => Promise<Response>) => handler,
}));

vi.mock("@/lib/contracts", () => ({
  simulateContractCall: mocks.simulateContractCall,
  DEFAULT_CONTRACT_ID: "CC_TEST_CONTRACT",
  CHAIN_READ_SOURCE: "G_TEST_SOURCE",
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: mocks.loggerError,
    request: vi.fn(),
    metric: vi.fn(),
    timing: vi.fn(),
  },
}));

vi.mock("@/lib/audit-log", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audit-log")>();
  mocks.realIterateAuditLogEntries = actual.iterateAuditLogEntries as never;
  return { ...actual, iterateAuditLogEntries: mocks.iterateAuditLogEntries };
});

import { GET } from "@/app/api/audit-log/export/route";
import type { AuditLogEntry } from "@/lib/audit-log";

const simMock = mocks.simulateContractCall;
const iterateMock = mocks.iterateAuditLogEntries;

const HEADER_CELLS = [
  "ID",
  "Timestamp (Unix)",
  "Action",
  "Actor",
  "Target ID",
  "Details",
];

const HEADER_LINE = "ID,Timestamp (Unix),Action,Actor,Target ID,Details\r\n";

function baseEntry(id: number, overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id,
    timestamp: 1700000000 + id,
    action: "payment_recorded",
    actor: "GABCDEFGH12345678",
    target_id: id,
    details: `Payment #${id} recorded`,
    ...overrides,
  };
}

/**
 * Fake on-chain ledger for the *real* iterator: `get_audit_log_count` reports
 * the ledger size and `get_audit_entry` hands entries back in the order the
 * iterator reads them (ids are walked highest-first by default).
 */
function mockLedger(entries: AuditLogEntry[]) {
  const queue = [...entries].reverse();
  simMock.mockImplementation((_contractId: string, fn: string) => {
    if (fn === "get_audit_log_count") {
      return Promise.resolve({ status: "SIMULATED", returnValue: entries.length });
    }
    if (fn === "get_audit_entry") {
      return Promise.resolve({ status: "SIMULATED", returnValue: queue.shift() ?? null });
    }
    return Promise.resolve({ status: "SIMULATED", returnValue: null });
  });
}

function exportRequest(query = "", signal?: AbortSignal) {
  return GET(new Request(`http://localhost/api/audit-log/export${query}`, { signal }));
}

/** Read the response body chunk by chunk, exactly as a browser would. */
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

beforeEach(() => {
  simMock.mockReset();
  mocks.loggerError.mockReset();
  iterateMock.mockReset();
  // Default to the real iterator so the tests exercise the production path.
  iterateMock.mockImplementation((...args: unknown[]) =>
    (mocks.realIterateAuditLogEntries as (...a: unknown[]) => unknown)(...args)
  );
});

describe("GET /api/audit-log/export — streaming behaviour", () => {
  it("streams the header exactly once and every row over multiple source batches", async () => {
    // 12 entries > the iterator's 10-entry batch size, so the source really
    // does span more than one chunk of on-chain reads.
    const entries = Array.from({ length: 12 }, (_, i) => baseEntry(i + 1));
    mockLedger(entries);

    const res = await exportRequest();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toMatch(
      /attachment; filename="ophirpay-audit-log-\d{4}-\d{2}-\d{2}\.csv"/
    );

    const body = await res.text();

    // Header appears exactly once, at the very start.
    expect(body.startsWith(HEADER_LINE)).toBe(true);
    expect(body.split("ID,Timestamp (Unix)").length - 1).toBe(1);

    const rows = parseCsvText(body);
    expect(rows[0]).toEqual(HEADER_CELLS);
    expect(rows).toHaveLength(entries.length + 1);
    // Default order is newest-first.
    expect(rows.slice(1).map((r) => Number(r[0]))).toEqual([
      12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1,
    ]);
  });

  it("round-trips a field containing a comma and a quote", async () => {
    const tricky = 'Payment, "quoted" #3';
    mockLedger([baseEntry(1, { details: tricky })]);

    const body = await (await exportRequest()).text();

    // Doubled-up quotes on the wire…
    expect(body).toContain('"Payment, ""quoted"" #3"');
    // …and intact after a round trip through the project's CSV parser.
    const rows = parseCsvText(body);
    expect(rows[1]).toEqual([
      "1",
      "1700000001",
      "payment_recorded",
      "GABCDEFGH12345678",
      "1",
      tricky,
    ]);
  });

  it("keeps each row inside a single chunk so a quoted field is never split", async () => {
    const entries = [
      baseEntry(1, { details: 'comma, and "quote" and\na newline' }),
      baseEntry(2, { details: "plain" }),
      baseEntry(3, { details: "trailing,comma," }),
    ];
    mockLedger(entries);

    const chunks = await readChunks(await exportRequest());

    // First chunk is the header; every following chunk is one whole row.
    expect(chunks[0]).toBe(HEADER_LINE);
    for (const chunk of chunks.slice(1)) {
      expect(chunk.endsWith("\r\n")).toBe(true);
      // The row terminator travels in the same chunk as the row it ends, so a
      // consumer can split on CRLF without reassembling a quoted field.
      expect(chunk.slice(0, -2)).not.toContain("\r\n");
    }

    // Reassembling the chunks (whatever the boundaries) parses back exactly.
    const rows = parseCsvText(chunks.join(""));
    expect(rows).toHaveLength(entries.length + 1);

    const detailsById = new Map(rows.slice(1).map((row) => [row[0], row[5]]));
    expect(detailsById.get("1")).toBe('comma, and "quote" and\na newline');
    expect(detailsById.get("2")).toBe("plain");
    expect(detailsById.get("3")).toBe("trailing,comma,");
  });

  it("emits only the header for an empty ledger", async () => {
    mockLedger([]);

    const body = await (await exportRequest()).text();

    expect(body).toBe(HEADER_LINE);
    expect(parseCsvText(body)).toEqual([HEADER_CELLS]);
  });

  it("applies the same filters as the list endpoint", async () => {
    mockLedger([
      baseEntry(1, { action: "payment_recorded" }),
      baseEntry(2, { action: "role_granted" }),
      baseEntry(3, { action: "role_granted" }),
    ]);

    const rows = parseCsvText(
      await (await exportRequest("?action=role_granted")).text()
    );

    expect(rows.slice(1).map((r) => r[0])).toEqual(["3", "2"]);
  });

  it("rejects invalid query params before opening the stream", async () => {
    const res = await exportRequest("?since=2026-01-02&until=2026-01-01");

    expect(res.status).toBe(400);
    expect((await res.json()).success).toBe(false);
    expect(simMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/audit-log/export — failure modes", () => {
  it("errors the stream when the source throws mid-stream instead of truncating it", async () => {
    // Two good rows, then the source explodes.
    iterateMock.mockImplementation(() =>
      (async function* () {
        yield baseEntry(1);
        yield baseEntry(2);
        throw new Error("contract read exploded");
      })()
    );

    const res = await exportRequest();
    // The status line and headers are already flushed, so the failure has to
    // surface on the body: a truncated-but-parseable CSV would look like a
    // complete export.
    expect(res.status).toBe(200);
    await expect(res.text()).rejects.toThrow("contract read exploded");

    expect(mocks.loggerError).toHaveBeenCalledWith(
      "Audit log export failed mid-stream",
      expect.objectContaining({ reason: "contract read exploded" })
    );
  });

  it("does not report a mid-stream failure caused by the client aborting", async () => {
    const controller = new AbortController();
    iterateMock.mockImplementation(() =>
      (async function* () {
        yield baseEntry(1);
        // The client is gone by the time the next read would fail…
        controller.abort();
        throw new Error("read cancelled");
      })()
    );

    const res = await exportRequest("", controller.signal);
    const body = await res.text();

    // …so the disconnect is not logged as an export failure.
    expect(mocks.loggerError).not.toHaveBeenCalled();
    expect(body.startsWith(HEADER_LINE)).toBe(true);
  });

  it("releases the source iterator when the client disconnects", async () => {
    let markReleased!: () => void;
    const released = new Promise<void>((resolve) => {
      markReleased = resolve;
    });
    let interrupted = false;

    let produced = 0;
    iterateMock.mockImplementation(() =>
      (async function* () {
        try {
          let id = 0;
          // Far more rows than the run could ever drain in the test window, so
          // the source can only stop early if it is actually released.
          while (id < 1_000_000) {
            id += 1;
            produced += 1;
            yield baseEntry(id);
          }
        } finally {
          interrupted = true;
          markReleased();
        }
      })()
    );

    const controller = new AbortController();
    const res = await exportRequest("", controller.signal);

    // Start consuming so the handler is inside the streaming loop…
    const reader = res.body!.getReader();
    await reader.read();

    // …then the client goes away. Nobody reads the body again: the source has
    // to be released on the disconnect itself, not on a failed write.
    const producedAtAbort = produced;
    controller.abort();

    const outcome = await Promise.race([
      released.then(() => "released" as const),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 2_000)),
    ]);

    expect(outcome).toBe("released");
    expect(interrupted).toBe(true);
    // Released promptly rather than drained: the generator stops within a row
    // or two of the disconnect instead of running to exhaustion.
    expect(produced - producedAtAbort).toBeLessThan(50);
  });
});
