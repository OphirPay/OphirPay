// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/audit-log/route";
import { decodeCursor } from "@/lib/pagination-utils";

vi.mock("@/lib/api-auth", () => ({
  withApiAuth: (handler: (req: Request) => Promise<Response>) => handler,
}));

vi.mock("@/lib/request-logging", () => ({
  withRequestLogging: (handler: (req: Request) => Promise<Response>) => handler,
  getCurrentRequestId: () => "test-request-id",
}));

const mockAuditLogs = [
  {
    id: "audit_1",
    action: "refund:create",
    actor: "user_alpha",
    target: "ref_1",
    details: { amount: 100 },
    ip: "127.0.0.1",
    createdAt: new Date("2026-08-01T10:00:00.000Z"),
  },
  {
    id: "audit_2",
    action: "refund:approve",
    actor: "user_beta",
    target: "ref_1",
    details: { amount: 100 },
    ip: "127.0.0.1",
    createdAt: new Date("2026-08-01T11:00:00.000Z"),
  },
  {
    id: "audit_3",
    action: "refund:process",
    actor: "user_gamma",
    target: "ref_1",
    details: { txHash: "0x123" },
    ip: "127.0.0.1",
    createdAt: new Date("2026-08-01T12:00:00.000Z"),
  },
  {
    id: "audit_4",
    action: "refund:create",
    actor: "user_alpha",
    target: "ref_2",
    details: { amount: 250 },
    ip: "127.0.0.1",
    createdAt: new Date("2026-08-01T13:00:00.000Z"),
  },
  {
    id: "audit_5",
    action: "refund:approve",
    actor: "user_beta",
    target: "ref_2",
    details: { amount: 250 },
    ip: "127.0.0.1",
    createdAt: new Date("2026-08-01T14:00:00.000Z"),
  },
];

const mockFindMany = vi.fn();
const mockCount = vi.fn();
const mockFindUnique = vi.fn();

vi.mock("@/lib/prisma", () => ({
  default: {
    auditLog: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
      count: (...args: unknown[]) => mockCount(...args),
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
    },
  },
}));

