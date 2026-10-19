// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFindMany, mockCount } = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockCount: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    auditLog: {
      findMany: mockFindMany,
      count: mockCount,
    },
  },
}));

vi.mock("@/lib/api-auth", () => ({
  withApiAuth: (handler: (req: Request) => Promise<Response>) => handler,
}));

vi.mock("@/lib/request-logging", () => ({
  withRequestLogging: (handler: (req: Request) => Promise<Response>) => handler,
  getCurrentRequestId: () => "test-request-id",
}));

import { GET } from "@/app/api/audit-log/route";

function makeAuditLog(id: string, createdAt: Date, overrides: Record<string, unknown> = {}) {
  return {
    id,
    action: "refund:create",
    actor: "user_alice",
    target: "ref_100",
    details: JSON.stringify({ amount: 100 }),
    ip: "127.0.0.1",
    createdAt,
    ...overrides,
  };
}

describe("GET /api/audit-log — Keyset & Cursor-Based Pagination (Issue #1361)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCount.mockResolvedValue(100);
  });

  it("returns initial page with standardized { data, nextCursor, hasMore } payload", async () => {
    const t0 = new Date("2026-10-18T10:00:00Z");
    const t1 = new Date("2026-10-18T09:50:00Z");
    const t2 = new Date("2026-10-18T09:40:00Z");

    // limit = 2, so route queries take: 3. Returning 3 rows indicates hasMore = true.
    mockFindMany.mockResolvedValue([
      makeAuditLog("audit_1", t0),
      makeAuditLog("audit_2", t1),
      makeAuditLog("audit_3", t2),
    ]);

    const req = new Request("http://localhost/api/audit-log?source=db&limit=2&order=desc");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();

    // Standardized payload verification
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
    expect(body.data[0].id).toBe("audit_1");
    expect(body.data[1].id).toBe("audit_2");
    expect(body.nextCursor).toBe("audit_2");
    expect(body.hasMore).toBe(true);

    // Meta compatibility
    expect(body.meta.nextCursor).toBe("audit_2");
    expect(body.meta.hasMore).toBe(true);
    expect(body.meta.total).toBe(100);

    // Prisma query arguments verification
    expect(mockFindMany).toHaveBeenCalledWith({
      where: {},
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 3,
    });
  });

  it("navigates to next page using cursor without row overlap", async () => {
    const t2 = new Date("2026-10-18T09:40:00Z");
    const t3 = new Date("2026-10-18T09:30:00Z");
    const t4 = new Date("2026-10-18T09:20:00Z");

    mockFindMany.mockResolvedValue([
      makeAuditLog("audit_3", t2),
      makeAuditLog("audit_4", t3),
      makeAuditLog("audit_5", t4),
    ]);

    const req = new Request("http://localhost/api/audit-log?source=db&limit=2&cursor=audit_2&order=desc");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data).toHaveLength(2);
    expect(body.data[0].id).toBe("audit_3");
    expect(body.data[1].id).toBe("audit_4");
    expect(body.nextCursor).toBe("audit_4");
    expect(body.hasMore).toBe(true);

    // Verify Prisma received cursor and skip: 1
    expect(mockFindMany).toHaveBeenCalledWith({
      where: {},
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      cursor: { id: "audit_2" },
      skip: 1,
      take: 3,
    });
  });

  it("reports last page with nextCursor=null and hasMore=false when rows <= limit", async () => {
    const t5 = new Date("2026-10-18T09:10:00Z");

    // Only 1 row returned for limit = 2
    mockFindMany.mockResolvedValue([makeAuditLog("audit_5", t5)]);

    const req = new Request("http://localhost/api/audit-log?source=db&limit=2&cursor=audit_4&order=desc");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe("audit_5");
    expect(body.nextCursor).toBeNull();
    expect(body.hasMore).toBe(false);
    expect(body.meta.nextCursor).toBeNull();
    expect(body.meta.hasMore).toBe(false);
  });

  it("handles empty database table returning empty array and hasMore=false", async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    const req = new Request("http://localhost/api/audit-log?source=db&limit=10");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data).toEqual([]);
    expect(body.nextCursor).toBeNull();
    expect(body.hasMore).toBe(false);
    expect(body.meta.total).toBe(0);
  });

  it("supports ascending directional sorting by timestamp and id", async () => {
    mockFindMany.mockResolvedValue([
      makeAuditLog("audit_1", new Date("2026-10-18T01:00:00Z")),
      makeAuditLog("audit_2", new Date("2026-10-18T02:00:00Z")),
    ]);

    const req = new Request("http://localhost/api/audit-log?source=db&limit=2&order=asc");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.meta.order).toBe("asc");
    expect(mockFindMany).toHaveBeenCalledWith({
      where: {},
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 3,
    });
  });

  it("combines filters with cursor-based pagination seamlessly", async () => {
    mockFindMany.mockResolvedValue([
      makeAuditLog("audit_10", new Date("2026-10-18T05:00:00Z"), { action: "refund:approve", actor: "admin_bob" }),
    ]);

    const req = new Request(
      "http://localhost/api/audit-log?source=db&action=refund:approve&actor=bob&limit=5&cursor=audit_9"
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(mockFindMany).toHaveBeenCalledWith({
      where: {
        action: "refund:approve",
        actor: { contains: "bob" },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      cursor: { id: "audit_9" },
      skip: 1,
      take: 6,
    });
  });
});
