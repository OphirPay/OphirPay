// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import {
  withAuth,
  withValidation,
  withMutatingRoute,
  withQueryRoute,
  normalizeOptOutReason,
} from "@/lib/api-wrapper";
import { generateCsrfToken, CSRF_OPT_OUT_REGISTRY, findUnprotectedRoutes } from "@/lib/csrf";
import { successResponse } from "@/lib/api-response";

// ── Mock Auth Session ──────────────────────────────────────────

const { mockGetAuthContext } = vi.hoisted(() => ({
  mockGetAuthContext: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {},
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: mockGetAuthContext,
}));

function csrfHeaders(): Record<string, string> {
  const token = generateCsrfToken();
  return { "x-csrf-token": token, cookie: `__Host-csrf=${token}` };
}

describe("src/lib/api-wrapper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Opt-Out Validation", () => {
    it("accepts valid string opt-out reason", () => {
      expect(normalizeOptOutReason("Public endpoint", "optOutAuth")).toBe("Public endpoint");
    });

    it("accepts valid object opt-out reason", () => {
      expect(normalizeOptOutReason({ reason: "Cron job secret" }, "optOutCsrf")).toBe("Cron job secret");
    });

    it("returns null when opt-out is undefined", () => {
      expect(normalizeOptOutReason(undefined, "optOutAuth")).toBeNull();
    });

    it("throws when opt-out reason is empty or whitespace", () => {
      expect(() => normalizeOptOutReason("", "optOutAuth")).toThrow(/reviewable reason/);
      expect(() => normalizeOptOutReason("   ", "optOutCsrf")).toThrow(/reviewable reason/);
      expect(() => normalizeOptOutReason({ reason: "" }, "optOutAuth")).toThrow(/reviewable reason/);
    });
  });

  describe("withAuth", () => {
    it("rejects unauthenticated requests with 401", async () => {
      mockGetAuthContext.mockResolvedValueOnce(null);
      const handler = vi.fn();
      const wrapped = withAuth(handler);

      const req = new Request("http://localhost/api/test");
      const res = await wrapped(req);

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error.code).toBe("UNAUTHORIZED");
      expect(handler).not.toHaveBeenCalled();
    });

    it("injects auth context and calls handler on valid session", async () => {
      mockGetAuthContext.mockResolvedValueOnce({ userId: "u123", publicKey: "GABC..." });
      const handler = vi.fn().mockResolvedValue(successResponse({ ok: true }));
      const wrapped = withAuth(handler);

      const req = new Request("http://localhost/api/test");
      const res = await wrapped(req);

      expect(res.status).toBe(200);
      expect(handler).toHaveBeenCalledWith(req, expect.objectContaining({
        auth: { userId: "u123", publicKey: "GABC..." },
      }));
    });
  });

  describe("withValidation", () => {
    it("validates request body against schema and returns 400 on failure", async () => {
      const schema = z.object({ amount: z.number().positive() });
      const handler = vi.fn().mockResolvedValue(successResponse({ done: true }));
      const wrapped = withValidation({ bodySchema: schema }, handler);

      const req = new Request("http://localhost/api/test", {
        method: "POST",
        body: JSON.stringify({ amount: -5 }),
      });
      const res = await wrapped(req);

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(handler).not.toHaveBeenCalled();
    });

    it("passes parsed typed body to handler on success", async () => {
      const schema = z.object({ amount: z.number().positive() });
      const handler = vi.fn().mockResolvedValue(successResponse({ done: true }));
      const wrapped = withValidation({ bodySchema: schema }, handler);

      const req = new Request("http://localhost/api/test", {
        method: "POST",
        body: JSON.stringify({ amount: 100 }),
      });
      const res = await wrapped(req);

      expect(res.status).toBe(200);
      expect(handler).toHaveBeenCalledWith(req, expect.objectContaining({
        body: { amount: 100 },
      }));
    });

    it("validates query searchParams", async () => {
      const querySchema = z.object({ page: z.coerce.number().int().positive() });
      const handler = vi.fn().mockResolvedValue(successResponse({ done: true }));
      const wrapped = withValidation({ querySchema }, handler);

      const req = new Request("http://localhost/api/test?page=invalid");
      const res = await wrapped(req);

      expect(res.status).toBe(400);
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("withMutatingRoute", () => {
    const testBodySchema = z.object({ title: z.string().min(2) });

    it("enforces CSRF by default and rejects missing CSRF tokens", async () => {
      const handler = vi.fn().mockResolvedValue(successResponse({ ok: true }));
      const wrapped = withMutatingRoute({
        route: "POST /api/test/mutating",
        bodySchema: testBodySchema,
      }, handler);

      // Missing CSRF headers
      const req = new Request("http://localhost/api/test/mutating", {
        method: "POST",
        body: JSON.stringify({ title: "Valid Title" }),
      });
      const res = await wrapped(req);

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe("CSRF_INVALID");
      expect(handler).not.toHaveBeenCalled();
    });

    it("enforces authentication by default and rejects unauthenticated requests", async () => {
      mockGetAuthContext.mockResolvedValueOnce(null);
      const handler = vi.fn().mockResolvedValue(successResponse({ ok: true }));
      const wrapped = withMutatingRoute({
        route: "POST /api/test/mutating",
        bodySchema: testBodySchema,
      }, handler);

      const req = new Request("http://localhost/api/test/mutating", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ title: "Valid Title" }),
      });
      const res = await wrapped(req);

      expect(res.status).toBe(401);
      expect(handler).not.toHaveBeenCalled();
    });

    it("executes handler with typed context when CSRF, Auth, and Body are valid", async () => {
      mockGetAuthContext.mockResolvedValueOnce({ userId: "u_abc" });
      const handler = vi.fn().mockResolvedValue(successResponse({ success: true }));
      const wrapped = withMutatingRoute({
        route: "POST /api/test/mutating",
        bodySchema: testBodySchema,
      }, handler);

      const req = new Request("http://localhost/api/test/mutating", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ title: "Valid Title" }),
      });
      const res = await wrapped(req);

      expect(res.status).toBe(200);
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        auth: { userId: "u_abc" },
        body: { title: "Valid Title" },
      }));
    });

    it("permits explicit CSRF opt-out with reviewable reason", async () => {
      mockGetAuthContext.mockResolvedValueOnce({ userId: "u_abc" });
      const handler = vi.fn().mockResolvedValue(successResponse({ success: true }));
      const wrapped = withMutatingRoute({
        route: "POST /api/webhooks/incoming",
        bodySchema: testBodySchema,
        optOutCsrf: "External webhook receiver authenticated with cryptographic HMAC signature",
      }, handler);

      // Request without CSRF token
      const req = new Request("http://localhost/api/webhooks/incoming", {
        method: "POST",
        body: JSON.stringify({ title: "Valid Webhook" }),
      });
      const res = await wrapped(req);

      expect(res.status).toBe(200);
      expect(CSRF_OPT_OUT_REGISTRY["/api/webhooks/incoming"]?.POST).toContain("cryptographic HMAC signature");
    });

    it("permits explicit Auth opt-out with reviewable reason", async () => {
      const handler = vi.fn().mockResolvedValue(successResponse({ public: true }));
      const wrapped = withMutatingRoute({
        route: "POST /api/public/submit",
        bodySchema: testBodySchema,
        optOutAuth: "Public guest submission endpoint",
      }, handler);

      mockGetAuthContext.mockResolvedValueOnce(null);

      const req = new Request("http://localhost/api/public/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ title: "Guest Title" }),
      });
      const res = await wrapped(req);

      expect(res.status).toBe(200);
      expect(handler).toHaveBeenCalled();
    });

    it("catches errors and formats them with handleApiError", async () => {
      mockGetAuthContext.mockResolvedValueOnce({ userId: "u_abc" });
      const handler = vi.fn().mockRejectedValue(new Error("Database connection lost"));
      const wrapped = withMutatingRoute({
        route: "POST /api/test/error",
        bodySchema: testBodySchema,
      }, handler);

      const req = new Request("http://localhost/api/test/error", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ title: "Test Error" }),
      });
      const res = await wrapped(req);

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("INTERNAL_ERROR");
    });
  });

  describe("withQueryRoute", () => {
    it("enforces authentication on read routes by default", async () => {
      mockGetAuthContext.mockResolvedValueOnce(null);
      const handler = vi.fn().mockResolvedValue(successResponse({ data: [] }));
      const wrapped = withQueryRoute({
        route: "GET /api/test/items",
      }, handler);

      const req = new Request("http://localhost/api/test/items");
      const res = await wrapped(req);

      expect(res.status).toBe(401);
      expect(handler).not.toHaveBeenCalled();
    });

    it("permits explicit Auth opt-out for public read routes", async () => {
      mockGetAuthContext.mockResolvedValueOnce(null);
      const handler = vi.fn().mockResolvedValue(successResponse({ data: "public info" }));
      const wrapped = withQueryRoute({
        route: "GET /api/public/info",
        optOutAuth: "Public metadata read",
      }, handler);

      const req = new Request("http://localhost/api/public/info");
      const res = await wrapped(req);

      expect(res.status).toBe(200);
      expect(handler).toHaveBeenCalled();
    });
  });

  describe("CSRF Route Audit Integration", () => {
    it("findUnprotectedRoutes detects mutating routes without CSRF or valid opt-outs", () => {
      const unprotected = findUnprotectedRoutes();
      expect(unprotected).toEqual([]);
    });
  });
});