function get(query: string) {
  return GET(new Request(`http://localhost/api/audit-log${query}`));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/audit-log — Cursor-based pagination & sorting (issue #1361)", () => {
  it("returns the first page with nextCursor and hasMore=true", async () => {
    // 5 total items, limit 2: route requests take: 3 to detect hasMore
    const sortedDesc = [...mockAuditLogs].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
    mockFindMany.mockResolvedValueOnce(sortedDesc.slice(0, 3));

    const res = await get("?source=db&limit=2");
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
    expect(body.data[0].id).toBe("audit_5");
    expect(body.data[1].id).toBe("audit_4");
    expect(body.meta.limit).toBe(2);
    expect(body.meta.hasMore).toBe(true);
    expect(body.meta.nextCursor).toBeDefined();

    // Verify nextCursor is a valid decoded payload pointing to audit_4
    const decoded = decodeCursor(body.meta.nextCursor);
    expect(decoded).toEqual({
      createdAt: "2026-08-01T13:00:00.000Z",
      id: "audit_4",
    });
  });

  it("navigates through multi-page sets deterministically without overlaps", async () => {
    const sortedDesc = [...mockAuditLogs].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );

    // Page 1: items [5, 4] with take 3
    mockFindMany.mockResolvedValueOnce(sortedDesc.slice(0, 3));
    const page1Res = await get("?source=db&limit=2");
    const page1 = await page1Res.json();
    expect(page1.data.map((r: { id: string }) => r.id)).toEqual(["audit_5", "audit_4"]);
    expect(page1.meta.hasMore).toBe(true);
    const cursor1 = page1.meta.nextCursor;

    // Page 2: items [3, 2] with take 3
    mockFindMany.mockResolvedValueOnce(sortedDesc.slice(2, 5));
    const page2Res = await get(`?source=db&limit=2&cursor=${cursor1}`);
    const page2 = await page2Res.json();
    expect(page2.data.map((r: { id: string }) => r.id)).toEqual(["audit_3", "audit_2"]);
    expect(page2.meta.hasMore).toBe(true);
    const cursor2 = page2.meta.nextCursor;

    // Verify buildCursorWhere was called for page 2 with cursor1
    expect(mockFindMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              OR: [
                { createdAt: { lt: "2026-08-01T13:00:00.000Z" } },
                {
                  createdAt: "2026-08-01T13:00:00.000Z",
                  id: { lt: "audit_4" },
                },
              ],
            }),
          ]),
        }),
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 3,
      })
    );

    // Page 3: item [1] with take 3 (only 1 row returned => hasMore: false)
    mockFindMany.mockResolvedValueOnce([sortedDesc[4]]);
    const page3Res = await get(`?source=db&limit=2&cursor=${cursor2}`);
    const page3 = await page3Res.json();
    expect(page3.data.map((r: { id: string }) => r.id)).toEqual(["audit_1"]);
    expect(page3.meta.hasMore).toBe(false);
    expect(page3.meta.nextCursor).toBeNull();
  });

  it("supports directional sorting (order=asc) by timestamp", async () => {
    const sortedAsc = [...mockAuditLogs].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
    );

    // Page 1 in ascending order
    mockFindMany.mockResolvedValueOnce(sortedAsc.slice(0, 3));
    const res = await get("?source=db&limit=2&order=asc");
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.map((r: { id: string }) => r.id)).toEqual(["audit_1", "audit_2"]);
    expect(body.meta.hasMore).toBe(true);

    const cursor = body.meta.nextCursor;
    const decoded = decodeCursor(cursor);
    expect(decoded?.id).toBe("audit_2");

    // Next page with order=asc
    mockFindMany.mockResolvedValueOnce(sortedAsc.slice(2, 5));
    const page2Res = await get(`?source=db&limit=2&order=asc&cursor=${cursor}`);
    expect(page2Res.status).toBe(200);

    expect(mockFindMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              OR: [
                { createdAt: { gt: "2026-08-01T11:00:00.000Z" } },
                {
                  createdAt: "2026-08-01T11:00:00.000Z",
                  id: { gt: "audit_2" },
                },
              ],
            }),
          ]),
        }),
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      })
    );
  });

  it("supports raw record ID as cursor via Prisma findUnique anchor", async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: "audit_3",
      createdAt: new Date("2026-08-01T12:00:00.000Z"),
    });
    mockFindMany.mockResolvedValueOnce([]);

    const res = await get("?source=db&limit=2&cursor=audit_3");
    expect(res.status).toBe(200);

    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { id: "audit_3" },
      select: { id: true, createdAt: true },
    });
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              OR: [
                { createdAt: { lt: "2026-08-01T12:00:00.000Z" } },
                {
                  createdAt: "2026-08-01T12:00:00.000Z",
                  id: { lt: "audit_3" },
                },
              ],
            }),
          ]),
        }),
      })
    );
  });

  it("rejects mutual exclusivity violation when cursor and page are both passed", async () => {
    // When page > 1: caught by schema refinement
    const res = await get("?source=db&cursor=some-cursor&page=2");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(JSON.stringify(body.error)).toContain("cursor and page cannot both be used");

    // When page = 1: caught by explicitPage guard in route
    const res1 = await get("?source=db&cursor=some-cursor&page=1");
    expect(res1.status).toBe(400);
    const body1 = await res1.json();
    expect(body1.success).toBe(false);
    expect(JSON.stringify(body1.error)).toContain("cursor and page cannot both be used");
  });

  it("rejects invalid cursor with 400", async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    const res = await get("?source=db&cursor=invalid_non_existent_token");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.message).toContain("Invalid cursor");
  });

  it("preserves legacy offset pagination when explicit page parameter is passed", async () => {
    mockFindMany.mockResolvedValueOnce([mockAuditLogs[0], mockAuditLogs[1]]);
    mockCount.mockResolvedValueOnce(5);

    const res = await get("?source=db&page=1&limit=2");
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data).toHaveLength(2);
    expect(body.meta.page).toBe(1);
    expect(body.meta.limit).toBe(2);
    expect(body.meta.total).toBe(5);
    expect(body.meta.hasMore).toBe(true);
    expect(body.meta.nextCursor).toBeNull();
  });
});
