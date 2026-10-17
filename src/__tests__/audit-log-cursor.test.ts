// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { auditLogQuerySchema } from "@/lib/audit-log";
import { buildAuditLogCursorArgs } from "@/lib/prisma";
import { resetReadCache } from "@/lib/api-cache";

vi.mock("@/lib/api-auth", () => ({
  withApiAuth: (handler: (req: Request) => Promise<Response>) => handler,
}));

vi.mock("@/lib/contracts", () => ({
  simulateContractCall: vi.fn(),
  DEFAULT_CONTRACT_ID: "CC_CURSOR_TEST_CONTRACT",
  CHAIN_READ_SOURCE: "G_CURSOR_TEST_SOURCE",
}));

const mockDbAuditStore: Array<{
  id: string;
  action: string;
  actor: string | null;
  target: string | null;
  details: unknown;
  createdAt: Date;
}> = [];

vi.mock("@/lib/prisma", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/prisma")>();
  return {
    ...actual,
    default: {
      auditLog: {
        findMany: vi.fn(
          async (args: {
            where?: {
              action?: string;
              actor?: { contains?: string };
              target?: string;
              createdAt?: { gte?: Date; lte?: Date };
            };
            orderBy?:
              | Array<{ createdAt?: "asc" | "desc"; id?: "asc" | "desc" }>
              | { createdAt?: "asc" | "desc" };
            cursor?: { id: string };
            skip?: number;
            take?: number;
          }) => {
            let rows = [...mockDbAuditStore];

            if (args.where) {
              if (args.where.action) {
                rows = rows.filter((r) => r.action === args.where!.action);
              }
              if (args.where.actor?.contains) {
                const sub = args.where.actor.contains.toLowerCase();
                rows = rows.filter((r) =>
                  (r.actor ?? "").toLowerCase().includes(sub)
                );
              }
              if (args.where.target) {
                rows = rows.filter((r) => r.target === args.where!.target);
              }
              if (args.where.createdAt?.gte) {
                const minMs = args.where.createdAt.gte.getTime();
                rows = rows.filter((r) => r.createdAt.getTime() >= minMs);
              }
              if (args.where.createdAt?.lte) {
                const maxMs = args.where.createdAt.lte.getTime();
                rows = rows.filter((r) => r.createdAt.getTime() <= maxMs);
              }
            }

            const dir = Array.isArray(args.orderBy)
              ? (args.orderBy[0]?.createdAt ?? "desc")
              : (args.orderBy?.createdAt ?? "desc");

            rows.sort((a, b) => {
              const tDiff = a.createdAt.getTime() - b.createdAt.getTime();
              if (tDiff !== 0) return dir === "asc" ? tDiff : -tDiff;
              return dir === "asc"
                ? a.id.localeCompare(b.id)
                : b.id.localeCompare(a.id);
            });

            let startIdx = 0;
            if (args.cursor?.id) {
              const cursorIdx = rows.findIndex((r) => r.id === args.cursor!.id);
              if (cursorIdx === -1) return [];
              startIdx = cursorIdx + (args.skip ?? 0);
            } else if (args.skip) {
              startIdx = args.skip;
            }

            const take = args.take ?? rows.length;
            return rows.slice(startIdx, startIdx + take);
          }
        ),
        count: vi.fn(async () => mockDbAuditStore.length),
      },
    },
  };
});

import prisma from "@/lib/prisma";
import { simulateContractCall } from "@/lib/contracts";
import { GET } from "@/app/api/audit-log/route";

const simMock = vi.mocked(simulateContractCall);

function seedDbAuditLogs(count = 10) {
  mockDbAuditStore.length = 0;
  for (let i = 1; i <= count; i++) {
    mockDbAuditStore.push({
      id: `audit_cuid_${String(i).padStart(4, "0")}`,
      action: i % 2 === 0 ? "refund:approve" : "refund:create",
      actor: `GACTOR_${i}`,
      target: String(100 + i),
      details: { step: i },
      createdAt: new Date(1700000000000 + i * 1000),
    });
  }
}

function mockContractLedger(totalCount: number) {
  simMock.mockImplementation((_contractId: string, fn: string, _src: string, args?: unknown[]) => {
    if (fn === "get_audit_log_count") {
      return Promise.resolve({ status: "SIMULATED", returnValue: totalCount } as never);
    }
    if (fn === "get_audit_entry") {
      // Extract numeric id from ScVal or fallback
      let id = 1;
      if (args && args[0] && typeof args[0] === "object") {
        const scVal = args[0] as { value?: () => unknown };
        const raw = typeof scVal.value === "function" ? scVal.value() : undefined;
        id = Number(raw ?? 1);
      }
      if (id < 1 || id > totalCount) {
        return Promise.resolve({ status: "SIMULATED", returnValue: null } as never);
      }
      return Promise.resolve({
        status: "SIMULATED",
        returnValue: {
          id,
          timestamp: 1700000000 + id * 60,
          action: id % 2 === 0 ? "escrow_created" : "payment_recorded",
          actor: "GABCDEFGH12345678",
          target_id: id,
          details: `Entry #${id}`,
        },
      } as never);
    }
    return Promise.resolve({ status: "SIMULATED", returnValue: null } as never);
  });
}

