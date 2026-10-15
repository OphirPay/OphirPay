// SPDX-License-Identifier: MIT

/**
 * Sudo mode — step-up re-authentication for critical administrative actions.
 *
 * Session cookies are long-lived (7 days). If a user leaves a browser
 * unattended, an attacker with access to the machine could perform
 * high-impact admin mutations (fee config changes, RBAC rotation, master
 * key rotation) without re-proving wallet ownership.
 *
 * This middleware enforces a freshness window: any operation marked
 * `sudo: true` requires a cryptographic wallet signature no older than
 * SUDO_MAX_AGE_MS (15 minutes). The freshness proof travels as a signed
 * challenge token (see `challenge.ts`) in the `X-Sudo-Token` header.
 *
 * Flow:
 *   1. Client detects a 403 SUDO_REQUIRED response.
 *   2. Client requests a fresh challenge: GET /api/auth/challenge
 *   3. Wallet signs the challenge message (Freighter/xBull/Albedo).
 *   4. Client POSTs { publicKey, challenge, signature } to /api/auth/sudo
 *      → receives a short-lived sudo token.
 *   5. Client retries the admin call with `X-Sudo-Token: <token>`.
 *
 * The sudo token is stateless (HMAC-signed with AUTH_SECRET), bound to the
 * public key, and expires after SUDO_MAX_AGE_MS. No server state needed.
 */

import crypto from "crypto";
import { getAuthSecret } from "@/lib/auth-session";

/** Maximum age of a sudo verification before re-authentication is required. */
export const SUDO_MAX_AGE_MS = 15 * 60 * 1000; // 15 minutes

/** HTTP header carrying the sudo token. */
export const SUDO_TOKEN_HEADER = "x-sudo-token";

// ── Token payload ──────────────────────────────────────────────

interface SudoPayload {
  pk: string; // Stellar public key that proved ownership
  iat: number; // issued-at (ms epoch)
  exp: number; // expiry (ms epoch)
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

// ── Issue ──────────────────────────────────────────────────────

/**
 * Mint a sudo token after a successful wallet signature verification.
 * Called by `POST /api/auth/sudo` once the challenge signature checks out.
 */
export function createSudoToken(publicKey: string): string {
  const now = Date.now();
  const payload: SudoPayload = {
    pk: publicKey,
    iat: now,
    exp: now + SUDO_MAX_AGE_MS,
  };
  const body = b64url(JSON.stringify(payload));
  const sig = crypto
    .createHmac("sha256", getAuthSecret())
    .update(body)
    .digest("base64url");
  return `${body}.${sig}`;
}

// ── Verify ─────────────────────────────────────────────────────

export interface SudoVerification {
  valid: boolean;
  publicKey?: string;
  reason?: "malformed" | "bad_signature" | "expired" | "not_yet_valid";
}

/**
 * Verify a sudo token: signature, expiry, and clock sanity.
 * Does NOT check key binding — the caller compares `publicKey` against the
 * session's public key to ensure the sudo proof matches the authenticated
 * identity.
 */
export function verifySudoToken(token: string | null | undefined): SudoVerification {
  if (!token) return { valid: false, reason: "malformed" };

  const parts = token.split(".");
  if (parts.length !== 2) return { valid: false, reason: "malformed" };
  const [body, sig] = parts;
  if (!body || !sig) return { valid: false, reason: "malformed" };

  const expected = crypto
    .createHmac("sha256", getAuthSecret())
    .update(body)
    .digest("base64url");

  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { valid: false, reason: "bad_signature" };
  }

  let payload: SudoPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { valid: false, reason: "malformed" };
  }

  if (!payload || typeof payload.pk !== "string" || typeof payload.exp !== "number") {
    return { valid: false, reason: "malformed" };
  }

  const now = Date.now();
  if (payload.exp <= now) return { valid: false, reason: "expired" };
  if (payload.iat > now + 60_000) return { valid: false, reason: "not_yet_valid" };

  return { valid: true, publicKey: payload.pk };
}

// ── Guard ──────────────────────────────────────────────────────

/**
 * Check whether the request carries a valid, fresh sudo token bound to
 * the given public key. Returns `true` if the admin operation may proceed.
 *
 * Callers must pass the *session* public key — a sudo token minted for a
 * different key is rejected even if cryptographically valid.
 */
export function hasFreshSudo(
  token: string | null | undefined,
  sessionPublicKey: string | null | undefined
): boolean {
  if (!sessionPublicKey) return false;
  const result = verifySudoToken(token);
  if (!result.valid) return false;
  return result.publicKey === sessionPublicKey;
}
