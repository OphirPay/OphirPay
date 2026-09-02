// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("@/lib/prisma", () => ({
  default: {
    apiKey: {
      findMany: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth-session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-session")>();
  return {
    ...actual,
    getAuthContext: vi.fn(),
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

import prisma from "@/lib/prisma";
import * as authSession from "@/lib/auth-session";
import * as csrf from "@/lib/csrf";
import * as challengeLib from "@/lib/challenge";
import { GET as getChallenge } from "@/app/api/auth/challenge/route";
import { POST as postSession, DELETE as deleteSession } from "@/app/api/auth/session/route";
import { GET as getCsrf } from "@/app/api/csrf/route";
import { GET as getKeys, POST as postKeys, DELETE as deleteKeys } from "@/app/api/keys/route";

const VALID_STELLAR_PK = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

describe("API Routes: Auth, CSRF & Keys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(csrf.verifyCsrf).mockReturnValue(null);
  });

  describe("GET /api/auth/challenge", () => {
    it("returns challenge token and message for valid public key", async () => {
      const req = new Request(`http://localhost/api/auth/challenge?publicKey=${VALID_STELLAR_PK}`);
      const res = await getChallenge(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.challenge).toBe("mock_challenge_token");
      expect(data.data.expiresIn).toBe(300);
    });

    it("returns 400 when public key is invalid or missing", async () => {
      const req = new Request("http://localhost/api/auth/challenge?publicKey=invalid_pk");
      const res = await getChallenge(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error.message).toContain("valid Stellar public key");
    });
  });

  describe("/api/auth/session", () => {
    it("returns 403 when CSRF check fails", async () => {
      vi.mocked(csrf.verifyCsrf).mockReturnValueOnce(
        new Response(JSON.stringify({ success: false, error: { message: "CSRF token invalid" } }), {
          status: 403,
        })
      );
      const req = new Request("http://localhost/api/auth/session", {
        method: "POST",
        body: JSON.stringify({ publicKey: VALID_STELLAR_PK }),
      });
      const res = await postSession(req);
      expect(res.status).toBe(403);
    });

    it("returns 400 when public key is invalid", async () => {
      const req = new Request("http://localhost/api/auth/session", {
        method: "POST",
        body: JSON.stringify({ publicKey: "bad_pk" }),
      });
      const res = await postSession(req);
      expect(res.status).toBe(400);
    });

    it("returns 401 when proof is missing and no existing session exists", async () => {
      const req = new Request("http://localhost/api/auth/session", {
        method: "POST",
        body: JSON.stringify({ publicKey: VALID_STELLAR_PK }),
      });
      const res = await postSession(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error.message).toContain("Proof of ownership required");
    });

    it("returns 401 when session renewal is for a different public key", async () => {
      const otherKey = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";
      const cookieHeader = `ophirpay_session=${authSession.createSessionToken(otherKey, "TESTNET")}`;
      const req = new Request("http://localhost/api/auth/session", {
        method: "POST",
        headers: { cookie: cookieHeader },
        body: JSON.stringify({ publicKey: VALID_STELLAR_PK }),
      });
      const res = await postSession(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error.message).toContain("same public key");
    });

    it("allows renewal without challenge when matching session cookie exists", async () => {
      const cookieHeader = `ophirpay_session=${authSession.createSessionToken(VALID_STELLAR_PK, "TESTNET")}`;
      const req = new Request("http://localhost/api/auth/session", {
        method: "POST",
        headers: { cookie: cookieHeader },
        body: JSON.stringify({ publicKey: VALID_STELLAR_PK, network: "PUBLIC" }),
      });
      const res = await postSession(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.authenticated).toBe(true);
      expect(res.headers.get("Set-Cookie")).toContain("ophirpay_session");
    });

    it("returns 401 when challenge verification fails", async () => {
      vi.mocked(challengeLib.verifyChallengeToken).mockReturnValueOnce(false);
      const req = new Request("http://localhost/api/auth/session", {
        method: "POST",
        body: JSON.stringify({
          publicKey: VALID_STELLAR_PK,
          challenge: "invalid_token",
          signature: "some_sig",
        }),
      });
      const res = await postSession(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error.message).toContain("Challenge expired or invalid");
    });

    it("returns 401 when wallet signature verification fails", async () => {
      vi.mocked(challengeLib.verifyChallengeToken).mockReturnValueOnce(true);
      vi.mocked(challengeLib.verifyWalletSignature).mockReturnValueOnce(false);
      const req = new Request("http://localhost/api/auth/session", {
        method: "POST",
        body: JSON.stringify({
          publicKey: VALID_STELLAR_PK,
          challenge: "valid_token",
          signature: "bad_sig",
        }),
      });
      const res = await postSession(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error.message).toContain("Signature does not match");
    });

    it("successfully issues session on valid proof", async () => {
      vi.mocked(challengeLib.verifyChallengeToken).mockReturnValueOnce(true);
      vi.mocked(challengeLib.verifyWalletSignature).mockReturnValueOnce(true);
      const req = new Request("http://localhost/api/auth/session", {
        method: "POST",
        body: JSON.stringify({
          publicKey: VALID_STELLAR_PK,
          network: "TESTNET",
          challenge: "valid_token",
          signature: "valid_sig",
        }),
      });
      const res = await postSession(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.authenticated).toBe(true);
      expect(data.data.publicKey).toBe(VALID_STELLAR_PK);
      expect(res.headers.get("Set-Cookie")).toBeDefined();
    });

    it("DELETE /api/auth/session clears session cookie", async () => {
      const res = await deleteSession(
        new Request("http://localhost/api/auth/session", { method: "DELETE" })
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.authenticated).toBe(false);
      expect(res.headers.get("Set-Cookie")).toContain("Max-Age=0");
    });
  });

  describe("GET /api/csrf", () => {
    it("mints and sets CSRF token cookie", async () => {
      const req = new Request("http://localhost/api/csrf");
      const res = await getCsrf(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.token).toBeDefined();
      expect(res.headers.get("Set-Cookie")).toContain("csrf=");
    });
  });

  describe("/api/keys", () => {
    it("GET returns 401 when unauthenticated", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(null);
      const res = await getKeys(new Request("http://localhost/api/keys"));
      expect(res.status).toBe(401);
    });

    it("GET returns list of user API keys", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce({ userId: "u123" });
      const mockKeys = [{ id: "k1", name: "Backend", prefix: "oph_abc", createdAt: new Date() }];
      vi.mocked(prisma.apiKey.findMany).mockResolvedValueOnce(mockKeys as never);

      const res = await getKeys(new Request("http://localhost/api/keys"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data).toHaveLength(1);
      expect(data.data[0].id).toBe("k1");
    });

    it("POST returns 401 when unauthenticated", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(null);
      const res = await postKeys(
        new Request("http://localhost/api/keys", {
          method: "POST",
          body: JSON.stringify({ name: "My Key" }),
        })
      );
      expect(res.status).toBe(401);
    });

    it("POST returns 400 when name is missing or empty", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce({ userId: "u123" });
      const res = await postKeys(
        new Request("http://localhost/api/keys", {
          method: "POST",
          body: JSON.stringify({ name: "" }),
        })
      );
      expect(res.status).toBe(400);
    });

    it("POST creates and returns new API key", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce({ userId: "u123" });
      vi.mocked(prisma.apiKey.create).mockResolvedValueOnce({
        id: "key_created_1",
        name: "Test Key",
        prefix: "oph_test",
      } as never);

      const res = await postKeys(
        new Request("http://localhost/api/keys", {
          method: "POST",
          body: JSON.stringify({ name: "Test Key" }),
        })
      );
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.data.id).toBe("key_created_1");
      expect(data.data.key).toMatch(/^oph_[a-f0-9]+$/);
    });

    it("DELETE returns 401 when unauthenticated", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(null);
      const res = await deleteKeys(
        new Request("http://localhost/api/keys?id=k1", { method: "DELETE" })
      );
      expect(res.status).toBe(401);
    });

    it("DELETE returns 400 when id param is missing", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce({ userId: "u123" });
      const res = await deleteKeys(new Request("http://localhost/api/keys", { method: "DELETE" }));
      expect(res.status).toBe(400);
    });

    it("DELETE returns 400 when key is not found or not owned by user", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce({ userId: "u123" });
      vi.mocked(prisma.apiKey.deleteMany).mockResolvedValueOnce({ count: 0 });

      const res = await deleteKeys(
        new Request("http://localhost/api/keys?id=nonexistent", { method: "DELETE" })
      );
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toContain("Key not found");
    });

    it("DELETE successfully deletes key", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce({ userId: "u123" });
      vi.mocked(prisma.apiKey.deleteMany).mockResolvedValueOnce({ count: 1 });

      const res = await deleteKeys(
        new Request("http://localhost/api/keys?id=k1", { method: "DELETE" })
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.deleted).toBe(true);
    });
  });
});
