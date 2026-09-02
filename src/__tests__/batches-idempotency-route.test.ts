// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockFindUnique,
  mockCreate,
  mockCreateMany,
  mockFindMany,
  mockCount,
  mockGetAuthContext,
} = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockCreate: vi.fn(),
  mockCreateMany: vi.fn(),
  mockFindMany: vi.fn(),
  mockCount: vi.fn(),
  mockGetAuthContext: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    batch: {
      findUnique: mockFindUnique,
      create: mockCreate,
      findMany: mockFindMany,
      count: mockCount,
    },
    payment: {
      createMany: mockCreateMany,
    },
  },
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: mockGetAuthContext,
}));

import { POST } from "@/app/api/batches/route";

const USER_ID = "user-1";

const VALID_STELLAR = "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/batches", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const BATCH_RESPONSE = {
  id: "batch-1",
  userId: USER_ID,
  name: "Payroll Jan",
  description: null,
  status: "CREATED",
  idempotencyKey: "test-key-123",
  createdAt: new Date("2026-08-26T10:00:00.000Z"),
  updatedAt: new Date("2026-08-26T10:00:00.000Z"),
  payments: [],
};

const VALID_BODY = {
  name: "Payroll Jan",
  sourceAccountId: "acct-1",
  recipients: [
    {
      address: VALID_STELLAR,
      amount: 500,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthContext.mockResolvedValue({ userId: USER_ID });
  mockCreate.mockResolvedValue({ id: "batch-1", userId: USER_ID });
  mockCreateMany.mockResolvedValue({ count: 1 });
  mockFindUnique.mockResolvedValue(null);
  mockFindMany.mockResolvedValue([]);
  mockCount.mockResolvedValue(0);
});

describe("POST /api/batches — idempotency", () => {
  describe("when idempotencyKey is provided", () => {
    it("creates a new batch with the provided key", async () => {
      mockFindUnique.mockResolvedValueOnce(null);
      mockCreate.mockResolvedValueOnce({
        id: "batch-1",
        userId: USER_ID,
        idempotencyKey: "my-key",
      });
      mockFindUnique.mockResolvedValueOnce({
        ...BATCH_RESPONSE,
        idempotencyKey: "my-key",
      });

      const res = await POST(
        makeRequest({ ...VALID_BODY, idempotencyKey: "my-key" })
      );

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.idempotencyKey).toBe("my-key");
      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          idempotencyKey: "my-key",
        }),
      });
    });

    it("returns existing batch and 409 when batch is COMPLETED", async () => {
      mockFindUnique.mockResolvedValue({
        ...BATCH_RESPONSE,
        status: "COMPLETED",
        idempotencyKey: "existing-key",
      });

      const res = await POST(
        makeRequest({ ...VALID_BODY, idempotencyKey: "existing-key" })
      );

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.code).toBe("CONFLICT");
      expect(body.error.message).toContain("already completed");
      // No new batch or payments should be created.
      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockCreateMany).not.toHaveBeenCalled();
    });

    it("returns existing batch and 409 when batch is PROCESSING", async () => {
      mockFindUnique.mockResolvedValue({
        ...BATCH_RESPONSE,
        status: "PROCESSING",
        idempotencyKey: "existing-key",
      });

      const res = await POST(
        makeRequest({ ...VALID_BODY, idempotencyKey: "existing-key" })
      );

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.code).toBe("CONFLICT");
      expect(body.error.message).toContain("already processing");
    });

    it("returns existing batch with resumed:true when CREATED (partial retry)", async () => {
      mockFindUnique.mockResolvedValue({
        ...BATCH_RESPONSE,
        status: "CREATED",
        idempotencyKey: "resume-key",
        payments: [{ id: "pay-1", status: "CREATED" }],
      });

      const res = await POST(
        makeRequest({ ...VALID_BODY, idempotencyKey: "resume-key" })
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.idempotencyKey).toBe("resume-key");
      expect(body.meta.resumed).toBe(true);
      // No new batch or payments should be created.
      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockCreateMany).not.toHaveBeenCalled();
    });

    it("returns existing batch with resumed:true when PARTIALLY_COMPLETED", async () => {
      mockFindUnique.mockResolvedValue({
        ...BATCH_RESPONSE,
        status: "PARTIALLY_COMPLETED",
        idempotencyKey: "resume-key-2",
        payments: [
          { id: "pay-1", status: "COMPLETED" },
          { id: "pay-2", status: "CREATED" },
        ],
      });

      const res = await POST(
        makeRequest({ ...VALID_BODY, idempotencyKey: "resume-key-2" })
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.meta.resumed).toBe(true);
    });

    it("returns existing batch with resumed:true when FAILED", async () => {
      mockFindUnique.mockResolvedValue({
        ...BATCH_RESPONSE,
        status: "FAILED",
        idempotencyKey: "resume-key-3",
        payments: [{ id: "pay-1", status: "FAILED" }],
      });

      const res = await POST(
        makeRequest({ ...VALID_BODY, idempotencyKey: "resume-key-3" })
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.meta.resumed).toBe(true);
    });
  });

  describe("when idempotencyKey is not provided", () => {
    it("creates a batch with a server-generated idempotency key", async () => {
      mockCreate.mockResolvedValueOnce({
        id: "batch-1",
        userId: USER_ID,
        idempotencyKey: "server-generated-uuid",
      });
      mockFindUnique.mockResolvedValueOnce({
        ...BATCH_RESPONSE,
        idempotencyKey: "server-generated-uuid",
      });

      const res = await POST(makeRequest(VALID_BODY));

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.idempotencyKey).toBeDefined();
      expect(typeof body.data.idempotencyKey).toBe("string");
    });

    it("does not check for existing batch (no key = no dedup)", async () => {
      mockCreate.mockResolvedValueOnce({
        id: "batch-1",
        userId: USER_ID,
        idempotencyKey: "generated",
      });
      mockFindUnique.mockResolvedValueOnce({
        ...BATCH_RESPONSE,
        idempotencyKey: "generated",
      });

      await POST(makeRequest(VALID_BODY));

      // findUnique should only be called once (to fetch the result), not for dedup check
      expect(mockFindUnique).toHaveBeenCalledTimes(1);
    });
  });
});

describe("POST /api/batches — basic validation", () => {
  it("rejects unauthenticated callers with 401", async () => {
    mockGetAuthContext.mockResolvedValue(null);

    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(401);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects invalid request body", async () => {
    const res = await POST(makeRequest({}));

    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects empty recipients array", async () => {
    const res = await POST(
      makeRequest({
        name: "Test",
        sourceAccountId: "acct-1",
        recipients: [],
      })
    );

    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
