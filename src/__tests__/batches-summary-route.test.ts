// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockBatchGroupBy,
  mockBatchFindMany,
  mockPaymentGroupBy,
  mockGetAuthContext,
} = vi.hoisted(() => ({
  mockBatchGroupBy: vi.fn(),
  mockBatchFindMany: vi.fn(),
  mockPaymentGroupBy: vi.fn(),
  mockGetAuthContext: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    batch: { groupBy: mockBatchGroupBy, findMany: mockBatchFindMany },
    payment: { groupBy: mockPaymentGroupBy },
  },
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: mockGetAuthContext,
}));

import { GET } from "@/app/api/batches/summary/route";

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthContext.mockResolvedValue({ userId: "user-1" });
});

const BASE_STATUS_GROUPS = [
  { status: "CREATED", _count: { _all: 2 } },
  { status: "PROCESSING", _count: { _all: 1 } },
  { status: "COMPLETED", _count: { _all: 1 } },
];

const BASE_BATCHES = [
  {
    id: "b1",
    name: "Payroll",
    description: null,
    status: "COMPLETED",
    createdAt: new Date("2026-01-02T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
  },
  {
    id: "b2",
    name: "Vendors",
    description: null,
    status: "PARTIALLY_COMPLETED",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  },
];

const BASE_PAYMENT_GROUPS = [
  { batchId: "b1", status: "COMPLETED", _count: { _all: 3 } },
  { batchId: "b2", status: "COMPLETED", _count: { _all: 1 } },
  { batchId: "b2", status: "FAILED", _count: { _all: 1 } },
  { batchId: "b2", status: "CREATED", _count: { _all: 2 } },
];

async function setup(
  statusGroups = BASE_STATUS_GROUPS,
  batches = BASE_BATCHES,
  paymentGroups = BASE_PAYMENT_GROUPS
) {
  mockBatchGroupBy.mockResolvedValue(statusGroups);
  mockBatchFindMany.mockResolvedValue(batches);
  mockPaymentGroupBy.mockResolvedValue(paymentGroups);
  return GET(new Request("http://localhost/api/batches/summary"));
}

describe("GET /api/batches/summary", () => {
  it("requires authentication", async () => {
    mockGetAuthContext.mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/api/batches/summary"));
    expect(res.status).toBe(401);
  });

  it("rolls up batch statuses into counts and scopes to the user", async () => {
    await setup();

    expect(mockBatchGroupBy).toHaveBeenCalledWith({
      by: ["status"],
      where: { userId: "user-1" },
      _count: { _all: true },
    });
    expect(mockBatchFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-1" }, take: 10 })
    );
    expect(mockPaymentGroupBy).toHaveBeenCalledWith({
      by: ["batchId", "status"],
      where: { userId: "user-1", batchId: { not: null } },
      _count: { _all: true },
    });
  });

  it("returns status counts, global progress, and per-batch drill-down", async () => {
    const res = await setup();
    expect(res.status).toBe(200);

    const body = await res.json();
    const data = body.data;

    // Status counts include every BatchStatus (zeroed when unused).
    expect(data.counts).toEqual({
      total: 4,
      CREATED: 2,
      PROCESSING: 1,
      COMPLETED: 1,
      PARTIALLY_COMPLETED: 0,
      FAILED: 0,
    });

    // Global progress derived from the same payment rows as the per-batch data.
    expect(data.progress).toEqual({ total: 7, completed: 4, failed: 1, pending: 2 });

    // Per-batch drill-down mirrors the item-level progress data.
    expect(data.batches).toEqual([
      {
        id: "b1",
        name: "Payroll",
        description: null,
        status: "COMPLETED",
        createdAt: "2026-01-02T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
        paymentCounts: { total: 3, completed: 3, failed: 0, pending: 0 },
      },
      {
        id: "b2",
        name: "Vendors",
        description: null,
        status: "PARTIALLY_COMPLETED",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        paymentCounts: { total: 4, completed: 1, failed: 1, pending: 2 },
      },
    ]);
  });

  it("treats CANCELLED payments as failed in the per-batch counts", async () => {
    const res = await setup(
      [{ status: "PROCESSING", _count: { _all: 1 } }],
      BASE_BATCHES,
      [{ batchId: "b1", status: "CANCELLED", _count: { _all: 2 } }]
    );
    const body = await res.json();
    const b1 = body.data.batches.find((b: { id: string }) => b.id === "b1");
    expect(b1.paymentCounts).toEqual({ total: 2, completed: 0, failed: 2, pending: 0 });
    expect(body.data.progress).toEqual({ total: 2, completed: 0, failed: 2, pending: 0 });
  });

  it("honors the limit param up to 50 for the drill-down list", async () => {
    await setup();
    await GET(new Request("http://localhost/api/batches/summary?limit=25"));
    expect(mockBatchFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 25 })
    );

    // Excessive/invalid values clamp back to defaults.
    await GET(new Request("http://localhost/api/batches/summary?limit=999"));
    expect(mockBatchFindMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ take: 50 })
    );
  });

  it("renders an all-zero summary when nothing exists", async () => {
    const res = await setup([], [], []);
    const body = await res.json();
    expect(body.data.counts).toEqual({
      total: 0,
      CREATED: 0,
      PROCESSING: 0,
      COMPLETED: 0,
      PARTIALLY_COMPLETED: 0,
      FAILED: 0,
    });
    expect(body.data.progress).toEqual({ total: 0, completed: 0, failed: 0, pending: 0 });
    expect(body.data.batches).toEqual([]);
  });

  it("caps an invalid limit to the default of 10", async () => {
    await setup();
    await GET(new Request("http://localhost/api/batches/summary?limit=abc"));
    expect(mockBatchFindMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ take: 10 })
    );
  });
});