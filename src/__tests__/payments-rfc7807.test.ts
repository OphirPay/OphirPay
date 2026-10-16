// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import {
  formatProblemDetails,
  problemResponse,
  problemJsonResponse,
  zodFieldErrors,
  zodValidationProblem,
  handlePaymentProblemError,
  PROBLEM_TYPE_BASE,
} from "@/lib/api-errors";
import { OphirPayClient, OphirPayError } from "../../packages/ophirpay-client/index.js";

const {
  mockCreate,
  mockFindFirst,
  mockFindUnique,
  mockUpdateMany,
  mockGetAuthContext,
} = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockFindFirst: vi.fn(),
  mockFindUnique: vi.fn(),
  mockUpdateMany: vi.fn(),
  mockGetAuthContext: vi.fn(),
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

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: mockGetAuthContext,
}));

vi.mock("@/lib/webhook-dispatcher", () => ({
  dispatchWebhookEventAsync: vi.fn(),
}));

vi.mock("@/lib/api-cache", () => ({
  invalidateCaches: vi.fn(),
}));

import { POST as createPayment } from "@/app/api/payments/route";
import { POST as cancelPayment } from "@/app/api/payments/cancel/route";
import { POST as retryPayment } from "@/app/api/payments/retry/route";
import { generateCsrfToken } from "@/lib/csrf";

function csrfHeaders(): Record<string, string> {
  const token = generateCsrfToken();
  return { "x-csrf-token": token, cookie: `__Host-csrf=${token}` };
}

describe("RFC 7807 Problem Details Helpers", () => {
  it("formats standard RFC 7807 problem details object", () => {
    const problem = formatProblemDetails(404, "Payment with ID 123 not found");

    expect(problem.status).toBe(404);
    expect(problem.type).toBe(`${PROBLEM_TYPE_BASE}/not-found`);
    expect(problem.title).toBe("Not Found");
    expect(problem.detail).toBe("Payment with ID 123 not found");
    expect(problem.code).toBe("NOT_FOUND");
  });

  it("supports options object with custom extensions", () => {
    const problem = formatProblemDetails({
      type: "https://docs.ophirpay.com/errors/custom-failure",
      title: "Custom Failure",
      status: 422,
      detail: "Invalid parameters supplied",
      customKey: "customValue",
    });

    expect(problem.status).toBe(422);
    expect(problem.type).toBe("https://docs.ophirpay.com/errors/custom-failure");
    expect(problem.title).toBe("Custom Failure");
    expect(problem.detail).toBe("Invalid parameters supplied");
    expect(problem.customKey).toBe("customValue");
  });

  it("formats Zod validation errors with field mappings", () => {
    const testSchema = z.object({
      amount: z.number().positive("Amount must be positive"),
      memo: z.string().min(1, "Memo cannot be empty"),
    });

    const parsed = testSchema.safeParse({ amount: -5, memo: "" });
    expect(parsed.success).toBe(false);

    if (!parsed.success) {
      const fieldErrors = zodFieldErrors(parsed.error);
      expect(fieldErrors).toEqual([
        { field: "amount", message: "Amount must be positive" },
        { field: "memo", message: "Memo cannot be empty" },
      ]);

      const res = zodValidationProblem(parsed.error);
      expect(res.status).toBe(400);
      expect(res.headers.get("content-type")).toBe("application/problem+json");
    }
  });

  it("problemJsonResponse creates Response from ProblemDetails object", async () => {
    const details = formatProblemDetails(404, "Item not found");
    const res = problemJsonResponse(details, { "X-Custom-Header": "value" });

    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    expect(res.headers.get("x-custom-header")).toBe("value");

    const json = await res.json();
    expect(json.status).toBe(404);
    expect(json.detail).toBe("Item not found");
  });

  it("handlePaymentProblemError formats standard errors into 500 problem details", async () => {
    const error = new Error("Database connection lost");
    const res = handlePaymentProblemError(error, "TEST /error");

    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toBe("application/problem+json");

    const json = await res.json();
    expect(json.status).toBe(500);
    expect(json.type).toBe(`${PROBLEM_TYPE_BASE}/internal-error`);
    expect(json.detail).toBe("Database connection lost");
  });

  it("problemResponse creates Response with application/problem+json", async () => {
    const res = problemResponse(400, "Bad request occurred");

    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toBe("application/problem+json");

    const json = await res.json();
    expect(json.status).toBe(400);
    expect(json.type).toBe(`${PROBLEM_TYPE_BASE}/bad-request`);
    expect(json.title).toBe("Bad Request");
    expect(json.detail).toBe("Bad request occurred");
  });
});

