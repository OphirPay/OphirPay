// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("@/lib/prisma", () => ({
  default: {
    payment: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    batch: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
    paymentRequest: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(async (cb: ((tx: unknown) => Promise<unknown>) | Promise<unknown>[]) =>
      typeof cb === "function" ? cb(prisma) : Promise.all(cb)
    ),
  },
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/webhook-dispatcher", () => ({
  dispatchWebhookEventAsync: vi.fn(),
}));

vi.mock("@/lib/metrics-counters", () => ({
  incMetric: vi.fn(),
  recordEndpointLatency: vi.fn(),
}));

vi.mock("@/lib/contracts", () => ({
  DEFAULT_CONTRACT_ID: "CDAVU2XJ7C2Y52GRJZKRG3HDI7AJ2K2FHAFH5FPDTSUQAV7XNBQNNVAN",
  CHAIN_READ_SOURCE: "GACNKEDGJYLLVQDXWYEEPB47Y3JEV5JNZ3RQANTJIVKKEOXX4NC4YWHU",
  // Mirrors MAX_READER_ENTRIES in contracts/ophirpay/src/lib.rs (#742).
  CONTRACT_READER_ENTRY_CAP: 100,
  simulateContractCall: vi.fn(),
}));

import prisma from "@/lib/prisma";
import * as authSession from "@/lib/auth-session";
import * as webhookDispatcher from "@/lib/webhook-dispatcher";
import { GET as getPayments, POST as postPayments } from "@/app/api/payments/route";
import {
  GET as getPaymentById,
  PATCH as patchPaymentById,
  DELETE as deletePaymentById,
} from "@/app/api/payments/[id]/route";
import { GET as getBatches, POST as postBatches } from "@/app/api/batches/route";
import { GET as getBatchById } from "@/app/api/batches/[id]/route";
import { GET as getRequests, POST as postRequests } from "@/app/api/requests/route";
import { generateCsrfToken } from "@/lib/csrf";
import { CONTRACT_READER_ENTRY_CAP } from "@/lib/contracts";
import { invalidateCaches } from "@/lib/api-cache";

// Keep the real cache behaviour, but observe the invalidation calls a mutation
// makes (#741).
vi.mock("@/lib/api-cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-cache")>();
  return {
    ...actual,
    invalidateCache: vi.fn(actual.invalidateCache),
    invalidateCaches: vi.fn(actual.invalidateCaches),
  };
});

function csrfHeaders(): Record<string, string> {
  const token = generateCsrfToken();
  return { "x-csrf-token": token, cookie: `__Host-csrf=${token}` };
}