describe("Audit Log Cursor-Based Pagination & Sorting (#1361)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await resetReadCache();
    seedDbAuditLogs(8);
  });

  describe("Schema & helper unit tests", () => {
    it("declares composite @@index([createdAt, id]) on AuditLog in prisma/schema.prisma", () => {
      const schema = readFileSync(
        path.join(process.cwd(), "prisma/schema.prisma"),
        "utf8"
      );
      const auditLogModelMatch = schema.match(/model AuditLog\s*\{[\s\S]*?\n\}/);
      expect(auditLogModelMatch).not.toBeNull();
      expect(auditLogModelMatch![0]).toContain("@@index([createdAt, id])");
    });

    it("builds Prisma cursor pagination args with indexed (createdAt, id) orderBy", () => {
      const withCursor = buildAuditLogCursorArgs({
        cursor: "audit_cuid_0005",
        limit: 3,
        order: "desc",
        where: { action: "refund:create" },
      });
      expect(withCursor).toEqual({
        where: { action: "refund:create" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        cursor: { id: "audit_cuid_0005" },
        skip: 1,
        take: 4,
      });

      const withoutCursor = buildAuditLogCursorArgs({
        page: 2,
        limit: 5,
        order: "asc",
      });
      expect(withoutCursor).toEqual({
        where: {},
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        skip: 5,
        take: 6,
      });
    });

    it("supports cursor, order, and sort query parameters in auditLogQuerySchema", () => {
      const p1 = auditLogQuerySchema.safeParse({
        cursor: "audit_cuid_0004",
        limit: "3",
        sort: "asc",
      });
      expect(p1.success).toBe(true);
      expect(p1.data?.cursor).toBe("audit_cuid_0004");
      expect(p1.data?.order).toBe("asc");

      const p2 = auditLogQuerySchema.safeParse({
        order: "desc",
      });
      expect(p2.success).toBe(true);
      expect(p2.data?.order).toBe("desc");

      const invalidSort = auditLogQuerySchema.safeParse({
        sort: "random",
      });
      expect(invalidSort.success).toBe(false);
    });
  });

  describe("Database-backed cursor pagination (source=db)", () => {
    it("navigates deterministically across multiple pages in descending order with { data, nextCursor, hasMore }", async () => {
      const collectedIds: string[] = [];
      let cursor: string | null = null;
      let pages = 0;

      do {
        const qs: string = cursor
          ? `?source=db&limit=3&order=desc&cursor=${encodeURIComponent(cursor)}`
          : `?source=db&limit=3&order=desc`;
        const startMs = performance.now();
        const res: Response = await GET(
          new Request(`http://localhost/api/audit-log${qs}`)
        );
        const elapsedMs = performance.now() - startMs;

        expect(res.status).toBe(200);
        expect(elapsedMs).toBeLessThan(25);

        const body: {
          success: boolean;
          data: Array<{ id: string }>;
          nextCursor: string | null;
          hasMore: boolean;
          meta: { order: string; nextCursor: string | null; hasMore: boolean };
        } = await res.json();
        expect(body.success).toBe(true);
        expect(Array.isArray(body.data)).toBe(true);
        expect(typeof body.hasMore).toBe("boolean");
        expect(body.meta.order).toBe("desc");
        expect(body.meta.nextCursor).toBe(body.nextCursor);
        expect(body.meta.hasMore).toBe(body.hasMore);

        for (const row of body.data) {
          collectedIds.push(row.id);
        }

        cursor = body.nextCursor;
        pages++;
        expect(pages).toBeLessThanOrEqual(5);
      } while (cursor !== null);

      expect(pages).toBe(3); // 8 items with limit=3 -> 3 + 3 + 2
      expect(collectedIds).toEqual([
        "audit_cuid_0008",
        "audit_cuid_0007",
        "audit_cuid_0006",
        "audit_cuid_0005",
        "audit_cuid_0004",
        "audit_cuid_0003",
        "audit_cuid_0002",
        "audit_cuid_0001",
      ]);

      // Verify Prisma findMany was called with cursor: { id } on subsequent pages
      expect(prisma.auditLog.findMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          cursor: { id: "audit_cuid_0006" },
          skip: 1,
          take: 4,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        })
      );
    });

    it("navigates deterministically across multiple pages in ascending order (sort=asc)", async () => {
      const collectedIds: string[] = [];
      let cursor: string | null = null;

      do {
        const qs: string = cursor
          ? `?source=db&limit=3&sort=asc&cursor=${encodeURIComponent(cursor)}`
          : `?source=db&limit=3&sort=asc`;
        const res: Response = await GET(
          new Request(`http://localhost/api/audit-log${qs}`)
        );
        expect(res.status).toBe(200);
        const body: {
          data: Array<{ id: string }>;
          nextCursor: string | null;
        } = await res.json();

        for (const row of body.data) {
          collectedIds.push(row.id);
        }
        cursor = body.nextCursor;
      } while (cursor !== null);

      expect(collectedIds).toEqual([
        "audit_cuid_0001",
        "audit_cuid_0002",
        "audit_cuid_0003",
        "audit_cuid_0004",
        "audit_cuid_0005",
        "audit_cuid_0006",
        "audit_cuid_0007",
        "audit_cuid_0008",
      ]);
    });

    it("prevents pagination drift when new records are inserted between page requests", async () => {
      // Page 1: fetches [0008, 0007, 0006], nextCursor = "audit_cuid_0006"
      const res1 = await GET(
        new Request("http://localhost/api/audit-log?source=db&limit=3&order=desc")
      );
      const page1 = await res1.json();
      expect(page1.data.map((r: { id: string }) => r.id)).toEqual([
        "audit_cuid_0008",
        "audit_cuid_0007",
        "audit_cuid_0006",
      ]);
      expect(page1.hasMore).toBe(true);
      expect(page1.nextCursor).toBe("audit_cuid_0006");

      // Concurrent write: insert a brand-new record (0009) at the head of the log
      mockDbAuditStore.push({
        id: "audit_cuid_0009",
        action: "refund:create",
        actor: "GACTOR_9",
        target: "109",
        details: { step: 9 },
        createdAt: new Date(1700000000000 + 9000),
      });

      // Page 2 using cursor: must NOT repeat 0006! Should return [0005, 0004, 0003]
      const res2 = await GET(
        new Request(
          `http://localhost/api/audit-log?source=db&limit=3&order=desc&cursor=${page1.nextCursor}`
        )
      );
      const page2 = await res2.json();
      expect(page2.data.map((r: { id: string }) => r.id)).toEqual([
        "audit_cuid_0005",
        "audit_cuid_0004",
        "audit_cuid_0003",
      ]);
    });
  });

  describe("On-chain contract cursor pagination (source=contract)", () => {
    it("walks multi-page contract audit log using cursor in desc and asc order", async () => {
      mockContractLedger(7);

      // Descending walk with limit=3 -> [7,6,5], [4,3,2], [1]
      const descIds: number[] = [];
      let cursor: string | null = null;
      do {
        const qs: string = cursor
          ? `?source=contract&limit=3&order=desc&cursor=${cursor}`
          : `?source=contract&limit=3&order=desc`;
        const res: Response = await GET(
          new Request(`http://localhost/api/audit-log${qs}`)
        );
        const body: {
          data: Array<{ id: number }>;
          nextCursor: string | null;
        } = await res.json();
        descIds.push(...body.data.map((e) => e.id));
        cursor = body.nextCursor;
      } while (cursor !== null);

      expect(descIds).toEqual([7, 6, 5, 4, 3, 2, 1]);

      // Ascending walk with limit=3 -> [1,2,3], [4,5,6], [7]
      const ascIds: number[] = [];
      cursor = null;
      do {
        const qs: string = cursor
          ? `?source=contract&limit=3&order=asc&cursor=${cursor}`
          : `?source=contract&limit=3&order=asc`;
        const res: Response = await GET(
          new Request(`http://localhost/api/audit-log${qs}`)
        );
        const body: {
          data: Array<{ id: number }>;
          nextCursor: string | null;
        } = await res.json();
        ascIds.push(...body.data.map((e) => e.id));
        cursor = body.nextCursor;
      } while (cursor !== null);

      expect(ascIds).toEqual([1, 2, 3, 4, 5, 6, 7]);
    });

    it("supports cursor navigation on filtered on-chain queries", async () => {
      mockContractLedger(8); // odd ids (1,3,5,7) have action="payment_recorded"

      const res1 = await GET(
        new Request(
          "http://localhost/api/audit-log?action=payment_recorded&limit=2&order=desc"
        )
      );
      const body1 = await res1.json();
      expect(body1.data.map((e: { id: number }) => e.id)).toEqual([7, 5]);
      expect(body1.hasMore).toBe(true);
      expect(body1.nextCursor).toBe("5");

      const res2 = await GET(
        new Request(
          `http://localhost/api/audit-log?action=payment_recorded&limit=2&order=desc&cursor=${body1.nextCursor}`
        )
      );
      const body2 = await res2.json();
      expect(body2.data.map((e: { id: number }) => e.id)).toEqual([3, 1]);
      expect(body2.hasMore).toBe(false);
      expect(body2.nextCursor).toBeNull();
    });
  });
});
