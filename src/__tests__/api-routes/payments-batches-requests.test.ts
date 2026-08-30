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
      findUnique: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
    paymentRequest: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
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
  simulateContractCall: vi.fn(),
}));

import prisma from "@/lib/prisma";
import * as authSession from "@/lib/auth-session";
import * as contracts from "@/lib/contracts";
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
        new Request("http://localhost/api/payments", {
          method: "POST",
          body: JSON.stringify({ amount: "10" }),
        })
      );
      expect(res.status).toBe(401);
    });

    it("POST returns 400 when validation fails", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      const res = await postPayments(
        new Request("http://localhost/api/payments", {
          method: "POST",
          body: JSON.stringify({ amount: "invalid-amount" }),
        })
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
        new Request("http://localhost/api/payments", {
          method: "POST",
          body: JSON.stringify({
            amount: 25.5,
            sourceAccountId: "source_acc_1",
            destAddress: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
            assetCode: "XLM",
            description: "Service fee",
          }),
        })
      );
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.data.id).toBe("p_new_1");
      expect(webhookDispatcher.dispatchWebhookEventAsync).toHaveBeenCalled();
    });
  });

  describe("/api/payments/[id]", () => {
    it("GET returns 401 when unauthenticated", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(null);
      const res = await getPaymentById(new Request("http://localhost/api/payments/p1"), {
        params: Promise.resolve({ id: "p1" }),
      });
      expect(res.status).toBe(401);
    });

    it("GET returns 404 when payment is not found or not owned by user", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(prisma.payment.findFirst).mockResolvedValueOnce(null);

      const res = await getPaymentById(new Request("http://localhost/api/payments/p1"), {
        params: Promise.resolve({ id: "p1" }),
      });
      expect(res.status).toBe(404);
    });

    it("GET returns payment detail for owner", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      const mockPayment = { id: "p1", amount: 100, status: "CONFIRMED" };
      vi.mocked(prisma.payment.findFirst).mockResolvedValueOnce(mockPayment as never);

      const res = await getPaymentById(new Request("http://localhost/api/payments/p1"), {
        params: Promise.resolve({ id: "p1" }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.id).toBe("p1");
    });

    it("PATCH updates payment status and triggers webhooks", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(prisma.payment.updateMany).mockResolvedValueOnce({ count: 1 });
      const updatedPayment = {
        id: "p1",
        status: "COMPLETED",
        amount: 50,
        assetCode: "XLM",
        completedAt: new Date(),
      };
      vi.mocked(prisma.payment.findUnique).mockResolvedValueOnce(updatedPayment as never);

      const res = await patchPaymentById(
        new Request("http://localhost/api/payments/p1", {
          method: "PATCH",
          body: JSON.stringify({ status: "COMPLETED", memo: "settled" }),
        }),
        { params: Promise.resolve({ id: "p1" }) }
      );
      expect(res.status).toBe(200);
      expect(webhookDispatcher.dispatchWebhookEventAsync).toHaveBeenCalled();
    });

    it("PATCH returns 404 when payment does not exist", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(prisma.payment.updateMany).mockResolvedValueOnce({ count: 0 });

      const res = await patchPaymentById(
        new Request("http://localhost/api/payments/p_none", {
          method: "PATCH",
          body: JSON.stringify({ status: "SIGNED" }),
        }),
        { params: Promise.resolve({ id: "p_none" }) }
      );
      expect(res.status).toBe(404);
    });

    it("DELETE removes payment record", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(prisma.payment.updateMany).mockResolvedValueOnce({ count: 1 });

      const res = await deletePaymentById(
        new Request("http://localhost/api/payments/p1", { method: "DELETE" }),
        {
          params: Promise.resolve({ id: "p1" }),
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
        new Request("http://localhost/api/payments/p1", { method: "DELETE" }),
        {
          params: Promise.resolve({ id: "p1" }),
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
    });

    it("POST returns 400 when batch payload is invalid", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      const res = await postBatches(
        new Request("http://localhost/api/batches", {
          method: "POST",
          body: JSON.stringify({ name: "", recipients: [] }),
        })
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
        new Request("http://localhost/api/batches", {
          method: "POST",
          body: JSON.stringify({
            name: "Payroll Jan",
            sourceAccountId: "source_batch_1",
            recipients: [
              { amount: 100, address: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" },
              { amount: 200, address: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" },
            ],
          }),
        })
      );
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.data.id).toBe("batch_123");
    });
  });

  describe("GET /api/batches/[id]", () => {
    it("returns 404 when ID is not a valid number", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      const res = await getBatchById(new Request("http://localhost/api/batches/not-a-number"), {
        params: Promise.resolve({ id: "not-a-number" }),
      });
      expect(res.status).toBe(404);
    });

    it("returns 404 when contract simulation fails", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contracts.simulateContractCall).mockResolvedValueOnce({
        status: "SIMULATION_FAILED",
        error: "Not found",
      } as never);

      const res = await getBatchById(new Request("http://localhost/api/batches/10"), {
        params: Promise.resolve({ id: "10" }),
      });
      expect(res.status).toBe(404);
    });

    it("returns batch details and includes payments when ?payments=true", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contracts.simulateContractCall)
        .mockResolvedValueOnce({
          status: "SUCCESS",
          returnValue: { id: 10, name: "OnChain Batch", status: 1 },
        } as never)
        .mockResolvedValueOnce({
          status: "SUCCESS",
          returnValue: [1, 2, 3],
        } as never);

      const res = await getBatchById(new Request("http://localhost/api/batches/10?payments=true"), {
        params: Promise.resolve({ id: "10" }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.id).toBe(10);
      expect(data.data.payments).toEqual([1, 2, 3]);
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
        new Request("http://localhost/api/requests", {
          method: "POST",
          body: JSON.stringify({ amount: -10 }),
        })
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
        new Request("http://localhost/api/requests", {
          method: "POST",
          body: JSON.stringify({
            amount: 100,
            assetCode: "XLM",
            description: "Invoice #101",
            recipientAddress: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
          }),
        })
      );
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.data.id).toBe("req_new_1");
    });
  });
});
