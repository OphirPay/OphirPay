// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/audit-log/route";

vi.mock("@/lib/api-auth", () => ({
  withApiAuth: (handler: (req: Request) => Promise<Response>) => handler,
}));

vi.mock("@/lib/contracts", () => ({
  simulateContractCall: vi.fn(),
  DEFAULT_CONTRACT_ID: "CC_TEST_CONTRACT",
  CHAIN_READ_SOURCE: "G_TEST_SOURCE",
}));

import { simulateContractCall } from "@/lib/contracts";
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

/**
 * Simulate an on-chain ledger: `get_audit_log_count` returns the ledger size
 * and `get_audit_entry` hands back entries in the order the route reads them
 * (highest id first).
 */
function mockLedger(entries: AuditEntry[]) {
  const queue = [...entries].reverse();
  simMock.mockImplementation((_contractId: string, fn: string) => {
    if (fn === "get_audit_log_count") {
      return Promise.resolve({ status: "SIMULATED", returnValue: entries.length });
    }
    if (fn === "get_audit_entry") {
      const e = queue.shift();
      return Promise.resolve({ status: "SIMULATED", returnValue: e ?? null });
    }
    return Promise.resolve({ status: "SIMULATED", returnValue: null });
  });
}

async function get(query = "") {
  return GET(new Request(`http://localhost/api/audit-log${query}`));
}

describe("GET /api/audit-log", () => {
  it("returns all entries and the total when unfiltered", async () => {
    mockLedger([
      baseEntry(1),
      baseEntry(2, { action: "role_granted" }),
      baseEntry(3),
    ]);

    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.map((e: AuditEntry) => e.id)).toEqual([3, 2, 1]);
    expect(body.meta.total).toBe(3);
  });

  it("passes the entry id to get_audit_entry", async () => {
    mockLedger([baseEntry(1)]);

    await get();

    expect(simMock).toHaveBeenCalledWith(
      "CC_TEST_CONTRACT",
      "get_audit_entry",
      "G_TEST_SOURCE",
      [expect.anything()]
    );
  });

  it("only reads the requested page window when unfiltered", async () => {
    const entries = Array.from({ length: 10 }, (_, i) => baseEntry(i + 1));
    mockLedger(entries);

    await get("?limit=3");

    const entryCalls = simMock.mock.calls.filter(
      (c) => c[1] === "get_audit_entry"
    );
    expect(entryCalls).toHaveLength(3);
  });

  it("filters by actor substring, case-insensitively", async () => {
    mockLedger([
      baseEntry(1, { actor: "GABCDEFGH12345678" }),
      baseEntry(2, { actor: "GZZZZZZZ99999999" }),
      baseEntry(3, { actor: "GABCDEFGH87654321" }),
    ]);

    const res = await get("?actor=gabc");
    const body = await res.json();
    expect(body.data.map((e: AuditEntry) => e.id)).toEqual([3, 1]);
    expect(body.meta.total).toBe(2);
  });

  it("filters by exact action type", async () => {
    mockLedger([
      baseEntry(1, { action: "payment_recorded" }),
      baseEntry(2, { action: "role_granted" }),
      baseEntry(3, { action: "payment_recorded" }),
    ]);

    const res = await get("?action=role_granted");
    const body = await res.json();
    expect(body.data.map((e: AuditEntry) => e.id)).toEqual([2]);
    expect(body.meta.total).toBe(1);
  });

  it("filters by an inclusive since/until date range", async () => {
    mockLedger([
      baseEntry(1, { timestamp: 1700000001 }),
      baseEntry(2, { timestamp: 1700000100 }),
      baseEntry(3, { timestamp: 1700000200 }),
    ]);

    const res = await get("?since=1700000050&until=1700000150");
    const body = await res.json();
    expect(body.data.map((e: AuditEntry) => e.id)).toEqual([2]);
    expect(body.meta.total).toBe(1);
  });

  it("paginates over the filtered result set", async () => {
    mockLedger([1, 2, 3, 4, 5].map((id) => baseEntry(id)));

    const res = await get("?action=payment_recorded&page=2&limit=2");
    const body = await res.json();
    // Filtered order (newest first): [5, 4, 3, 2, 1] → page 2 = [3, 2]
    expect(body.data.map((e: AuditEntry) => e.id)).toEqual([3, 2]);
    expect(body.meta.total).toBe(5);
    expect(body.meta.page).toBe(2);
  });

  it("returns an empty page when the ledger is empty", async () => {
    mockLedger([]);

    const res = await get();
    const body = await res.json();
    expect(body.data).toEqual([]);
    expect(body.meta.total).toBe(0);
  });

  it("rejects invalid query params", async () => {
    const res = await get("?limit=500");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });
});
