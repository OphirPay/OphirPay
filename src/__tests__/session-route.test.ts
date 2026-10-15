// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach, vi } from "vitest";
import * as csrf from "@/lib/csrf";

vi.mock("@/lib/csrf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/csrf")>();
  return {
    ...actual,
    verifyCsrf: vi.fn().mockReturnValue(null),
  };
});

import { GET, DELETE } from "@/app/api/auth/session/route";
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
  clearRevocationBlacklistForTests,
  SESSION_TTL_MS,
  getAuthSecret,
} from "@/lib/auth-session";
import crypto from "crypto";

const PK = "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U";

function createAgingToken(publicKey: string, network: string): string {
  // Aging token with only 1 day remaining (< 3.5 days / half of 7-day TTL)
  const payload = {
    pk: publicKey,
    nw: network,
    exp: Date.now() + 1 * 24 * 60 * 60 * 1000,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto
    .createHmac("sha256", getAuthSecret())
    .update(body)
    .digest("base64url");
  return `${body}.${sig}`;
}

describe("GET /api/auth/session", () => {
  beforeEach(() => {
    clearRevocationBlacklistForTests();
  });

  it("returns 401 when no session cookie is provided", async () => {
    const req = new Request("http://localhost:3000/api/auth/session", {
      method: "GET",
    });
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns authenticated session info for fresh session without rolling renewal", async () => {
    const token = createSessionToken(PK, "TESTNET");
    const req = new Request("http://localhost:3000/api/auth/session", {
      method: "GET",
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${token}`,
      },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.authenticated).toBe(true);
    expect(body.data.publicKey).toBe(PK);
    expect(body.data.network).toBe("TESTNET");

    // Fresh session does not need renewal
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });

  it("performs automatic rolling session renewal when < half TTL remains", async () => {
    const agingToken = createAgingToken(PK, "PUBLIC");
    const req = new Request("http://localhost:3000/api/auth/session", {
      method: "GET",
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${agingToken}`,
      },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);

    const setCookie = res.headers.get("Set-Cookie");
    expect(setCookie).not.toBeNull();
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).toContain(SESSION_COOKIE_NAME);
  });
});

describe("DELETE /api/auth/session", () => {
  beforeEach(() => {
    clearRevocationBlacklistForTests();
  });

  it("logs out, revokes token in blacklist, and clears cookie", async () => {
    const token = createSessionToken(PK, "TESTNET");
    const deleteReq = new Request("http://localhost:3000/api/auth/session", {
      method: "DELETE",
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${token}`,
      },
    });

    const res = await DELETE(deleteReq);
    expect(res.status).toBe(200);

    const setCookie = res.headers.get("Set-Cookie");
    expect(setCookie).toContain("Max-Age=0");
    expect(setCookie).toContain("SameSite=Strict");

    // Verify revoked token is now rejected on subsequent requests
    const subsequentReq = new Request("http://localhost:3000/api/auth/session", {
      method: "GET",
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${token}`,
      },
    });
    const getRes = await GET(subsequentReq);
    expect(getRes.status).toBe(401);
  });
});
