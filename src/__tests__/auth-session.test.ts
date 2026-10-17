// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createSessionToken,
  parseSessionToken,
  readSessionCookie,
  buildSessionCookie,
  buildLogoutCookie,
  sessionNeedsRenewal,
  SESSION_COOKIE_NAME,
  SESSION_RENEW_AFTER_MS,
  SESSION_TTL_MS,
} from "@/lib/auth-session";
import {
  isWalletRevoked,
  revokeWalletSessions,
  resetSessionRevocation,
  REVOCATION_TTL_MS,
} from "@/lib/session-revocation";

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
    // Issued-at is recorded so a logout can invalidate this exact token.
    expect(typeof payload!.iat).toBe("number");
    expect(payload!.iat!).toBeLessThanOrEqual(Date.now());
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
  afterEach(() => {
    // `process.env.NODE_ENV` is typed readonly; vi.stubEnv is the sanctioned way
    // to flip it (see csp-nonce.test.ts).
    vi.unstubAllEnvs();
  });

  it("builds a session cookie with strict security attributes", () => {
    const cookie = buildSessionCookie(PK, "TESTNET");
    expect(cookie.startsWith(`${SESSION_COOKIE_NAME}=`)).toBe(true);
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Max-Age=");
  });

  it("adds Secure in production and omits it in development (http localhost)", () => {
    // A production build refuses to sign without a real secret (issue #705).
    vi.stubEnv("AUTH_SECRET", "test-auth-secret-0000000000000000000000000000");

    vi.stubEnv("NODE_ENV", "production");
    expect(buildSessionCookie(PK, "TESTNET")).toContain("Secure");

    vi.stubEnv("NODE_ENV", "development");
    expect(buildSessionCookie(PK, "TESTNET")).not.toContain("Secure");
  });

  it("builds an immediate-expiry logout cookie that matches the session attributes", () => {
    const cookie = buildLogoutCookie();
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    // A mismatch here would leave the original cookie in place over HTTPS.
    vi.stubEnv("NODE_ENV", "production");
    expect(buildLogoutCookie()).toContain("Secure");
  });
});

describe("rolling renewal (issue #1399)", () => {
  it("renews a session only once less than half its TTL remains", () => {
    const fresh = parseSessionToken(createSessionToken(PK, "TESTNET"))!;
    expect(sessionNeedsRenewal(fresh)).toBe(false);

    // Simulate a token that has burned through most of its lifetime.
    const stale = { ...fresh, exp: Date.now() + SESSION_RENEW_AFTER_MS - 1 };
    expect(sessionNeedsRenewal(stale)).toBe(true);
  });
});

describe("session revocation (issue #1399)", () => {
  // Dedicated keys (never the shared session PK) so a shared Redis across test
  // workers can never leak revocation state into another suite.
  const WALLET = "GREVOCATIONTESTWALLET00000000000000000000000000000000000";
  const OTHER = "GREVOCATIONTESTWALLET11111111111111111111111111111111111";

  beforeEach(async () => {
    await resetSessionRevocation();
  });
  afterEach(async () => {
    await resetSessionRevocation();
  });

  it("keeps the revocation window at least as long as a session", () => {
    // If the two drifted apart, a revoked token could outlive its revocation
    // record and start authenticating again.
    expect(REVOCATION_TTL_MS).toBe(SESSION_TTL_MS);
  });

  it("revokes tokens issued at or before the logout, but not later ones", async () => {
    const issuedAt = Date.now();
    expect(await isWalletRevoked(WALLET, issuedAt)).toBe(false);

    const revokedAt = Date.now() + 1;
    await revokeWalletSessions(WALLET, revokedAt);

    expect(await isWalletRevoked(WALLET, issuedAt)).toBe(true);
    expect(await isWalletRevoked(WALLET, revokedAt)).toBe(true);
    // A token minted after the logout (a fresh sign-in) is valid again.
    expect(await isWalletRevoked(WALLET, revokedAt + 1)).toBe(false);
  });

  it("treats a token with no issued-at as revoked once the wallet logs out", async () => {
    await revokeWalletSessions(WALLET);
    expect(await isWalletRevoked(WALLET, undefined)).toBe(true);
  });

  it("scopes revocation to the wallet that logged out", async () => {
    const issuedAt = Date.now();
    await revokeWalletSessions(WALLET, issuedAt);
    expect(await isWalletRevoked(OTHER, issuedAt)).toBe(false);
  });

  it("treats an unknown/empty key as never revoked", async () => {
    expect(await isWalletRevoked("", 0)).toBe(false);
    await revokeWalletSessions("");
  });
});
