// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/audit-log/route";
import { buildPrismaCursorArgs } from "@/lib/prisma";

vi.mock("@/lib/api-auth", () => ({
  withApiAuth: (handler: (req: Request) => Promise<Response>) => handler,
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    auditLog: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
  buildPrismaCursorArgs: vi.fn((options: { cursor?: string; limit?: number; order?: "asc" | "desc" } = {}) => {
    const limit = options.limit ?? 20;
    const order = options.order === "asc" ? "asc" : "desc";
    return {
      take: limit + 1,
      orderBy: [{ createdAt: order }, { id: order }],
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    };
  }),
}));

import prisma from "@/lib/prisma";
const mockAuditLog = vi.mocked(prisma.auditLog);

describe("Audit Log Cursor-Based Pagination (#1361)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("buildPrismaCursorArgs generates correct cursor args with skip: 1 and take: limit + 1", () => {
    const args = buildPrismaCursorArgs({ cursor: "row_123", limit: 10, order: "asc" });
    expect(args).toEqual({
      take: 11,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      cursor: { id: "row_123" },
      skip: 1,
    });
  });

  it("returns first page with nextCursor and hasMore when additional rows exist", async () => {
    const mockRows = [
      {
        id: "log_1",
        action: "refund:create",
        actor: "user_a",
        target: "ref_1",
        details: { amount: 100 },
        createdAt: new Date("2026-10-18T12:00:00Z"),
      },
      {
        id: "log_2",
        action: "refund:create",
        actor: "user_b",
        target: "ref_2",
        details: null,
        createdAt: new Date("2026-10-18T11:00:00Z"),
      },
      {
        id: "log_3", // limit + 1 extra row
        action: "refund:create",
        actor: "user_c",
        target: "ref_3",
        details: null,
        createdAt: new Date("2026-10-18T10:00:00Z"),
      },
    ];

    mockAuditLog.findMany.mockResolvedValue(mockRows as unknown as never);
    mockAuditLog.count.mockResolvedValue(10);

    const req = new Request("http://localhost/api/audit-log?source=db&limit=2&order=desc");
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
    expect(body.data[0].id).toBe("log_1");
    expect(body.data[1].id).toBe("log_2");
    expect(body.hasMore).toBe(true);
    expect(body.nextCursor).toBe("log_2");
    expect(body.meta.hasMore).toBe(true);
    expect(body.meta.nextCursor).toBe("log_2");
  });

  it("navigates to next page using cursor and detects last page termination", async () => {
    const mockRowsPage2 = [
      {
        id: "log_3",
        action: "refund:create",
        actor: "user_c",
        target: "ref_3",
        details: null,
        createdAt: new Date("2026-10-18T10:00:00Z"),
      },
    ];

    mockAuditLog.findMany.mockResolvedValue(mockRowsPage2 as unknown as never);
    mockAuditLog.count.mockResolvedValue(3);

    const req = new Request("http://localhost/api/audit-log?source=db&limit=2&cursor=log_2&order=desc");
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(mockAuditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { id: "log_2" },
        skip: 1,
        take: 3,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      })
    );

    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe("log_3");
    expect(body.hasMore).toBe(false);
    expect(body.nextCursor).toBeNull();
  });

  it("supports chronological ascending sorting (order=asc)", async () => {
    mockAuditLog.findMany.mockResolvedValue([] as unknown as never);
    mockAuditLog.count.mockResolvedValue(0);

    const req = new Request("http://localhost/api/audit-log?source=db&order=asc&limit=10");
    const res = await GET(req);
    expect(res.status).toBe(200);

    expect(mockAuditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      })
    );
  });

  it("returns empty data and hasMore: false when table is empty", async () => {
    mockAuditLog.findMany.mockResolvedValue([]);
    mockAuditLog.count.mockResolvedValue(0);

    const req = new Request("http://localhost/api/audit-log?source=db");
    const res = await GET(req);
    const body = await res.json();

    expect(body.data).toEqual([]);
    expect(body.hasMore).toBe(false);
    expect(body.nextCursor).toBeNull();
  });
});
