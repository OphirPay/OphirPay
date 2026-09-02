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
  },
}));

import {
  hasScope,
  requireScopes,
  withApiAuth,
  type ApiScope,
} from "@/lib/api-auth";

function makeKey(scopes: string[]) {
  return {
    id: "key_1",
    userId: "user_1",
    name: "test-key",
    expiresAt: null,
    scopes,
  };
}

function makeRequest() {
  return new Request("http://localhost/api/test", {
    headers: { "x-api-key": "oph_testkey" },
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

describe("requireScopes", () => {
  beforeEach(() => {
    mocks.findFirst.mockReset();
    mocks.update.mockReset();
    mocks.update.mockResolvedValue(undefined);
  });

  const scopes = [
    "read:payments",
    "write:payments",
    "read:analytics",
    "admin",
  ] as const;

  for (const scope of scopes) {
    it(`grants a request whose key has the "${scope}" scope`, async () => {
      mocks.findFirst.mockResolvedValue(makeKey([scope]));
      const result = await requireScopes(makeRequest(), scope);
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
