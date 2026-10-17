// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

const {
  mockPaymentCreate,
  mockGetAuthContext,
} = vi.hoisted(() => ({
  mockPaymentCreate: vi.fn(),
  mockGetAuthContext: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    payment: {
      create: mockPaymentCreate,
    },
  },
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: mockGetAuthContext,
}));

vi.mock("@/lib/webhook-dispatcher", () => ({
  dispatchWebhookEventAsync: vi.fn(),
}));

vi.mock("@/lib/api-cache", () => ({
  invalidateCaches: vi.fn().mockResolvedValue(undefined),
}));

import { generateCsrfToken } from "@/lib/csrf";
import {
  IDEMPOTENCY_TTL_MS,
  checkIdempotencyKey,
  clearIdempotencyStore,
  computePayloadHash,
  storeIdempotencyResponse,
  validateIdempotencyKeyHeader,
} from "@/lib/idempotency";
import { apiRoute } from "@/lib/api-route";
import { successResponse } from "@/lib/api-response";
import { POST as createPaymentPOST } from "@/app/api/payments/route";
import { POST as createStreamPOST } from "@/app/api/streams/route";

function csrfHeaders(): Record<string, string> {
  const token = generateCsrfToken();
  return { "x-csrf-token": token, cookie: `__Host-csrf=${token}` };
}

const VALID_PAYMENT_BODY = {
  amount: 250,
  sourceAccountId: "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U",
  destAddress: "GDHJ3K2LQ7F5XQZPX6YWNMYKXWQXVZKBJZQFYX3F6KRLV4WDXHJMB2UY",
  assetCode: "XLM",
  memo: "inv-1302",
};

