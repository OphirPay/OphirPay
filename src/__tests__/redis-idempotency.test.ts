// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Hoisted mocks for database, auth, and redis
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
  acquireIdempotencyLock,
  completeIdempotency,
  releaseIdempotencyLock,
  DEFAULT_LOCK_LEASE_SECONDS,
  DEFAULT_CACHE_TTL_SECONDS,
} from "@/lib/idempotency";
import {
  setRedisClientForTesting,
  resetRedisForTesting,
  type RedisClientLike,
} from "@/lib/redis";

function csrfHeaders(): Record<string, string> {
  const token = generateCsrfToken();
  return { "x-csrf-token": token, cookie: `__Host-csrf=${token}` };
}

const USER_ID = "user-123";
const BATCH_ID = "batch-789";
const TEST_KEY = "test-idempotency-key-abc-123";

const VALID_RECIPIENTS = [
  {
    address: "GDHJ3K2LQ7F5XQZPX6YWNMYKXWQXVZKBJZQFYX3F6KRLV4WDXHJMB2UY",
    amount: 100,
    assetCode: "XLM",
    memo: "p1",
  },
];

function makeBody(overrides: Record<string, unknown> = {}) {
  return {
    name: "Engineering payroll",
    description: "Bi-weekly payouts",
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
    description: "Bi-weekly payouts",
    idempotencyKey: TEST_KEY,
    status: "CREATED",
    createdAt: new Date("2026-10-18T00:00:00.000Z"),
    updatedAt: new Date("2026-10-18T00:00:00.000Z"),
    payments: VALID_RECIPIENTS.map((r, i) => ({
      id: `payment-${i}`,
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

/**
 * In-memory Mock Redis implementation for atomic SET NX EX testing.
 */
class MockRedisStore implements RedisClientLike {
  private store = new Map<string, { value: string; expiresAt: number }>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ...args: (string | number)[]): Promise<unknown> {
    let ttlSeconds = 0;
    let nx = false;

    for (let i = 0; i < args.length; i++) {
      const arg = String(args[i]).toUpperCase();
      if (arg === "EX" && i + 1 < args.length) {
        ttlSeconds = Number(args[i + 1]);
        i++;
      } else if (arg === "NX") {
        nx = true;
      }
    }

    const existing = await this.get(key);
    if (nx && existing !== null) {
      return null; // Key exists, NX check fails
    }

    const expiresAt = ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : Infinity;
    this.store.set(key, { value, expiresAt });
    return "OK";
  }

  async del(...keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      if (this.store.delete(key)) count++;
    }
    return count;
  }

  async expire(key: string, seconds: number): Promise<number> {
    const entry = this.store.get(key);
    if (!entry) return 0;
    entry.expiresAt = Date.now() + seconds * 1000;
    return 1;
  }

  async ttl(key: string): Promise<number> {
    const entry = this.store.get(key);
    if (!entry) return -2;
    const remainingMs = entry.expiresAt - Date.now();
    if (remainingMs <= 0) {
      this.store.delete(key);
      return -2;
    }
    return Math.ceil(remainingMs / 1000);
  }

  clear() {
    this.store.clear();
  }
}

describe("Redis-backed Idempotency Lock and Cache Suite (Issue #1366)", () => {
  let mockRedis: MockRedisStore;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis = new MockRedisStore();
    setRedisClientForTesting(mockRedis);
    vi.stubEnv("REDIS_URL", "redis://localhost:6379");

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
  });

  afterEach(async () => {
    await resetRedisForTesting();
    vi.unstubAllEnvs();
  });

  describe("Unit tests: acquireIdempotencyLock, completeIdempotency, releaseIdempotencyLock", () => {
    it("successfully acquires an atomic lock with default 120s lease", async () => {
      const lockRes = await acquireIdempotencyLock(TEST_KEY);
      expect(lockRes.status).toBe("acquired");

      const raw = await mockRedis.get(`idempotency:${TEST_KEY}`);
      expect(raw).toBeTruthy();
      const parsed = JSON.parse(raw!);
      expect(parsed.status).toBe("processing");
      expect(parsed.startedAt).toBeTypeOf("number");

      const ttl = await mockRedis.ttl(`idempotency:${TEST_KEY}`);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(DEFAULT_LOCK_LEASE_SECONDS);
    });

    it("returns in_flight and retryAfter 5 when a second concurrent request attempts same key", async () => {
      // First acquire succeeds
      const first = await acquireIdempotencyLock(TEST_KEY);
      expect(first.status).toBe("acquired");

      // Concurrent second acquire on the same key
      const second = await acquireIdempotencyLock(TEST_KEY);
      expect(second.status).toBe("in_flight");
      if (second.status === "in_flight") {
        expect(second.retryAfter).toBe(5);
      }
    });

    it("caches completed response for 24h and serves cached response on subsequent calls", async () => {
      await acquireIdempotencyLock(TEST_KEY);

      const cachedData = { id: BATCH_ID, name: "Engineering payroll" };
      await completeIdempotency(TEST_KEY, { data: cachedData, status: 201 });

      const replay = await acquireIdempotencyLock(TEST_KEY);
      expect(replay.status).toBe("cached");
      if (replay.status === "cached") {
        expect(replay.response.data).toEqual(cachedData);
        expect(replay.response.status).toBe(201);
      }

      const ttl = await mockRedis.ttl(`idempotency:${TEST_KEY}`);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(DEFAULT_CACHE_TTL_SECONDS);
    });

    it("releases in-flight lock upon request error so it can be re-acquired", async () => {
      await acquireIdempotencyLock(TEST_KEY);
      expect((await acquireIdempotencyLock(TEST_KEY)).status).toBe("in_flight");

      await releaseIdempotencyLock(TEST_KEY);

      // Now lock is available again
      const retry = await acquireIdempotencyLock(TEST_KEY);
      expect(retry.status).toBe("acquired");
    });

    it("does not delete cached completed results during releaseIdempotencyLock", async () => {
      await completeIdempotency(TEST_KEY, { data: { id: BATCH_ID }, status: 201 });
      await releaseIdempotencyLock(TEST_KEY);

      const check = await acquireIdempotencyLock(TEST_KEY);
      expect(check.status).toBe("cached");
    });

    it("gracefully falls back when Redis is not configured or throws", async () => {
      setRedisClientForTesting(null);
      vi.stubEnv("REDIS_URL", "");

      const res = await acquireIdempotencyLock(TEST_KEY);
      expect(res.status).toBe("fallback");
    });
  });

  describe("Route integration: POST /api/batches with Redis-backed Idempotency", () => {
    it("rejects concurrent submissions with identical idempotency key with 409 and Retry-After: 5", async () => {
      // First request arrives and acquires the lock
      const lockRes = await acquireIdempotencyLock(TEST_KEY);
      expect(lockRes.status).toBe("acquired");

      // Concurrent request with same key
      const res = await POST(
        makeRequest(makeBody(), { "Idempotency-Key": TEST_KEY })
      );

      expect(res.status).toBe(409);
      expect(res.headers.get("retry-after")).toBe("5");

      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("CONFLICT");
      expect(body.error.message).toContain("currently processing");

      // Database transaction should not have executed for the rejected second request
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it("returns cached 201 response with Idempotent-Replay: true on retries after completion", async () => {
      // Initial submission succeeds
      const firstRes = await POST(
        makeRequest(makeBody(), { "Idempotency-Key": TEST_KEY })
      );
      expect(firstRes.status).toBe(201);
      expect(firstRes.headers.get("Idempotent-Replay")).toBeNull();

      // Subsequent retry with the same key
      const retryRes = await POST(
        makeRequest(makeBody(), { "Idempotency-Key": TEST_KEY })
      );

      expect(retryRes.status).toBe(201);
      expect(retryRes.headers.get("Idempotent-Replay")).toBe("true");

      const body = await retryRes.json();
      expect(body.success).toBe(true);
      expect(body.data.id).toBe(BATCH_ID);
      expect(body.meta.deduplicated).toBe(true);
      expect(body.meta.cached).toBe(true);

      // Verify no extra DB writes occurred on the replay
      expect(mockTransaction).toHaveBeenCalledTimes(1);
    });

    it("releases lock and allows retry when initial batch transaction fails", async () => {
      // First attempt fails inside transaction
      mockTransaction.mockRejectedValueOnce(new Error("Database connection timeout"));

      const failRes = await POST(
        makeRequest(makeBody(), { "Idempotency-Key": TEST_KEY })
      );
      expect(failRes.status).toBe(500);

      // Lock should have been released by error cleanup
      const raw = await mockRedis.get(`idempotency:${TEST_KEY}`);
      expect(raw).toBeNull();

      // Subsequent attempt succeeds without being blocked by 409
      const secondRes = await POST(
        makeRequest(makeBody(), { "Idempotency-Key": TEST_KEY })
      );
      expect(secondRes.status).toBe(201);
      const secondBody = await secondRes.json();
      expect(secondBody.data.id).toBe(BATCH_ID);
    });

    it("gracefully falls back to DB uniqueness when Redis is unconfigured", async () => {
      setRedisClientForTesting(null);
      vi.stubEnv("REDIS_URL", "");

      const res = await POST(
        makeRequest(makeBody(), { "Idempotency-Key": TEST_KEY })
      );

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.id).toBe(BATCH_ID);
      expect(mockTransaction).toHaveBeenCalledTimes(1);
    });
  });
});