function mutatingRequest(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

const MOCK_AUTH = {
  userId: "user_123",
  publicKey: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
};

describe("API Routes: Payments, Batches & Requests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("/api/payments", () => {
    it("GET returns 401 when unauthenticated", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(null);
      const res = await getPayments(new Request("http://localhost/api/payments"));
      expect(res.status).toBe(401);
    });

    it("GET returns 400 when query params are invalid", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      const res = await getPayments(new Request("http://localhost/api/payments?limit=-5"));
      expect(res.status).toBe(400);
    });

    it("GET returns paginated payments with filters", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      const mockPayments = [{ id: "p1", amount: 100, status: "COMPLETED" }];
      vi.mocked(prisma.payment.findMany).mockResolvedValueOnce(mockPayments as never);
      vi.mocked(prisma.payment.count).mockResolvedValueOnce(1);

      const res = await getPayments(
        new Request("http://localhost/api/payments?page=1&limit=10&status=COMPLETED&search=test")
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data).toHaveLength(1);
      expect(data.meta.total).toBe(1);
      expect(data.meta.page).toBe(1);
    });

    it("POST returns 401 when unauthenticated", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(null);
      const res = await postPayments(
        mutatingRequest("http://localhost/api/payments", "POST", { amount: "10" })
      );
      expect(res.status).toBe(401);
    });

    it("POST returns 400 when validation fails", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      const res = await postPayments(
        mutatingRequest("http://localhost/api/payments", "POST", { amount: "invalid-amount" })
      );
      expect(res.status).toBe(400);
    });

    it("POST creates a new payment record and dispatches webhook", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      const mockCreated = {
        id: "p_new_1",
        amount: 25.5,
        assetCode: "XLM",
        status: "CREATED",
        createdAt: new Date(),
        userId: MOCK_AUTH.userId,
      };
      vi.mocked(prisma.payment.create).mockResolvedValueOnce(mockCreated as never);

      const res = await postPayments(
        mutatingRequest("http://localhost/api/payments", "POST", {
          amount: 25.5,
          sourceAccountId: "source_acc_1",
          destAddress: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
          assetCode: "XLM",
          description: "Service fee",
        })
      );
      expect(res.status).toBe(201);

      // Payment creation invalidates the read caches it changes (#741):
      // aggregate stats, this user's analytics, and the audit ledger.
      expect(vi.mocked(invalidateCaches)).toHaveBeenCalledWith([
        { scope: "stats" },
        { scope: "analytics", subject: MOCK_AUTH.userId },
        { scope: "audit-log" },
      ]);

      const data = await res.json();
      expect(data.data.id).toBe("p_new_1");
      expect(webhookDispatcher.dispatchWebhookEventAsync).toHaveBeenCalled();
    });
  });

  describe("/api/payments/[id]", () => {
    it("GET returns 401 when unauthenticated", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(null);
      const res = await getPaymentById(new Request("http://localhost/api/payments/cabcdefghijklmnopqrstuvwx"), {
        params: Promise.resolve({ id: "cabcdefghijklmnopqrstuvwx" }),
      });
      expect(res.status).toBe(401);
    });

    it("GET returns 404 when payment is not found or not owned by user", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(prisma.payment.findFirst).mockResolvedValueOnce(null);

      const res = await getPaymentById(new Request("http://localhost/api/payments/cabcdefghijklmnopqrstuvwx"), {
        params: Promise.resolve({ id: "cabcdefghijklmnopqrstuvwx" }),
      });
      expect(res.status).toBe(404);
    });

    it("GET returns payment detail for owner", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      const mockPayment = { id: "cabcdefghijklmnopqrstuvwx", amount: 100, status: "CONFIRMED" };
      vi.mocked(prisma.payment.findFirst).mockResolvedValueOnce(mockPayment as never);

      const res = await getPaymentById(new Request("http://localhost/api/payments/cabcdefghijklmnopqrstuvwx"), {
        params: Promise.resolve({ id: "cabcdefghijklmnopqrstuvwx" }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.id).toBe("cabcdefghijklmnopqrstuvwx");
    });

    it("PATCH updates payment status and triggers webhooks", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(prisma.payment.updateMany).mockResolvedValueOnce({ count: 1 });
      const updatedPayment = {
        id: "cabcdefghijklmnopqrstuvwx",
        status: "COMPLETED",
        amount: 50,
        assetCode: "XLM",
        completedAt: new Date(),
      };
      vi.mocked(prisma.payment.findUnique).mockResolvedValueOnce(updatedPayment as never);

      const res = await patchPaymentById(
        mutatingRequest("http://localhost/api/payments/cabcdefghijklmnopqrstuvwx", "PATCH", { status: "COMPLETED", memo: "settled" }),
        { params: Promise.resolve({ id: "cabcdefghijklmnopqrstuvwx" }) }
      );
      expect(res.status).toBe(200);
      expect(webhookDispatcher.dispatchWebhookEventAsync).toHaveBeenCalled();
    });

    it("PATCH returns 404 when payment does not exist", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(prisma.payment.updateMany).mockResolvedValueOnce({ count: 0 });

      const res = await patchPaymentById(
        mutatingRequest("http://localhost/api/payments/cabcdefghijklmnopqrstuvwz", "PATCH", { status: "SIGNED" }),
        { params: Promise.resolve({ id: "cabcdefghijklmnopqrstuvwz" }) }
      );
      expect(res.status).toBe(404);
    });

    it("DELETE removes payment record", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(prisma.payment.updateMany).mockResolvedValueOnce({ count: 1 });

      const res = await deletePaymentById(
        mutatingRequest("http://localhost/api/payments/cabcdefghijklmnopqrstuvwx", "DELETE"),
        {
          params: Promise.resolve({ id: "cabcdefghijklmnopqrstuvwx" }),
        }
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.deleted).toBe(true);
    });

    it("DELETE returns 404 when payment is not found", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(prisma.payment.updateMany).mockResolvedValueOnce({ count: 0 });

      const res = await deletePaymentById(
        mutatingRequest("http://localhost/api/payments/cabcdefghijklmnopqrstuvwx", "DELETE"),
        {
          params: Promise.resolve({ id: "cabcdefghijklmnopqrstuvwx" }),
        }
      );
      expect(res.status).toBe(404);
    });
  });

  describe("/api/batches", () => {
    it("GET returns paginated batches", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      const mockBatches = [{ id: "b1", name: "Payroll", payments: [] }];
      vi.mocked(prisma.batch.findMany).mockResolvedValueOnce(mockBatches as never);
      vi.mocked(prisma.batch.count).mockResolvedValueOnce(1);

      const res = await getBatches(
        new Request("http://localhost/api/batches?page=1&limit=5&status=PENDING&search=Pay")
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data).toHaveLength(1);
      // Child payments stay below the shared reader cap → not truncated (#742).
      expect(data.data[0].paymentsTruncated).toBe(false);
      expect(data.meta.truncated).toBe(false);
    });

    it("GET caps each batch's payments and surfaces the flag (#742)", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      // The route fetches cap + 1 child payments to detect an over-cap batch.
      const overflow = CONTRACT_READER_ENTRY_CAP + 1;
      const mockBatches = [
        {
          id: "b1",
          name: "Legacy payroll",
          payments: Array.from({ length: overflow }, (_, i) => ({ id: `p${i}` })),
        },
      ];
      vi.mocked(prisma.batch.findMany).mockResolvedValueOnce(mockBatches as never);
      vi.mocked(prisma.batch.count).mockResolvedValueOnce(1);

      const res = await getBatches(new Request("http://localhost/api/batches?page=1&limit=5"));
      expect(res.status).toBe(200);
      const data = await res.json();

      // The payload is capped at the same ceiling the on-chain reader uses and
      // says so, instead of returning a partial list silently.
      expect(data.data[0].payments).toHaveLength(CONTRACT_READER_ENTRY_CAP);
      expect(data.data[0].paymentsTruncated).toBe(true);
      expect(data.data[0].paymentsLimit).toBe(CONTRACT_READER_ENTRY_CAP);
      expect(data.meta.truncated).toBe(true);
      expect(vi.mocked(prisma.batch.findMany)).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            payments: expect.objectContaining({ take: CONTRACT_READER_ENTRY_CAP + 1 }),
          }),
        })
      );
    });

    it("POST returns 400 when batch payload is invalid", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      const res = await postBatches(
        mutatingRequest("http://localhost/api/batches", "POST", { name: "", recipients: [] })
      );
      expect(res.status).toBe(400);
    });

    it("POST creates batch and nested payments", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      const mockBatch = { id: "batch_123", name: "Payroll Jan" };
      vi.mocked(prisma.batch.create).mockResolvedValueOnce(mockBatch as never);
      vi.mocked(prisma.payment.createMany).mockResolvedValueOnce({ count: 2 });
      vi.mocked(prisma.batch.findUnique).mockResolvedValueOnce({
        ...mockBatch,
        payments: [{ id: "p1" }, { id: "p2" }],
      } as never);

      const res = await postBatches(
        mutatingRequest("http://localhost/api/batches", "POST", {
          name: "Payroll Jan",
          sourceAccountId: "source_batch_1",
          recipients: [
            { amount: 100, address: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" },
            { amount: 200, address: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" },
          ],
        })
      );
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.data.id).toBe("batch_123");
    });
  });

  describe("GET /api/batches/[id]", () => {
    it("returns 404 when the batch is not found", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(prisma.batch.findFirst).mockResolvedValueOnce(null);
      const res = await getBatchById(new Request("http://localhost/api/batches/missing"), {
        params: Promise.resolve({ id: "missing" }),
      });
      expect(res.status).toBe(404);
    });

    it("returns batch details with per-item status when found", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(prisma.batch.findFirst).mockResolvedValueOnce({
        id: "batch_123",
        userId: "user_123",
        name: "Payroll Jan",
        description: null,
        status: "PARTIALLY_COMPLETED",
        createdAt: new Date("2026-08-01T00:00:00Z"),
        updatedAt: new Date("2026-08-01T00:00:00Z"),
        payments: [
          {
            id: "pay_1",
            amount: 100,
            assetCode: "XLM",
            memo: "aug-1",
            status: "COMPLETED",
            errorMessage: null,
          },
          {
            id: "pay_2",
            amount: 200,
            assetCode: "XLM",
            memo: null,
            status: "FAILED",
            errorMessage: "insufficient funds",
          },
        ],
      } as never);

      const res = await getBatchById(new Request("http://localhost/api/batches/batch_123"), {
        params: Promise.resolve({ id: "batch_123" }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.id).toBe("batch_123");
      expect(data.data.items).toHaveLength(2);
      expect(data.data.items[0].status).toBe("sent");
      expect(data.data.items[1].status).toBe("failed");
      expect(data.data.items[1].errorMessage).toBe("insufficient funds");
      expect(data.data.progress).toMatchObject({ total: 2, sent: 1, failed: 1, pending: 0 });
    });
  });

  describe("/api/requests", () => {
    it("GET returns user payment requests", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      const mockRequests = [{ id: "req_1", amount: 50 }];
      vi.mocked(prisma.paymentRequest.findMany).mockResolvedValueOnce(mockRequests as never);

      const res = await getRequests(new Request("http://localhost/api/requests"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data).toHaveLength(1);
    });

    it("POST returns 400 when validation fails", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      const res = await postRequests(
        mutatingRequest("http://localhost/api/requests", "POST", { amount: -10 })
      );
      expect(res.status).toBe(400);
    });

    it("POST creates a payment request successfully", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      const mockCreated = {
        id: "req_new_1",
        amount: 100,
        assetCode: "XLM",
        recipientAddress: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        status: "PENDING",
        createdAt: new Date(),
      };
      vi.mocked(prisma.paymentRequest.create).mockResolvedValueOnce(mockCreated as never);

      const res = await postRequests(
        mutatingRequest("http://localhost/api/requests", "POST", {
          amount: 100,
          assetCode: "XLM",
          description: "Invoice #101",
          recipientAddress: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        })
      );
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.data.id).toBe("req_new_1");
    });
  });
});
