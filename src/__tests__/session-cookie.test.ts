// SPDX-License-Identifier: MIT

import { describe, it, expect, afterEach, vi } from "vitest";
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  buildSessionCookie,
  buildLogoutCookie,
} from "@/lib/auth-session";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("session cookie attributes", () => {
  it("dev profile: HttpOnly + SameSite=Lax + Max-Age, no Secure", () => {
    vi.stubEnv("NODE_ENV", "development");
    const cookie = buildSessionCookie("G" + "A".repeat(55), "TESTNET");

    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain(`Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`);
    expect(cookie).not.toContain("Secure");
  });

  it("production profile: adds the Secure flag", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "t".repeat(64));
    const cookie = buildSessionCookie("G" + "A".repeat(55), "PUBLIC");

    expect(cookie).toContain("; Secure");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
  });

  it("sets a bounded lifetime (7 days)", () => {
    vi.stubEnv("NODE_ENV", "development");
    const cookie = buildSessionCookie("G" + "A".repeat(55), "TESTNET");
    const maxAge = Number(cookie.match(/Max-Age=(\d+)/)?.[1]);

    expect(maxAge).toBe(7 * 24 * 60 * 60);
  });
});

describe("logout cookie attributes", () => {
  it("clears the session immediately", () => {
    vi.stubEnv("NODE_ENV", "development");
    const cookie = buildLogoutCookie();

    expect(cookie.startsWith(`${SESSION_COOKIE_NAME}=;`)).toBe(true);
    expect(cookie).toContain("Max-Age=0");
  });

  it("dev profile: no Secure flag", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(buildLogoutCookie()).not.toContain("Secure");
  });

  it("production profile: mirrors the session cookie's Secure flag so the browser reliably deletes it", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "t".repeat(64));
    const cookie = buildLogoutCookie();

    expect(cookie).toContain("; Secure");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
  });
});
