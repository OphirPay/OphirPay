// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { Prisma } from "@prisma/client";

const {
  mockFindMany,
  mockFindFirst,
  mockFindUnique,
  mockCount,
  mockCreate,
  mockUpdateMany,
  mockGetAuthContext,
} = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockFindFirst: vi.fn(),
  mockFindUnique: vi.fn(),
  mockCount: vi.fn(),
  mockCreate: vi.fn(),
  mockUpdateMany: vi.fn(),
  mockGetAuthContext: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    payment: {
      findMany: mockFindMany,
      findFirst: mockFindFirst,
      findUnique: mockFindUnique,
      count: mockCount,
      create: mockCreate,
      updateMany: mockUpdateMany,
    },
  },
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: mockGetAuthContext,
}));

vi.mock("@/lib/webhook-dispatcher", () => ({
  dispatchWebhookEventAsync: vi.fn(),
}));

vi.mock("@/lib/metrics-counters", () => ({
  incMetric: vi.fn(),
  recordEndpointLatency: vi.fn(),
}));

import {
  PROBLEM_JSON_CONTENT_TYPE,
  formatProblemDetails,
  mapZodErrors,
  problemResponse,
  validationProblem,
  badRequestProblem,
  unauthorizedProblem,
  forbiddenProblem,
  notFoundProblem,
  conflictProblem,
  serverProblem,
  handleProblemApiError,
} from "@/lib/api-errors";
import { generateCsrfToken } from "@/lib/csrf";
import { GET as getPayments, POST as postPayments } from "@/app/api/payments/route";
import { POST as cancelPayment } from "@/app/api/payments/cancel/route";
import { POST as retryPayment } from "@/app/api/payments/retry/route";
import {
  GET as getPaymentById,
  PATCH as patchPaymentById,
  DELETE as deletePaymentById,
} from "@/app/api/payments/[id]/route";
import { GET as exportPayments } from "@/app/api/payments/export/route";
import {
  OphirPayClient,
  OphirPayError,
} from "../../packages/ophirpay-client/index.js";

function csrfHeaders(): Record<string, string> {
  const token = generateCsrfToken();
  return { "x-csrf-token": token, cookie: `__Host-csrf=${token}` };
}

