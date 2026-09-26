// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("@/lib/prisma", () => ({
  default: {
    apiKey: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    apiKeyRequestLog: {
      create: vi.fn().mockResolvedValue({}),
    },
    auditLog: {
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/csrf", () => ({
  verifyCsrf: vi.fn().mockReturnValue(null),
}));

import prisma from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-session";
import {
  authenticateApiKeyDetails,
  authenticateRequest,
  withApiAuth,
  hashApiKey,
  deriveKeyPrefix,
  generateApiKey,
} from "@/lib/api-auth";
import { POST as rotateKey } from "@/app/api/keys/[id]/rotate/route";
import { POST as retireKey } from "@/app/api/keys/[id]/retire/route";
import { POST as cancelRotation } from "@/app/api/keys/[id]/cancel-rotation/route";
import { GET as getKeys } from "@/app/api/keys/route";

const mockApiKeyFindFirst = prisma.apiKey.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockApiKeyCreate = prisma.apiKey.create as unknown as ReturnType<typeof vi.fn>;
const mockApiKeyUpdate = prisma.apiKey.update as unknown as ReturnType<typeof vi.fn>;
const mockApiKeyDeleteMany = prisma.apiKey.deleteMany as unknown as ReturnType<typeof vi.fn>;
const mockAuditLogCreate = prisma.auditLog.create as unknown as ReturnType<typeof vi.fn>;
const mockGetAuth = getAuthContext as unknown as ReturnType<typeof vi.fn>;

