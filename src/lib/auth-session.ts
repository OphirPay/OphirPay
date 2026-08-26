// SPDX-License-Identifier: MIT

/**
 * Wallet session authentication for OphirPay.
 *
 * The browser UI authenticates by connecting a Stellar wallet, which
 * produces a signed session cookie. Machine-to-machine callers continue
 * to authenticate with API keys (see api-auth.ts).
 *
 * The cookie contains { publicKey, network, expiresAt } and is HMAC-SHA256
 * signed with AUTH_SECRET, so it cannot be forged or tampered with without
 * the secret. All data-bearing API routes scope their queries to the
 * authenticated user's public key — unauthenticated callers get 401.
 *
 * NOTE: this issues the session after a wallet *connect*. The next hardening
 * step (proof-of-ownership via signed message challenge) is documented in
 * docs/integration-guide.md.
 */

import crypto from "crypto";
import prisma from "@/lib/prisma";
import { authenticateRequest } from "@/lib/api-auth";
import { isValidStellarAddress } from "@/lib/stellar";

export const SESSION_COOKIE_NAME = "ophirpay_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ── Secret ────────────────────────────────────────────────────

/**
 * AUTH_SECRET signs session cookies. Required in production — refuse to
 * start without it rather than silently issuing forgeable sessions.
 */
export function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "AUTH_SECRET is required in production. Generate one with: openssl rand -hex 32"
    );
  }
  // Dev-only fallback — never valid in production (the branch above throws).
  return "dev-only-auth-secret-000000000000000000000000";
}

// ── Token sign / verify ───────────────────────────────────────

interface SessionPayload {
  pk: string; // Stellar public key (G...)
  nw: string; // network: TESTNET | PUBLIC
  exp: number; // expiry (ms epoch)
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function signToken(body: string): string {
  return crypto
    .createHmac("sha256", getAuthSecret())
    .update(body)
    .digest("base64url");
}

/** Create a signed session token for a wallet public key. */
export function createSessionToken(publicKey: string, network: string): string {
  const payload: SessionPayload = {
    pk: publicKey,
    nw: network === "PUBLIC" ? "PUBLIC" : "TESTNET",
    exp: Date.now() + SESSION_TTL_MS,
  };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${signToken(body)}`;
}

/** Verify signature + expiry and return the payload, or null. */
export function parseSessionToken(token: string): SessionPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;

  const expected = signToken(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8")
    ) as SessionPayload;
    if (!isValidStellarAddress(payload.pk ?? "")) return null;
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// ── Cookie helpers ────────────────────────────────────────────

/** Read and verify the session cookie from a Request. */
export function readSessionCookie(request: Request): SessionPayload | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE_NAME && rest.length > 0) {
      return parseSessionToken(rest.join("="));
    }
  }
  return null;
}

/** Build the Set-Cookie value for a new session. */
export function buildSessionCookie(publicKey: string, network: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return (
    `${SESSION_COOKIE_NAME}=${createSessionToken(publicKey, network)}; ` +
    `Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure}`
  );
}

/** Build the Set-Cookie value that clears the session. */
export function buildLogoutCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

// ── Auth context resolution ───────────────────────────────────

export interface AuthContext {
  userId: string;
  publicKey?: string;
  keyId?: string;
}

/**
 * Resolve the authenticated user for a request:
 *
 *   1. Signed wallet session cookie (browser UI)  →  { userId, publicKey }
 *   2. API key (machine-to-machine)               →  { userId, keyId }
 *
 * Returns null when the caller is unauthenticated. Route handlers should
 * respond with 401 in that case.
 */
export async function getAuthContext(
  request: Request
): Promise<AuthContext | null> {
  const session = readSessionCookie(request);
  if (session) {
    try {
      let user = await prisma.user.findUnique({
        where: { stellarAddress: session.pk },
      });
      if (!user) {
        user = await prisma.user.upsert({
          where: { stellarAddress: session.pk },
          update: {},
          create: { stellarAddress: session.pk },
        });
      }
      return { userId: user.id, publicKey: session.pk };
    } catch {
      // DB unavailable — treat as unauthenticated rather than failing open
      return null;
    }
  }

  const apiAuth = await authenticateRequest(request);
  if (apiAuth) return { userId: apiAuth.userId, keyId: apiAuth.keyId };

  return null;
}
