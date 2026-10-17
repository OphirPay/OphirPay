// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const apiKeyCreate = vi.fn();
  const apiKeyCount = vi.fn().mockResolvedValue(0);
  const auditCreate = vi.fn().mockResolvedValue({});
  const txs = vi.fn();
  return { apiKeyCreate, apiKeyCount, auditCreate, txs };
});

vi.mock("@/lib/prisma", () => {
  const tx = {
    apiKey: {
      count: mocks.apiKeyCount,
      create: mocks.apiKeyCreate,
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    auditLog: { create: mocks.auditCreate },
  };
  mocks.txs.mockImplementation(
    (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)
  );
  return {
    default: {
      apiKey: {
        count: mocks.apiKeyCount,
        create: mocks.apiKeyCreate,
      },
      auditLog: { create: mocks.auditCreate },
      $transaction: mocks.txs,
    },
  };
});

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/csrf", () => ({
  verifyCsrf: vi.fn().mockReturnValue(null),
}));

import { POST as createKey } from "@/app/api/keys/route";
import { POST as rotateKey } from "@/app/api/keys/[id]/rotate/route";
import { getAuthContext } from "@/lib/auth-session";
import {
  consumeApiKeyMutationQuota,
  InMemoryRateLimitStore,
  MAX_ACTIVE_API_KEYS,
  setRateLimitStore,
} from "@/lib/rate-limit";

const userId = "user_1370";

function createRequest(body: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/keys", {
    method: "POST",
    body: JSON.stringify({ name: "CI bot", ...body }),
  });
}

function rotateRequest() {
  return new Request("http://localhost/api/keys/key_1/rotate", {
    method: "POST",
  });
}

describe("API key lifecycle limits (#1370)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Fresh quota store per test: the module singleton is intentionally
    // process-wide in production and would otherwise leak counts between
    // cases.
    setRateLimitStore(new InMemoryRateLimitStore());
    vi.mocked(getAuthContext).mockResolvedValue({ userId });
    mocks.apiKeyCount.mockResolvedValue(0);
    mocks.apiKeyCreate.mockResolvedValue({ id: "key_new", name: "CI bot" });
    mocks.auditCreate.mockResolvedValue({});
    mocks.txs.mockImplementation(
      (callback: (transaction: unknown) => Promise<unknown>) =>
        callback({
          apiKey: {
            count: mocks.apiKeyCount,
            create: mocks.apiKeyCreate,
          },
          auditLog: { create: mocks.auditCreate },
        })
    );
  });

  it("returns 429 with a reset timestamp once the hourly quota is exhausted", async () => {
    for (let i = 0; i < 10; i++) {
      await consumeApiKeyMutationQuota(userId);
    }

    const response = await createKey(createRequest());
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(body.error.details).toMatchObject({ limit: 10, remaining: 0 });
    expect(new Date(body.error.details.resetAt).getTime()).toBeGreaterThan(
      Date.now()
    );
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(response.headers.get("X-RateLimit-Limit")).toBe("10");
    // Quota exhaustion must short-circuit before any DB work.
    expect(mocks.txs).not.toHaveBeenCalled();
  });

  it("returns 409 when the account already holds the maximum active keys", async () => {
    mocks.apiKeyCount.mockResolvedValue(MAX_ACTIVE_API_KEYS);

    const response = await createKey(createRequest());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("CONFLICT");
    expect(body.error.message).toContain(String(MAX_ACTIVE_API_KEYS));
    expect(mocks.apiKeyCreate).not.toHaveBeenCalled();
  });

  it("counts only unrevoked, unrotated, unexpired keys toward the cap", async () => {
    await createKey(createRequest());

    expect(mocks.apiKeyCount).toHaveBeenCalledWith({
      where: {
        userId,
        revokedAt: null,
        rotatedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
      },
    });
  });

  it("records key creation in the audit log with the initiating credential", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({
      userId,
      publicKey: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    });

    const response = await createKey(createRequest({ scopes: ["read:payments"] }));
    expect(response.status).toBe(201);

    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: {
        action: "api_key:create",
        actor: userId,
        target: "key_new",
        details: {
          name: "CI bot",
          prefix: expect.stringMatching(/^(oph_|op_(live|test)_)/),
          scopes: ["read:payments"],
          initiatedBy:
            "wallet:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        },
      },
    });
  });

  it("applies the same quota to rotation", async () => {
    for (let i = 0; i < 10; i++) {
      await consumeApiKeyMutationQuota(userId);
    }

    const response = await rotateKey(rotateRequest(), {
      params: Promise.resolve({ id: "key_1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.error.details.resetAt).toBeDefined();
    expect(mocks.txs).not.toHaveBeenCalled();
  });

  it("records the initiating API key on rotation", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({ userId, keyId: "key_actor" });
    mocks.txs.mockImplementation(
      (callback: (transaction: unknown) => Promise<unknown>) =>
        callback({
          apiKey: {
            findFirst: vi.fn().mockResolvedValue({
              id: "key_1",
              name: "Production",
              prefix: "oph_old",
              scopes: [],
              expiresAt: null,
            }),
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
            create: vi.fn().mockResolvedValue({ id: "key_replacement" }),
            update: vi.fn().mockResolvedValue({}),
          },
          auditLog: { create: mocks.auditCreate },
        })
    );

    const response = await rotateKey(rotateRequest(), {
      params: Promise.resolve({ id: "key_1" }),
    });
    expect(response.status).toBe(201);

    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "api_key:rotate",
        actor: userId,
        target: "key_1",
        details: expect.objectContaining({ initiatedBy: "api_key:key_actor" }),
      }),
    });
  });
});
