// SPDX-License-Identifier: MIT
// Issue #1361: cursor-based pagination and sorting on GET /api/audit-log.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/audit-log/route";
import {
  encodeAuditCursor,
  decodeAuditCursor,
  compareAuditEntries,
  AUDIT_PAGE_MAX,
} from "@/lib/audit-log";

vi.mock("@/lib/api-auth", () => ({
  withApiAuth: (handler: (req: Request) => Promise<Response>) => handler,
}));

vi.mock("@/lib/contracts", () => ({
  simulateContractCall: vi.fn(),
  DEFAULT_CONTRACT_ID: "CC_TEST_CONTRACT",
  CHAIN_READ_SOURCE: "G_TEST_SOURCE",
}));

import { simulateContractCall } from "@/lib/contracts";
import { scValToNative } from "@stellar/stellar-sdk";
const simMock = vi.mocked(simulateContractCall);

beforeEach(() => {
  simMock.mockReset();
});

interface AuditEntry {
  id: number;
  timestamp: number;
  action: string;
  actor: string;
  target_id: number;
  details: string;
}

function baseEntry(id: number, overrides: Partial<AuditEntry> = {}): AuditEntry {
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

function mockLedger(entries: AuditEntry[]) {
  const byId = new Map(entries.map((e) => [e.id, e]));
  simMock.mockImplementation(
    (_contractId: string, fn: string, _src?: unknown, args?: unknown[]) => {
      if (fn === "get_audit_log_count") {
        return Promise.resolve({ status: "SIMULATED", returnValue: entries.length });
      }
      if (fn === "get_audit_entry") {
        const id = Number(scValToNative(args?.[0] as never));
        const e = byId.get(id);
        return Promise.resolve({ status: "SIMULATED", returnValue: e ?? null });
      }
      return Promise.resolve({ status: "SIMULATED", returnValue: null });
    }
  );
}

async function get(query = "") {
  return GET(new Request(`http://localhost/api/audit-log${query}`));
}

describe("audit-log cursor pagination (#1361)", () => {
  it("round-trips a cursor through encode/decode", () => {
    const e = baseEntry(7);
    const cur = decodeAuditCursor(encodeAuditCursor(e, "timestamp"));
    expect(cur).toEqual({ v: e.timestamp, id: 7 });
  });

  it("rejects a malformed cursor", () => {
    expect(decodeAuditCursor("!!!not-base64url!!!")).toBeNull();
    expect(decodeAuditCursor(Buffer.from('{"id":"x"}').toString("base64url"))).toBeNull();
  });

  it("compares entries stably with id tiebreaker", () => {
    const a = { ...baseEntry(1), timestamp: 100 };
    const b = { ...baseEntry(2), timestamp: 100 };
    // Same key → id tiebreaker decides; stable in both directions.
    expect(compareAuditEntries(a, b, "timestamp", "asc")).toBeLessThan(0);
    expect(compareAuditEntries(b, a, "timestamp", "asc")).toBeGreaterThan(0);
    expect(compareAuditEntries(a, b, "timestamp", "desc")).toBeGreaterThan(0);
  });

  it("returns the first page with a nextCursor when more remain", async () => {
    mockLedger(Array.from({ length: 10 }, (_, i) => baseEntry(i + 1)));

    const res = await get("?sort=id&limit=4");
    const body = await res.json();
    expect(res.status).toBe(200);
    // Descending id order (default): newest first.
    expect(body.data.map((e: AuditEntry) => e.id)).toEqual([10, 9, 8, 7]);
    expect(body.meta.hasMore).toBe(true);
    expect(typeof body.meta.nextCursor).toBe("string");
  });

  it("resumes after the cursor without repeating rows", async () => {
    mockLedger(Array.from({ length: 10 }, (_, i) => baseEntry(i + 1)));

    const first = await (await get("?sort=id&limit=4")).json();
    const second = await (await get(`?sort=id&limit=4&cursor=${first.meta.nextCursor}`)).json();
    const firstIds = first.data.map((e: AuditEntry) => e.id);
    const secondIds = second.data.map((e: AuditEntry) => e.id);
    expect(secondIds).toEqual([6, 5, 4, 3]);
    expect(secondIds.some((id: number) => firstIds.includes(id))).toBe(false);
  });

  it("reaches the last page with hasMore=false and no nextCursor", async () => {
    mockLedger(Array.from({ length: 10 }, (_, i) => baseEntry(i + 1)));

    const first = await (await get("?sort=id&limit=4")).json();
    const second = await (await get(`?sort=id&limit=4&cursor=${first.meta.nextCursor}`)).json();
    const third = await (await get(`?sort=id&limit=4&cursor=${second.meta.nextCursor}`)).json();
    expect(third.data.map((e: AuditEntry) => e.id)).toEqual([2, 1]);
    expect(third.meta.hasMore).toBe(false);
    expect(third.meta.nextCursor).toBeNull();
  });

  it("rejects an invalid cursor with a 400", async () => {
    mockLedger([baseEntry(1)]);
    const res = await get("?cursor=%24%24bogus%24%24");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it("rejects a non-allowlisted sort field via Zod", async () => {
    mockLedger([baseEntry(1)]);
    const res = await get("?sort=details");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it("rejects an invalid order via Zod", async () => {
    mockLedger([baseEntry(1)]);
    const res = await get("?order=updown&cursor=x");
    expect(res.status).toBe(400);
  });

  it("caps limit at AUDIT_PAGE_MAX", async () => {
    mockLedger(Array.from({ length: 10 }, (_, i) => baseEntry(i + 1)));
    // limit is validated by Zod: >100 (AUDIT_PAGE_MAX) is rejected with 400.
    const tooBig = await get("?limit=5000");
    expect(tooBig.status).toBe(400);
    const body = await (await get("?limit=5000")).json().catch(() => null);
    void body;
    const res = await get("?sort=id&limit=10");
    const page = await res.json();
    expect(res.status).toBe(200);
    expect(page.data.length).toBeLessThanOrEqual(AUDIT_PAGE_MAX);
    expect(page.data.map((e: AuditEntry) => e.id)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  });

  it("sorts by timestamp ascending across pages", async () => {
    mockLedger([
      baseEntry(1, { timestamp: 1700000003 }),
      baseEntry(2, { timestamp: 1700000001 }),
      baseEntry(3, { timestamp: 1700000002 }),
    ]);

    const first = await (await get("?sort=timestamp&order=asc&limit=2")).json();
    expect(first.data.map((e: AuditEntry) => e.id)).toEqual([2, 3]);
    const second = await (await get(`?sort=timestamp&order=asc&limit=2&cursor=${first.meta.nextCursor}`)).json();
    expect(second.data.map((e: AuditEntry) => e.id)).toEqual([1]);
    expect(second.meta.hasMore).toBe(false);
  });

  it("sorts by actor with id tiebreaker on collisions", async () => {
    mockLedger([
      baseEntry(3, { actor: "GSAME" }),
      baseEntry(1, { actor: "GSAME" }),
      baseEntry(2, { actor: "GAAA" }),
    ]);

    const res = await get("?sort=actor&order=asc&limit=10");
    const body = await res.json();
    expect(body.data.map((e: AuditEntry) => e.id)).toEqual([2, 1, 3]);
  });

  it("keeps the legacy page mode working", async () => {
    mockLedger(Array.from({ length: 6 }, (_, i) => baseEntry(i + 1)));
    const res = await get("?page=2&limit=2");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.map((e: AuditEntry) => e.id)).toEqual([4, 3]);
    expect(body.meta.page).toBe(2);
  });
});
