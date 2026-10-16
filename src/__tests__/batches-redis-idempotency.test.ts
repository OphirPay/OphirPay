// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  acquireIdempotencyLock,
  saveIdempotentResponse,
  releaseIdempotencyLock,
  makeIdempotencyConflictResponse,
  makeIdempotentReplayResponse,
  IDEMPOTENCY_LOCK_LEASE_SECONDS,
  IDEMPOTENCY_CACHE_TTL_SECONDS,
  IDEMPOTENCY_RETRY_AFTER_SECONDS,
} from "@/lib/idempotency";
import { setRedisClient, resetRedisClient, type RedisClient } from "@/lib/redis";

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

function csrfHeaders(): Record<string, string> {
  const token = generateCsrfToken();
  return { "x-csrf-token": token, cookie: `__Host-csrf=${token}` };
}

const USER_ID = "user-redis-1";
const BATCH_ID = "cm0bt0000000000000000099";
const IDEMPOTENCY_KEY = "test-idempotency-key-redis-12345";

const VALID_RECIPIENTS = [
  {
    address: "GDHJ3K2LQ7F5XQZPX6YWNMYKXWQXVZKBJZQFYX3F6KRLV4WDXHJMB2UY",
    amount: 1500,
    assetCode: "XLM",
    memo: "batch-1",
  },
];