describe("Payment Routes RFC 7807 Compliance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthContext.mockResolvedValue({ userId: "user-123" });
  });

  describe("POST /api/payments", () => {
    it("returns 401 application/problem+json when unauthenticated", async () => {
      mockGetAuthContext.mockResolvedValue(null);

      const req = new Request("http://localhost/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ amount: 10, assetCode: "XLM" }),
      });

      const res = await createPayment(req);
      expect(res.status).toBe(401);
      expect(res.headers.get("content-type")).toBe("application/problem+json");

      const body = await res.json();
      expect(body.type).toBe(`${PROBLEM_TYPE_BASE}/unauthorized`);
      expect(body.title).toBe("Unauthorized");
      expect(body.status).toBe(401);
      expect(body.detail).toContain("Authentication required");
    });

    it("returns 400 application/problem+json on validation failure with errors array", async () => {
      const req = new Request("http://localhost/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ amount: -10 }), // missing assetCode, negative amount
      });

      const res = await createPayment(req);
      expect(res.status).toBe(400);
      expect(res.headers.get("content-type")).toBe("application/problem+json");

      const body = await res.json();
      expect(body.type).toBe(`${PROBLEM_TYPE_BASE}/validation-error`);
      expect(body.title).toBe("Validation Error");
      expect(body.status).toBe(400);
      expect(Array.isArray(body.errors)).toBe(true);
      expect(body.errors.length).toBeGreaterThan(0);
    });

    it("returns 403 application/problem+json on CSRF mismatch", async () => {
      const req = new Request("http://localhost/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" }, // no CSRF headers
        body: JSON.stringify({ amount: 10, assetCode: "XLM" }),
      });

      const res = await createPayment(req);
      expect(res.status).toBe(403);
      expect(res.headers.get("content-type")).toBe("application/problem+json");

      const body = await res.json();
      expect(body.type).toBe(`${PROBLEM_TYPE_BASE}/forbidden`);
      expect(body.title).toBe("Forbidden");
      expect(body.status).toBe(403);
    });
  });

  describe("POST /api/payments/cancel", () => {
    it("returns 401 application/problem+json when unauthenticated", async () => {
      mockGetAuthContext.mockResolvedValue(null);

      const req = new Request("http://localhost/api/payments/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ txHash: "abc123" }),
      });

      const res = await cancelPayment(req);
      expect(res.status).toBe(401);
      expect(res.headers.get("content-type")).toBe("application/problem+json");

      const body = await res.json();
      expect(body.type).toBe(`${PROBLEM_TYPE_BASE}/unauthorized`);
      expect(body.status).toBe(401);
    });

    it("returns 400 application/problem+json on missing txHash", async () => {
      const req = new Request("http://localhost/api/payments/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({}),
      });

      const res = await cancelPayment(req);
      expect(res.status).toBe(400);
      expect(res.headers.get("content-type")).toBe("application/problem+json");

      const body = await res.json();
      expect(body.type).toBe(`${PROBLEM_TYPE_BASE}/validation-error`);
      expect(body.status).toBe(400);
      expect(body.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: "txHash" })])
      );
    });

    it("returns 404 application/problem+json when payment not found", async () => {
      mockUpdateMany.mockResolvedValue({ count: 0 });

      const req = new Request("http://localhost/api/payments/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ txHash: "nonexistent-hash" }),
      });

      const res = await cancelPayment(req);
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toBe("application/problem+json");

      const body = await res.json();
      expect(body.type).toBe(`${PROBLEM_TYPE_BASE}/not-found`);
      expect(body.title).toBe("Not Found");
      expect(body.status).toBe(404);
      expect(body.detail).toBe("Payment not found");
    });
  });

  describe("POST /api/payments/retry", () => {
    it("returns 401 application/problem+json when unauthenticated", async () => {
      mockGetAuthContext.mockResolvedValue(null);

      const req = new Request("http://localhost/api/payments/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ id: "pay-1" }),
      });

      const res = await retryPayment(req);
      expect(res.status).toBe(401);
      expect(res.headers.get("content-type")).toBe("application/problem+json");

      const body = await res.json();
      expect(body.type).toBe(`${PROBLEM_TYPE_BASE}/unauthorized`);
      expect(body.status).toBe(401);
    });

    it("returns 404 application/problem+json when payment not found", async () => {
      mockFindFirst.mockResolvedValue(null);

      const req = new Request("http://localhost/api/payments/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ id: "nonexistent-id" }),
      });

      const res = await retryPayment(req);
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toBe("application/problem+json");

      const body = await res.json();
      expect(body.type).toBe(`${PROBLEM_TYPE_BASE}/not-found`);
      expect(body.status).toBe(404);
      expect(body.detail).toBe("Payment not found");
    });

    it("returns 409 application/problem+json when payment is not FAILED", async () => {
      mockFindFirst.mockResolvedValue({
        id: "pay-1",
        userId: "user-123",
        status: "COMPLETED",
      });

      const req = new Request("http://localhost/api/payments/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ id: "pay-1" }),
      });

      const res = await retryPayment(req);
      expect(res.status).toBe(409);
      expect(res.headers.get("content-type")).toBe("application/problem+json");

      const body = await res.json();
      expect(body.type).toBe(`${PROBLEM_TYPE_BASE}/conflict`);
      expect(body.title).toBe("Conflict");
      expect(body.status).toBe(409);
      expect(body.detail).toContain("Only failed payments can be retried");
    });
  });
});

