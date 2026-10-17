// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const {
  mockFindFirst,
  mockFindUnique,
  mockCreateMany,
  mockBatchCreate,
  mockTransaction,
  mockGetAuthContext,
} = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockFindUnique: vi.fn(),
  mockCreateMany: vi.fn(),
  mockBatchCreate: vi.fn(),
  mockTransaction: vi.fn(),
  mockGetAuthContext: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    batch: { findFirst: mockFindFirst, findUnique: mockFindUnique },
    payment: { createMany: mockCreateMany },
    $transaction: mockTransaction,
  },
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: mockGetAuthContext,
}));

import { generateCsrfToken } from "@/lib/csrf";
import { POST } from "@/app/api/batches/route";
import {
  InMemoryRedisClient,
  HttpRedisClient,
  setRedisClient,
  resetRedisClient,
  getRedisClient,
  type RedisClient,
} from "@/lib/redis";
import {
  IDEMPOTENCY_LOCK_TTL_SECONDS,
  IDEMPOTENCY_CACHE_TTL_SECONDS,
  IDEMPOTENCY_RETRY_AFTER_SECONDS,
  buildIdempotencyRedisKey,
  acquireIdempotencyLock,
  cacheIdempotencyResponse,
  getCachedIdempotencyResponse,
  releaseIdempotencyLock,
} from "@/lib/idempotency";

function csrfHeaders(): Record<string, string> {
  const token = generateCsrfToken();
  return { "x-csrf-token": token, cookie: `__Host-csrf=${token}` };
}

const USER_ID = "user-redis-1";
const BATCH_ID = "cm0bt0000000000000000999";
const IDEMPOTENCY_KEY = "batch-idem-key-1366";

const VALID_RECIPIENTS = [
  {
    address: "GDHJ3K2LQ7F5XQZPX6YWNMYKXWQXVZKBJZQFYX3F6KRLV4WDXHJMB2UY",
    amount: 1200,
    assetCode: "XLM",
    memo: "aug-1",
  },
  {
    address: "GA5AZNWWOW5PXPNHBVRJOB2ZPZO3PXN5VTXTXOIJTACZZHE5ZA7CAH7H",
    amount: 800,
    assetCode: "XLM",
    memo: "aug-2",
  },
];

function makeBody(overrides: Record<string, unknown> = {}) {
  return {
    name: "September payroll",
    description: "Contractor payouts",
    sourceAccountId: "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U",
    recipients: VALID_RECIPIENTS,
    ...overrides,
  };
}

function makeRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/batches", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...csrfHeaders(), ...headers },
    body: JSON.stringify(body),
  });
}

function makeBatch(overrides: Record<string, unknown> = {}) {
  return {
    id: BATCH_ID,
    userId: USER_ID,
    name: "September payroll",
    description: "Contractor payouts",
    idempotencyKey: IDEMPOTENCY_KEY,
    status: "CREATED",
    createdAt: new Date("2026-09-01T12:00:00.000Z"),
    updatedAt: new Date("2026-09-01T12:00:00.000Z"),
    payments: VALID_RECIPIENTS.map((r, i) => ({
      id: `cm0py00000000000000009${10 + i}`,
      batchId: BATCH_ID,
      userId: USER_ID,
      amount: r.amount,
      assetCode: r.assetCode,
      memo: r.memo,
      status: "CREATED",
    })),
    ...overrides,
  };
}

function makeTx() {
  return {
    batch: { create: mockBatchCreate, findUnique: mockFindUnique },
    payment: { createMany: mockCreateMany },
  };
}