function makeBody(overrides: Record<string, unknown> = {}) {
  return {
    name: "Engineering payroll",
    description: "Bi-weekly sprint payments",
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
    name: "Engineering payroll",
    description: "Bi-weekly sprint payments",
    idempotencyKey: IDEMPOTENCY_KEY,
    status: "CREATED",
    createdAt: new Date("2026-10-15T12:00:00.000Z"),
    updatedAt: new Date("2026-10-15T12:00:00.000Z"),
    payments: VALID_RECIPIENTS.map((r, i) => ({
      id: `cm0py000000000000000009${i}`,
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

describe("Redis-backed Idempotency Library (src/lib/idempotency.ts)", () => {
  let inMemoryStore: Map<string, { value: string; ex?: number }>;
  let mockRedis: RedisClient;

  beforeEach(() => {
    inMemoryStore = new Map();
    mockRedis = {
      get: vi.fn(async (key: string) => {
        const item = inMemoryStore.get(key);
        return item ? item.value : null;
      }),
      set: vi.fn(async (key: string, value: string, ...args: any[]) => {
        const hasNx = args.includes("NX");
        const exIdx = args.indexOf("EX");
        const ex = exIdx !== -1 ? Number(args[exIdx + 1]) : undefined;

        if (hasNx && inMemoryStore.has(key)) {
          return null; // Key already exists, NX fails
        }
        inMemoryStore.set(key, { value, ex });
        return "OK";
      }),
      del: vi.fn(async (...keys: string[]) => {
        let count = 0;
        for (const k of keys) {
          if (inMemoryStore.delete(k)) count++;
        }
        return count;
      }),
      expire: vi.fn(async (key: string, seconds: number) => {
        const item = inMemoryStore.get(key);
        if (item) {
          item.ex = seconds;
          return 1;
        }
        return 0;
      }),
    };
    setRedisClient(mockRedis);
  });

  it("acquires an atomic lock with 120s lease when key is not present", async () => {
    const res = await acquireIdempotencyLock("req-1");
    expect(res.status).toBe("ACQUIRED");
    if (res.status === "ACQUIRED") {
      expect(res.lockKey).toBe("idempotency:req-1");
    }

    expect(mockRedis.set).toHaveBeenCalledWith(
      "idempotency:req-1",
      expect.stringContaining('"status":"IN_PROGRESS"'),
      "EX",
      IDEMPOTENCY_LOCK_LEASE_SECONDS,
      "NX"
    );
  });

  it("returns IN_PROGRESS with Retry-After: 5 if key is already locked", async () => {
    // First acquisition
    const first = await acquireIdempotencyLock("req-conflict");
    expect(first.status).toBe("ACQUIRED");

    // Concurrent second acquisition
    const second = await acquireIdempotencyLock("req-conflict");
    expect(second.status).toBe("IN_PROGRESS");
    if (second.status === "IN_PROGRESS") {
      expect(second.retryAfter).toBe(IDEMPOTENCY_RETRY_AFTER_SECONDS);
    }
  });

  it("returns COMPLETED with cached response if key was previously completed", async () => {
    const cachedData = { body: { success: true, data: { id: "batch-123" } }, statusCode: 201 };
    await saveIdempotentResponse("req-cached", cachedData);

    const lock = await acquireIdempotencyLock("req-cached");
    expect(lock.status).toBe("COMPLETED");
    if (lock.status === "COMPLETED") {
      expect(lock.cachedResponse.body).toEqual(cachedData.body);
      expect(lock.cachedResponse.statusCode).toBe(201);
    }

    // Verify 24 hour TTL (86,400 seconds)
    expect(mockRedis.set).toHaveBeenCalledWith(
      "idempotency:req-cached",
      expect.stringContaining('"status":"COMPLETED"'),
      "EX",
      IDEMPOTENCY_CACHE_TTL_SECONDS
    );
  });

  it("releases in-flight lock on releaseIdempotencyLock", async () => {
    await acquireIdempotencyLock("req-err");
    expect(inMemoryStore.has("idempotency:req-err")).toBe(true);

    await releaseIdempotencyLock("req-err");
    expect(inMemoryStore.has("idempotency:req-err")).toBe(false);
  });

  it("gracefully returns BYPASS when Redis throws an unexpected error", async () => {
    (mockRedis.get as any).mockRejectedValueOnce(new Error("Connection refused"));
    const res = await acquireIdempotencyLock("req-fail");
    expect(res.status).toBe("BYPASS");
  });

  it("formats 409 Conflict with Retry-After header correctly", () => {
    const res = makeIdempotencyConflictResponse(5);
    expect(res.status).toBe(409);
    expect(res.headers.get("Retry-After")).toBe("5");
  });

  it("formats idempotent replay response with Idempotent-Replay: true header", () => {
    const res = makeIdempotentReplayResponse({
      body: { success: true, id: "b-1" },
      statusCode: 201,
    });
    expect(res.status).toBe(201);
    expect(res.headers.get("Idempotent-Replay")).toBe("true");
  });
});

describe("POST /api/batches with Redis distributed idempotency", () => {
  let inMemoryStore: Map<string, { value: string; ex?: number }>;
  let mockRedis: RedisClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthContext.mockResolvedValue({ userId: USER_ID });
    mockFindFirst.mockResolvedValue(null);
    mockFindUnique.mockResolvedValue(makeBatch());
    mockCreateMany.mockResolvedValue({ count: VALID_RECIPIENTS.length });
    mockBatchCreate.mockResolvedValue(makeBatch({ payments: undefined }));
    mockTransaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback({
        batch: { create: mockBatchCreate, findUnique: mockFindUnique },
        payment: { createMany: mockCreateMany },
      })
    );

    inMemoryStore = new Map();
    mockRedis = {
      get: vi.fn(async (key: string) => {
        const item = inMemoryStore.get(key);
        return item ? item.value : null;
      }),
      set: vi.fn(async (key: string, value: string, ...args: any[]) => {
        const hasNx = args.includes("NX");
        const exIdx = args.indexOf("EX");
        const ex = exIdx !== -1 ? Number(args[exIdx + 1]) : undefined;

        if (hasNx && inMemoryStore.has(key)) {
          return null;
        }
        inMemoryStore.set(key, { value, ex });
        return "OK";
      }),
      del: vi.fn(async (...keys: string[]) => {
        let count = 0;
        for (const k of keys) {
          if (inMemoryStore.delete(k)) count++;
        }
        return count;
      }),
      expire: vi.fn(async (key: string, seconds: number) => {
        const item = inMemoryStore.get(key);
        if (item) {
          item.ex = seconds;
          return 1;
        }
        return 0;
      }),
    };
    setRedisClient(mockRedis);
  });

  it("creates batch and caches 201 response with 24h expiration in Redis", async () => {
    const res = await POST(
      makeRequest(makeBody(), { "Idempotency-Key": IDEMPOTENCY_KEY })
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.id).toBe(BATCH_ID);

    // Verify Redis lock was acquired
    expect(mockRedis.set).toHaveBeenCalledWith(
      `idempotency:${IDEMPOTENCY_KEY}`,
      expect.stringContaining('"status":"IN_PROGRESS"'),
      "EX",
      120,
      "NX"
    );

    // Verify final 201 response was cached with 24h TTL
    expect(mockRedis.set).toHaveBeenCalledWith(
      `idempotency:${IDEMPOTENCY_KEY}`,
      expect.stringContaining('"status":"COMPLETED"'),
      "EX",
      86400
    );
  });

  it("rejects concurrent submission with identical idempotency key with 409 and Retry-After: 5", async () => {
    // Simulate an in-flight request holding the lock
    inMemoryStore.set(`idempotency:${IDEMPOTENCY_KEY}`, {
      value: JSON.stringify({ status: "IN_PROGRESS", createdAt: Date.now() }),
      ex: 120,
    });

    const res = await POST(
      makeRequest(makeBody(), { "Idempotency-Key": IDEMPOTENCY_KEY })
    );

    expect(res.status).toBe(409);
    expect(res.headers.get("Retry-After")).toBe("5");
    const body = await res.json();
    expect(body.error.code).toBe("CONFLICT");

    // Did not touch DB
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockBatchCreate).not.toHaveBeenCalled();
  });

  it("returns cached 201 response with Idempotent-Replay: true header on retry after completion", async () => {
    // 1. Initial request creates batch and populates Redis cache
    const initialRes = await POST(
      makeRequest(makeBody(), { "Idempotency-Key": IDEMPOTENCY_KEY })
    );
    expect(initialRes.status).toBe(201);
    expect(initialRes.headers.get("Idempotent-Replay")).toBeNull();

    // Reset DB mocks to ensure retry doesn't touch DB
    mockTransaction.mockClear();
    mockBatchCreate.mockClear();
    mockFindFirst.mockClear();

    // 2. Retry with same key
    const retryRes = await POST(
      makeRequest(makeBody(), { "Idempotency-Key": IDEMPOTENCY_KEY })
    );

    expect(retryRes.status).toBe(201);
    expect(retryRes.headers.get("Idempotent-Replay")).toBe("true");
    const retryBody = await retryRes.json();
    expect(retryBody.data.id).toBe(BATCH_ID);

    // DB was never called during replay
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockBatchCreate).not.toHaveBeenCalled();
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it("releases in-flight lock if batch creation fails, allowing retry", async () => {
    mockTransaction.mockRejectedValueOnce(new Error("Database transaction aborted"));

    const failRes = await POST(
      makeRequest(makeBody(), { "Idempotency-Key": IDEMPOTENCY_KEY })
    );
    expect(failRes.status).toBe(500);

    // Lock was released via del
    expect(mockRedis.del).toHaveBeenCalledWith(`idempotency:${IDEMPOTENCY_KEY}`);
    expect(inMemoryStore.has(`idempotency:${IDEMPOTENCY_KEY}`)).toBe(false);
  });

  it("gracefully falls back to database constraints when Redis is unavailable", async () => {
    resetRedisClient();
    delete process.env.REDIS_URL;

    const res = await POST(
      makeRequest(makeBody(), { "Idempotency-Key": IDEMPOTENCY_KEY })
    );

    expect(res.status).toBe(201);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });
});
