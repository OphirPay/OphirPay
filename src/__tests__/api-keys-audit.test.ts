// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
  deleteMany: vi.fn(),
  updateMany: vi.fn(),
  update: vi.fn().mockResolvedValue(undefined),
  userFindUnique: vi.fn(),
  userUpsert: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    apiKey: {
      findFirst: mocks.findFirst,
      findMany: mocks.findMany,
      create: mocks.create,
      deleteMany: mocks.deleteMany,
      updateMany: mocks.updateMany,
      update: mocks.update,
    },
    user: {
      findUnique: mocks.userFindUnique,
      upsert: mocks.userUpsert,
    },
  },
}));

import { GET, POST, DELETE, PATCH } from "@/app/api/keys/route";
import { authenticateRequest } from "@/lib/api-auth";
import {
  recordAudit,
  getAuditLogs,
  clearAuditLogs,
  addAuditListener,
  AUDIT_ACTIONS,
  type AuditEntry,
} from "@/lib/audit";
import { createSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth-session";

const TEST_STELLAR_PK = "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U";

function createAuthenticatedRequest(
  url: string,
  options: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {}
) {
  const token = createSessionToken(TEST_STELLAR_PK, "TESTNET");
  const headers = new Headers(options.headers || {});
  headers.set("cookie", `${SESSION_COOKIE_NAME}=${token}`);
  if (options.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  return new Request(url, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
}

describe("Audit Utility", () => {
  beforeEach(() => {
    clearAuditLogs();
  });

  it("records an audit entry with an accurate ISO timestamp", () => {
    const before = new Date(Date.now() - 1000).toISOString();
    const entry = recordAudit({
      action: AUDIT_ACTIONS.API_KEY_REVOKE,
      actor: "user_audit_1",
      target: "key_target_1",
      details: { keyId: "key_target_1", reason: "manual_revocation" },
    });
    const after = new Date(Date.now() + 1000).toISOString();

    expect(entry.action).toBe(AUDIT_ACTIONS.API_KEY_REVOKE);
    expect(entry.actor).toBe("user_audit_1");
    expect(entry.target).toBe("key_target_1");
    expect(entry.details).toEqual({
      keyId: "key_target_1",
      reason: "manual_revocation",
    });
    expect(entry.timestamp >= before).toBe(true);
    expect(entry.timestamp <= after).toBe(true);
  });

  it("stores and retrieves audit entries in-memory", () => {
    expect(getAuditLogs()).toHaveLength(0);

    recordAudit({
      action: AUDIT_ACTIONS.API_KEY_CREATE,
      actor: "user_1",
      target: "key_1",
    });
    recordAudit({
      action: AUDIT_ACTIONS.API_KEY_REVOKE,
      actor: "user_1",
      target: "key_1",
    });

    const logs = getAuditLogs();
    expect(logs).toHaveLength(2);
    expect(logs[0].action).toBe("api_key:create");
    expect(logs[1].action).toBe("api_key:revoke");

    clearAuditLogs();
    expect(getAuditLogs()).toHaveLength(0);
  });

  it("notifies listeners on recorded audit events", () => {
    const received: AuditEntry[] = [];
    const unsubscribe = addAuditListener((entry) => {
      received.push(entry);
    });

    recordAudit({
      action: AUDIT_ACTIONS.SETTINGS_CHANGE,
      actor: "admin_user",
      target: "config",
    });

    expect(received).toHaveLength(1);
    expect(received[0].action).toBe(AUDIT_ACTIONS.SETTINGS_CHANGE);

    unsubscribe();
    recordAudit({
      action: AUDIT_ACTIONS.WALLET_CONNECT,
      actor: "user_2",
    });
    expect(received).toHaveLength(1); // Listener was unsubscribed
  });
});

describe("API Key Authentication & lastUsedAt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates lastUsedAt timestamp on successful authentication", async () => {
    const fakeKey = {
      id: "key_valid_123",
      userId: "user_abc",
      name: "Prod Backend",
      expiresAt: null,
      scopes: ["read:payments", "write:payments"],
    };
    mocks.findFirst.mockResolvedValueOnce(fakeKey);

    const req = new Request("http://localhost/api/test", {
      headers: { "x-api-key": "oph_abcdef1234567890" },
    });

    const authResult = await authenticateRequest(req);

    expect(authResult).toEqual({
      userId: "user_abc",
      keyId: "key_valid_123",
      keyName: "Prod Backend",
      scopes: ["read:payments", "write:payments"],
    });

    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "key_valid_123" },
      data: { lastUsedAt: expect.any(Date) },
    });
  });

  it("does not update lastUsedAt for expired keys", async () => {
    const expiredKey = {
      id: "key_expired",
      userId: "user_abc",
      name: "Old Key",
      expiresAt: new Date(Date.now() - 3600_000), // expired 1 hour ago
      scopes: ["read:payments"],
    };
    mocks.findFirst.mockResolvedValueOnce(expiredKey);

    const req = new Request("http://localhost/api/test", {
      headers: { Authorization: "Bearer oph_expiredkey123" },
    });

    const authResult = await authenticateRequest(req);
    expect(authResult).toBeNull();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("returns null and does not update lastUsedAt for non-existent key", async () => {
    mocks.findFirst.mockResolvedValueOnce(null);

    const req = new Request("http://localhost/api/test", {
      headers: { "x-api-key": "oph_nonexistent" },
    });

    const authResult = await authenticateRequest(req);
    expect(authResult).toBeNull();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});

describe("GET /api/keys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.userFindUnique.mockResolvedValue({ id: "user_test_id", stellarAddress: TEST_STELLAR_PK });
  });

  it("rejects unauthenticated requests with 401", async () => {
    const req = new Request("http://localhost/api/keys");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("surfaces lastUsedAt in the keys list response", async () => {
    const now = new Date();
    mocks.findMany.mockResolvedValueOnce([
      {
        id: "key_1",
        name: "Test Key 1",
        prefix: "oph_1234",
        scopes: ["read:payments"],
        lastUsedAt: now,
        createdAt: now,
        expiresAt: null,
      },
      {
        id: "key_2",
        name: "Test Key 2",
        prefix: "oph_5678",
        scopes: ["admin"],
        lastUsedAt: null,
        createdAt: now,
        expiresAt: null,
      },
    ]);

    const req = createAuthenticatedRequest("http://localhost/api/keys");
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
    expect(body.data[0].id).toBe("key_1");
    expect(body.data[0].lastUsedAt).toBe(now.toISOString());
    expect(body.data[0].lastUsed).toBe(now.toISOString());
    expect(body.data[1].id).toBe("key_2");
    expect(body.data[1].lastUsedAt).toBeNull();
    expect(body.data[1].lastUsed).toBeNull();
  });
});

describe("POST /api/keys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAuditLogs();
    mocks.userFindUnique.mockResolvedValue({ id: "user_test_id", stellarAddress: TEST_STELLAR_PK });
  });

  it("creates a key and writes an audit-log entry", async () => {
    mocks.create.mockResolvedValueOnce({
      id: "key_new_123",
      name: "Worker Bot",
      keyHash: "dummyhash",
      prefix: "oph_abc1",
      userId: "user_test_id",
      scopes: ["read:payments"],
      createdAt: new Date(),
    });

    const req = createAuthenticatedRequest("http://localhost/api/keys", {
      method: "POST",
      body: { name: "Worker Bot", scopes: ["read:payments"] },
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.id).toBe("key_new_123");
    expect(body.data.name).toBe("Worker Bot");
    expect(body.data.key).toMatch(/^oph_[a-f0-9]{48}$/);

    // Verify audit log was recorded
    const logs = getAuditLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe(AUDIT_ACTIONS.API_KEY_CREATE);
    expect(logs[0].actor).toBe("user_test_id");
    expect(logs[0].target).toBe("key_new_123");
    expect(logs[0].details?.name).toBe("Worker Bot");
  });

  it("rejects request missing key name", async () => {
    const req = createAuthenticatedRequest("http://localhost/api/keys", {
      method: "POST",
      body: { scopes: ["read:payments"] },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rejects request with invalid scopes", async () => {
    const req = createAuthenticatedRequest("http://localhost/api/keys", {
      method: "POST",
      body: { name: "Bad Key", scopes: ["invalid:scope"] },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/keys (Key Revocation & Audit Log)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAuditLogs();
    mocks.userFindUnique.mockResolvedValue({ id: "user_test_id", stellarAddress: TEST_STELLAR_PK });
  });

  it("writes an audit-log entry (who/when/which key) upon successful key revocation", async () => {
    mocks.deleteMany.mockResolvedValueOnce({ count: 1 });

    const req = createAuthenticatedRequest("http://localhost/api/keys?id=key_to_revoke_456", {
      method: "DELETE",
    });

    const res = await DELETE(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.deleted).toBe(true);

    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: { id: "key_to_revoke_456", userId: "user_test_id" },
    });

    // Verify audit entry contains who, when, and which key
    const logs = getAuditLogs();
    expect(logs).toHaveLength(1);
    const revokeAudit = logs[0];
    expect(revokeAudit.action).toBe(AUDIT_ACTIONS.API_KEY_REVOKE);
    expect(revokeAudit.actor).toBe("user_test_id"); // WHO
    expect(revokeAudit.target).toBe("key_to_revoke_456"); // WHICH KEY
    expect(revokeAudit.details?.keyId).toBe("key_to_revoke_456");
    expect(revokeAudit.details?.userId).toBe("user_test_id");
    expect(typeof revokeAudit.timestamp).toBe("string"); // WHEN
    expect(Number.isNaN(Date.parse(revokeAudit.timestamp))).toBe(false);
  });

  it("rejects request without key id parameter", async () => {
    const req = createAuthenticatedRequest("http://localhost/api/keys", {
      method: "DELETE",
    });

    const res = await DELETE(req);
    expect(res.status).toBe(400);
    expect(getAuditLogs()).toHaveLength(0);
  });

  it("returns 400 when key is not found or not owned by user", async () => {
    mocks.deleteMany.mockResolvedValueOnce({ count: 0 });

    const req = createAuthenticatedRequest("http://localhost/api/keys?id=nonexistent_key", {
      method: "DELETE",
    });

    const res = await DELETE(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toBe("Key not found");
    expect(getAuditLogs()).toHaveLength(0);
  });
});

describe("PATCH /api/keys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.userFindUnique.mockResolvedValue({ id: "user_test_id", stellarAddress: TEST_STELLAR_PK });
  });

  it("updates key scopes successfully", async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 1 });

    const req = createAuthenticatedRequest("http://localhost/api/keys", {
      method: "PATCH",
      body: { id: "key_to_update", scopes: ["read:payments", "write:payments"] },
    });

    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.id).toBe("key_to_update");
    expect(body.data.scopes).toEqual(["read:payments", "write:payments"]);
  });

  it("rejects patch missing key id", async () => {
    const req = createAuthenticatedRequest("http://localhost/api/keys", {
      method: "PATCH",
      body: { scopes: ["read:payments"] },
    });

    const res = await PATCH(req);
    expect(res.status).toBe(400);
  });
});
