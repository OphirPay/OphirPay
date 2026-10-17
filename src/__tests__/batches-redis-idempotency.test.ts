// SPDX-License-Identifier: MIT

/**
 * Batch creation + the Redis idempotency lease (issue #1366), from the route's
 * point of view.
 *
 * The lease module's own atomicity is covered in `idempotency.test.ts`; here
 * the claim is scripted so each branch of the route can be asserted in
 * isolation: replay, in-flight rejection, and settling the lease on success
 * and on failure.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockFindFirst,
  mockFindUnique,
  mockCreateMany,
  mockBatchCreate,
  mockTransaction,
  mockGetAuthContext,
  mockClaim,
} = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockFindUnique: vi.fn(),
  mockCreateMany: vi.fn(),
  mockBatchCreate: vi.fn(),
  mockTransaction: vi.fn(),
  mockGetAuthContext: vi.fn(),
  mockClaim: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    batch: { findFirst: mockFindFirst, findUnique: mockFindUnique },
    payment: { createMany: mockCreateMany },
    $transaction: mockTransaction,
  },
}));

vi.mock("@/lib/auth-session", () => ({ getAuthContext: mockGetAuthContext }));

vi.mock("@/lib/idempotency", () => ({
  claimIdempotencyKey: mockClaim,
}));

import { generateCsrfToken } from "@/lib/csrf";
import { POST } from "@/app/api/batches/route";

const USER_ID = "user-1";
const BATCH_ID = "cm0bt0000000000000000001";
const KEY = "batch-key-12345";

function csrfHeaders(): Record<string, string> {
  const token = generateCsrfToken();
  return { "x-csrf-token": token, cookie: `__Host-csrf=${token}` };
}

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/batches", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...csrfHeaders(),
      "Idempotency-Key": KEY,
      ...headers,
    },
    body: JSON.stringify({
      name: "August payroll",
      sourceAccountId: "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U",
      recipients: [
        {
          address: "GDHJ3K2LQ7F5XQZPX6YWNMYKXWQXVZKBJZQFYX3F6KRLV4WDXHJMB2UY",
          amount: 1200,
          assetCode: "XLM",
          memo: "aug-1",
        },
      ],
    }),
  });
}

function makeBatch(overrides: Record<string, unknown> = {}) {
  return {
    id: BATCH_ID,
    userId: USER_ID,
    name: "August payroll",
    description: null,
    idempotencyKey: KEY,
    status: "CREATED",
    createdAt: new Date("2026-10-01T10:00:00.000Z"),
    updatedAt: new Date("2026-10-01T10:00:00.000Z"),
    payments: [],
    ...overrides,
  };
}

const release = vi.fn();
const remember = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  release.mockResolvedValue(undefined);
  remember.mockResolvedValue(undefined);

  mockGetAuthContext.mockResolvedValue({ userId: USER_ID });
  mockFindFirst.mockResolvedValue(null);
  mockFindUnique.mockResolvedValue(makeBatch());
  mockCreateMany.mockResolvedValue({ count: 1 });
  mockBatchCreate.mockResolvedValue(makeBatch());
  mockTransaction.mockImplementation(
    async (callback: (tx: unknown) => unknown) =>
      callback({
        batch: { create: mockBatchCreate, findUnique: mockFindUnique },
        payment: { createMany: mockCreateMany },
      })
  );
  mockClaim.mockResolvedValue({
    status: "acquired",
    remember,
    release,
  });
});

describe("POST /api/batches — Redis idempotency claim", () => {
  it("claims the key before doing any database work", async () => {
    await POST(makeRequest());

    expect(mockClaim).toHaveBeenCalledWith(USER_ID, KEY);
    expect(mockBatchCreate).toHaveBeenCalled();
  });

  it("does not claim anything when the client sends no key", async () => {
    const request = new Request("http://localhost/api/batches", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...csrfHeaders() },
      body: JSON.stringify({
        name: "August payroll",
        sourceAccountId: "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U",
        recipients: [
          {
            address: "GDHJ3K2LQ7F5XQZPX6YWNMYKXWQXVZKBJZQFYX3F6KRLV4WDXHJMB2UY",
            amount: 1,
          },
        ],
      }),
    });

    const res = await POST(request);
    expect(res.status).toBe(201);
    expect(mockClaim).not.toHaveBeenCalled();
  });

  it("replays a completed request as 201 with Idempotent-Replay", async () => {
    // Stored as the JSON text Redis holds, so the replay is byte-identical
    // rather than re-serialized from JavaScript objects.
    const cached = {
      success: true,
      data: { id: BATCH_ID, name: "August payroll", status: "CREATED" },
      meta: { timestamp: "2026-10-01T10:00:00.000Z" },
    };
    mockClaim.mockResolvedValue({
      status: "replay",
      response: { status: 201, body: cached },
    });

    const res = await POST(makeRequest());

    expect(res.status).toBe(201);
    expect(res.headers.get("Idempotent-Replay")).toBe("true");
    expect(await res.json()).toEqual(cached);
    // A replay must not touch the database: that is the point of caching it.
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(remember).not.toHaveBeenCalled();
  });

  it("replays a cached deduplicated 200 with its original status", async () => {
    // The first request may itself have been a database-level dedupe; a replay
    // must not promote that 200 to a 201 the client never received.
    mockClaim.mockResolvedValue({
      status: "replay",
      response: {
        status: 200,
        body: { success: true, data: { id: BATCH_ID }, meta: { deduplicated: true } },
      },
    });

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(res.headers.get("Idempotent-Replay")).toBe("true");
  });

  it("rejects a concurrent attempt with 409 and Retry-After", async () => {
    mockClaim.mockResolvedValue({ status: "in-flight", retryAfterSeconds: 5 });

    const res = await POST(makeRequest());

    expect(res.status).toBe(409);
    expect(res.headers.get("Retry-After")).toBe("5");
    const body = await res.json();
    expect(body.error.code).toBe("OPERATION_IN_PROGRESS");
    expect(body.error.message).toContain("already being processed");
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("caches the 201 envelope for future retries", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(201);

    expect(remember).toHaveBeenCalledTimes(1);
    const claimed = remember.mock.calls[0][0];
    expect(claimed.status).toBe(201);
    expect(claimed.body.success).toBe(true);
    expect(claimed.body.data.id).toBe(BATCH_ID);
    expect(release).not.toHaveBeenCalled();
  });

  it("releases the lease without caching when the request fails", async () => {
    mockClaim.mockResolvedValue({
      status: "acquired",
      remember,
      release,
    });
    mockTransaction.mockRejectedValue(new Error("database is down"));

    const res = await POST(makeRequest());

    expect(res.status).toBe(500);
    expect(release).toHaveBeenCalled();
    expect(remember).not.toHaveBeenCalled();
  });

  it("falls back to the database guard when Redis is unavailable", async () => {
    mockClaim.mockResolvedValue({ status: "unavailable" });

    const res = await POST(makeRequest());

    expect(res.status).toBe(201);
    expect(mockBatchCreate).toHaveBeenCalled();
    expect(remember).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  it("still deduplicates against the database when Redis has no cached response", async () => {
    // 24h cache expired (or the first attempt ran while Redis was down): the
    // durable unique key still prevents a duplicate batch.
    mockFindFirst.mockResolvedValue(makeBatch({ payments: [{ id: "p1" }] }));

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.meta.deduplicated).toBe(true);
    expect(mockBatchCreate).not.toHaveBeenCalled();
    // The deduplicated 200 is itself replayable afterwards.
    expect(remember).toHaveBeenCalledWith(
      expect.objectContaining({ status: 200 })
    );
  });
});
