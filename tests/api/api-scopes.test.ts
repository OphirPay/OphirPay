// SPDX-License-Identifier: MIT
/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  default: {
    apiKey: {
      findFirst: vi.fn(),
      update: vi.fn().mockResolvedValue(undefined),
    },
    apiKeyRequestLog: {
      create: vi.fn().mockResolvedValue(undefined),
    },
    batch: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    payment: {
      createMany: vi.fn(),
    },
    webhook: {
      create: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(async (cb) => {
      if (typeof cb === "function") {
        return cb({
          batch: { create: vi.fn().mockResolvedValue({ id: "batch-1", name: "test", payments: [] }) },
          payment: { createMany: vi.fn() },
        });
      }
      return cb;
    }),
  },
}));

vi.mock("@/lib/csrf", () => ({
  verifyCsrf: vi.fn().mockReturnValue(null),
  generateCsrfToken: vi.fn().mockReturnValue("csrf-mock-token"),
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: vi.fn(),
}));

import prisma from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-session";
import { requireScope, assertScope } from "@/lib/api-auth";
import { apiRoute } from "@/lib/api-route";
import { POST as batchesPost } from "@/app/api/batches/route";
import { POST as escrowPost } from "@/app/api/escrow/route";
import { POST as escrowReleasePost } from "@/app/api/escrow/release/route";
import { POST as webhooksPost } from "@/app/api/webhooks/route";

const authMock = vi.mocked(getAuthContext);
const apiKeyMock = vi.mocked(prisma.apiKey.findFirst);

const VALID_KEY = `oph_${"a".repeat(64)}`;

