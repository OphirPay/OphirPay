// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach } from "vitest";
import {
  createSessionToken,
  parseSessionToken,
  readSessionCookie,
  buildSessionCookie,
  buildLogoutCookie,
  SESSION_COOKIE_NAME,
  revokeSession,
  isSessionRevoked,
  shouldRenewSession,
  renewSessionCookie,
} from "@/lib/auth-session";

const PK = "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U";

describe("createSessionToken", () => {
  it("produces a body.signature pair", () => {
    const token = createSessionToken(PK, "TESTNET");
    expect(token.split(".")).toHaveLength(2);
    expect(token).not.toContain(PK); // public key is base64url-encoded, not plaintext
  });

  it("is unique across payloads", () => {
    const a = createSessionToken(PK, "TESTNET");
    const b = createSessionToken(PK, "PUBLIC");
    expect(a).not.toBe(b);
  });
});

describe("parseSessionToken", () => {
  beforeEach(() => {
    // Keep tests hermetic — restore real Date after each
  });

  it("round-trips a valid token", () => {
    const token = createSessionToken(PK, "TESTNET");
    const payload = parseSessionToken(token);
    expect(payload).not.toBeNull();
    expect(payload!.pk).toBe(PK);
    expect(payload!.nw).toBe("TESTNET");
    expect(payload!.exp).toBeGreaterThan(Date.now());
  });

  it("rejects a tampered payload", () => {
    const token = createSessionToken(PK, "TESTNET");
    const [body] = token.split(".");
    // Flip one character in the payload body
    const tamperedBody =
      body.slice(0, 3) + (body[3] === "A" ? "B" : "A") + body.slice(4);
    expect(parseSessionToken(`${tamperedBody}.${token.split(".")[1]}`)).toBeNull();
  });

  it("rejects a token with a wrong signature", () => {
    const token = createSessionToken(PK, "TESTNET");
    const [, sig] = token.split(".");
    const forged = `${Buffer.from(JSON.stringify({ pk: PK, nw: "TESTNET", exp: Date.now() + 100000 })).toString("base64url")}.${sig}`;
    expect(parseSessionToken(forged)).toBeNull();
  });

  it("rejects an expired token", () => {
    const token = createSessionToken(PK, "TESTNET");
    const [body, sig] = token.split(".");
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    const expired = Buffer.from(
      JSON.stringify({ ...payload, exp: Date.now() - 1000 })
    ).toString("base64url");
    expect(parseSessionToken(`${expired}.${sig}`)).toBeNull();
  });

  it("rejects a non-stellar public key", () => {
    const body = Buffer.from(
      JSON.stringify({ pk: "not-a-key", nw: "TESTNET", exp: Date.now() + 100000 })
    ).toString("base64url");
    const token = createSessionToken(PK, "TESTNET");
    const [, sig] = token.split(".");
    expect(parseSessionToken(`${body}.${sig}`)).toBeNull();
  });

  it("returns null for malformed tokens", () => {
    expect(parseSessionToken("")).toBeNull();
    expect(parseSessionToken("no-dots-here")).toBeNull();
    expect(parseSessionToken("a.b.c")).toBeNull();
  });
});

describe("readSessionCookie", () => {
  it("extracts a valid session from the Cookie header", () => {
    const token = createSessionToken(PK, "TESTNET");
    const request = new Request("http://localhost/api/test", {
      headers: { cookie: `foo=bar; ${SESSION_COOKIE_NAME}=${token}; baz=qux` },
    });
    const payload = readSessionCookie(request);
    expect(payload).not.toBeNull();
    expect(payload!.pk).toBe(PK);
  });

  it("returns null without the cookie", () => {
    const request = new Request("http://localhost/api/test", {
      headers: { cookie: "foo=bar" },
    });
    expect(readSessionCookie(request)).toBeNull();
  });

  it("returns null for a forged cookie value", () => {
    const request = new Request("http://localhost/api/test", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=forged.value` },
    });
    expect(readSessionCookie(request)).toBeNull();
  });
});

describe("cookie builders", () => {
  it("builds a session cookie with security attributes including SameSite=Strict", () => {
    const cookie = buildSessionCookie(PK, "TESTNET");
    expect(cookie.startsWith(`${SESSION_COOKIE_NAME}=`)).toBe(true);
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Max-Age=");
  });

  it("includes Secure flag in production environment", () => {
    const env = process.env as Record<string, string | undefined>;
    const prevEnv = env.NODE_ENV;
    const prevSecret = env.AUTH_SECRET;
    try {
      env.AUTH_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
      env.NODE_ENV = "production";
      const cookie = buildSessionCookie(PK, "PUBLIC");
      expect(cookie).toContain("; Secure");
      expect(cookie).toContain("SameSite=Strict");

      const logout = buildLogoutCookie();
      expect(logout).toContain("; Secure");
      expect(logout).toContain("SameSite=Strict");
    } finally {
      env.NODE_ENV = prevEnv;
      env.AUTH_SECRET = prevSecret;
    }
  });

  it("builds an immediate-expiry logout cookie with SameSite=Strict", () => {
    const cookie = buildLogoutCookie();
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
  });
});

describe("session revocation & blacklist", () => {
  it("revokes an active session token and rejects future parsing", async () => {
    const token = createSessionToken(PK, "TESTNET");
    expect(parseSessionToken(token)).not.toBeNull();

    await revokeSession(token);
    expect(isSessionRevoked(token)).toBe(true);
    expect(parseSessionToken(token)).toBeNull();
  });
});

describe("rolling session renewal", () => {
  it("determines when a session should be renewed (< half TTL remaining)", () => {
    const now = Date.now();
    // Fresh session (almost full 7 days TTL) -> should NOT renew
    const freshPayload = {
      pk: PK,
      nw: "TESTNET",
      exp: now + 6 * 24 * 60 * 60 * 1000,
    };
    expect(shouldRenewSession(freshPayload)).toBe(false);

    // Aging session (< 3.5 days TTL remaining) -> SHOULD renew
    const agingPayload = {
      pk: PK,
      nw: "TESTNET",
      exp: now + 2 * 24 * 60 * 60 * 1000,
    };
    expect(shouldRenewSession(agingPayload)).toBe(true);
  });

  it("issues renewed session cookie preserving identity", () => {
    const payload = {
      pk: PK,
      nw: "PUBLIC",
      exp: Date.now() + 10000,
    };
    const renewed = renewSessionCookie(payload);
    expect(renewed).toContain("SameSite=Strict");
    const parsed = parseSessionToken(renewed.split(";")[0].split("=")[1]);
    expect(parsed?.pk).toBe(PK);
    expect(parsed?.nw).toBe("PUBLIC");
    expect(parsed?.exp).toBeGreaterThan(Date.now() + 5 * 24 * 60 * 60 * 1000);
  });
});