describe("Client SDK RFC 7807 Parsing", () => {
  it("parses application/problem+json error into OphirPayError with RFC 7807 properties", async () => {
    const problemPayload = {
      type: "https://docs.ophirpay.com/errors/validation-error",
      title: "Validation Error",
      status: 400,
      detail: "Invalid payment amount",
      instance: "urn:request:req_12345",
      errors: [{ field: "amount", message: "Amount must be positive" }],
    };

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(problemPayload), {
        status: 400,
        headers: { "Content-Type": "application/problem+json" },
      })
    );

    const client = new OphirPayClient({
      baseUrl: "https://api.example.com",
      apiKey: "test_key",
      fetch: mockFetch,
    });

    let caughtError: OphirPayError | null = null;
    try {
      await client.createPayment({ amount: -5 });
    } catch (err) {
      caughtError = err as OphirPayError;
    }

    expect(caughtError).toBeInstanceOf(OphirPayError);
    expect(caughtError?.status).toBe(400);
    expect(caughtError?.code).toBe("VALIDATION_ERROR");
    expect(caughtError?.message).toBe("Invalid payment amount");
    expect(caughtError?.type).toBe("https://docs.ophirpay.com/errors/validation-error");
    expect(caughtError?.title).toBe("Validation Error");
    expect(caughtError?.detail).toBe("Invalid payment amount");
    expect(caughtError?.instance).toBe("urn:request:req_12345");
    expect(caughtError?.errors).toEqual([
      { field: "amount", message: "Amount must be positive" },
    ]);
  });

  it("preserves backward compatibility with legacy API error envelope", async () => {
    const legacyPayload = {
      success: false,
      error: {
        code: "UNAUTHORIZED",
        message: "Invalid API key",
        details: { hint: "Check credentials" },
      },
    };

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(legacyPayload), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      })
    );

    const client = new OphirPayClient({
      baseUrl: "https://api.example.com",
      apiKey: "bad_key",
      fetch: mockFetch,
    });

    let caughtError: OphirPayError | null = null;
    try {
      await client.getPayment("pay-1");
    } catch (err) {
      caughtError = err as OphirPayError;
    }

    expect(caughtError).toBeInstanceOf(OphirPayError);
    expect(caughtError?.status).toBe(401);
    expect(caughtError?.code).toBe("UNAUTHORIZED");
    expect(caughtError?.message).toBe("Invalid API key");
    expect(caughtError?.details).toEqual({ hint: "Check credentials" });
  });
});
