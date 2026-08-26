// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach } from "vitest";
import {
  createSessionToken,
  parseSessionToken,
  readSessionCookie,
  buildSessionCookie,
  buildLogoutCookie,
  SESSION_COOKIE_NAME,
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
  it("builds a session cookie with security attributes", () => {
    const cookie = buildSessionCookie(PK, "TESTNET");
    expect(cookie.startsWith(`${SESSION_COOKIE_NAME}=`)).toBe(true);
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Max-Age=");
  });

  it("builds an immediate-expiry logout cookie", () => {
    const cookie = buildLogoutCookie();
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("HttpOnly");
  });
});
