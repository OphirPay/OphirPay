// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSimulateContractCall } = vi.hoisted(() => ({
  mockSimulateContractCall: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  withApiAuth: (fn: (request: Request) => Promise<Response>) => fn,
}));

vi.mock("@/lib/request-logging", () => ({
  withRequestLogging: (fn: (request: Request) => Promise<Response>) => fn,
  getCurrentRequestId: () => "test-req-id",
}));

vi.mock("@/lib/contracts", () => ({
  simulateContractCall: mockSimulateContractCall,
  DEFAULT_CONTRACT_ID: "MOCK_CONTRACT_ID",
  CHAIN_READ_SOURCE: "MOCK_CHAIN_READ_SOURCE",
}));

import { GET } from "@/app/api/audit-log/route";

interface MockAuditLogItem {
  id: number;
  timestamp: number;
  action: string;
  actor: string;
  target_id: number;
  details: string;
}

const sampleEntries: MockAuditLogItem[] = [
  {
    id: 1,
    timestamp: 1785542400, // 2026-08-01T00:00:00.000Z
    action: "payment_recorded",
    actor: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    target_id: 101,
    details: "Payment 101 recorded for 100 XLM",
  },
  {
    id: 2,
    timestamp: 1785628800, // 2026-08-02T00:00:00.000Z
    action: "escrow_created",
    actor: "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
    target_id: 102,
    details: "Escrow 102 created for 500 XLM",
  },
  {
    id: 3,
    timestamp: 1785715200, // 2026-08-03T00:00:00.000Z
    action: "contract_paused",
    actor: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    target_id: 0,
    details: "Contract paused by emergency multisig",
  },
  {
    id: 4,
    timestamp: 1785801600, // 2026-08-04T00:00:00.000Z
    action: "payment_recorded",
    actor: "GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD",
    target_id: 104,
    details: "Payment 104 recorded for 25 XLM",
  },
];

function setupContractMock(entries = sampleEntries) {
  mockSimulateContractCall.mockImplementation((_contractId, func, _src, args) => {
    if (func === "get_audit_log_count") {
      return Promise.resolve({
        status: "SIMULATED",
        returnValue: entries.length,
      });
    }
    if (func === "get_audit_entry") {
      const id = args && args[0] ? Number(args[0]._value ?? args[0]) : 1;
      const found = entries.find((e) => e.id === id);
      if (found) {
        return Promise.resolve({
          status: "SIMULATED",
          returnValue: found,
        });
      }
      return Promise.resolve({
        status: "SIMULATION_FAILED",
        returnValue: null,
      });
    }
    return Promise.resolve({ status: "SIMULATED", returnValue: null });
  });
}

describe("GET /api/audit-log", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupContractMock();
  });

  it("returns all entries paginated with default limit and total", async () => {
    const res = await GET(new Request("http://localhost/api/audit-log"));
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.length).toBe(4);
    expect(json.meta.total).toBe(4);
    expect(json.meta.page).toBe(1);
    expect(json.meta.limit).toBe(20);
  });

  it("filters entries by actor", async () => {
    const res = await GET(
      new Request(
        "http://localhost/api/audit-log?actor=GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"
      )
    );
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.length).toBe(2);
    expect(json.meta.total).toBe(2);
    expect(json.data.every((e: MockAuditLogItem) => e.actor.includes("GBBB"))).toBe(true);
  });

  it("filters entries by action type", async () => {
    const res = await GET(
      new Request("http://localhost/api/audit-log?action=payment_recorded")
    );
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.length).toBe(2);
    expect(json.data.every((e: MockAuditLogItem) => e.action === "payment_recorded")).toBe(true);
  });

  it("filters entries by date range (dateFrom and dateTo)", async () => {
    const res = await GET(
      new Request(
        "http://localhost/api/audit-log?dateFrom=2026-08-02&dateTo=2026-08-03"
      )
    );
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    // entries 2 and 3
    expect(json.data.length).toBe(2);
    expect(json.data.map((e: MockAuditLogItem) => e.id)).toEqual([3, 2]);
  });

  it("filters entries by timestamp `since`", async () => {
    const res = await GET(
      new Request("http://localhost/api/audit-log?since=1785700000")
    );
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.length).toBe(2); // entries 3 and 4
  });

  it("filters entries by keyword search", async () => {
    const res = await GET(
      new Request("http://localhost/api/audit-log?search=emergency")
    );
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.length).toBe(1);
    expect(json.data[0].details).toContain("Contract paused by emergency multisig");
  });

  it("composes pagination (page and limit) with filters", async () => {
    const res = await GET(
      new Request(
        "http://localhost/api/audit-log?action=payment_recorded&page=2&limit=1"
      )
    );
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.length).toBe(1);
    expect(json.meta.total).toBe(2);
    expect(json.meta.page).toBe(2);
    expect(json.meta.limit).toBe(1);
  });

  it("returns 400 bad request for invalid query parameters", async () => {
    const res = await GET(
      new Request("http://localhost/api/audit-log?limit=invalid_number")
    );
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error.code).toBe("BAD_REQUEST");
  });

  it("handles contract count simulation failure gracefully", async () => {
    mockSimulateContractCall.mockResolvedValueOnce({
      status: "SIMULATION_FAILED",
      returnValue: null,
    });

    const res = await GET(new Request("http://localhost/api/audit-log"));
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toEqual([]);
    expect(json.meta.total).toBe(0);
  });
});
