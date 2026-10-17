// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  update: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    apiKey: {
      findFirst: mocks.findFirst,
      update: mocks.update,
    },
    apiKeyRequestLog: {
      create: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

import {
  hasScope,
  requireScope,
  requireScopes,
  verifyApiKeyScope,
  withApiAuth,
  type ApiScope,
} from "@/lib/api-auth";
import { POST as postEscrows } from "@/app/api/escrows/route";

function makeKey(scopes: string[]) {
  return {
    id: "key_1",
    userId: "user_1",
    name: "test-key",
    expiresAt: null,
    scopes,
  };
}

// A valid-format key (32 CSPRNG bytes as hex) so the request reaches the
// mocked lookup — malformed material is rejected before the DB (issue #701).
const VALID_LOOKUP_KEY = `oph_${"a".repeat(64)}`;

function makeRequest() {
  return new Request("http://localhost/api/test", {
    headers: { "x-api-key": VALID_LOOKUP_KEY },
  });
}

describe("hasScope", () => {
  it("grants when the key has the exact scope", () => {
    expect(hasScope(["read:payments"], ["read:payments"])).toBe(true);
  });

  it("denies when the key lacks the required scope", () => {
    expect(hasScope(["read:payments"], ["write:payments"])).toBe(false);
  });

  it("admin scope grants every other scope", () => {
    const all: ApiScope[] = [
      "read:payments",
      "write:payments",
      "read:analytics",
      "batches:create",
      "escrow:write",
      "escrow:release",
      "webhooks:write",
      "admin",
    ];
    for (const scope of all) {
      expect(hasScope(["admin"], [scope])).toBe(true);
    }
  });

  it("empty required list is always satisfied regardless of key scopes", () => {
    expect(hasScope([], [])).toBe(true);
    expect(hasScope(["read:payments"], [])).toBe(true);
    expect(hasScope(null, [])).toBe(true);
  });

  it("null/undefined scopes deny any requirement", () => {
    expect(hasScope(null, ["read:payments"])).toBe(false);
    expect(hasScope(undefined, ["read:payments"])).toBe(false);
  });

  it("requires every scope when multiple are required (AND)", () => {
    expect(
      hasScope(["read:payments", "write:payments"], [
        "read:payments",
        "write:payments",
      ])
    ).toBe(true);
    expect(
      hasScope(["read:payments"], ["read:payments", "write:payments"])
    ).toBe(false);
  });
});

describe("requireScopes / requireScope", () => {
  beforeEach(() => {
    mocks.findFirst.mockReset();
    mocks.update.mockReset();
    mocks.update.mockResolvedValue(undefined);
  });

  const scopes = [
    "read:payments",
    "write:payments",
    "read:analytics",
    "batches:create",
    "escrow:write",
    "escrow:release",
    "webhooks:write",
    "admin",
  ] as const;

  for (const scope of scopes) {
    it(`grants a request whose key has the "${scope}" scope`, async () => {
      mocks.findFirst.mockResolvedValue(makeKey([scope]));
      const result = await requireScope(makeRequest(), scope);
      expect("userId" in result).toBe(true);
      if ("userId" in result) {
        expect(result.scopes).toContain(scope);
      }
    });

    it(`denies (403) a request whose key lacks the "${scope}" scope`, async () => {
      // A key that has every scope EXCEPT the one required.
      const keyScopes = scopes.filter((s) => s !== scope && s !== "admin");
      mocks.findFirst.mockResolvedValue(makeKey(keyScopes));
      const result = await requireScopes(makeRequest(), scope);
      expect("userId" in result).toBe(false);
      if (!("userId" in result)) {
        expect(result.status).toBe(403);
        const body = await result.json();
        expect(body.error.code).toBe("INSUFFICIENT_SCOPE");
        expect(body.error.details.required).toEqual([scope]);
      }
    });
  }

  it("admin scope satisfies a read:payments requirement (granted)", async () => {
    mocks.findFirst.mockResolvedValue(makeKey(["admin"]));
    const result = await requireScopes(makeRequest(), "read:payments");
    expect("userId" in result).toBe(true);
  });

  it("returns 401 when no API key is present", async () => {
    mocks.findFirst.mockResolvedValue(null);
    const req = new Request("http://localhost/api/test");
    const result = await requireScopes(req, "read:payments");
    expect("userId" in result).toBe(false);
    if (!("userId" in result)) {
      expect(result.status).toBe(401);
    }
  });
});

describe("verifyApiKeyScope & mutation route enforcement (#1312)", () => {
  beforeEach(() => {
    mocks.findFirst.mockReset();
    mocks.update.mockReset();
    mocks.update.mockResolvedValue(undefined);
  });

  it("allows wallet-session contexts without keyId/scopes", () => {
    expect(verifyApiKeyScope({ userId: "user_1", publicKey: "GABC" } as never, "batches:create")).toBeNull();
  });

  it("returns 403 INSUFFICIENT_SCOPE with missing scope details when API key lacks scope", async () => {
    const err = verifyApiKeyScope(
      { keyId: "key_1", scopes: ["read:payments"] },
      "batches:create"
    );
    expect(err).not.toBeNull();
    expect(err?.status).toBe(403);
    const body = await err!.json();
    expect(body.error.code).toBe("INSUFFICIENT_SCOPE");
    expect(body.error.message).toContain("batches:create");
    expect(body.error.details).toEqual({
      required: ["batches:create"],
      has: ["read:payments"],
    });
  });

  it("POST /api/escrows rejects an API key lacking escrow:write with 403 INSUFFICIENT_SCOPE", async () => {
    mocks.findFirst.mockResolvedValue(makeKey(["read:payments"]));
    const req = new Request("http://localhost/api/escrows", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": VALID_LOOKUP_KEY,
      },
      body: JSON.stringify({ depositor: "G1", beneficiary: "G2", amount: "100" }),
    });
    const res = await postEscrows(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("INSUFFICIENT_SCOPE");
    expect(body.error.details.required).toEqual(["escrow:write"]);
  });

  it("POST /api/escrows succeeds when API key carries escrow:write", async () => {
    mocks.findFirst.mockResolvedValue(makeKey(["escrow:write"]));
    const req = new Request("http://localhost/api/escrows", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": VALID_LOOKUP_KEY,
      },
      body: JSON.stringify({ depositor: "G1", beneficiary: "G2", amount: "100" }),
    });
    const res = await postEscrows(req);
    expect(res.status).toBe(202);
  });
});

describe("withApiAuth scope enforcement", () => {
  beforeEach(() => {
    mocks.findFirst.mockReset();
    mocks.update.mockReset();
    mocks.update.mockResolvedValue(undefined);
  });

  it("blocks handlers when the key lacks the required scope (403)", async () => {
    mocks.findFirst.mockResolvedValue(makeKey(["read:payments"]));
    const handler = vi.fn(async () => new Response("ok"));
    const wrapped = withApiAuth(handler, "write:payments");
    const res = await wrapped(makeRequest());
    expect(res.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it("invokes the handler when the key has the required scope", async () => {
    mocks.findFirst.mockResolvedValue(makeKey(["write:payments", "admin"]));
    const handler = vi.fn(async () => new Response("ok"));
    const wrapped = withApiAuth(handler, "write:payments");
    const res = await wrapped(makeRequest());
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });
});
