// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockPaymentFindFirst,
  mockPaymentCreate,
  mockBatchFindFirst,
  mockBatchCreate,
  mockCreateMany,
  mockTransaction,
  mockGetAuthContext,
} = vi.hoisted(() => ({
  mockPaymentFindFirst: vi.fn(),
  mockPaymentCreate: vi.fn(),
  mockBatchFindFirst: vi.fn(),
  mockBatchCreate: vi.fn(),
  mockCreateMany: vi.fn(),
  mockTransaction: vi.fn(),
  mockGetAuthContext: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    payment: {
      findFirst: mockPaymentFindFirst,
      create: mockPaymentCreate,
      createMany: mockCreateMany,
    },
    batch: {
      findFirst: mockBatchFindFirst,
      create: mockBatchCreate,
    },
    $transaction: mockTransaction,
  },
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: mockGetAuthContext,
}));

vi.mock("@/lib/webhook-dispatcher", () => ({
  dispatchWebhookEventAsync: vi.fn(),
}));

import { generateCsrfToken } from "@/lib/csrf";
import {
  clearIdempotencyStore,
  cleanExpiredIdempotencyKeys,
  getIdempotencyRecord,
  saveIdempotencyRecord,
  validateIdempotencyHeader,
  IDEMPOTENCY_TTL_MS,
} from "@/lib/idempotency";
import { apiRoute } from "@/lib/api-route";
import { POST as postPayments } from "@/app/api/payments/route";
import { POST as postBatches } from "@/app/api/batches/route";
import { POST as postEscrows } from "@/app/api/escrows/route";
import { POST as postStreams } from "@/app/api/streams/route";

const USER_ID = "usr_idempotency_123";

function csrfHeaders(): Record<string, string> {
  const token = generateCsrfToken();
  return { "x-csrf-token": token, cookie: `__Host-csrf=${token}` };
}

