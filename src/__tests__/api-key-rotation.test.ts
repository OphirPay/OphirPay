// SPDX-License-Identifier: MIT
/**
 * @vitest-environment node
 *
 * Dedicated test coverage for API key zero-downtime rotation (Issue #805):
 * - Key rotation issues replacement key with identical scopes
 * - Overlap window keeps old key valid
 * - Expiry window rejection surfaces precise reason
 * - Explicit cancellation immediately invalidates old key
 * - AuditLog emission on rotation and revocation
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
  update: vi.fn((...args: any[]) => Promise.resolve({ id: 'key_old_1' })),
  deleteMany: vi.fn(),
  auditCreate: vi.fn(() => Promise.resolve()),
  logCreate: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    apiKey: {
      findFirst: mocks.findFirst,
      findMany: mocks.findMany,
      create: mocks.create,
      update: mocks.update,
      deleteMany: mocks.deleteMany,
    },
    auditLog: {
      create: mocks.auditCreate,
    },
    apiKeyRequestLog: {
      create: mocks.logCreate,
    },
  },
}));

import {
  authenticateRequest,
  authenticateRequestDetailed,
  requireAuth,
  requireScopes,
} from "@/lib/api-auth";
import { rotateApiKey } from "@/app/api/keys/[id]/rotate/route";
import { revokeApiKey } from "@/app/api/keys/[id]/revoke/route";

const RAW_OLD_KEY = `oph_${"a".repeat(64)}`;
const RAW_NEW_KEY = `oph_${"b".repeat(64)}`;

function requestWithKey(key = RAW_OLD_KEY): Request {
  return new Request("http://localhost/api/payments", {
    headers: { authorization: `Bearer ${key}` },
  });
}

describe("API Key Rotation (Issue #805)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Rotation Service (rotateApiKey)", () => {
    it("creates replacement key with identical scopes and overlap window", async () => {
      const existingKey = {
        id: "key_old_1",
        userId: "user_test_1",
        name: "Production Worker",
        scopes: ["read:payments", "write:payments"],
        revokedAt: null,
        rotationExpiresAt: null,
      };

      mocks.findFirst.mockResolvedValue(existingKey);
      mocks.create.mockImplementation(({ data }) =>
        Promise.resolve({
          id: "key_new_2",
          ...data,
        })
      );
      mocks.update.mockResolvedValue({ id: "key_old_1" } as any);

      const result = await rotateApiKey("key_old_1", "user_test_1", 24);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.scopes).toEqual(["read:payments", "write:payments"]);
      expect(result.data?.rotatedFromId).toBe("key_old_1");
      expect(result.data?.key).toMatch(/^oph_[0-9a-f]{64}$/);
      expect(result.data?.oldKey.id).toBe("key_old_1");

      // Verify old key update
      expect(mocks.update).toHaveBeenCalledWith({
        where: { id: "key_old_1" },
        data: expect.objectContaining({
          rotatedToId: "key_new_2",
          rotationExpiresAt: expect.any(Date),
        }),
      });

      // Verify audit log creation
      expect(mocks.auditCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: "api_key:rotate",
          actor: "user_test_1",
          target: "key_old_1",
        }),
      });
    });

    it("rejects rotation if key is not found or already revoked", async () => {
      mocks.findFirst.mockResolvedValue(null);
      const res404 = await rotateApiKey("invalid_id", "user_test_1");
      expect(res404.status).toBe(404);

      mocks.findFirst.mockResolvedValue({
        id: "revoked_key",
        userId: "user_test_1",
        revokedAt: new Date(),
      });
      const resRevoked = await rotateApiKey("revoked_key", "user_test_1");
      expect(resRevoked.error).toContain("revoked");
    });
  });

  describe("Authentication during Overlap & Expiration", () => {
    it("authenticates old key successfully while overlap window is active", async () => {
      const futureExpiry = new Date(Date.now() + 12 * 3600 * 1000); // 12 hours remaining
      mocks.findFirst.mockResolvedValue({
        id: "key_old_1",
        userId: "user_1",
        name: "Old Key",
        scopes: ["read:payments"],
        expiresAt: null,
        revokedAt: null,
        rotationExpiresAt: futureExpiry,
        rotatedToId: "key_new_2",
      });

      const detailed = await authenticateRequestDetailed(requestWithKey(RAW_OLD_KEY));
      expect(detailed.ok).toBe(true);
      expect(detailed.auth?.userId).toBe("user_1");

      const auth = await authenticateRequest(requestWithKey(RAW_OLD_KEY));
      expect(auth).not.toBeNull();
      expect(auth?.userId).toBe("user_1");
    });

    it("rejects old key and surfaces specific reason once overlap window expires", async () => {
      const pastExpiry = new Date(Date.now() - 3600 * 1000); // Expired 1 hour ago
      mocks.findFirst.mockResolvedValue({
        id: "key_old_1",
        userId: "user_1",
        name: "Old Key",
        scopes: ["read:payments"],
        expiresAt: null,
        revokedAt: null,
        rotationExpiresAt: pastExpiry,
        rotatedToId: "key_new_2",
      });

      const detailed = await authenticateRequestDetailed(requestWithKey(RAW_OLD_KEY));
      expect(detailed.ok).toBe(false);
      expect(detailed.reason).toBe("rotation_expired");
      expect(detailed.errorMessage).toContain("rotated out and its overlap window has expired");

      // authenticateRequest returns null for backward compatibility
      const auth = await authenticateRequest(requestWithKey(RAW_OLD_KEY));
      expect(auth).toBeNull();

      // requireAuth surfaces the precise error message
      const res = await requireAuth(requestWithKey(RAW_OLD_KEY));
      expect("status" in res).toBe(true);
      const json = await (res as Response).json();
      expect(json.error.message).toContain("rotated out and its overlap window has expired");
    });

    it("rejects key immediately when explicitly revoked and surfaces revocation reason", async () => {
      mocks.findFirst.mockResolvedValue({
        id: "key_old_1",
        userId: "user_1",
        name: "Old Key",
        scopes: ["read:payments"],
        expiresAt: null,
        revokedAt: new Date(),
        rotationExpiresAt: new Date(Date.now() + 100000),
      });

      const detailed = await authenticateRequestDetailed(requestWithKey(RAW_OLD_KEY));
      expect(detailed.ok).toBe(false);
      expect(detailed.reason).toBe("revoked");
      expect(detailed.errorMessage).toContain("revoked");

      const res = await requireScopes(requestWithKey(RAW_OLD_KEY), "read:payments");
      expect("status" in res).toBe(true);
      const json = await (res as Response).json();
      expect(json.error.message).toContain("revoked");
    });
  });

  describe("Explicit Overlap Cancellation (revokeApiKey)", () => {
    it("cancels overlap immediately and records audit log", async () => {
      mocks.findFirst.mockResolvedValue({
        id: "key_old_1",
        userId: "user_1",
        rotationExpiresAt: new Date(Date.now() + 100000),
      });
      mocks.update.mockResolvedValue({ id: "key_old_1" } as any);

      const res = await revokeApiKey("key_old_1", "user_1");
      expect(res.success).toBe(true);
      expect(res.data?.revoked).toBe(true);

      expect(mocks.update).toHaveBeenCalledWith({
        where: { id: "key_old_1" },
        data: expect.objectContaining({
          revokedAt: expect.any(Date),
          rotationExpiresAt: expect.any(Date),
        }),
      });

      expect(mocks.auditCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: "api_key:revoke",
          actor: "user_1",
          target: "key_old_1",
        }),
      });
    });
  });
});