function makeMutatingRequest(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

const AUTH_USER = {
  userId: "user-rfc7807",
  publicKey: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
};

const VALID_CUID = "cm0py0000000000000000001";

describe("RFC 7807 Problem Details helper (src/lib/api-errors.ts)", () => {
  it("formatProblemDetails formats type, title, status, detail, and instance", () => {
    const problem = formatProblemDetails({
      type: "https://api.ophirpay.com/problems/validation-error",
      title: "Validation Error",
      status: 400,
      detail: "Amount must be positive",
      instance: "/api/payments",
    });

    expect(problem).toEqual({
      type: "https://api.ophirpay.com/problems/validation-error",
      title: "Validation Error",
      status: 400,
      detail: "Amount must be positive",
      instance: "/api/payments",
    });
  });

  it("formatProblemDetails defaults type to about:blank and title from HTTP status", () => {
    const problem = formatProblemDetails({
      status: 404,
      detail: "Payment not found",
    });

    expect(problem.type).toBe("about:blank");
    expect(problem.title).toBe("Not Found");
    expect(problem.status).toBe(404);
    expect(problem.detail).toBe("Payment not found");
    expect(problem.instance).toBeUndefined();
  });

  it("mapZodErrors maps Zod schema issues into field, path, message, and code", () => {
    const schema = z.object({
      amount: z.number().positive("Amount must be positive"),
      txHash: z.string().min(1, "Transaction hash is required"),
    });
    const parsed = schema.safeParse({ amount: -10, txHash: "" });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    const errors = mapZodErrors(parsed.error);
    expect(errors).toEqual([
      expect.objectContaining({
        field: "amount",
        path: "amount",
        message: "Amount must be positive",
      }),
      expect.objectContaining({
        field: "txHash",
        path: "txHash",
        message: "Transaction hash is required",
      }),
    ]);
  });

  it("problemResponse sets Content-Type to application/problem+json", async () => {
    const res = problemResponse({
      type: "https://api.ophirpay.com/problems/conflict",
      title: "Conflict",
      status: 409,
      detail: "Only failed payments can be retried",
      instance: "/api/payments/retry",
    });

    expect(res.status).toBe(409);
    expect(res.headers.get("content-type")).toBe(PROBLEM_JSON_CONTENT_TYPE);
    const body = await res.json();
    expect(body).toMatchObject({
      type: "https://api.ophirpay.com/problems/conflict",
      title: "Conflict",
      status: 409,
      detail: "Only failed payments can be retried",
      instance: "/api/payments/retry",
    });
  });

  it("convenience helpers produce valid RFC 7807 responses with application/problem+json", async () => {
    const valProblem = validationProblem(
      new z.ZodError([{ code: "custom", path: ["amount"], message: "Invalid" }]),
      "/api/payments"
    );
    expect(valProblem.status).toBe(400);
    expect(valProblem.headers.get("content-type")).toBe(PROBLEM_JSON_CONTENT_TYPE);

    const badReq = badRequestProblem("Invalid cursor", "/api/payments");
    expect(badReq.status).toBe(400);
    expect(badReq.headers.get("content-type")).toBe(PROBLEM_JSON_CONTENT_TYPE);

    const unauth = unauthorizedProblem("Auth required", "/api/payments");
    expect(unauth.status).toBe(401);
    expect(unauth.headers.get("content-type")).toBe(PROBLEM_JSON_CONTENT_TYPE);

    const forbidden = forbiddenProblem("CSRF invalid", "/api/payments");
    expect(forbidden.status).toBe(403);
    expect(forbidden.headers.get("content-type")).toBe(PROBLEM_JSON_CONTENT_TYPE);

    const notFound = notFoundProblem("Payment", "/api/payments/cancel");
    expect(notFound.status).toBe(404);
    expect(notFound.headers.get("content-type")).toBe(PROBLEM_JSON_CONTENT_TYPE);

    const conflict = conflictProblem("State conflict", "/api/payments/retry");
    expect(conflict.status).toBe(409);
    expect(conflict.headers.get("content-type")).toBe(PROBLEM_JSON_CONTENT_TYPE);

    const server = serverProblem("Unexpected failure", "/api/payments");
    expect(server.status).toBe(500);
    expect(server.headers.get("content-type")).toBe(PROBLEM_JSON_CONTENT_TYPE);
  });

  it("handleProblemApiError maps Zod, Prisma, and generic errors to application/problem+json", async () => {
    const zodErr = new z.ZodError([
      { code: "custom", path: ["amount"], message: "Invalid amount" },
    ]);
    const zodRes = handleProblemApiError(zodErr, "POST /api/payments", "/api/payments");
    expect(zodRes.status).toBe(400);
    expect(zodRes.headers.get("content-type")).toBe(PROBLEM_JSON_CONTENT_TYPE);
    const zodBody = await zodRes.json();
    expect(zodBody.errors).toEqual([
      expect.objectContaining({ field: "amount", path: "amount", message: "Invalid amount" }),
    ]);

    const prismaErr = new Prisma.PrismaClientKnownRequestError("Unique constraint", {
      code: "P2002",
      clientVersion: "5.0",
      meta: { target: ["idempotencyKey"] },
    });
    const prismaRes = handleProblemApiError(prismaErr, "POST /api/payments", "/api/payments");
    expect(prismaRes.status).toBe(409);
    expect(prismaRes.headers.get("content-type")).toBe(PROBLEM_JSON_CONTENT_TYPE);

    const genericRes = handleProblemApiError(
      new Error("RPC node timeout"),
      "POST /api/payments",
      "/api/payments"
    );
    expect(genericRes.status).toBe(500);
    expect(genericRes.headers.get("content-type")).toBe(PROBLEM_JSON_CONTENT_TYPE);
    const genericBody = await genericRes.json();
    expect(genericBody).toMatchObject({
      title: "Internal Server Error",
      status: 500,
      detail: "RPC node timeout",
      instance: "/api/payments",
    });
  });
});

describe("RFC 7807 error formatting across /api/payments routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthContext.mockResolvedValue(AUTH_USER);
  });

  describe("POST /api/payments & GET /api/payments", () => {
    it("returns 401 application/problem+json when unauthenticated", async () => {
      mockGetAuthContext.mockResolvedValueOnce(null);
      const res = await postPayments(
        makeMutatingRequest("http://localhost/api/payments", "POST", { amount: 10 })
      );

      expect(res.status).toBe(401);
      expect(res.headers.get("content-type")).toBe(PROBLEM_JSON_CONTENT_TYPE);
      const body = await res.json();
      expect(body).toMatchObject({
        type: "https://api.ophirpay.com/problems/unauthorized",
        title: "Unauthorized",
        status: 401,
        detail: expect.stringContaining("Authentication required"),
        instance: "/api/payments",
      });
    });

    it("returns 403 application/problem+json when CSRF token is missing", async () => {
      const res = await postPayments(
        new Request("http://localhost/api/payments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amount: 10 }),
        })
      );

      expect(res.status).toBe(403);
      expect(res.headers.get("content-type")).toBe(PROBLEM_JSON_CONTENT_TYPE);
      const body = await res.json();
      expect(body).toMatchObject({
        type: "https://api.ophirpay.com/problems/forbidden",
        title: "Forbidden",
        status: 403,
        instance: "/api/payments",
      });
    });

    it("returns 400 application/problem+json with Zod field error mappings on invalid body", async () => {
      const res = await postPayments(
        makeMutatingRequest("http://localhost/api/payments", "POST", {
          amount: -5,
          assetCode: "",
        })
      );

      expect(res.status).toBe(400);
      expect(res.headers.get("content-type")).toBe(PROBLEM_JSON_CONTENT_TYPE);
      const body = await res.json();
      expect(body).toMatchObject({
        type: "https://api.ophirpay.com/problems/validation-error",
        title: "Validation Error",
        status: 400,
        detail: "Request validation failed",
        instance: "/api/payments",
      });
      expect(Array.isArray(body.errors)).toBe(true);
      expect(body.errors.length).toBeGreaterThan(0);
      expect(body.errors[0]).toEqual(
        expect.objectContaining({
          field: expect.any(String),
          path: expect.any(String),
          message: expect.any(String),
        })
      );
    });

    it("GET /api/payments returns 400 application/problem+json on invalid query params", async () => {
      const res = await getPayments(new Request("http://localhost/api/payments?limit=999"));

      expect(res.status).toBe(400);
      expect(res.headers.get("content-type")).toBe(PROBLEM_JSON_CONTENT_TYPE);
      const body = await res.json();
      expect(body).toMatchObject({
        type: "https://api.ophirpay.com/problems/validation-error",
        title: "Validation Error",
        status: 400,
        instance: "/api/payments",
      });
      expect(body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: "limit", path: "limit" }),
        ])
      );
    });
  });

  describe("POST /api/payments/cancel", () => {
    it("returns 401 application/problem+json when unauthenticated", async () => {
      mockGetAuthContext.mockResolvedValueOnce(null);
      const res = await cancelPayment(
        makeMutatingRequest("http://localhost/api/payments/cancel", "POST", {
          txHash: "a".repeat(64),
        })
      );

      expect(res.status).toBe(401);
      expect(res.headers.get("content-type")).toBe(PROBLEM_JSON_CONTENT_TYPE);
      const body = await res.json();
      expect(body).toMatchObject({
        type: "https://api.ophirpay.com/problems/unauthorized",
        title: "Unauthorized",
        status: 401,
        instance: "/api/payments/cancel",
      });
    });

    it("returns 400 application/problem+json with field errors when txHash is missing", async () => {
      const res = await cancelPayment(
        makeMutatingRequest("http://localhost/api/payments/cancel", "POST", {})
      );

      expect(res.status).toBe(400);
      expect(res.headers.get("content-type")).toBe(PROBLEM_JSON_CONTENT_TYPE);
      const body = await res.json();
      expect(body).toMatchObject({
        type: "https://api.ophirpay.com/problems/validation-error",
        title: "Validation Error",
        status: 400,
        detail: "Request validation failed",
        instance: "/api/payments/cancel",
      });
      expect(body.errors).toEqual([
        expect.objectContaining({
          field: "txHash",
          path: "txHash",
        }),
      ]);
    });

    it("returns 404 application/problem+json when payment is not found", async () => {
      mockUpdateMany.mockResolvedValueOnce({ count: 0 });
      const res = await cancelPayment(
        makeMutatingRequest("http://localhost/api/payments/cancel", "POST", {
          txHash: "a".repeat(64),
        })
      );

      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toBe(PROBLEM_JSON_CONTENT_TYPE);
      const body = await res.json();
      expect(body).toMatchObject({
        type: "https://api.ophirpay.com/problems/not-found",
        title: "Not Found",
        status: 404,
        detail: "Payment not found",
        instance: "/api/payments/cancel",
      });
    });
  });

  describe("POST /api/payments/retry", () => {
    it("returns 400 application/problem+json with field errors when id is missing", async () => {
      const res = await retryPayment(
        makeMutatingRequest("http://localhost/api/payments/retry", "POST", {})
      );

      expect(res.status).toBe(400);
      expect(res.headers.get("content-type")).toBe(PROBLEM_JSON_CONTENT_TYPE);
      const body = await res.json();
      expect(body).toMatchObject({
        type: "https://api.ophirpay.com/problems/validation-error",
        title: "Validation Error",
        status: 400,
        detail: "Request validation failed",
        instance: "/api/payments/retry",
      });
      expect(body.errors).toEqual([
        expect.objectContaining({
          field: "id",
          path: "id",
        }),
      ]);
    });

    it("returns 404 application/problem+json when payment does not exist", async () => {
      mockFindFirst.mockResolvedValueOnce(null);
      const res = await retryPayment(
        makeMutatingRequest("http://localhost/api/payments/retry", "POST", {
          id: VALID_CUID,
        })
      );

      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toBe(PROBLEM_JSON_CONTENT_TYPE);
      const body = await res.json();
      expect(body).toMatchObject({
        type: "https://api.ophirpay.com/problems/not-found",
        title: "Not Found",
        status: 404,
        detail: "Payment not found",
        instance: "/api/payments/retry",
      });
    });

    it("returns 409 application/problem+json when payment status is not FAILED", async () => {
      mockFindFirst.mockResolvedValueOnce({
        id: VALID_CUID,
        userId: AUTH_USER.userId,
        status: "COMPLETED",
      });
      const res = await retryPayment(
        makeMutatingRequest("http://localhost/api/payments/retry", "POST", {
          id: VALID_CUID,
        })
      );

      expect(res.status).toBe(409);
      expect(res.headers.get("content-type")).toBe(PROBLEM_JSON_CONTENT_TYPE);
      const body = await res.json();
      expect(body).toMatchObject({
        type: "https://api.ophirpay.com/problems/conflict",
        title: "Conflict",
        status: 409,
        detail: "Only failed payments can be retried (current status: COMPLETED)",
        instance: "/api/payments/retry",
      });
    });
  });

  describe("/api/payments/[id] and /api/payments/export", () => {
    it("GET /api/payments/[id] returns 404 application/problem+json when missing", async () => {
      mockFindFirst.mockResolvedValueOnce(null);
      const res = await getPaymentById(
        new Request(`http://localhost/api/payments/${VALID_CUID}`),
        { params: Promise.resolve({ id: VALID_CUID }) }
      );

      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toBe(PROBLEM_JSON_CONTENT_TYPE);
      const body = await res.json();
      expect(body).toMatchObject({
        type: "https://api.ophirpay.com/problems/not-found",
        title: "Not Found",
        status: 404,
        detail: "Payment not found",
        instance: `/api/payments/${VALID_CUID}`,
      });
    });

    it("PATCH and DELETE /api/payments/[id] return application/problem+json on error", async () => {
      mockUpdateMany.mockResolvedValueOnce({ count: 0 });
      const patchRes = await patchPaymentById(
        makeMutatingRequest(
          `http://localhost/api/payments/${VALID_CUID}`,
          "PATCH",
          { status: "SIGNED" }
        ),
        { params: Promise.resolve({ id: VALID_CUID }) }
      );
      expect(patchRes.status).toBe(404);
      expect(patchRes.headers.get("content-type")).toBe(PROBLEM_JSON_CONTENT_TYPE);

      mockUpdateMany.mockResolvedValueOnce({ count: 0 });
      const deleteRes = await deletePaymentById(
        makeMutatingRequest(`http://localhost/api/payments/${VALID_CUID}`, "DELETE"),
        { params: Promise.resolve({ id: VALID_CUID }) }
      );
      expect(deleteRes.status).toBe(404);
      expect(deleteRes.headers.get("content-type")).toBe(PROBLEM_JSON_CONTENT_TYPE);
    });

    it("GET /api/payments/export returns 401 application/problem+json when unauthenticated", async () => {
      mockGetAuthContext.mockResolvedValueOnce(null);
      const res = await exportPayments(new Request("http://localhost/api/payments/export"));
      expect(res.status).toBe(401);
      expect(res.headers.get("content-type")).toBe(PROBLEM_JSON_CONTENT_TYPE);
    });
  });
});

