// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, type Payment } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  paymentFindMany: vi.fn(),
  auditLogFindMany: vi.fn(),
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    payment: {
      findMany: mocks.paymentFindMany,
    },
    auditLog: {
      findMany: mocks.auditLogFindMany,
    },
  },
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: mocks.getAuthContext,
}));

vi.mock("@/lib/api-auth", () => ({
  withApiAuth: (handler: (req: Request) => Promise<Response>) => handler,
}));

import {
  GET as exportPayments,
  PAYMENT_EXPORT_BATCH_SIZE,
} from "@/app/api/payments/export/route";
import {
  GET as exportAuditLog,
  AUDIT_EXPORT_BATCH_SIZE,
} from "@/app/api/audit-log/export/route";

function makePaymentRow(index: number): Payment {
  const id = `pay_stream_${String(index).padStart(5, "0")}`;
  return {
    id,
    userId: "user_stream_1",
    amount: new Prisma.Decimal("42.5000000"),
    assetCode: "XLM",
    assetIssuer: null,
    description: `Streaming payment #${index}`,
    memo: `memo-${index}`,
    status: "COMPLETED",
    transactionHash: "a".repeat(64),
    stellarOpId: null,
    sourceAccountId: "src_1",
    destAccountId: "dst_1",
    batchId: null,
    recurrenceId: null,
    metadata: null,
    errorMessage: null,
    idempotencyKey: null,
    scheduleRunKey: null,
    createdAt: new Date(1700000000000 + index * 1000),
    updatedAt: new Date(1700000000000 + index * 1000),
    completedAt: null,
    deletedAt: null,
  } as Payment;
}

function makeDbAuditRow(index: number) {
  return {
    id: `audit_stream_${String(index).padStart(5, "0")}`,
    action: "refund:create",
    actor: "user_stream_1",
    target: `target_${index}`,
    details: { index },
    createdAt: new Date(1700000000000 + index * 1000),
  };
}

async function readStreamChunks(res: Response): Promise<string[]> {
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

describe("Streaming Chunked CSV Exports (#1369)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthContext.mockResolvedValue({ userId: "user_stream_1" });
  });

  describe("GET /api/payments/export", () => {
    it("streams CSV header followed by 250-row cursor batches with Transfer-Encoding: chunked", async () => {
      expect(PAYMENT_EXPORT_BATCH_SIZE).toBe(250);
      const allPayments = Array.from({ length: 600 }, (_, i) =>
        makePaymentRow(600 - i)
      );

      mocks.paymentFindMany.mockImplementation(
        async (args: {
          cursor?: { id: string };
          skip?: number;
          take?: number;
        }) => {
          let startIdx = 0;
          if (args.cursor?.id) {
            const idx = allPayments.findIndex((p) => p.id === args.cursor!.id);
            if (idx === -1) return [];
            startIdx = idx + (args.skip ?? 0);
          }
          const take = args.take ?? PAYMENT_EXPORT_BATCH_SIZE;
          return allPayments.slice(startIdx, startIdx + take);
        }
      );

      const res = await exportPayments(
        new Request("http://localhost/api/payments/export?status=COMPLETED")
      );

      expect(res.status).toBe(200);
      expect(res.headers.get("Transfer-Encoding")).toBe("chunked");
      expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
      expect(res.headers.get("Content-Disposition")).toMatch(
        /attachment; filename="ophirpay-payments-\d{4}-\d{2}-\d{2}\.csv"/
      );

      const chunks = await readStreamChunks(res);
      // 1 header chunk + 3 data chunks (250 + 250 + 100)
      expect(chunks).toHaveLength(4);
      expect(chunks[0]).toContain("Payment ID,Amount,Asset Code");

      const fullCsv = chunks.join("").trim();
      const lines = fullCsv.split("\n");
      expect(lines).toHaveLength(601); // 1 header + 600 rows

      // Verify Prisma findMany was called 3 times with cursor pagination
      expect(mocks.paymentFindMany).toHaveBeenCalledTimes(3);
      expect(mocks.paymentFindMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          cursor: { id: "pay_stream_00351" },
          skip: 1,
          take: 250,
        })
      );
      expect(mocks.paymentFindMany).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({
          cursor: { id: "pay_stream_00101" },
          skip: 1,
          take: 250,
        })
      );
    });

    it("halts database cursor queries immediately when the client cancels or disconnects", async () => {
      const allPayments = Array.from({ length: 1000 }, (_, i) =>
        makePaymentRow(1000 - i)
      );

      const controller = new AbortController();
      let batchesFetched = 0;

      mocks.paymentFindMany.mockImplementation(async () => {
        batchesFetched++;
        // Simulate client disconnecting right after the first 250-row batch
        controller.abort();
        return allPayments.slice(0, PAYMENT_EXPORT_BATCH_SIZE);
      });

      const res = await exportPayments(
        new Request("http://localhost/api/payments/export", {
          signal: controller.signal,
        })
      );

      const reader = res.body!.getReader();
      await reader.read(); // read header
      await reader.cancel();

      expect(batchesFetched).toBeLessThanOrEqual(1);
    });
  });

  describe("GET /api/audit-log/export?source=db", () => {
    it("streams CSV header followed by 250-row cursor batches with Transfer-Encoding: chunked", async () => {
      expect(AUDIT_EXPORT_BATCH_SIZE).toBe(250);
      const allAuditRows = Array.from({ length: 520 }, (_, i) =>
        makeDbAuditRow(520 - i)
      );

      mocks.auditLogFindMany.mockImplementation(
        async (args: {
          cursor?: { id: string };
          skip?: number;
          take?: number;
        }) => {
          let startIdx = 0;
          if (args.cursor?.id) {
            const idx = allAuditRows.findIndex((r) => r.id === args.cursor!.id);
            if (idx === -1) return [];
            startIdx = idx + (args.skip ?? 0);
          }
          const take = args.take ?? AUDIT_EXPORT_BATCH_SIZE;
          return allAuditRows.slice(startIdx, startIdx + take);
        }
      );

      const res = await exportAuditLog(
        new Request("http://localhost/api/audit-log/export?source=db")
      );

      expect(res.status).toBe(200);
      expect(res.headers.get("Transfer-Encoding")).toBe("chunked");
      expect(res.headers.get("Content-Disposition")).toMatch(
        /attachment; filename="ophirpay-audit-log-\d{4}-\d{2}-\d{2}\.csv"/
      );

      const chunks = await readStreamChunks(res);
      // 1 header chunk + 3 data chunks (250 + 250 + 20)
      expect(chunks).toHaveLength(4);
      expect(chunks[0]).toBe(
        "ID,Timestamp (Unix),Action,Actor,Target ID,Details\r\n"
      );

      const fullCsv = chunks.join("").trim();
      const lines = fullCsv.split(/\r?\n/);
      expect(lines).toHaveLength(521); // 1 header + 520 rows
      expect(mocks.auditLogFindMany).toHaveBeenCalledTimes(3);
    });
  });
});
