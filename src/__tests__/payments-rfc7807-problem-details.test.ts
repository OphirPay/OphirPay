// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCreate, mockFindFirst, mockFindUnique, mockUpdateMany, mockGetAuthContext } =
  vi.hoisted(() => ({
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

import { generateCsrfToken } from "@/lib/csrf";
import { POST as createPayment } from "@/app/api/payments/route";
import { POST as cancelPayment } from "@/app/api/payments/cancel/route";
import { POST as retryPayment } from "@/app/api/payments/retry/route";
import { OphirPayClient, OphirPayError } from "../../packages/ophirpay-client";

function csrfHeaders(): Record<string, string> {
  const token = generateCsrfToken();
  return { "x-csrf-token": token, cookie: `__Host-csrf=${token}` };
}

describe("RFC 7807 Problem Details on Payment Mutation Routes (Issue #1364)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/payments", () => {
    it("returns application/problem+json on validation failure (400)", async () => {
      mockGetAuthContext.mockResolvedValue({ userId: "user-1" });

      const req = new Request("http://localhost/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ amount: "invalid-amount" }),
      });

      const res = await createPayment(req);
      expect(res.status).toBe(400);
      expect(res.headers.get("content-type")).toContain("application/problem+json");

      const problem = await res.json();
      expect(problem.type).toBe("https://api.ophirpay.com/errors/validation-error");
      expect(problem.title).toBe("Validation Error");
      expect(problem.status).toBe(400);
      expect(problem.instance).toBe("/api/payments");
      expect(problem.detail).toContain("Request validation failed");
      expect(Array.isArray(problem.errors)).toBe(true);
      expect(problem.errors.length).toBeGreaterThan(0);
    });

    it("returns application/problem+json on unauthorized request (401)", async () => {
      mockGetAuthContext.mockResolvedValue(null);

      const req = new Request("http://localhost/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ amount: 100 }),
      });

      const res = await createPayment(req);
      expect(res.status).toBe(401);
      expect(res.headers.get("content-type")).toContain("application/problem+json");

      const problem = await res.json();
      expect(problem.type).toBe("https://api.ophirpay.com/errors/unauthorized");
      expect(problem.title).toBe("Unauthorized");
      expect(problem.status).toBe(401);
      expect(problem.instance).toBe("/api/payments");
    });
  });

  describe("POST /api/payments/cancel", () => {
    it("returns application/problem+json on validation failure (400)", async () => {
      mockGetAuthContext.mockResolvedValue({ userId: "user-1" });

      const req = new Request("http://localhost/api/payments/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({}),
      });

      const res = await cancelPayment(req);
      expect(res.status).toBe(400);
      expect(res.headers.get("content-type")).toContain("application/problem+json");

      const problem = await res.json();
      expect(problem.title).toBe("Validation Error");
      expect(problem.status).toBe(400);
      expect(problem.instance).toBe("/api/payments/cancel");
      expect(problem.errors[0].field).toBe("txHash");
    });

    it("returns application/problem+json on not found (404)", async () => {
      mockGetAuthContext.mockResolvedValue({ userId: "user-1" });
      mockUpdateMany.mockResolvedValue({ count: 0 });

      const req = new Request("http://localhost/api/payments/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ txHash: "unknown_hash" }),
      });

      const res = await cancelPayment(req);
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toContain("application/problem+json");

      const problem = await res.json();
      expect(problem.type).toBe("https://api.ophirpay.com/errors/not-found");
      expect(problem.title).toBe("Not Found");
      expect(problem.status).toBe(404);
      expect(problem.detail).toBe("Payment not found");
      expect(problem.instance).toBe("/api/payments/cancel");
    });
  });

  describe("POST /api/payments/retry", () => {
    it("returns application/problem+json on conflict (409)", async () => {
      mockGetAuthContext.mockResolvedValue({ userId: "user-1" });
      mockFindFirst.mockResolvedValue({
        id: "pymt_1",
        userId: "user-1",
        status: "COMPLETED",
        deletedAt: null,
      });

      const req = new Request("http://localhost/api/payments/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ id: "pymt_1" }),
      });

      const res = await retryPayment(req);
      expect(res.status).toBe(409);
      expect(res.headers.get("content-type")).toContain("application/problem+json");

      const problem = await res.json();
      expect(problem.type).toBe("https://api.ophirpay.com/errors/conflict");
      expect(problem.title).toBe("Conflict");
      expect(problem.status).toBe(409);
      expect(problem.detail).toContain("Only failed payments can be retried");
      expect(problem.instance).toBe("/api/payments/retry");
    });
  });

  describe("Client SDK RFC 7807 parsing (@ophirpay/client)", () => {
    it("correctly parses RFC 7807 problem details without throwing generic error", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            type: "https://api.ophirpay.com/errors/validation-error",
            title: "Validation Error",
            status: 400,
            detail: "Amount must be greater than 0",
            instance: "/api/payments",
            code: "VALIDATION_ERROR",
            errors: [{ field: "amount", message: "Number must be greater than 0" }],
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/problem+json" },
          }
        )
      );

      const client = new OphirPayClient({
        baseUrl: "http://localhost:3000",
        fetchImpl: mockFetch as unknown as typeof fetch,
      });

      let caughtError: OphirPayError | null = null;
      try {
        await client.request("POST", "/api/payments", { body: { amount: -10 } });
      } catch (err) {
        caughtError = err as OphirPayError;
      }

      expect(caughtError).toBeInstanceOf(OphirPayError);
      expect(caughtError?.status).toBe(400);
      expect(caughtError?.message).toBe("Amount must be greater than 0");
      expect(caughtError?.code).toBe("VALIDATION_ERROR");
      expect(caughtError?.type).toBe("https://api.ophirpay.com/errors/validation-error");
      expect(caughtError?.title).toBe("Validation Error");
      expect(caughtError?.detail).toBe("Amount must be greater than 0");
      expect(caughtError?.instance).toBe("/api/payments");
      expect(caughtError?.errors).toEqual([
        { field: "amount", message: "Number must be greater than 0" },
      ]);
    });
  });
});