describe("@ophirpay/client RFC 7807 Problem Details parsing", () => {
  it("parses pure RFC 7807 problem+json responses without throwing a generic status error", async () => {
    const problemPayload = formatProblemDetails({
      type: "https://api.ophirpay.com/problems/validation-error",
      title: "Validation Error",
      status: 400,
      detail: "Amount must be greater than zero",
      instance: "/api/payments",
      code: "VALIDATION_ERROR",
      errors: [
        {
          field: "amount",
          path: "amount",
          message: "Amount must be greater than zero",
          code: "too_small",
        },
      ],
    });

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(problemPayload), {
        status: 400,
        headers: { "Content-Type": "application/problem+json" },
      })
    );

    const client = new OphirPayClient({
      baseUrl: "http://localhost:3000",
      apiKey: "op_live_test",
      fetchImpl: mockFetch,
    });

    await expect(
      client.createPayment({ amount: -10, assetCode: "XLM" })
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(OphirPayError);
      const ophirErr = err as InstanceType<typeof OphirPayError>;
      expect(ophirErr.message).toBe("Amount must be greater than zero");
      expect(ophirErr.message).not.toContain("Request failed with status");
      expect(ophirErr.status).toBe(400);
      expect(ophirErr.type).toBe("https://api.ophirpay.com/problems/validation-error");
      expect(ophirErr.title).toBe("Validation Error");
      expect(ophirErr.detail).toBe("Amount must be greater than zero");
      expect(ophirErr.instance).toBe("/api/payments");
      expect(ophirErr.code).toBe("VALIDATION_ERROR");
      expect(ophirErr.errors).toEqual([
        {
          field: "amount",
          path: "amount",
          message: "Amount must be greater than zero",
          code: "too_small",
        },
      ]);
      return true;
    });
  });

  it("parses RFC 7807 responses directly from POST /api/payments route handler", async () => {
    mockGetAuthContext.mockResolvedValueOnce(AUTH_USER);
    const client = new OphirPayClient({
      baseUrl: "http://localhost:3000",
      apiKey: "op_live_test",
      fetchImpl: async (input, init) =>
        postPayments(
          new Request(String(input), {
            method: init?.method ?? "POST",
            headers: {
              ...(init?.headers as Record<string, string>),
              ...csrfHeaders(),
            },
            body: init?.body,
          })
        ),
    });

    await expect(
      client.createPayment({ amount: -99 })
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(OphirPayError);
      const ophirErr = err as InstanceType<typeof OphirPayError>;
      expect(ophirErr.status).toBe(400);
      expect(ophirErr.type).toBe("https://api.ophirpay.com/problems/validation-error");
      expect(ophirErr.title).toBe("Validation Error");
      expect(ophirErr.detail).toBe("Request validation failed");
      expect(ophirErr.instance).toBe("/api/payments");
      expect(Array.isArray(ophirErr.errors)).toBe(true);
      expect(ophirErr.errors?.length).toBeGreaterThan(0);
      return true;
    });
  });
});