describe("Unit tests: API Scope Enforcement (#1312)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("assertScope helper", () => {
    it("allows wallet sessions without scope restrictions", () => {
      const auth = { userId: "user-1", isSession: true, scopes: [] };
      const err = assertScope(auth, "batches:create");
      expect(err).toBeNull();
    });

    it("returns null when API key has required scope", () => {
      const auth = { userId: "user-1", isSession: false, scopes: ["batches:create"] };
      const err = assertScope(auth, "batches:create");
      expect(err).toBeNull();
    });

    it("returns null when API key has admin scope", () => {
      const auth = { userId: "user-1", isSession: false, scopes: ["admin"] };
      const err = assertScope(auth, "batches:create");
      expect(err).toBeNull();
    });

    it("returns 403 Forbidden with INSUFFICIENT_SCOPE when API key lacks scope", async () => {
      const auth = { userId: "user-1", isSession: false, scopes: ["read:payments"] };
      const res = assertScope(auth, "batches:create");
      expect(res).not.toBeNull();
      expect(res?.status).toBe(403);

      const json = await res?.json();
      expect(json.error.code).toBe("INSUFFICIENT_SCOPE");
      expect(json.error.details.missing).toContain("batches:create");
    });
  });

  describe("requireScope middleware helper", () => {
    it("works with curried signature requireScope(scope)(request)", async () => {
      apiKeyMock.mockResolvedValueOnce({
        id: "key-1",
        userId: "user-1",
        name: "test",
        expiresAt: null,
        scopes: ["webhooks:write"],
      } as any);

      const req = new Request("http://localhost/api/test", {
        headers: { "x-api-key": VALID_KEY },
      });

      const guard = requireScope("webhooks:write");
      const result = await guard(req);
      expect("userId" in result).toBe(true);
      if ("userId" in result) {
        expect(result.userId).toBe("user-1");
      }
    });

    it("works with direct signature requireScope(scope, request)", async () => {
      apiKeyMock.mockResolvedValueOnce({
        id: "key-1",
        userId: "user-1",
        name: "test",
        expiresAt: null,
        scopes: ["batches:create"],
      } as any);

      const req = new Request("http://localhost/api/test", {
        headers: { "x-api-key": VALID_KEY },
      });

      const result = await requireScope("batches:create", req);
      expect("userId" in result).toBe(true);
    });

    it("returns 403 with INSUFFICIENT_SCOPE when key lacks scope", async () => {
      apiKeyMock.mockResolvedValueOnce({
        id: "key-1",
        userId: "user-1",
        name: "test",
        expiresAt: null,
        scopes: ["read:payments"],
      } as any);

      const req = new Request("http://localhost/api/test", {
        headers: { "x-api-key": VALID_KEY },
      });

      const result = await requireScope("batches:create", req);
      expect("userId" in result).toBe(false);
      if (!("userId" in result)) {
        expect(result.status).toBe(403);
        const json = await result.json();
        expect(json.error.code).toBe("INSUFFICIENT_SCOPE");
        expect(json.error.details.missing).toContain("batches:create");
      }
    });
  });

  describe("apiRoute scope option", () => {
    it("blocks request with 403 when API key lacks configured scope", async () => {
      authMock.mockResolvedValueOnce({
        userId: "user-1",
        scopes: ["read:payments"],
        isSession: false,
      });

      const routeHandler = apiRoute(
        { name: "POST /api/test", scope: "payments:write" },
        async () => new Response(JSON.stringify({ ok: true }))
      );

      const req = new Request("http://localhost/api/test", { method: "POST" });
      const res = await routeHandler(req, { params: Promise.resolve({}) });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe("INSUFFICIENT_SCOPE");
    });
  });

  describe("Mutating route: POST /api/batches", () => {
    it("rejects API key lacking batches:create with 403", async () => {
      authMock.mockResolvedValueOnce({
        userId: "user-1",
        scopes: ["read:payments"],
        isSession: false,
      });

      const req = new Request("http://localhost/api/batches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Batch 1", recipients: [] }),
      });

      const res = await batchesPost(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe("INSUFFICIENT_SCOPE");
      expect(json.error.details.missing).toContain("batches:create");
    });

    it("allows API key with batches:create", async () => {
      authMock.mockResolvedValueOnce({
        userId: "user-1",
        scopes: ["batches:create"],
        isSession: false,
      });

      const req = new Request("http://localhost/api/batches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Valid Batch",
          recipients: [{ amount: 10, recipientAddress: "GD6W556ZTGNG64PAYU2HNU2ZTGNG64PAYU2HNU2ZTGNG64PAYU2HNU2Z" }],
        }),
      });

      const res = await batchesPost(req);
      // Scope passed: should not be 403
      expect(res.status).not.toBe(403);
    });
  });

  describe("Mutating route: POST /api/escrow", () => {
    it("rejects API key lacking escrow:write with 403", async () => {
      authMock.mockResolvedValueOnce({
        userId: "user-1",
        scopes: ["batches:create"],
        isSession: false,
      });

      const req = new Request("http://localhost/api/escrow", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ depositor: "D1", beneficiary: "B1", amount: "100" }),
      });

      const res = await escrowPost(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe("INSUFFICIENT_SCOPE");
      expect(json.error.details.missing).toContain("escrow:write");
    });

    it("allows API key with escrow:write", async () => {
      authMock.mockResolvedValueOnce({
        userId: "user-1",
        scopes: ["escrow:write"],
        isSession: false,
      });

      const req = new Request("http://localhost/api/escrow", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ depositor: "D1", beneficiary: "B1", amount: "100" }),
      });

      const res = await escrowPost(req);
      expect(res.status).toBe(202);
    });
  });

  describe("Mutating route: POST /api/escrow/release", () => {
    it("rejects API key lacking escrow:release with 403", async () => {
      authMock.mockResolvedValueOnce({
        userId: "user-1",
        scopes: ["webhooks:write"],
        isSession: false,
      });

      const req = new Request("http://localhost/api/escrow/release", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ escrowId: "escrow-1" }),
      });

      const res = await escrowReleasePost(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe("INSUFFICIENT_SCOPE");
    });

    it("allows API key with escrow:release", async () => {
      authMock.mockResolvedValueOnce({
        userId: "user-1",
        scopes: ["escrow:release"],
        isSession: false,
      });

      const req = new Request("http://localhost/api/escrow/release", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ escrowId: "escrow-1" }),
      });

      const res = await escrowReleasePost(req);
      expect(res.status).toBe(202);
    });
  });

  describe("Mutating route: POST /api/webhooks", () => {
    it("rejects API key lacking webhooks:write with 403", async () => {
      authMock.mockResolvedValueOnce({
        userId: "user-1",
        scopes: ["read:payments"],
        isSession: false,
      });

      const req = new Request("http://localhost/api/webhooks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/webhook", events: ["payment.created"] }),
      });

      const res = await webhooksPost(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe("INSUFFICIENT_SCOPE");
      expect(json.error.details.missing).toContain("webhooks:write");
    });
  });
});