describe("Request Idempotency-Key validation and 24h TTL deduplication (#1302)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearIdempotencyStore();
    mockGetAuthContext.mockResolvedValue({ userId: "user-1302" });
    mockPaymentCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "pay-1302-1",
      ...data,
      createdAt: new Date("2026-10-17T06:00:00.000Z"),
    }));
  });

  describe("validateIdempotencyKeyHeader & computePayloadHash", () => {
    it("accepts UUID v4 and up to 255 printable ASCII characters", () => {
      const uuidKey = "550e8400-e29b-41d4-a716-446655440000";
      const resUuid = validateIdempotencyKeyHeader(uuidKey);
      expect(resUuid).toEqual({ ok: true, key: uuidKey });

      const maxAscii = "k".repeat(255);
      const resMax = validateIdempotencyKeyHeader(maxAscii);
      expect(resMax).toEqual({ ok: true, key: maxAscii });
    });

    it("rejects malformed keys (empty, <8 chars, >255 chars, control/non-ASCII chars)", async () => {
      const invalidKeys = [
        "   ",
        "short",
        "x".repeat(256),
        "bad-key-\u0000-null",
        "non-ascii-key-🚀-1234",
      ];

      for (const rawKey of invalidKeys) {
        const res = validateIdempotencyKeyHeader(rawKey);
        expect(res.ok).toBe(false);
        if (!res.ok) {
          expect(res.errorResponse.status).toBe(400);
        }
      }
    });

    it("computes identical SHA-256 payload hashes regardless of object key order", () => {
      const hashA = computePayloadHash({ amount: 100, assetCode: "XLM", meta: { b: 2, a: 1 } });
      const hashB = computePayloadHash({ meta: { a: 1, b: 2 }, assetCode: "XLM", amount: 100 });
      const hashC = computePayloadHash({ amount: 200, assetCode: "XLM", meta: { a: 1, b: 2 } });

      expect(hashA).toBe(hashB);
      expect(hashA).not.toBe(hashC);
    });
  });

  describe("24-hour TTL store and conflict detection", () => {
    it("replays cached response within 24h TTL and expires after 24h", async () => {
      const baseTime = 1_700_000_000_000;
      const key = "550e8400-e29b-41d4-a716-446655440000";
      const payload = { amount: 50, dest: "GABC" };

      const miss1 = checkIdempotencyKey({
        scope: "POST /api/payments",
        userId: "u1",
        key,
        payload,
        now: baseTime,
      });
      expect(miss1.status).toBe("miss");

      await storeIdempotencyResponse({
        scope: "POST /api/payments",
        userId: "u1",
        key,
        payloadHash: computePayloadHash(payload),
        response: successResponse({ id: "pay-1" }, undefined, 201),
        now: baseTime,
      });

      // Within 24h TTL -> hit
      const hit = checkIdempotencyKey({
        scope: "POST /api/payments",
        userId: "u1",
        key,
        payload,
        now: baseTime + IDEMPOTENCY_TTL_MS - 1_000,
      });
      expect(hit.status).toBe("hit");
      if (hit.status === "hit") {
        expect(hit.response.status).toBe(201);
        expect(hit.response.headers.get("X-Idempotency-Replayed")).toBe("true");
        const body = await hit.response.json();
        expect(body.data.id).toBe("pay-1");
      }

      // Same key with different payload within 24h -> 409 Conflict
      const conflict = checkIdempotencyKey({
        scope: "POST /api/payments",
        userId: "u1",
        key,
        payload: { amount: 999, dest: "GABC" },
        now: baseTime + 5_000,
      });
      expect(conflict.status).toBe("conflict");
      if (conflict.status === "conflict") {
        expect(conflict.response.status).toBe(409);
      }

      // After 24h TTL -> expired, treated as miss
      const afterExpiry = checkIdempotencyKey({
        scope: "POST /api/payments",
        userId: "u1",
        key,
        payload: { amount: 999, dest: "GABC" },
        now: baseTime + IDEMPOTENCY_TTL_MS + 1,
      });
      expect(afterExpiry.status).toBe("miss");
    });
  });

  describe("POST /api/payments & POST /api/streams idempotency", () => {
    it("returns cached response on duplicate POST /api/payments with same key and payload", async () => {
      const idemKey = "pay-idem-key-550e8400-e29b-41d4";

      const req1 = new Request("http://localhost/api/payments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idemKey,
          ...csrfHeaders(),
        },
        body: JSON.stringify(VALID_PAYMENT_BODY),
      });
      const res1 = await createPaymentPOST(req1);
      expect(res1.status).toBe(201);
      expect(mockPaymentCreate).toHaveBeenCalledTimes(1);

      const req2 = new Request("http://localhost/api/payments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idemKey,
          ...csrfHeaders(),
        },
        body: JSON.stringify(VALID_PAYMENT_BODY),
      });
      const res2 = await createPaymentPOST(req2);
      expect(res2.status).toBe(201);
      expect(res2.headers.get("X-Idempotency-Replayed")).toBe("true");
      // Mutation handler was NOT invoked a second time
      expect(mockPaymentCreate).toHaveBeenCalledTimes(1);
    });

    it("returns 409 Conflict when POST /api/payments reuses an Idempotency-Key with a different payload", async () => {
      const idemKey = "pay-conflict-key-12345678";

      const req1 = new Request("http://localhost/api/payments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idemKey,
          ...csrfHeaders(),
        },
        body: JSON.stringify(VALID_PAYMENT_BODY),
      });
      const res1 = await createPaymentPOST(req1);
      expect(res1.status).toBe(201);

      const reqConflict = new Request("http://localhost/api/payments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idemKey,
          ...csrfHeaders(),
        },
        body: JSON.stringify({ ...VALID_PAYMENT_BODY, amount: 999 }),
      });
      const resConflict = await createPaymentPOST(reqConflict);
      expect(resConflict.status).toBe(409);
      const conflictJson = await resConflict.json();
      expect(conflictJson.error.code).toBe("CONFLICT");
      expect(mockPaymentCreate).toHaveBeenCalledTimes(1);
    });

    it("returns 400 when POST /api/payments or POST /api/streams receives a malformed Idempotency-Key", async () => {
      const badReq = new Request("http://localhost/api/payments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "short",
          ...csrfHeaders(),
        },
        body: JSON.stringify(VALID_PAYMENT_BODY),
      });
      const res = await createPaymentPOST(badReq);
      expect(res.status).toBe(400);
      expect(mockPaymentCreate).not.toHaveBeenCalled();

      const badStreamReq = new Request("http://localhost/api/streams", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "   ",
          ...csrfHeaders(),
        },
        body: JSON.stringify({
          creator: VALID_PAYMENT_BODY.sourceAccountId,
          recipient: VALID_PAYMENT_BODY.destAddress,
          totalAmount: "100",
        }),
      });
      const streamRes = await createStreamPOST(badStreamReq);
      expect(streamRes.status).toBe(400);
    });

    it("enforces idempotency replay and 409 conflict on apiRoute wrapper", async () => {
      let executions = 0;
      const route = apiRoute(
        {
          name: "POST /api/escrows",
          idempotency: true,
          bodySchema: z.object({ amount: z.number().positive() }),
        },
        async (_req, ctx) => {
          executions += 1;
          return successResponse({ executions, amount: ctx.body?.amount, key: ctx.idempotencyKey }, undefined, 201);
        },
      );

      const key = "escrow-idem-key-987654321";
      const r1 = await route(
        new Request("http://localhost/api/escrows", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": key, ...csrfHeaders() },
          body: JSON.stringify({ amount: 50 }),
        }),
        { params: Promise.resolve({}) },
      );
      expect(r1.status).toBe(201);
      expect(executions).toBe(1);

      // Duplicate request with identical payload -> cached replay
      const r2 = await route(
        new Request("http://localhost/api/escrows", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": key, ...csrfHeaders() },
          body: JSON.stringify({ amount: 50 }),
        }),
        { params: Promise.resolve({}) },
      );
      expect(r2.status).toBe(201);
      expect(r2.headers.get("X-Idempotency-Replayed")).toBe("true");
      expect(executions).toBe(1);

      // Conflicting payload with same key -> 409 Conflict
      const r3 = await route(
        new Request("http://localhost/api/escrows", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": key, ...csrfHeaders() },
          body: JSON.stringify({ amount: 75 }),
        }),
        { params: Promise.resolve({}) },
      );
      expect(r3.status).toBe(409);
      expect(executions).toBe(1);
    });
  });
});
