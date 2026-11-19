// SPDX-License-Identifier: MIT

/**
 * Granular API scope enforcement (least privilege for delegated keys).
 *
 * Browser sessions belong to the account owner and are not scope-limited;
 * API keys must carry the scope a mutating route declares.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  update: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    apiKey: {
      findFirst: mocks.findMany,
      findMany: mocks.findMany,
      update: mocks.update,
    },
    apiKeyRequestLog: {
      create: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

import { API_SCOPES, hasScope, missingScopes, hashApiKeyV1 } from "@/lib/api-auth";
import { calculateCrc32 } from "@/lib/api-key-format";
import { requireScope } from "@/lib/api-route";
import { createSessionToken } from "@/lib/auth-session";
import { POST as createBatch } from "@/app/api/batches/route";
import { POST as createEscrow } from "@/app/api/escrows/route";
import { POST as createWebhook } from "@/app/api/webhooks/route";

// A valid-format key so authentication reaches the mocked lookup.
const VALID_PAYLOAD = `op_test_${"a".repeat(64)}`;
const VALID_KEY = `${VALID_PAYLOAD}_${calculateCrc32(VALID_PAYLOAD)}`;

function makeKey(scopes: string[]) {
  return {
    id: "key_1",
    userId: "user_1",
    name: "delegated-key",
    expiresAt: null,
    scopes,
    keyHash: hashApiKeyV1(VALID_KEY),
  };
}

function apiKeyRequest(path = "/api/batches", key = VALID_KEY) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}` },
  });
}

const SESSION_PUBLIC_KEY =
  "GACNKEDGJYLLVQDXWYEEPB47Y3JEV5JNZ3RQANTJIVKKEOXX4NC4YWHU";

function sessionRequest(path = "/api/batches") {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      cookie: `ophirpay_session=${createSessionToken(
        SESSION_PUBLIC_KEY,
        "TESTNET"
      )}`,
    },
  });
}

describe("granular API scopes", () => {
  it("declares the scopes enforced by mutating routes", () => {
    for (const scope of [
      "payments:write",
      "batches:create",
      "escrow:write",
      "escrow:release",
      "webhooks:write",
    ] as const) {
      expect(API_SCOPES).toContain(scope);
    }
  });

  it("keeps the legacy coarse scopes valid for existing keys", () => {
    expect(API_SCOPES).toContain("read:payments");
    expect(API_SCOPES).toContain("write:payments");
    expect(API_SCOPES).toContain("read:analytics");
  });

  it("does not let a legacy broad scope satisfy a granular requirement", () => {
    expect(hasScope(["write:payments"], ["batches:create"])).toBe(false);
  });

  it("reports the exact missing scopes", () => {
    expect(missingScopes(["read:payments"], ["batches:create"])).toEqual([
      "batches:create",
    ]);
    expect(missingScopes(["admin"], ["batches:create"])).toEqual([]);
    expect(missingScopes([], ["escrow:write", "escrow:release"])).toEqual([
      "escrow:write",
      "escrow:release",
    ]);
  });
});

describe("requireScope", () => {
  beforeEach(() => {
    mocks.findMany.mockReset();
    mocks.update.mockReset();
    mocks.update.mockResolvedValue(undefined);
  });

  const keyAuth = (scopes: string[]) => ({ keyId: "key_1", scopes });

  it("allows an API key that carries the required granular scope", async () => {
    await expect(
      requireScope(apiKeyRequest(), "batches:create", keyAuth(["batches:create"]))
    ).resolves.toBeNull();
  });

  it("allows an admin key to satisfy any scope", async () => {
    await expect(
      requireScope(apiKeyRequest("/api/webhooks"), "webhooks:write", keyAuth(["admin"]))
    ).resolves.toBeNull();
  });

  it("rejects a scoped key that lacks the permission with an RFC 7807 403", async () => {
    const response = await requireScope(
      apiKeyRequest("/api/batches"),
      "batches:create",
      keyAuth(["read:payments"])
    );

    expect(response).not.toBeNull();
    expect(response!.status).toBe(403);
    expect(response!.headers.get("content-type")).toContain(
      "application/problem+json"
    );

    const body = (await response!.json()) as Record<string, unknown>;
    expect(body.status).toBe(403);
    expect(body.code).toBe("INSUFFICIENT_SCOPE");
    expect(body.missingScope).toBe("batches:create");
    expect(body.detail).toContain("batches:create");
  });

  it("names each missing scope for an escrow mutation", async () => {
    const response = await requireScope(
      apiKeyRequest("/api/escrows"),
      "escrow:write",
      keyAuth(["read:payments"])
    );
    const body = (await response!.json()) as Record<string, unknown>;

    expect(response!.status).toBe(403);
    expect(body.missingScope).toBe("escrow:write");
    expect(body.requiredScopes).toEqual(["escrow:write"]);
  });

  it("does not apply key scopes to a signed browser session", async () => {
    await expect(
      requireScope(sessionRequest(), "batches:create", {})
    ).resolves.toBeNull();
  });

  it("does not reveal the key's full scope list on denial", async () => {
    const response = await requireScope(
      apiKeyRequest("/api/webhooks"),
      "webhooks:write",
      keyAuth(["read:payments", "read:analytics"])
    );
    const raw = await response!.text();

    expect(raw).not.toContain("read:analytics");
  });
});

describe("mutating route wiring", () => {
  beforeEach(() => {
    mocks.findMany.mockReset();
    mocks.findMany.mockResolvedValue([makeKey(["read:payments"])]);
  });

  const cases = [
    { name: "POST /api/batches", path: "/api/batches", handler: createBatch, scope: "batches:create" },
    { name: "POST /api/escrows", path: "/api/escrows", handler: createEscrow, scope: "escrow:write" },
    { name: "POST /api/webhooks", path: "/api/webhooks", handler: createWebhook, scope: "webhooks:write" },
  ] as const;

  for (const entry of cases) {
    it(`${entry.name} rejects an API key without ${entry.scope}`, async () => {
      const response = await entry.handler(apiKeyRequest(entry.path, VALID_KEY));

      expect(response.status).toBe(403);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.code).toBe("INSUFFICIENT_SCOPE");
      expect(body.missingScope).toBe(entry.scope);
    });
  }
});