function makeRequest(
  url: string,
  body: unknown,
  headers: Record<string, string> = {}
): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...csrfHeaders(),
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("Issue #1302: Request Idempotency Key Validation and 409 Conflict Replay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearIdempotencyStore();
    mockGetAuthContext.mockResolvedValue({ userId: USER_ID });
    mockPaymentFindFirst.mockResolvedValue(null);
    mockBatchFindFirst.mockResolvedValue(null);
  });

  describe("Core Idempotency Validation and 24-Hour Expiry", () => {
    it("rejects missing or empty Idempotency-Key headers", () => {
      const emptyReq = new Request("http://localhost/test", { method: "POST" });
      const res1 = validateIdempotencyHeader(emptyReq);
      expect(res1.success).toBe(false);

      const whitespaceReq = new Request("http://localhost/test", {
        method: "POST",
        headers: { "Idempotency-Key": "    " },
      });
      const res2 = validateIdempotencyHeader(whitespaceReq);
      expect(res2.success).toBe(false);
    });

    it("rejects keys shorter than 8 chars or longer than 255 chars", () => {
      const shortReq = new Request("http://localhost/test", {
        method: "POST",
        headers: { "Idempotency-Key": "short" },
      });
      expect(validateIdempotencyHeader(shortReq).success).toBe(false);

      const longReq = new Request("http://localhost/test", {
        method: "POST",
        headers: { "Idempotency-Key": "a".repeat(256) },
      });
      expect(validateIdempotencyHeader(longReq).success).toBe(false);

      const validReq = new Request("http://localhost/test", {
        method: "POST",
        headers: { "Idempotency-Key": "valid-key-12345" },
      });
      const res = validateIdempotencyHeader(validReq);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.key).toBe("valid-key-12345");
      }
    });

    it("evicts expired keys after 24 hours (IDEMPOTENCY_TTL_MS)", async () => {
      const key = "expire-test-key-001";
      await saveIdempotencyRecord(key, "test", { foo: "bar" }, 200, USER_ID, IDEMPOTENCY_TTL_MS);

      // Immediately present
      const immediate = await getIdempotencyRecord(key, "test", USER_ID);
      expect(immediate).not.toBeNull();
      expect(immediate?.responseBody).toEqual({ foo: "bar" });

      // After 24h + 1s, cleanExpiredIdempotencyKeys evicts it
      const futureTime = Date.now() + IDEMPOTENCY_TTL_MS + 1000;
      const evictedCount = cleanExpiredIdempotencyKeys(futureTime);
      expect(evictedCount).toBe(1);

      const expired = await getIdempotencyRecord(key, "test", USER_ID);
      expect(expired).toBeNull();
    });
  });

  describe("POST /api/payments", () => {
    const validPaymentBody = {
      amount: 100.5,
      assetCode: "XLM",
      destAddress: "GDHJ3K2LQ7F5XQZPX6YWNMYKXWQXVZKBJZQFYX3F6KRLV4WDXHJMB2UY",
      sourceAccountId: "GA5AZNWWOW5PXPNHBVRJOB2ZPZO3PXN5VTXTXOIJTACZZHE5ZA7CAH7H",
      memo: "test payment",
    };

    it("enforces Idempotency-Key header on POST /api/payments", async () => {
      const req = makeRequest("http://localhost/api/payments", validPaymentBody);
      const res = await postPayments(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toMatch(/Idempotency-Key header is required/i);
    });

    it("creates payment on first submission (201) and returns 409 with original body on replay", async () => {
      const key = "payment-key-uuid-999";
      const createdRecord = {
        id: "pay_test_123",
        amount: 100.5,
        assetCode: "XLM",
        status: "CREATED",
        userId: USER_ID,
        createdAt: new Date("2026-10-18T10:00:00Z"),
      };
      mockPaymentCreate.mockResolvedValue(createdRecord);

      // 1. First submission
      const req1 = makeRequest("http://localhost/api/payments", validPaymentBody, {
        "Idempotency-Key": key,
      });
      const res1 = await postPayments(req1);
      expect(res1.status).toBe(201);
      const body1 = await res1.json();
      expect(body1.success).toBe(true);
      expect(body1.data.id).toBe("pay_test_123");
      expect(mockPaymentCreate).toHaveBeenCalledTimes(1);

      // 2. Duplicate submission with identical key returns HTTP 409 with original body
      const req2 = makeRequest("http://localhost/api/payments", validPaymentBody, {
        "Idempotency-Key": key,
      });
      const res2 = await postPayments(req2);
      expect(res2.status).toBe(409);
      expect(res2.headers.get("X-Idempotency-Status")).toBe("CONFLICT");
      const body2 = await res2.json();
      expect(body2.success).toBe(true);
      expect(body2.data.id).toBe("pay_test_123");

      // Did not call database create again
      expect(mockPaymentCreate).toHaveBeenCalledTimes(1);
    });
  });

  describe("POST /api/batches", () => {
    const validBatchBody = {
      name: "Payroll Batch",
      sourceAccountId: "GA5AZNWWOW5PXPNHBVRJOB2ZPZO3PXN5VTXTXOIJTACZZHE5ZA7CAH7H",
      recipients: [
        {
          address: "GDHJ3K2LQ7F5XQZPX6YWNMYKXWQXVZKBJZQFYX3F6KRLV4WDXHJMB2UY",
          amount: 50,
          assetCode: "XLM",
        },
      ],
    };

    it("enforces Idempotency-Key header on POST /api/batches", async () => {
      const req = makeRequest("http://localhost/api/batches", validBatchBody);
      const res = await postBatches(req);
      expect(res.status).toBe(400);
    });

    it("returns 409 Conflict with original batch on duplicate submission", async () => {
      const key = "batch-unique-key-111";
      const batchResult = {
        id: "batch_abc_456",
        userId: USER_ID,
        name: "Payroll Batch",
        idempotencyKey: key,
        payments: [],
      };
      mockTransaction.mockImplementation(async (callback: (tx: unknown) => unknown) => {
        return callback({
          batch: {
            create: vi.fn().mockResolvedValue(batchResult),
            findUnique: vi.fn().mockResolvedValue(batchResult),
          },
          payment: { createMany: vi.fn() },
        });
      });

      // First run
      const req1 = makeRequest("http://localhost/api/batches", validBatchBody, {
        "Idempotency-Key": key,
      });
      const res1 = await postBatches(req1);
      expect(res1.status).toBe(201);

      // Replay run -> 409
      const req2 = makeRequest("http://localhost/api/batches", validBatchBody, {
        "Idempotency-Key": key,
      });
      const res2 = await postBatches(req2);
      expect(res2.status).toBe(409);
      const body2 = await res2.json();
      expect(body2.data.id).toBe("batch_abc_456");
    });
  });

  describe("POST /api/escrows", () => {
    const validEscrowBody = {
      depositor: "GA5AZNWWOW5PXPNHBVRJOB2ZPZO3PXN5VTXTXOIJTACZZHE5ZA7CAH7H",
      beneficiary: "GDHJ3K2LQ7F5XQZPX6YWNMYKXWQXVZKBJZQFYX3F6KRLV4WDXHJMB2UY",
      amount: "500",
    };

    it("enforces Idempotency-Key header on POST /api/escrows", async () => {
      const req = makeRequest("http://localhost/api/escrows", validEscrowBody);
      const res = await postEscrows(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toMatch(/Idempotency-Key header is required/i);
    });

    it("returns 202 on first submission and 409 on duplicate key replay", async () => {
      const key = "escrow-key-pass-555";
      const req1 = makeRequest("http://localhost/api/escrows", validEscrowBody, {
        "Idempotency-Key": key,
      });
      const res1 = await postEscrows(req1);
      expect(res1.status).toBe(202);
      const body1 = await res1.json();
      expect(body1.data.message).toMatch(/requires wallet signing/i);

      // Duplicate submission
      const req2 = makeRequest("http://localhost/api/escrows", validEscrowBody, {
        "Idempotency-Key": key,
      });
      const res2 = await postEscrows(req2);
      expect(res2.status).toBe(409);
      const body2 = await res2.json();
      expect(body2.data.message).toMatch(/requires wallet signing/i);
      expect(body2.data.params.amount).toBe("500");
    });
  });

  describe("POST /api/streams", () => {
    const validStreamBody = {
      creator: "GA5AZNWWOW5PXPNHBVRJOB2ZPZO3PXN5VTXTXOIJTACZZHE5ZA7CAH7H",
      recipient: "GDHJ3K2LQ7F5XQZPX6YWNMYKXWQXVZKBJZQFYX3F6KRLV4WDXHJMB2UY",
      totalAmount: "1000",
    };

    it("enforces Idempotency-Key header on POST /api/streams", async () => {
      const req = makeRequest("http://localhost/api/streams", validStreamBody);
      const res = await postStreams(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toMatch(/Idempotency-Key header is required/i);
    });

    it("returns 202 on first submission and 409 on duplicate key replay", async () => {
      const key = "stream-key-pass-777";
      const req1 = makeRequest("http://localhost/api/streams", validStreamBody, {
        "Idempotency-Key": key,
      });
      const res1 = await postStreams(req1);
      expect(res1.status).toBe(202);
      const body1 = await res1.json();
      expect(body1.data.message).toMatch(/requires wallet signing/i);

      // Duplicate submission
      const req2 = makeRequest("http://localhost/api/streams", validStreamBody, {
        "Idempotency-Key": key,
      });
      const res2 = await postStreams(req2);
      expect(res2.status).toBe(409);
      const body2 = await res2.json();
      expect(body2.data.message).toMatch(/requires wallet signing/i);
      expect(body2.data.params.totalAmount).toBe("1000");
    });
  });

  describe("apiRoute Idempotency Integration", () => {
    it("handles idempotency check and 409 caching automatically in apiRoute wrapper", async () => {
      let executeCount = 0;
      const handler = apiRoute(
        {
          name: "POST /api/test-mutation",
          csrf: "opt-out",
          idempotency: true,
        },
        async () => {
          executeCount++;
          return Response.json({ count: executeCount, result: "created" }, { status: 201 });
        }
      );

      const key = "apiroute-test-key-123";

      // 1. Missing header -> 400
      const noHeaderReq = new Request("http://localhost/api/test-mutation", { method: "POST" });
      const noHeaderRes = await handler(noHeaderReq, { params: Promise.resolve({}) });
      expect(noHeaderRes.status).toBe(400);
      expect(executeCount).toBe(0);

      // 2. Valid first call -> 201
      const req1 = new Request("http://localhost/api/test-mutation", {
        method: "POST",
        headers: { "Idempotency-Key": key },
      });
      const res1 = await handler(req1, { params: Promise.resolve({}) });
      expect(res1.status).toBe(201);
      expect(executeCount).toBe(1);

      // 3. Replay with same key -> 409 with original response
      const req2 = new Request("http://localhost/api/test-mutation", {
        method: "POST",
        headers: { "Idempotency-Key": key },
      });
      const res2 = await handler(req2, { params: Promise.resolve({}) });
      expect(res2.status).toBe(409);
      const body2 = await res2.json();
      expect(body2.count).toBe(1);
      expect(body2.result).toBe("created");
      expect(executeCount).toBe(1); // Handler was not executed again!
    });
  });
});
