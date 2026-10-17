// SPDX-License-Identifier: MIT

import { describe, it, test, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import {
  formatProblemDetails,
  validationProblem,
  badRequestProblem,
  unauthorizedProblem,
  forbiddenProblem,
  notFoundProblem,
  conflictProblem,
  rateLimitProblem,
  serverProblem,
  handleProblemError,
  isProblemDetails,
  getDefaultTitle,
  getDefaultType,
  mapZodIssuesToInvalidParams,
  PROBLEM_CONTENT_TYPE,
  type ProblemDetails,
} from "@/lib/api-errors";
import { OphirPayClient, OphirPayError } from "../packages/ophirpay-client/index.js";

describe("RFC 7807 Problem Details Specification - 5D Exhaustive Test Matrix", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // DIMENSION 1: Boundaries, Status Codes & Content-Type Clamping
  // =========================================================================
  describe("Dimension 1: Boundaries, Titles, Types and Content-Type Verification", () => {
    const statusTestCases: Array<[number, string, string]> = [
      [400, "Bad Request", "https://api.ophirpay.com/errors/bad-request"],
      [401, "Unauthorized", "https://api.ophirpay.com/errors/unauthorized"],
      [403, "Forbidden", "https://api.ophirpay.com/errors/insufficient-scope"],
      [404, "Not Found", "https://api.ophirpay.com/errors/not-found"],
      [405, "Method Not Allowed", "https://api.ophirpay.com/errors/method-not-allowed"],
      [409, "Conflict", "https://api.ophirpay.com/errors/conflict"],
      [422, "Unprocessable Entity", "https://api.ophirpay.com/errors/unprocessable-entity"],
      [429, "Too Many Requests", "https://api.ophirpay.com/errors/rate-limited"],
      [500, "Internal Server Error", "https://api.ophirpay.com/errors/internal-error"],
      [502, "Bad Gateway", "https://api.ophirpay.com/errors/bad-gateway"],
      [503, "Service Unavailable", "https://api.ophirpay.com/errors/service-unavailable"],
      [504, "Gateway Timeout", "https://api.ophirpay.com/errors/gateway-timeout"],
    ];

    test.each(statusTestCases)(
      "status %d correctly maps to default title '%s'",
      (status: number, expectedTitle: string, _type: string) => {
        expect(getDefaultTitle(status)).toBe(expectedTitle);
      }
    );

    const typeNormalizationCases: Array<[string, string]> = [
      ["VALIDATION_ERROR", "https://api.ophirpay.com/errors/validation-error"],
      ["BAD_REQUEST", "https://api.ophirpay.com/errors/bad-request"],
      ["RATE_LIMITED", "https://api.ophirpay.com/errors/rate-limited"],
      ["insufficient_scope", "https://api.ophirpay.com/errors/insufficient-scope"],
      ["Unknown Error Code!", "https://api.ophirpay.com/errors/unknown-error-code"],
      ["---padded---", "https://api.ophirpay.com/errors/padded"],
      ["", "https://api.ophirpay.com/errors/generic"],
    ];

    test.each(typeNormalizationCases)(
      "getDefaultType('%s') => '%s'",
      (input: string, expectedType: string) => {
        expect(getDefaultType(input)).toBe(expectedType);
      }
    );

    it("always sets Content-Type to application/problem+json on every error helper", async () => {
      const helpers = [
        () => badRequestProblem("Malformed input"),
        () => unauthorizedProblem(),
        () => forbiddenProblem(),
        () => notFoundProblem("Payment"),
        () => conflictProblem("Already exists"),
        () => rateLimitProblem("Rate exceeded", 60),
        () => serverProblem("Database crash"),
      ];

      for (const helper of helpers) {
        const response = helper();
        expect(response.headers.get("Content-Type")).toBe(PROBLEM_CONTENT_TYPE);
        const data = await response.json();
        expect(isProblemDetails(data)).toBe(true);
        expect(data.timestamp).toBeDefined();
      }
    });

    it("supports optional instance URI and custom headers", async () => {
      const response = formatProblemDetails({
        status: 404,
        detail: "Payment 123 not found",
        instance: "/api/payments/123",
        headers: { "X-Custom-Header": "trace-456" },
      });

      expect(response.headers.get("Content-Type")).toBe(PROBLEM_CONTENT_TYPE);
      expect(response.headers.get("X-Custom-Header")).toBe("trace-456");
      const data = await response.json();
      expect(data.status).toBe(404);
      expect(data.instance).toBe("/api/payments/123");
      expect(data.detail).toBe("Payment 123 not found");
    });
  });

  // =========================================================================
  // DIMENSION 2: Zod Validation & Invalid Params Mapping
  // =========================================================================
  describe("Dimension 2: Zod Schema Validation & invalidParams Mapping", () => {
    const TestSchema = z.object({
      amount: z.number().positive("Amount must be positive"),
      recipient: z.string().min(56, "Stellar address must be at least 56 chars"),
      memo: z.string().max(28, "Memo too long").optional(),
      tags: z.array(z.string()).min(1, "At least one tag required"),
    });

    it("maps multiple nested Zod issues to RFC 7807 invalidParams", async () => {
      const result = TestSchema.safeParse({
        amount: -10,
        recipient: "short",
        memo: "a".repeat(30),
        tags: [],
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const mapped = mapZodIssuesToInvalidParams(result.error);
        expect(mapped).toHaveLength(4);
        expect(mapped).toEqual([
          { name: "amount", reason: "Amount must be positive", code: "too_small" },
          { name: "recipient", reason: "Stellar address must be at least 56 chars", code: "too_small" },
          { name: "memo", reason: "Memo too long", code: "too_big" },
          { name: "tags", reason: "At least one tag required", code: "too_small" },
        ]);

        const response = validationProblem(result.error, { instance: "/api/payments" });
        expect(response.status).toBe(400);
        expect(response.headers.get("Content-Type")).toBe(PROBLEM_CONTENT_TYPE);
        const data = await response.json();
        expect(data.invalidParams).toHaveLength(4);
        expect(data.invalid_params).toHaveLength(4);
        expect(data.detail).toContain("amount: Amount must be positive");
      }
    });

    it("handles root schema rejection with _root field name", () => {
      const RootRefinedSchema = z.string().refine((val) => val === "VALID", {
        message: "String must be VALID",
      });

      const result = RootRefinedSchema.safeParse("INVALID");
      expect(result.success).toBe(false);
      if (!result.success) {
        const mapped = mapZodIssuesToInvalidParams(result.error);
        expect(mapped).toHaveLength(1);
        expect(mapped[0].name).toBe("_root");
        expect(mapped[0].reason).toBe("String must be VALID");
      }
    });
  });

  // =========================================================================
  // DIMENSION 3: Client SDK (packages/ophirpay-client) RFC 7807 Parsing
  // =========================================================================
  describe("Dimension 3: Client SDK Compatibility with Problem Details", () => {
    it("parses RFC 7807 problem details into OphirPayError without generic fallback", async () => {
      const problemPayload: ProblemDetails = {
        type: "https://api.ophirpay.com/errors/validation-error",
        title: "Validation Error",
        status: 400,
        detail: "amount: Amount must be positive",
        instance: "/api/payments",
        code: "VALIDATION_ERROR",
        invalidParams: [{ name: "amount", reason: "Amount must be positive", code: "too_small" }],
        timestamp: new Date().toISOString(),
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve(JSON.stringify(problemPayload)),
      });

      const client = new OphirPayClient({
        baseUrl: "https://api.test",
        fetchImpl: mockFetch as unknown as typeof fetch,
      });

      try {
        await client.request("POST", "/api/payments", { body: { amount: -5 } });
        expect.unreachable("Should have thrown OphirPayError");
      } catch (err) {
        expect(err).toBeInstanceOf(OphirPayError);
        const error = err as OphirPayError;
        expect(error.message).toBe("amount: Amount must be positive");
        expect(error.status).toBe(400);
        expect(error.code).toBe("VALIDATION_ERROR");
        expect(error.type).toBe("https://api.ophirpay.com/errors/validation-error");
        expect(error.instance).toBe("/api/payments");
        expect(error.invalidParams).toEqual([
          { name: "amount", reason: "Amount must be positive", code: "too_small" },
        ]);
        expect(error.problemDetails).toEqual(problemPayload);
      }
    });

    it("parses legacy { success: false, error: ... } envelopes backwards-compatibly", async () => {
      const legacyPayload = {
        success: false,
        error: {
          code: "PAYMENT_NOT_FOUND",
          message: "Payment with ID 999 does not exist",
          details: { id: "999" },
        },
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve(JSON.stringify(legacyPayload)),
      });

      const client = new OphirPayClient({
        baseUrl: "https://api.test",
        fetchImpl: mockFetch as unknown as typeof fetch,
      });

      try {
        await client.request("GET", "/api/payments/999");
        expect.unreachable("Should have thrown OphirPayError");
      } catch (err) {
        expect(err).toBeInstanceOf(OphirPayError);
        const error = err as OphirPayError;
        expect(error.message).toBe("Payment with ID 999 does not exist");
        expect(error.status).toBe(404);
        expect(error.code).toBe("PAYMENT_NOT_FOUND");
        expect(error.details).toEqual({ id: "999" });
        expect(error.problemDetails).toBeNull();
      }
    });

    it("handles non-JSON error responses gracefully", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        text: () => Promise.resolve("Bad Gateway - Cloudflare Nginx 502"),
      });

      const client = new OphirPayClient({
        baseUrl: "https://api.test",
        fetchImpl: mockFetch as unknown as typeof fetch,
      });

      try {
        await client.request("GET", "/api/payments");
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(OphirPayError);
        const error = err as OphirPayError;
        expect(error.status).toBe(502);
        expect(error.message).toContain("Bad Gateway");
      }
    });
  });

  // =========================================================================
  // DIMENSION 4: Negative Controls & Type Guard Validation
  // =========================================================================
  describe("Dimension 4: Negative Controls & Invariants", () => {
    it("isProblemDetails returns false for non-problem objects", () => {
      expect(isProblemDetails(null)).toBe(false);
      expect(isProblemDetails(undefined)).toBe(false);
      expect(isProblemDetails("error string")).toBe(false);
      expect(isProblemDetails(12345)).toBe(false);
      expect(isProblemDetails([])).toBe(false);
      expect(isProblemDetails({})).toBe(false);
      expect(isProblemDetails({ success: true, data: {} })).toBe(false);
      expect(isProblemDetails({ error: "missing required fields" })).toBe(false);
      expect(isProblemDetails({ type: "uri", title: "title", status: 400 })).toBe(false); // missing detail
    });

    it("isProblemDetails returns true for conforming problem objects", () => {
      expect(
        isProblemDetails({
          type: "https://api.ophirpay.com/errors/bad-request",
          title: "Bad Request",
          status: 400,
          detail: "Invalid input",
        })
      ).toBe(true);
    });

    it("handleProblemError handles unexpected objects and exceptions cleanly", async () => {
      const response = handleProblemError(new Error("Database disconnected"), "/api/payments");
      expect(response.status).toBe(500);
      expect(response.headers.get("Content-Type")).toBe(PROBLEM_CONTENT_TYPE);
      const data = await response.json();
      expect(data.title).toBe("Internal Server Error");
      expect(data.instance).toBe("/api/payments");
    });
  });

  // =========================================================================
  // DIMENSION 5: Stress Matrix (50+ Parameterized Discrete Verifications)
  // =========================================================================
  describe("Dimension 5: Stress & High-Throughput Matrix (50 Parameterized Checks)", () => {
    const stressCombinations = Array.from({ length: 50 }, (_, i) => {
      const statuses = [400, 401, 403, 404, 409, 422, 429, 500, 502, 503];
      const status = statuses[i % statuses.length];
      return {
        id: i,
        status,
        detail: `Synthetic error occurrence #${i} for status ${status}`,
        instance: `/api/payments/test/${i}`,
        hasInvalidParams: i % 3 === 0,
      };
    });

    test.each(stressCombinations)(
      "stress check #$id: status $status at $instance",
      async ({
        status,
        detail,
        instance,
        hasInvalidParams,
      }: {
        id: number;
        status: number;
        detail: string;
        instance: string;
        hasInvalidParams: boolean;
      }) => {
        const invalidParams = hasInvalidParams
          ? [{ name: `field_${status}`, reason: "Invalid value", code: "custom" }]
          : undefined;

        const response = formatProblemDetails({
          status,
          detail,
          instance,
          invalidParams,
        });

        expect(response.status).toBe(status);
        expect(response.headers.get("Content-Type")).toBe(PROBLEM_CONTENT_TYPE);

        const data: ProblemDetails = await response.json();
        expect(isProblemDetails(data)).toBe(true);
        expect(data.status).toBe(status);
        expect(data.detail).toBe(detail);
        expect(data.instance).toBe(instance);

        if (hasInvalidParams) {
          expect(data.invalidParams).toHaveLength(1);
          expect(data.invalid_params).toHaveLength(1);
        } else {
          expect(data.invalidParams).toBeUndefined();
        }
      }
    );

    // 50 additional parameterized checks for error codes and custom extensions
    const extensionCombinations = Array.from({ length: 50 }, (_, i) => ({
      codeIndex: i,
      errorCode: `CUSTOM_ERROR_${i}`,
      detailText: `Detailed error message payload for index ${i}`,
      retryAfter: i % 5 === 0 ? i * 2 : undefined,
    }));

    test.each(extensionCombinations)(
      "parameterized code & header check #$codeIndex: $errorCode",
      async ({
        errorCode,
        detailText,
        retryAfter,
      }: {
        codeIndex: number;
        errorCode: string;
        detailText: string;
        retryAfter?: number;
      }) => {
        const response = rateLimitProblem(detailText, retryAfter, {
          code: errorCode,
          instance: `/api/rate-limit/${errorCode}`,
          extensions: { attemptCount: errorCode },
        });

        expect(response.status).toBe(429);
        expect(response.headers.get("Content-Type")).toBe(PROBLEM_CONTENT_TYPE);
        if (retryAfter !== undefined) {
          expect(response.headers.get("Retry-After")).toBe(String(retryAfter));
        }

        const data = await response.json();
        expect(data.code).toBe(errorCode);
        expect(data.detail).toBe(detailText);
        expect(data.attemptCount).toBe(errorCode);
      }
    );
  });

  // =========================================================================
  // DIMENSION 6: Route Handlers Direct Integration Checks
  // =========================================================================
  describe("Dimension 6: Payments Mutation Route Handlers Direct Integration", () => {
    it("POST /api/payments returns RFC 7807 problem details on missing CSRF", async () => {
      const { POST } = await import("@/app/api/payments/route");
      const req = new Request("http://localhost:3000/api/payments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ amount: 100 }),
      });

      const res = await POST(req);
      expect(res.headers.get("Content-Type")).toBe(PROBLEM_CONTENT_TYPE);
      expect(res.status).toBe(403);

      const json = await res.json();
      expect(isProblemDetails(json)).toBe(true);
      expect(json.title).toBe("Forbidden");
      expect(json.status).toBe(403);
      expect(json.instance).toBe("/api/payments");
    });

    it("POST /api/payments returns RFC 7807 problem details on unauthenticated request with API key bypass", async () => {
      const { POST } = await import("@/app/api/payments/route");
      const req = new Request("http://localhost:3000/api/payments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": "invalid_or_unregistered_key",
        },
        body: JSON.stringify({ amount: 100 }),
      });

      const res = await POST(req);
      expect(res.headers.get("Content-Type")).toBe(PROBLEM_CONTENT_TYPE);
      expect(res.status).toBe(401);

      const json = await res.json();
      expect(isProblemDetails(json)).toBe(true);
      expect(json.title).toBe("Unauthorized");
      expect(json.status).toBe(401);
      expect(json.instance).toBe("/api/payments");
    });

    it("POST /api/payments/cancel returns RFC 7807 problem details on missing CSRF and unauthenticated request", async () => {
      const { POST } = await import("@/app/api/payments/cancel/route");
      const req = new Request("http://localhost:3000/api/payments/cancel", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ txHash: "sample-hash" }),
      });

      const res = await POST(req);
      expect(res.headers.get("Content-Type")).toBe(PROBLEM_CONTENT_TYPE);
      expect(res.status).toBe(403);

      const json = await res.json();
      expect(isProblemDetails(json)).toBe(true);
      expect(json.instance).toBe("/api/payments/cancel");
    });

    it("POST /api/payments/retry returns RFC 7807 problem details on missing CSRF and unauthenticated request", async () => {
      const { POST } = await import("@/app/api/payments/retry/route");
      const req = new Request("http://localhost:3000/api/payments/retry", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id: "pay_123" }),
      });

      const res = await POST(req);
      expect(res.headers.get("Content-Type")).toBe(PROBLEM_CONTENT_TYPE);
      expect(res.status).toBe(403);

      const json = await res.json();
      expect(isProblemDetails(json)).toBe(true);
      expect(json.instance).toBe("/api/payments/retry");
    });
  });
});

