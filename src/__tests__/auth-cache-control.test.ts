// SPDX-License-Identifier: MIT

import { NextRequest } from "next/server";
import { beforeEach,describe, expect, it, vi } from "vitest";

import { SENSITIVE_CACHE_CONTROL,sensitiveSuccessResponse } from "@/lib/api-response";

// Mocks
const prismaMocks = vi.hoisted(() => {
  const apiKeyCreate = vi.fn();
  const apiKeyCount = vi.fn().mockResolvedValue(0);
  const auditCreate = vi.fn().mockResolvedValue({});
  const tx = {
    apiKey: { count: apiKeyCount, create: apiKeyCreate },
    auditLog: { create: auditCreate },
  };
  return { apiKeyCreate, apiKeyCount, auditCreate, tx };
});

vi.mock("@/lib/prisma", () => ({
  default: {
    apiKey: {
      findMany: vi.fn(),
      create: prismaMocks.apiKeyCreate,
      deleteMany: vi.fn(),
      updateMany: vi.fn(),
      count: prismaMocks.apiKeyCount,
    },
    auditLog: { create: prismaMocks.auditCreate },
    user: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    $transaction: vi.fn(
      (callback: (transaction: typeof prismaMocks.tx) => Promise<unknown>) =>
        callback(prismaMocks.tx)
    ),
  },
}));

vi.mock("@/lib/auth-session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-session")>();
  return {
    ...actual,
    getAuthContext: vi.fn(),
    readSessionCookie: vi.fn(),
    sessionNeedsRenewal: vi.fn(),
  };
});

vi.mock("@/lib/csrf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/csrf")>();
  return {
    ...actual,
    verifyCsrf: vi.fn().mockReturnValue(null),
  };
});

vi.mock("@/lib/challenge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/challenge")>();
  return {
    ...actual,
    createChallengeToken: vi.fn().mockReturnValue("mock_challenge_token"),
    verifyChallengeToken: vi.fn().mockReturnValue(true),
    verifyWalletSignature: vi.fn().mockReturnValue(true),
  };
});

import { GET as getChallenge } from "@/app/api/auth/challenge/route";
import { DELETE as deleteSession,GET as getSession, POST as postSession } from "@/app/api/auth/session/route";
import { DELETE as deleteKeys, GET as getKeys, PATCH as patchKeys,POST as postKeys } from "@/app/api/keys/route";
import * as authSession from "@/lib/auth-session";
import prisma from "@/lib/prisma";
import { proxy } from "@/proxy";

const VALID_STELLAR_PK = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

describe("Cache-Control on Sensitive Auth & Keys Endpoints (#1956)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Response Helper: sensitiveSuccessResponse", () => {
    it("sets Cache-Control: no-store, private and Pragma: no-cache", () => {
      const res = sensitiveSuccessResponse({ token: "secret_123" });
      expect(res.headers.get("Cache-Control")).toBe(SENSITIVE_CACHE_CONTROL);
      expect(res.headers.get("Cache-Control")).toContain("no-store");
      expect(res.headers.get("Cache-Control")).toContain("private");
      expect(res.headers.get("Pragma")).toBe("no-cache");
    });
  });

  describe("Auth Routes (/api/auth/*)", () => {
    it("GET /api/auth/challenge returns Cache-Control: no-store, private", async () => {
      const req = new Request(`http://localhost/api/auth/challenge?publicKey=${VALID_STELLAR_PK}`);
      const res = await getChallenge(req);
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toContain("no-store");
      expect(res.headers.get("Cache-Control")).toContain("private");
    });

    it("POST /api/auth/session returns Cache-Control: no-store, private on login", async () => {
      const req = new Request("http://localhost/api/auth/session", {
        method: "POST",
        body: JSON.stringify({
          publicKey: VALID_STELLAR_PK,
          network: "TESTNET",
          challenge: "mock_challenge_token",
          signature: "mock_sig",
        }),
      });
      const res = await postSession(req);
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toContain("no-store");
      expect(res.headers.get("Cache-Control")).toContain("private");
    });

    it("GET /api/auth/session returns Cache-Control: no-store, private on session status check", async () => {
      vi.mocked(authSession.readSessionCookie).mockReturnValueOnce({
        pk: VALID_STELLAR_PK,
        nw: "TESTNET",
        iat: Date.now(),
        exp: Date.now() + 3600000,
      });
      const req = new Request("http://localhost/api/auth/session");
      const res = await getSession(req);
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toContain("no-store");
      expect(res.headers.get("Cache-Control")).toContain("private");
    });

    it("DELETE /api/auth/session returns Cache-Control: no-store, private on logout", async () => {
      const req = new Request("http://localhost/api/auth/session", { method: "DELETE" });
      const res = await deleteSession(req);
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toContain("no-store");
      expect(res.headers.get("Cache-Control")).toContain("private");
    });
  });

  describe("API Key Routes (/api/keys)", () => {
    it("GET /api/keys returns Cache-Control: no-store, private", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce({ userId: "u123" });
      vi.mocked(prisma.apiKey.findMany).mockResolvedValueOnce([]);

      const req = new Request("http://localhost/api/keys");
      const res = await getKeys(req);
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toContain("no-store");
      expect(res.headers.get("Cache-Control")).toContain("private");
    });

    it("POST /api/keys returns Cache-Control: no-store, private on key creation", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce({ userId: "u123" });
      vi.mocked(prisma.apiKey.create).mockResolvedValueOnce({
        id: "key_created_1",
        name: "Dev Key",
        prefix: "oph_dev1",
      } as never);

      const req = new Request("http://localhost/api/keys", {
        method: "POST",
        body: JSON.stringify({ name: "Dev Key" }),
      });
      const res = await postKeys(req);
      expect(res.status).toBe(201);
      expect(res.headers.get("Cache-Control")).toContain("no-store");
      expect(res.headers.get("Cache-Control")).toContain("private");
    });

    it("PATCH /api/keys returns Cache-Control: no-store, private on scope update", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce({ userId: "u123" });
      vi.mocked(prisma.apiKey.updateMany).mockResolvedValueOnce({ count: 1 });

      const req = new Request("http://localhost/api/keys", {
        method: "PATCH",
        body: JSON.stringify({ id: "key_1", scopes: [] }),
      });
      const res = await patchKeys(req);
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toContain("no-store");
      expect(res.headers.get("Cache-Control")).toContain("private");
    });

    it("DELETE /api/keys returns Cache-Control: no-store, private on revocation", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce({ userId: "u123" });
      vi.mocked(prisma.apiKey.updateMany).mockResolvedValueOnce({ count: 1 });

      const req = new Request("http://localhost/api/keys?id=key_1", { method: "DELETE" });
      const res = await deleteKeys(req);
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toContain("no-store");
      expect(res.headers.get("Cache-Control")).toContain("private");
    });
  });

  describe("Proxy Middleware Enforcement", () => {
    it("enforces Cache-Control: no-store, private on /api/auth/* requests through proxy", async () => {
      const req = new NextRequest("http://localhost/api/auth/session");
      const res = await proxy(req);
      expect(res.headers.get("Cache-Control")).toContain("no-store");
      expect(res.headers.get("Cache-Control")).toContain("private");
    });

    it("enforces Cache-Control: no-store, private on /api/keys/* requests through proxy", async () => {
      const req = new NextRequest("http://localhost/api/keys");
      const res = await proxy(req);
      expect(res.headers.get("Cache-Control")).toContain("no-store");
      expect(res.headers.get("Cache-Control")).toContain("private");
    });
  });
});
