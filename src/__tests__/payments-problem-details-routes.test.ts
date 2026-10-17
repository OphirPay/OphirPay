// SPDX-License-Identifier: MIT

/**
 * RFC 7807 on the payment mutation routes (issue #1364).
 *
 * Acceptance criteria exercised here:
 *   • every error response is `application/problem+json`
 *   • Zod rejections become per-field `errors[]` entries
 *   • auth/CSRF/conflict/not-found failures keep their status and catalog code
 *   • a bad body is a 400, not a 500
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCreate, mockFindFirst, mockFindUnique, mockUpdateMany, mockAuth } =
  vi.hoisted(() => ({
    mockCreate: vi.fn(),
    mockFindFirst: vi.fn(),
    mockFindUnique: vi.fn(),
    mockUpdateMany: vi.fn(),
    mockAuth: vi.fn(),
  }));

vi.mock("@/lib/prisma", () => ({
  default: {
    payment: {
      create: mockCreate,
      findFirst: mockFindFirst,
      findUnique: mockFindUnique,
      updateMany: mockUpdateMany,
    },
  },
}));

vi.mock("@/lib/auth-session", () => ({ getAuthContext: mockAuth }));
vi.mock("@/lib/webhook-dispatcher", () => ({
  dispatchWebhookEventAsync: vi.fn(),
}));
vi.mock("@/lib/api-cache", () => ({ invalidateCaches: vi.fn() }));

import { generateCsrfToken } from "@/lib/csrf";
import { POST as createPayment } from "@/app/api/payments/route";
import { POST as cancelPayment } from "@/app/api/payments/cancel/route";
import { POST as retryPayment } from "@/app/api/payments/retry/route";
import { PROBLEM_CONTENT_TYPE } from "@/lib/problem-details";

const USER_ID = "user-1";
const VALID_STELLAR = "G" + "A".repeat(55);

function csrfHeaders(): Record<string, string> {
  const token = generateCsrfToken();
  return { "x-csrf-token": token, cookie: `__Host-csrf=${token}` };
}

function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...csrfHeaders(), ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function problem(response: Response) {
  expect(response.headers.get("content-type")).toBe(PROBLEM_CONTENT_TYPE);
  return (await response.json()) as {
    type: string;
    title: string;
    status: number;
    detail: string;
    code: string;
    instance?: string;
    errors?: { field: string; message: string }[];
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ userId: USER_ID });
  mockCreate.mockResolvedValue({
    id: "pay-1",
    amount: 10,
    assetCode: "XLM",
    status: "CREATED",
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
  });
});

describe("POST /api/payments", () => {
  it("rejects unauthenticated callers with a 401 problem document", async () => {
    mockAuth.mockResolvedValue(null);

    const response = await createPayment(
      post("/api/payments", { amount: 10 })
    );

    expect(response.status).toBe(401);
    expect(await problem(response)).toMatchObject({
      status: 401,
      code: "UNAUTHORIZED",
      instance: "/api/payments",
      type: "https://ophirpay.dev/problems/unauthorized",
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("converts the CSRF guard's legacy 403 into problem details", async () => {
    const response = await createPayment(
      new Request("http://localhost/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: 10 }),
      })
    );

    expect(response.status).toBe(403);
    expect(await problem(response)).toMatchObject({
      status: 403,
      code: "CSRF_INVALID",
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns field-level errors for an invalid memo", async () => {
    const response = await createPayment(
      post("/api/payments", {
        amount: 10,
        sourceAccountId: "src-1",
        destAddress: VALID_STELLAR,
        // 8 emoji = 32 UTF-8 bytes: over Stellar's 28-byte limit.
        memo: "😀".repeat(8),
      })
    );

    expect(response.status).toBe(400);
    const body = await problem(response);
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.detail).toBe(
      "Memo must be 28 bytes or fewer (non-ASCII characters count more)"
    );
    expect(body.errors).toEqual([
      expect.objectContaining({
        field: "memo",
        message: "Memo must be 28 bytes or fewer (non-ASCII characters count more)",
      }),
    ]);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("accepts an explicit MEMO_ID after validating it as an unsigned 64-bit value", async () => {
    const response = await createPayment(
      post("/api/payments", {
        amount: 10,
        sourceAccountId: "src-1",
        destAddress: VALID_STELLAR,
        memo: "18446744073709551615",
        memoType: "MEMO_ID",
      })
    );

    expect(response.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ memo: "18446744073709551615" }),
      })
    );
  });

  it("treats a non-JSON body as a 400 client error", async () => {
    const response = await createPayment(
      new Request("http://localhost/api/payments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...csrfHeaders(),
        },
        body: "{not json",
      })
    );

    expect(response.status).toBe(400);
    expect(await problem(response)).toMatchObject({
      code: "BAD_REQUEST",
      detail: "Request body must be valid JSON",
    });
  });
});

describe("POST /api/payments/cancel", () => {
  it("returns 404 as a problem document for an unknown hash", async () => {
    mockUpdateMany.mockResolvedValue({ count: 0 });

    const response = await cancelPayment(
      post("/api/payments/cancel", { txHash: "deadbeef" })
    );

    expect(response.status).toBe(404);
    expect(await problem(response)).toMatchObject({
      status: 404,
      code: "NOT_FOUND",
      detail: "Payment not found",
      instance: "/api/payments/cancel",
    });
  });

  it("returns 400 with the offending field for a missing txHash", async () => {
    const response = await cancelPayment(post("/api/payments/cancel", {}));

    expect(response.status).toBe(400);
    const body = await problem(response);
    expect(body.errors?.[0]).toMatchObject({ field: "txHash" });
  });
});

describe("POST /api/payments/retry", () => {
  const payment = {
    id: "pay-1",
    userId: USER_ID,
    status: "FAILED",
    memo: "payout-jul",
    amount: 25.5,
    deletedAt: null,
  };

  it("returns 409 with STATE_CONFLICT for a payment that is not FAILED", async () => {
    mockFindFirst.mockResolvedValue({ ...payment, status: "COMPLETED" });

    const response = await retryPayment(
      post("/api/payments/retry", { id: "pay-1" })
    );

    expect(response.status).toBe(409);
    expect(await problem(response)).toMatchObject({
      status: 409,
      code: "STATE_CONFLICT",
      type: "https://ophirpay.dev/problems/state-conflict",
    });
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown payment", async () => {
    mockFindFirst.mockResolvedValue(null);

    const response = await retryPayment(
      post("/api/payments/retry", { id: "missing" })
    );

    expect(response.status).toBe(404);
    expect((await problem(response)).code).toBe("NOT_FOUND");
  });

  it("keeps the 200 success envelope untouched", async () => {
    mockFindFirst.mockResolvedValue(payment);
    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockFindUnique.mockResolvedValue({ ...payment, status: "PENDING" });

    const response = await retryPayment(
      post("/api/payments/retry", { id: "pay-1" })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = (await response.json()) as { success: boolean; data: unknown };
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({ status: "PENDING" });
  });
});
