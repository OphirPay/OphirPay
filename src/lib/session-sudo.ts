// SPDX-License-Identifier: MIT

/**
 * Sudo mode — step-up re-authentication for critical administrative actions
 * (issue #1389).
 *
 * A wallet session cookie proves the holder connected at *some* point in the
 * last seven days. That is the right trade-off for reads and everyday
 * mutations, but it is too weak for high-impact admin operations (updating fee
 * configuration, rotating keys, changing RBAC roles): an unattended-but-unlocked
 * browser would let a passer-by make those changes. Requiring a fresh Ed25519
 * signature over a short-lived challenge (the same proof-of-ownership the
 * session route already uses) bounds the window in which a stolen cookie alone
 * is useful.
 *
 * Model:
 *
 *   • The session's "last cryptographic verification" is tracked by a separate,
 *     HMAC-signed `ophirpay_sudo` grant cookie — never by trusting a client
 *     timestamp. The grant is minted only after a proof verifies and expires
 *     after {@link SUDO_TTL_MS} (15 minutes).
 *   • A critical route calls {@link enforceSudo}. When the grant is missing,
 *     expired, or bound to a different public key, it returns a `403`
 *     `SUDO_REQUIRED` response carrying a fresh challenge payload.
 *   • The client signs that challenge and retries; the route verifies the proof
 *     with {@link verifySudoProof} and attaches a new grant with
 *     {@link buildSudoCookie}.
 *
 * The grant mirrors `auth-session`'s session token: stateless, HMAC-signed with
 * AUTH_SECRET, constant-time verified. Signatures are bound to the expiring
 * challenge token (see `lib/challenge.ts`), so a captured signature cannot be
 * replayed against a freshly minted challenge.
 */

import crypto from "crypto";
import { getAuthSecret, type AuthContext } from "@/lib/auth-session";
import {
  createChallengeToken,
  challengeMessage,
  verifyChallengeToken,
  verifyWalletSignature,
} from "@/lib/challenge";
import { errorResponse } from "@/lib/api-response";
import { ERROR_CODES } from "@/lib/error-codes";

/** How long a cryptographic re-verification stays valid. */
export const SUDO_TTL_MS = 15 * 60 * 1000; // 15 minutes

/** Dedicated cookie carrying the (signed, expiring) sudo grant. */
export const SUDO_COOKIE_NAME = "ophirpay_sudo";

/** Grant token body. `iat`/`exp` are ms epoch. */
export interface SudoGrantPayload {
  pk: string;
  iat: number;
  exp: number;
}

// ── Grant token ────────────────────────────────────────────────

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function signSudoBody(body: string): string {
  return crypto
    .createHmac("sha256", getAuthSecret())
    .update(body)
    .digest("base64url");
}

/** Mint a signed sudo grant for a public key. */
export function createSudoGrant(
  publicKey: string,
  nowMs: number = Date.now()
): string {
  const payload: SudoGrantPayload = {
    pk: publicKey,
    iat: nowMs,
    exp: nowMs + SUDO_TTL_MS,
  };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${signSudoBody(body)}`;
}

/**
 * Verify a grant's signature and expiry. Returns the payload, or `null` when
 * the token is malformed, tampered with, or expired. Constant-time comparison,
 * with the byte-length pre-check that `timingSafeEqual` requires.
 */
export function parseSudoGrant(
  token: string,
  nowMs: number = Date.now()
): SudoGrantPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;

  const expected = signSudoBody(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8")
    ) as SudoGrantPayload;
    if (typeof payload?.pk !== "string" || payload.pk.length === 0) return null;
    if (typeof payload.exp !== "number" || payload.exp < nowMs) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Read and verify the sudo grant cookie from a Request. */
export function readSudoGrant(
  request: Request,
  nowMs: number = Date.now()
): SudoGrantPayload | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SUDO_COOKIE_NAME && rest.length > 0) {
      return parseSudoGrant(rest.join("="), nowMs);
    }
  }
  return null;
}

/**
 * Whether the request carries a grant that is fresh AND bound to `publicKey`.
 * Checking the key binding stops a grant minted for wallet A from authorizing
 * an action as wallet B.
 */
export function hasFreshSudo(
  request: Request,
  publicKey: string,
  nowMs: number = Date.now()
): boolean {
  const grant = readSudoGrant(request, nowMs);
  return grant !== null && grant.pk === publicKey;
}

/** `Set-Cookie` value that installs a fresh grant. */
export function buildSudoCookie(
  publicKey: string,
  nowMs: number = Date.now()
): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return (
    `${SUDO_COOKIE_NAME}=${createSudoGrant(publicKey, nowMs)}; ` +
    `Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SUDO_TTL_MS / 1000)}${secure}`
  );
}

/** `Set-Cookie` value that clears the grant (wallet disconnect / lock). */
export function buildSudoClearCookie(): string {
  return `${SUDO_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

// ── Challenge / response ───────────────────────────────────────

/** The payload a `403 SUDO_REQUIRED` response carries. */
export interface SudoChallenge {
  challenge: string;
  message: string;
  expiresInSeconds: number;
}

/** Build the challenge the client must sign to refresh the grant. */
export function buildSudoChallenge(publicKey: string): SudoChallenge {
  const challenge = createChallengeToken(publicKey);
  return {
    challenge,
    message: challengeMessage(publicKey, challenge),
    expiresInSeconds: Math.floor(SUDO_TTL_MS / 1000),
  };
}

/** The `403 SUDO_REQUIRED` response for an admin request needing step-up. */
export function sudoRequiredResponse(publicKey: string | null) {
  return errorResponse(
    ERROR_CODES.SUDO_REQUIRED,
    "Re-authentication required: this administrative action needs a wallet " +
      "signature newer than 15 minutes. Sign the challenge and retry.",
    403,
    publicKey ? buildSudoChallenge(publicKey) : undefined
  );
}

/**
 * Verify a re-authentication proof (challenge token + wallet signature).
 * The challenge must be bound to `publicKey`, unexpired, and signed by it.
 */
export function verifySudoProof(
  publicKey: string,
  challenge: string,
  signature: string
): boolean {
  if (!verifyChallengeToken(challenge, publicKey)) return false;
  return verifyWalletSignature(
    challengeMessage(publicKey, challenge),
    signature,
    publicKey
  );
}

// ── Route guard ────────────────────────────────────────────────

export interface EnforceSudoOptions {
  /**
   * Set when the *current* request already carried a valid proof (the route
   * just verified a challenge+signature). Skips the cookie check so the retry
   * that supplies the proof succeeds even though it did not yet carry a grant.
   */
  verifiedNow?: boolean;
  /** Reference time (ms epoch) — injectable in tests. */
  nowMs?: number;
}

/**
 * Guard a critical admin mutation.
 *
 * Returns `null` when the request may proceed, or a `403` response the caller
 * must return (with `code: "SUDO_REQUIRED"` and a fresh challenge payload).
 * A request authenticated only by an API key has no wallet to re-verify, so it
 * is rejected outright — step-up is a wallet-session concept.
 */
export function enforceSudo(
  request: Request,
  auth: AuthContext,
  options: EnforceSudoOptions = {}
): Response | null {
  if (!auth.publicKey) {
    return errorResponse(
      ERROR_CODES.FORBIDDEN,
      "This administrative action requires a connected wallet session.",
      403
    );
  }
  if (options.verifiedNow) return null;
  if (hasFreshSudo(request, auth.publicKey, options.nowMs ?? Date.now())) {
    return null;
  }
  return sudoRequiredResponse(auth.publicKey);
}
