// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createSessionToken,
  parseSessionToken,
  readSessionCookie,
  buildSessionCookie,
  buildLogoutCookie,
  serializeCookie,
  resolveCookieOptions,
  parseCookie,
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  DEFAULT_SESSION_COOKIE_OPTIONS,
} from "@/lib/auth-session";
import { POST, DELETE } from "@/app/api/auth/session/route";
import { csrfCookieHeader } from "@/lib/csrf";

const PK = "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U";
const TEST_PROD_SECRET = "production-test-secret-at-least-32-chars-long-12345";

const envMap = process.env as Record<string, string | undefined>;

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

  it("returns null for an empty session cookie value", () => {
    const request = new Request("http://localhost/api/test", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=; foo=bar` },
    });
    expect(readSessionCookie(request)).toBeNull();
  });
});

describe("resolveCookieOptions and DEFAULT_SESSION_COOKIE_OPTIONS", () => {
  it("defines standard default options", () => {
    expect(DEFAULT_SESSION_COOKIE_OPTIONS.httpOnly).toBe(true);
    expect(DEFAULT_SESSION_COOKIE_OPTIONS.sameSite).toBe("Lax");
    expect(DEFAULT_SESSION_COOKIE_OPTIONS.secure).toBe(false);
    expect(DEFAULT_SESSION_COOKIE_OPTIONS.maxAge).toBe(Math.floor(SESSION_TTL_MS / 1000));
    expect(DEFAULT_SESSION_COOKIE_OPTIONS.path).toBe("/");
  });

  it("provides standard secure defaults in development", () => {
    const opts = resolveCookieOptions({}, false);
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe("Lax");
    expect(opts.secure).toBe(false);
    expect(opts.maxAge).toBe(Math.floor(SESSION_TTL_MS / 1000));
    expect(opts.path).toBe("/");
  });

  it("enforces secure flag in production", () => {
    const opts = resolveCookieOptions({}, true);
    expect(opts.secure).toBe(true);
  });

  it("normalizes sameSite casing", () => {
    expect(resolveCookieOptions({ sameSite: "strict" }).sameSite).toBe("Strict");
    expect(resolveCookieOptions({ sameSite: "lax" }).sameSite).toBe("Lax");
    expect(resolveCookieOptions({ sameSite: "none" }).sameSite).toBe("None");
  });

  it("respects explicit overrides", () => {
    const opts = resolveCookieOptions({
      httpOnly: false,
      sameSite: "Strict",
      secure: true,
      maxAge: 3600,
      path: "/auth",
      domain: "example.com",
    });
    expect(opts.httpOnly).toBe(false);
    expect(opts.sameSite).toBe("Strict");
    expect(opts.secure).toBe(true);
    expect(opts.maxAge).toBe(3600);
    expect(opts.path).toBe("/auth");
    expect(opts.domain).toBe("example.com");
  });
});

describe("parseCookie and serializeCookie", () => {
  it("serializes and parses cookie attributes accurately", () => {
    const serialized = serializeCookie("test_name", "test_val", {
      httpOnly: true,
      sameSite: "Strict",
      secure: true,
      maxAge: 1200,
      path: "/api",
      domain: "ophirpay.app",
    });

    const parsed = parseCookie(serialized);
    expect(parsed.name).toBe("test_name");
    expect(parsed.value).toBe("test_val");
    expect(parsed.httpOnly).toBe(true);
    expect(parsed.sameSite).toBe("Strict");
    expect(parsed.secure).toBe(true);
    expect(parsed.maxAge).toBe(1200);
    expect(parsed.path).toBe("/api");
    expect(parsed.domain).toBe("ophirpay.app");
  });

  it("handles cookies with minimal attributes", () => {
    const parsed = parseCookie("my_cookie=my_val; Path=/");
    expect(parsed.name).toBe("my_cookie");
    expect(parsed.value).toBe("my_val");
    expect(parsed.httpOnly).toBe(false);
    expect(parsed.secure).toBe(false);
    expect(parsed.sameSite).toBeNull();
    expect(parsed.maxAge).toBeNull();
    expect(parsed.path).toBe("/");
    expect(parsed.domain).toBeNull();
  });
});

describe("cookie builders & profiles", () => {
  const originalEnv = process.env.NODE_ENV;
  const originalSecret = process.env.AUTH_SECRET;

  afterEach(() => {
    envMap.NODE_ENV = originalEnv;
    envMap.AUTH_SECRET = originalSecret;
  });

  describe("Development Profile", () => {
    beforeEach(() => {
      envMap.NODE_ENV = "development";
    });

    it("builds a session cookie without Secure in development", () => {
      const cookie = buildSessionCookie(PK, "TESTNET");
      const parsed = parseCookie(cookie);

      expect(parsed.name).toBe(SESSION_COOKIE_NAME);
      expect(parsed.httpOnly).toBe(true);
      expect(parsed.sameSite).toBe("Lax");
      expect(parsed.secure).toBe(false);
      expect(parsed.maxAge).toBe(Math.floor(SESSION_TTL_MS / 1000));
      expect(parsed.path).toBe("/");
      expect(cookie).not.toContain("Secure");
    });

    it("builds a logout cookie without Secure in development", () => {
      const cookie = buildLogoutCookie();
      const parsed = parseCookie(cookie);

      expect(parsed.name).toBe(SESSION_COOKIE_NAME);
      expect(parsed.value).toBe("");
      expect(parsed.httpOnly).toBe(true);
      expect(parsed.sameSite).toBe("Lax");
      expect(parsed.secure).toBe(false);
      expect(parsed.maxAge).toBe(0);
      expect(parsed.path).toBe("/");
      expect(cookie).not.toContain("Secure");
    });
  });

  describe("Production Profile", () => {
    beforeEach(() => {
      envMap.NODE_ENV = "production";
      envMap.AUTH_SECRET = TEST_PROD_SECRET;
    });

    it("builds a session cookie with Secure in production", () => {
      const cookie = buildSessionCookie(PK, "PUBLIC");
      const parsed = parseCookie(cookie);

      expect(parsed.name).toBe(SESSION_COOKIE_NAME);
      expect(parsed.httpOnly).toBe(true);
      expect(parsed.sameSite).toBe("Lax");
      expect(parsed.secure).toBe(true);
      expect(parsed.maxAge).toBe(Math.floor(SESSION_TTL_MS / 1000));
      expect(parsed.path).toBe("/");
      expect(cookie).toContain("Secure");
    });

    it("builds a logout cookie with Secure in production", () => {
      const cookie = buildLogoutCookie();
      const parsed = parseCookie(cookie);

      expect(parsed.name).toBe(SESSION_COOKIE_NAME);
      expect(parsed.value).toBe("");
      expect(parsed.httpOnly).toBe(true);
      expect(parsed.sameSite).toBe("Lax");
      expect(parsed.secure).toBe(true);
      expect(parsed.maxAge).toBe(0);
      expect(parsed.path).toBe("/");
      expect(cookie).toContain("Secure");
    });
  });

  describe("Explicit Overrides", () => {
    it("allows overriding secure to true in dev", () => {
      envMap.NODE_ENV = "development";
      const cookie = buildSessionCookie(PK, "TESTNET", { secure: true });
      const parsed = parseCookie(cookie);
      expect(parsed.secure).toBe(true);
      expect(cookie).toContain("Secure");
    });

    it("allows overriding secure to false in prod", () => {
      envMap.NODE_ENV = "production";
      envMap.AUTH_SECRET = TEST_PROD_SECRET;
      const cookie = buildSessionCookie(PK, "TESTNET", { secure: false });
      const parsed = parseCookie(cookie);
      expect(parsed.secure).toBe(false);
      expect(cookie).not.toContain("Secure");
    });

    it("allows custom maxAge and sameSite", () => {
      const cookie = buildSessionCookie(PK, "TESTNET", {
        maxAge: 3600,
        sameSite: "Strict",
      });
      const parsed = parseCookie(cookie);
      expect(parsed.maxAge).toBe(3600);
      expect(parsed.sameSite).toBe("Strict");
    });
  });
});

describe("/api/auth/session route handlers Set-Cookie integration", () => {
  const originalEnv = process.env.NODE_ENV;
  const originalSecret = process.env.AUTH_SECRET;

  afterEach(() => {
    envMap.NODE_ENV = originalEnv;
    envMap.AUTH_SECRET = originalSecret;
  });

  it("POST /api/auth/session issues hardened session cookie on renewal in dev", async () => {
    envMap.NODE_ENV = "development";
    const existingToken = createSessionToken(PK, "TESTNET");
    const csrfToken = "c".repeat(64);
    const csrfHeaderVal = csrfCookieHeader(csrfToken, false).split(";")[0];

    const request = new Request("http://localhost/api/auth/session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "cookie": `${csrfHeaderVal}; ${SESSION_COOKIE_NAME}=${existingToken}`,
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({ publicKey: PK, network: "TESTNET" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const setCookie = response.headers.get("Set-Cookie");
    expect(setCookie).not.toBeNull();
    const parsed = parseCookie(setCookie!);
    expect(parsed.name).toBe(SESSION_COOKIE_NAME);
    expect(parsed.httpOnly).toBe(true);
    expect(parsed.sameSite).toBe("Lax");
    expect(parsed.secure).toBe(false);
    expect(parsed.maxAge).toBe(Math.floor(SESSION_TTL_MS / 1000));
  });

  it("POST /api/auth/session issues secure session cookie in HTTPS / production", async () => {
    envMap.NODE_ENV = "production";
    envMap.AUTH_SECRET = TEST_PROD_SECRET;
    const existingToken = createSessionToken(PK, "PUBLIC");
    const csrfToken = "d".repeat(64);
    const csrfHeaderVal = csrfCookieHeader(csrfToken, true).split(";")[0];

    const request = new Request("https://ophirpay.app/api/auth/session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "cookie": `${csrfHeaderVal}; ${SESSION_COOKIE_NAME}=${existingToken}`,
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({ publicKey: PK, network: "PUBLIC" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const setCookie = response.headers.get("Set-Cookie");
    expect(setCookie).not.toBeNull();
    const parsed = parseCookie(setCookie!);
    expect(parsed.name).toBe(SESSION_COOKIE_NAME);
    expect(parsed.httpOnly).toBe(true);
    expect(parsed.sameSite).toBe("Lax");
    expect(parsed.secure).toBe(true);
    expect(parsed.maxAge).toBe(Math.floor(SESSION_TTL_MS / 1000));
  });

  it("DELETE /api/auth/session sets Max-Age=0 logout cookie with matching security flags", async () => {
    envMap.NODE_ENV = "production";
    const request = new Request("https://ophirpay.app/api/auth/session", {
      method: "DELETE",
    });

    const response = await DELETE(request);
    expect(response.status).toBe(200);

    const setCookie = response.headers.get("Set-Cookie");
    expect(setCookie).not.toBeNull();
    const parsed = parseCookie(setCookie!);
    expect(parsed.name).toBe(SESSION_COOKIE_NAME);
    expect(parsed.value).toBe("");
    expect(parsed.httpOnly).toBe(true);
    expect(parsed.sameSite).toBe("Lax");
    expect(parsed.secure).toBe(true);
    expect(parsed.maxAge).toBe(0);
  });
});