describe("API Key Rotation & Overlap Lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Criterion 1: Rotation produces identical scopes & keeps old key valid during overlap", () => {
    it("POST /api/keys/[id]/rotate generates new key with identical scopes and sets overlap window", async () => {
      mockGetAuth.mockResolvedValue({ userId: "user_123" });

      const oldKey = {
        id: "key_old_1",
        name: "Backend Service",
        prefix: "oph_old1",
        scopes: ["read:payments", "write:payments"],
        supersededById: null,
        rotationExpiresAt: null,
        revokedAt: null,
      };

      mockApiKeyFindFirst.mockResolvedValue(oldKey);

      mockApiKeyCreate.mockImplementation(async ({ data }: { data: any }) => ({
        id: "key_new_2",
        name: data.name,
        prefix: data.prefix,
        scopes: data.scopes,
        userId: data.userId,
      }));

      mockApiKeyUpdate.mockResolvedValue({
        id: "key_old_1",
        supersededById: "key_new_2",
      });

      mockAuditLogCreate.mockResolvedValue({ id: "audit_rot_1" });

      const req = new Request("http://localhost/api/keys/key_old_1/rotate", {
        method: "POST",
        body: JSON.stringify({
          name: "Backend Service (v2)",
          overlapWindowSeconds: 3600, // 1 hour overlap
        }),
      });

      const res = await rotateKey(req, {
        params: Promise.resolve({ id: "key_old_1" }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);

      // Verify identical scopes inherited
      expect(json.data.newKey.scopes).toEqual(["read:payments", "write:payments"]);
      expect(json.data.newKey.name).toBe("Backend Service (v2)");
      expect(json.data.newKey.key).toMatch(/^oph_[a-f0-9]+$/);

      // Verify old key link and overlap
      expect(json.data.oldKey.supersededById).toBe("key_new_2");
      expect(json.data.overlapWindowSeconds).toBe(3600);
      expect(new Date(json.data.overlapExpiresAt).getTime()).toBeGreaterThan(Date.now());

      // Verify database calls
      expect(mockApiKeyCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: "user_123",
          scopes: ["read:payments", "write:payments"],
          name: "Backend Service (v2)",
        }),
      });

      expect(mockApiKeyUpdate).toHaveBeenCalledWith({
        where: { id: "key_old_1" },
        data: expect.objectContaining({
          supersededById: "key_new_2",
          rotationExpiresAt: expect.any(Date),
        }),
      });

      // Verify AuditLog was recorded
      expect(mockAuditLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: "api-key:rotate",
          actor: "user_123",
          target: "key_old_1",
          details: expect.objectContaining({
            oldKeyId: "key_old_1",
            newKeyId: "key_new_2",
            scopes: ["read:payments", "write:payments"],
            overlapWindowSeconds: 3600,
          }),
        }),
      });
    });

    it("authenticates successfully with old key during the active overlap window", async () => {
      const rawOldKey = generateApiKey();
      const keyHash = hashApiKey(rawOldKey);
      const prefix = deriveKeyPrefix(rawOldKey);

      // Overlap window expires 1 hour in the future
      const futureExpiry = new Date(Date.now() + 3600 * 1000);

      mockApiKeyFindFirst.mockResolvedValue({
        id: "key_old_1",
        userId: "user_123",
        name: "Backend Service",
        scopes: ["read:payments"],
        supersededById: "key_new_2",
        rotationExpiresAt: futureExpiry,
        revokedAt: null,
        expiresAt: null,
      });

      const req = new Request("http://localhost/api/test", {
        headers: { Authorization: `Bearer ${rawOldKey}` },
      });

      const result = await authenticateApiKeyDetails(req);
      expect(result.ok).toBe(true);
      expect(result.auth?.userId).toBe("user_123");
      expect(result.auth?.keyId).toBe("key_old_1");

      const authCompat = await authenticateRequest(req);
      expect(authCompat).not.toBeNull();
      expect(authCompat?.keyId).toBe("key_old_1");
    });
  });

  describe("Criterion 2: After the window, old key is rejected and reason is surfaced", () => {
    it("rejects old key with ROTATION_EXPIRED_KEY reason after the overlap window has closed", async () => {
      const rawOldKey = generateApiKey();
      const keyHash = hashApiKey(rawOldKey);
      const prefix = deriveKeyPrefix(rawOldKey);

      // Overlap window closed 5 minutes ago
      const pastExpiry = new Date(Date.now() - 300 * 1000);

      mockApiKeyFindFirst.mockResolvedValue({
        id: "key_old_1",
        userId: "user_123",
        name: "Backend Service",
        scopes: ["read:payments"],
        supersededById: "key_new_2",
        rotationExpiresAt: pastExpiry,
        revokedAt: null,
        expiresAt: null,
      });

      const req = new Request("http://localhost/api/test", {
        headers: { Authorization: `Bearer ${rawOldKey}` },
      });

      const result = await authenticateApiKeyDetails(req);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("ROTATION_EXPIRED_KEY");
      expect(result.message).toContain("This API key was rotated and its overlap grace period expired");
      expect(result.supersededById).toBe("key_new_2");

      // withApiAuth wrapper surfaces the specific reason to callers
      const handler = vi.fn().mockResolvedValue(new Response("ok"));
      const protectedHandler = withApiAuth(handler);
      const response = await protectedHandler(req);

      expect(response.status).toBe(401);
      const json = await response.json();
      expect(json.success).toBe(false);
      expect(json.error.message).toContain("This API key was rotated and its overlap grace period expired");
      expect(handler).not.toHaveBeenCalled();
    });

    it("rejects a revoked key with REVOKED_KEY reason", async () => {
      const rawKey = generateApiKey();

      mockApiKeyFindFirst.mockResolvedValue({
        id: "key_revoked",
        userId: "user_123",
        name: "Revoked Key",
        scopes: [],
        supersededById: null,
        rotationExpiresAt: null,
        revokedAt: new Date(Date.now() - 60000),
        expiresAt: null,
      });

      const req = new Request("http://localhost/api/test", {
        headers: { "x-api-key": rawKey },
      });

      const result = await authenticateApiKeyDetails(req);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("REVOKED_KEY");
      expect(result.message).toContain("This API key has been revoked and cannot be used");
    });
  });

  describe("Criterion 3: Explicit confirmation (early retirement) and cancellation paths", () => {
    it("POST /api/keys/[id]/retire immediately ends overlap window and revokes old key", async () => {
      mockGetAuth.mockResolvedValue({ userId: "user_123" });

      mockApiKeyFindFirst.mockResolvedValue({
        id: "key_old_1",
        name: "Backend Service",
        prefix: "oph_old1",
        supersededById: "key_new_2",
        rotationExpiresAt: new Date(Date.now() + 86400 * 1000),
        revokedAt: null,
      });

      mockApiKeyUpdate.mockResolvedValue({
        id: "key_old_1",
        revokedAt: new Date(),
      });
      mockAuditLogCreate.mockResolvedValue({ id: "audit_retire_1" });

      const req = new Request("http://localhost/api/keys/key_old_1/retire", {
        method: "POST",
      });

      const res = await retireKey(req, {
        params: Promise.resolve({ id: "key_old_1" }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.retired).toBe(true);

      // Verify update called with revokedAt timestamp
      expect(mockApiKeyUpdate).toHaveBeenCalledWith({
        where: { id: "key_old_1" },
        data: expect.objectContaining({
          revokedAt: expect.any(Date),
          rotationExpiresAt: expect.any(Date),
        }),
      });

      // Verify audit log entry
      expect(mockAuditLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: "api-key:retire-overlap",
          actor: "user_123",
          target: "key_old_1",
        }),
      });
    });

    it("POST /api/keys/[id]/cancel-rotation reverts original key and deletes replacement key", async () => {
      mockGetAuth.mockResolvedValue({ userId: "user_123" });

      mockApiKeyFindFirst.mockResolvedValue({
        id: "key_old_1",
        name: "Backend Service",
        supersededById: "key_new_2",
        rotationExpiresAt: new Date(Date.now() + 86400 * 1000),
        revokedAt: null,
      });

      mockApiKeyUpdate.mockResolvedValue({
        id: "key_old_1",
        supersededById: null,
        rotationExpiresAt: null,
      });
      mockApiKeyDeleteMany.mockResolvedValue({ count: 1 });
      mockAuditLogCreate.mockResolvedValue({ id: "audit_cancel_1" });

      const req = new Request("http://localhost/api/keys/key_old_1/cancel-rotation", {
        method: "POST",
      });

      const res = await cancelRotation(req, {
        params: Promise.resolve({ id: "key_old_1" }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.rotationCancelled).toBe(true);

      // Verify old key reset
      expect(mockApiKeyUpdate).toHaveBeenCalledWith({
        where: { id: "key_old_1" },
        data: {
          supersededById: null,
          rotationExpiresAt: null,
        },
      });

      // Verify replacement key deleted
      expect(mockApiKeyDeleteMany).toHaveBeenCalledWith({
        where: { id: "key_new_2", userId: "user_123" },
      });

      // Verify audit log entry
      expect(mockAuditLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: "api-key:cancel-rotation",
          actor: "user_123",
          target: "key_old_1",
        }),
      });
    });
  });

  describe("Criterion 4: Rotation state visibility in key listings", () => {
    it("GET /api/keys includes rotation fields and supersededBy relation", async () => {
      mockGetAuth.mockResolvedValue({ userId: "user_123" });

      mockApiKeyFindFirst.mockResolvedValue(null);
      (prisma.apiKey.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: "key_old_1",
          name: "Old Key",
          prefix: "oph_old1",
          scopes: ["read:payments"],
          lastUsed: null,
          createdAt: new Date(),
          expiresAt: null,
          supersededById: "key_new_2",
          rotationExpiresAt: new Date(Date.now() + 3600 * 1000),
          revokedAt: null,
          supersededBy: {
            id: "key_new_2",
            name: "New Key",
            prefix: "oph_new2",
          },
        },
        {
          id: "key_new_2",
          name: "New Key",
          prefix: "oph_new2",
          scopes: ["read:payments"],
          lastUsed: null,
          createdAt: new Date(),
          expiresAt: null,
          supersededById: null,
          rotationExpiresAt: null,
          revokedAt: null,
          supersededBy: null,
        },
      ]);

      const req = new Request("http://localhost/api/keys");
      const res = await getKeys(req);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toHaveLength(2);
      expect(json.data[0].supersededById).toBe("key_new_2");
      expect(json.data[0].supersededBy.prefix).toBe("oph_new2");
      expect(json.data[0].rotationExpiresAt).toBeDefined();
    });
  });
});
