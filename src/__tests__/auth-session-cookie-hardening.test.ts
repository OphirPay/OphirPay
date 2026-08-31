// SPDX-License-Identifier: MIT
// Hardening tests for session cookie attributes.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildSessionCookie,
  buildLogoutCookie,
  SESSION_COOKIE_NAME,
} from "@/lib/auth-session";

const PK = "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U";

describe("auth-session cookie hardening", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sets Secure attribute in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const cookie = buildSessionCookie(PK, "TESTNET");
    expect(cookie).toContain("Secure");
  });

  it("omits Secure attribute in non-production environments", () => {
    vi.stubEnv("NODE_ENV", "development");
    const cookie = buildSessionCookie(PK, "TESTNET");
    expect(cookie).not.toContain("Secure");
  });

  it("always emits HttpOnly, SameSite=Lax, Path=/ and a 7-day Max-Age", () => {
    vi.stubEnv("NODE_ENV", "production");
    const cookie = buildSessionCookie(PK, "TESTNET");
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toMatch(/Max-Age=604800/);
  });

  it("produces a logout cookie that immediately expires and keeps security flags", () => {
    const cookie = buildLogoutCookie();
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=0");
  });
});
