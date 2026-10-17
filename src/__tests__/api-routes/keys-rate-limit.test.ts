// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  API_KEY_MUTATION_MAX_PER_HOUR,
  InMemoryRateLimitStore,
  MAX_ACTIVE_API_KEYS_PER_ACCOUNT,
  setRateLimitStore,
} from "@/lib/rate-limit";

const mocks = vi.hoisted(() => ({
  apiKeyCount: vi.fn(),
  apiKeyCreate: vi.fn(),
  apiKeyFindFirst: vi.fn(),
  apiKeyUpdateMany: vi.fn(),
  apiKeyUpdate: vi.fn(),
  auditLogCreate: vi.fn(),
  transaction: vi.fn(),
  getAuthContext: vi.fn(),
  verifyCsrf: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    apiKey: {
      count: mocks.apiKeyCount,
      create: mocks.apiKeyCreate,
      findFirst: mocks.apiKeyFindFirst,
      updateMany: mocks.apiKeyUpdateMany,
      update: mocks.apiKeyUpdate,
    },
    auditLog: {
      create: mocks.auditLogCreate,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: mocks.getAuthContext,
}));

vi.mock("@/lib/csrf", () => ({
  verifyCsrf: mocks.verifyCsrf,
}));

import { POST as createKey } from "@/app/api/keys/route";
import { POST as rotateKey } from "@/app/api/keys/[id]/rotate/route";

const txClient = {
  apiKey: {
    findFirst: mocks.apiKeyFindFirst,
    updateMany: mocks.apiKeyUpdateMany,
    create: mocks.apiKeyCreate,
    update: mocks.apiKeyUpdate,
  },
  auditLog: {
    create: mocks.auditLogCreate,
  },
};

describe("API Keys Rate Limiting, Active Quota & Audit Logging (#1370)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setRateLimitStore(new InMemoryRateLimitStore());

    mocks.verifyCsrf.mockReturnValue(null);
    mocks.getAuthContext.mockResolvedValue({
      userId: "org_user_1",
      publicKey: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    });

    mocks.apiKeyCount.mockResolvedValue(0);
    mocks.apiKeyCreate.mockImplementation(async ({ data }: { data?: { name?: string } }) => ({
      id: "new_key_id",
      name: data?.name ?? "Created Key",
    }));
    mocks.apiKeyFindFirst.mockResolvedValue({
      id: "old_key_id",
      name: "Primary Key",
      prefix: "op_test_",
      scopes: ["read:payments"],
      expiresAt: null,
    });
    mocks.apiKeyUpdateMany.mockResolvedValue({ count: 1 });
    mocks.apiKeyUpdate.mockResolvedValue({ id: "old_key_id" });
    mocks.auditLogCreate.mockResolvedValue({ id: "audit_1" });
    mocks.transaction.mockImplementation(
      (cb: (tx: typeof txClient) => Promise<unknown>) => cb(txClient)
    );
  });

  describe("Sliding-window rate limiting (10 ops / hour per account)", () => {
    it("allows up to 10 key creation requests and rejects the 11th with HTTP 429 and reset headers", async () => {
      for (let i = 1; i <= API_KEY_MUTATION_MAX_PER_HOUR; i++) {
        const res = await createKey(
          new Request("http://localhost/api/keys", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: `Service Key ${i}` }),
          })
        );
        expect(res.status).toBe(201);
        expect(res.headers.get("X-RateLimit-Limit")).toBe("10");
        expect(res.headers.get("X-RateLimit-Remaining")).toBe(
          String(API_KEY_MUTATION_MAX_PER_HOUR - i)
        );
        expect(Number(res.headers.get("X-RateLimit-Reset"))).toBeGreaterThan(0);
      }

      // 11th request within the hour window must be rejected with 429
      const blocked = await createKey(
        new Request("http://localhost/api/keys", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Overflow Key" }),
        })
      );

      expect(blocked.status).toBe(429);
      expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
      expect(Number(blocked.headers.get("X-RateLimit-Reset"))).toBeGreaterThan(0);
      expect(blocked.headers.get("X-RateLimit-Remaining")).toBe("0");

      const body = await blocked.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("RATE_LIMITED");
      expect(body.resetAt).toBeDefined();
      expect(Number.isNaN(Date.parse(body.resetAt))).toBe(false);
      expect(mocks.apiKeyCreate).toHaveBeenCalledTimes(API_KEY_MUTATION_MAX_PER_HOUR);
    });

    it("shares the 10-ops/hour sliding window across key creation and key rotation", async () => {
      // Perform 5 creations + 5 rotations = 10 total operations
      for (let i = 0; i < 5; i++) {
        const cRes = await createKey(
          new Request("http://localhost/api/keys", {
            method: "POST",
            body: JSON.stringify({ name: `Key ${i}` }),
          })
        );
        expect(cRes.status).toBe(201);

        const rRes = await rotateKey(
          new Request("http://localhost/api/keys/old_key_id/rotate", {
            method: "POST",
          }),
          { params: Promise.resolve({ id: "old_key_id" }) }
        );
        expect(rRes.status).toBe(201);
      }

      // Next rotation exceeds the 10-ops/hour budget -> 429
      const blockedRotate = await rotateKey(
        new Request("http://localhost/api/keys/old_key_id/rotate", {
          method: "POST",
        }),
        { params: Promise.resolve({ id: "old_key_id" }) }
      );
      expect(blockedRotate.status).toBe(429);
      const body = await blockedRotate.json();
      expect(body.error.code).toBe("RATE_LIMITED");
      expect(body.resetAt).toBeDefined();
    });

    it("isolates rate-limit buckets per organization/account", async () => {
      // Exhaust org_user_1's quota
      for (let i = 0; i < API_KEY_MUTATION_MAX_PER_HOUR; i++) {
        await createKey(
          new Request("http://localhost/api/keys", {
            method: "POST",
            body: JSON.stringify({ name: `Key ${i}` }),
          })
        );
      }

      // Switch to org_user_2 -> should succeed with 201
      mocks.getAuthContext.mockResolvedValueOnce({ userId: "org_user_2" });
      const otherOrgRes = await createKey(
        new Request("http://localhost/api/keys", {
          method: "POST",
          body: JSON.stringify({ name: "Org 2 Key" }),
        })
      );
      expect(otherOrgRes.status).toBe(201);
    });
  });

  describe("Maximum active API keys per account", () => {
    it("enforces MAX_ACTIVE_API_KEYS_PER_ACCOUNT (5) on POST /api/keys", async () => {
      expect(MAX_ACTIVE_API_KEYS_PER_ACCOUNT).toBe(5);
      mocks.apiKeyCount.mockResolvedValueOnce(5);

      const res = await createKey(
        new Request("http://localhost/api/keys", {
          method: "POST",
          body: JSON.stringify({ name: "Sixth Key" }),
        })
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error.message).toContain("Maximum of 5 active API keys");
      expect(mocks.apiKeyCreate).not.toHaveBeenCalled();
    });
  });

  describe("Audit logging of key lifecycle events", () => {
    it("records api_key:create with initiator identity in the audit log", async () => {
      const res = await createKey(
        new Request("http://localhost/api/keys", {
          method: "POST",
          headers: { "x-forwarded-for": "203.0.113.42" },
          body: JSON.stringify({
            name: "CI Pipeline",
            scopes: ["read:payments"],
          }),
        })
      );

      expect(res.status).toBe(201);
      expect(mocks.auditLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: "api_key:create",
          actor: "org_user_1",
          target: "new_key_id",
          ip: "203.0.113.42",
          details: expect.objectContaining({
            name: "CI Pipeline",
            scopes: ["read:payments"],
            initiatorId: "org_user_1",
            initiatorPublicKey:
              "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
          }),
        }),
      });
    });

    it("records api_key:rotate with initiator identity in the audit log", async () => {
      const res = await rotateKey(
        new Request("http://localhost/api/keys/old_key_id/rotate", {
          method: "POST",
        }),
        { params: Promise.resolve({ id: "old_key_id" }) }
      );

      expect(res.status).toBe(201);
      expect(mocks.auditLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: "api_key:rotate",
          actor: "org_user_1",
          target: "old_key_id",
          details: expect.objectContaining({
            replacementId: "new_key_id",
            initiatorId: "org_user_1",
            initiatorPublicKey:
              "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
          }),
        }),
      });
    });
  });
});