describe("Redis-backed idempotency key cache & atomic lock (#1366)", () => {
  let currentTimeMs = 1_700_000_000_000;
  let redis: InMemoryRedisClient;

  beforeEach(() => {
    vi.clearAllMocks();
    currentTimeMs = 1_700_000_000_000;
    redis = new InMemoryRedisClient(() => currentTimeMs);
    setRedisClient(redis);

    mockGetAuthContext.mockResolvedValue({ userId: USER_ID });
    mockFindFirst.mockResolvedValue(null);
    mockFindUnique.mockResolvedValue(makeBatch());
    mockCreateMany.mockResolvedValue({ count: VALID_RECIPIENTS.length });
    mockBatchCreate.mockResolvedValue(makeBatch({ payments: undefined }));
    mockTransaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback(makeTx())
    );
  });

  afterEach(() => {
    resetRedisClient();
  });

  describe("Unit: src/lib/idempotency.ts & src/lib/redis.ts", () => {
    it("acquires an atomic SET NX EX lock on idempotency:${key} with a 120s lease", async () => {
      const setSpy = vi.spyOn(redis, "set");

      const first = await acquireIdempotencyLock(IDEMPOTENCY_KEY, USER_ID);
      expect(first).toEqual({
        status: "ACQUIRED",
        redisKey: `idempotency:${IDEMPOTENCY_KEY}`,
      });

      expect(setSpy).toHaveBeenCalledWith(
        `idempotency:${IDEMPOTENCY_KEY}`,
        expect.stringContaining('"state":"IN_FLIGHT"'),
        "NX",
        "EX",
        120
      );
      expect(IDEMPOTENCY_LOCK_TTL_SECONDS).toBe(120);
      expect(await redis.ttl(buildIdempotencyRedisKey(IDEMPOTENCY_KEY))).toBe(120);

      // A second concurrent attempt while the lock is active returns IN_FLIGHT
      const second = await acquireIdempotencyLock(IDEMPOTENCY_KEY, USER_ID);
      expect(second).toEqual({
        status: "IN_FLIGHT",
        redisKey: `idempotency:${IDEMPOTENCY_KEY}`,
        retryAfterSeconds: 5,
      });
      expect(IDEMPOTENCY_RETRY_AFTER_SECONDS).toBe(5);
    });

    it("expires the 120s in-flight lock after TTL elapses and allows re-acquisition", async () => {
      const first = await acquireIdempotencyLock(IDEMPOTENCY_KEY, USER_ID);
      expect(first.status).toBe("ACQUIRED");

      // Advance clock by 119 seconds — still locked
      currentTimeMs += 119 * 1000;
      const stillLocked = await acquireIdempotencyLock(IDEMPOTENCY_KEY, USER_ID);
      expect(stillLocked.status).toBe("IN_FLIGHT");

      // Advance past 120 seconds — lock expires and can be re-acquired
      currentTimeMs += 2 * 1000;
      const reacquired = await acquireIdempotencyLock(IDEMPOTENCY_KEY, USER_ID);
      expect(reacquired.status).toBe("ACQUIRED");
    });

    it("caches completed batch response for 24 hours (86,400s) and expires after TTL", async () => {
      const setSpy = vi.spyOn(redis, "set");
      const samplePayload = {
        success: true,
        data: { id: BATCH_ID, name: "September payroll" },
        meta: { timestamp: "2026-09-01T12:00:00.000Z" },
      };

      const cached = await cacheIdempotencyResponse(IDEMPOTENCY_KEY, {
        statusCode: 201,
        body: samplePayload,
        userId: USER_ID,
      });
      expect(cached).toBe(true);
      expect(IDEMPOTENCY_CACHE_TTL_SECONDS).toBe(86_400);

      expect(setSpy).toHaveBeenCalledWith(
        `idempotency:${IDEMPOTENCY_KEY}`,
        expect.stringContaining('"state":"COMPLETED"'),
        "EX",
        86_400
      );
      expect(await redis.ttl(`idempotency:${IDEMPOTENCY_KEY}`)).toBe(86_400);

      // Subsequent lock check returns CACHED with the 201 payload
      const lockCheck = await acquireIdempotencyLock(IDEMPOTENCY_KEY, USER_ID);
      expect(lockCheck).toMatchObject({
        status: "CACHED",
        redisKey: `idempotency:${IDEMPOTENCY_KEY}`,
        statusCode: 201,
        body: samplePayload,
      });

      const directGet = await getCachedIdempotencyResponse(IDEMPOTENCY_KEY, USER_ID);
      expect(directGet?.statusCode).toBe(201);
      expect(directGet?.body).toEqual(samplePayload);

      // Advance 24 hours + 1 second — TTL cleanup removes the cached entry
      currentTimeMs += (86_400 + 1) * 1000;
      expect(redis.cleanupExpired()).toBe(1);
      expect(redis.size()).toBe(0);
      expect(await getCachedIdempotencyResponse(IDEMPOTENCY_KEY, USER_ID)).toBeNull();
    });

    it("releases the lock via DEL when releaseIdempotencyLock is called", async () => {
      await acquireIdempotencyLock(IDEMPOTENCY_KEY, USER_ID);
      expect(await releaseIdempotencyLock(IDEMPOTENCY_KEY)).toBe(true);
      expect(await redis.get(`idempotency:${IDEMPOTENCY_KEY}`)).toBeNull();

      // Another caller can now immediately acquire the lock
      const next = await acquireIdempotencyLock(IDEMPOTENCY_KEY, USER_ID);
      expect(next.status).toBe("ACQUIRED");
    });

    it("supports HttpRedisClient REST commands and getRedisClient() env selection", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ result: "OK" }),
      });
      const httpClient = new HttpRedisClient({
        url: "https://redis.example.com/",
        token: "secret-token",
        fetchImpl: fetchMock as unknown as typeof fetch,
      });

      const res = await httpClient.set("idempotency:k1", "v1", "NX", "EX", 120);
      expect(res).toBe("OK");
      expect(fetchMock).toHaveBeenCalledWith(
        "https://redis.example.com",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify(["SET", "idempotency:k1", "v1", "NX", "EX", 120]),
        })
      );

      resetRedisClient();
      const prevUrl = process.env.REDIS_URL;
      delete process.env.REDIS_URL;
      expect(await getRedisClient()).toBeNull();
      if (prevUrl !== undefined) process.env.REDIS_URL = prevUrl;
    });
  });

  describe("Route: POST /api/batches with Redis idempotency cache", () => {
    it("returns 409 Conflict with Retry-After: 5 when an in-flight request holds the same key", async () => {
      let resolveTx!: (value: unknown) => void;
      mockTransaction.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveTx = resolve;
          })
      );

      // Start the first request (holds `idempotency:${key}` lock in-flight)
      const inFlightPromise = POST(
        makeRequest(makeBody(), { "Idempotency-Key": IDEMPOTENCY_KEY })
      );

      // Wait a microtask tick so the first request acquires the Redis lock and enters $transaction
      await new Promise((r) => setTimeout(r, 10));

      // Concurrent duplicate request while the first is still in flight
      const concurrentRes = await POST(
        makeRequest(makeBody(), { "Idempotency-Key": IDEMPOTENCY_KEY })
      );

      expect(concurrentRes.status).toBe(409);
      expect(concurrentRes.headers.get("Retry-After")).toBe("5");
      const conflictBody = await concurrentRes.json();
      expect(conflictBody.success).toBe(false);
      expect(conflictBody.error.code).toBe("CONFLICT");

      // Finish the first request and verify it completes with 201
      resolveTx(makeBatch());
      const firstRes = await inFlightPromise;
      expect(firstRes.status).toBe(201);
    });

    it("serves identical 201 response from Redis cache with Idempotent-Replay: true on retry", async () => {
      const firstRes = await POST(
        makeRequest(makeBody(), { "Idempotency-Key": IDEMPOTENCY_KEY })
      );
      expect(firstRes.status).toBe(201);
      expect(firstRes.headers.get("Idempotent-Replay")).toBeNull();
      const firstBody = await firstRes.json();

      // Verify the 24-hour (86,400s) TTL was set in Redis
      const ttl = await redis.ttl(`idempotency:${IDEMPOTENCY_KEY}`);
      expect(ttl).toBe(86_400);

      // Retry with the same key — served directly from Redis with 201 + Idempotent-Replay: true
      const retryRes = await POST(
        makeRequest(makeBody(), { "Idempotency-Key": IDEMPOTENCY_KEY })
      );
      expect(retryRes.status).toBe(201);
      expect(retryRes.headers.get("Idempotent-Replay")).toBe("true");
      const retryBody = await retryRes.json();

      expect(retryBody).toEqual(firstBody);
      // Database was only queried/written during the first submission
      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockFindFirst).toHaveBeenCalledTimes(1);
    });

    it("releases the Redis lock when the database transaction fails so a retry can succeed", async () => {
      mockTransaction.mockRejectedValueOnce(new Error("Transient DB error"));

      const failedRes = await POST(
        makeRequest(makeBody(), { "Idempotency-Key": IDEMPOTENCY_KEY })
      );
      expect(failedRes.status).toBe(500);

      // Lock must have been cleaned up on failure
      expect(await redis.get(`idempotency:${IDEMPOTENCY_KEY}`)).toBeNull();

      // Next retry succeeds with 201
      const retryRes = await POST(
        makeRequest(makeBody(), { "Idempotency-Key": IDEMPOTENCY_KEY })
      );
      expect(retryRes.status).toBe(201);
    });

    it("gracefully falls back to database uniqueness constraints when Redis throws or is unavailable", async () => {
      const brokenRedis: RedisClient = {
        get: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
        set: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
        del: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
      };
      setRedisClient(brokenRedis);

      // 1. First creation still succeeds via DB fallback
      const createRes = await POST(
        makeRequest(makeBody(), { "Idempotency-Key": IDEMPOTENCY_KEY })
      );
      expect(createRes.status).toBe(201);
      expect(mockTransaction).toHaveBeenCalledTimes(1);

      // 2. Subsequent retry finds the batch via Prisma findFirst fallback
      mockFindFirst.mockResolvedValueOnce(makeBatch());
      const retryRes = await POST(
        makeRequest(makeBody(), { "Idempotency-Key": IDEMPOTENCY_KEY })
      );
      expect(retryRes.status).toBe(200);
      expect(retryRes.headers.get("Idempotent-Replay")).toBe("true");
      const retryBody = await retryRes.json();
      expect(retryBody.meta.deduplicated).toBe(true);
      expect(retryBody.data.id).toBe(BATCH_ID);
    });
  });
});
