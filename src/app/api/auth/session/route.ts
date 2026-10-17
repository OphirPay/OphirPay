// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";

/**
 * Wallet session endpoints.
 *
 *   POST   /api/auth/session   — issue a signed session cookie for a wallet
 *   DELETE /api/auth/session   — revoke the session cookie
 *
 * Proof of ownership: a NEW session is only issued when the client proves it
 * holds the wallet's private key by signing a short-lived challenge (see
 * lib/challenge.ts and GET /api/auth/challenge). Callers that already hold a
 * valid session cookie may renew it without re-prompting the wallet. The
 * cookie is HttpOnly + SameSite=Strict (+ Secure in production) and signed with
 * AUTH_SECRET, and all data-bearing routes resolve the user from it via
 * getAuthContext().
 *
 * Rolling renewal (issue #1399): a session with less than half its TTL left is
 * reissued on the next POST so an active user is never logged out
 * mid-operation. Logout (DELETE) revokes the wallet's outstanding tokens in
 * addition to clearing the cookie, so every tab and device is invalidated at
 * once.
 */

import {
  buildSessionCookie,
  buildLogoutCookie,
  readSessionCookie,
  sessionNeedsRenewal,
} from "@/lib/auth-session";
import { revokeWalletSessions } from "@/lib/session-revocation";
import { verifyChallengeToken, challengeMessage, verifyWalletSignature } from "@/lib/challenge";
import { isValidStellarAddress } from "@/lib/stellar";
import { successResponse, badRequestError, unauthorizedError } from "@/lib/api-response";
import { verifyCsrf } from "@/lib/csrf";
import { withRequestLogging } from "@/lib/request-logging";
import { enforceAuthRateLimit } from "@/lib/auth-rate-limit";

export const POST = withMetrics("POST /api/auth/session", withRequestLogging(async function POST(request: Request) {
  const csrfError = verifyCsrf(request);
  if (csrfError) return csrfError;

  const body = await request.json().catch(() => null) as
    | { publicKey?: string; network?: string; challenge?: string; signature?: string }
    | null;

  const publicKey = body?.publicKey?.trim() ?? "";
  if (!isValidStellarAddress(publicKey)) {
    return badRequestError(
      "A valid Stellar public key (G...) is required to open a session."
    );
  }

  // Rate limit per IP and per wallet BEFORE any signature verification or
  // session issuance — throttled clients never reach the expensive proof-of-
  // ownership work (lib/auth-rate-limit.ts).
  const rateLimited = await enforceAuthRateLimit(request, { publicKey });
  if (rateLimited) return rateLimited;

  const network = body?.network === "PUBLIC" ? "PUBLIC" : "TESTNET";

  // Proof-of-ownership: a fresh session requires a valid challenge + wallet
  // signature. Renewing an already-proved session (valid cookie present) is
  // allowed without re-prompting, so page reloads don't nag the user — but
  // only for the SAME identity the cookie already proves.
  const hasProof = Boolean(body?.challenge && body?.signature);
  const existingSession = readSessionCookie(request);

  if (!hasProof && !existingSession) {
    return unauthorizedError(
      "Proof of ownership required: sign the challenge from GET /api/auth/challenge with your wallet."
    );
  }

  if (!hasProof && existingSession && existingSession.pk !== publicKey) {
    return unauthorizedError(
      "Session renewal must be for the same public key as the existing session."
    );
  }

  if (hasProof && body) {
    const challenge = body.challenge ?? "";
    const signature = body.signature ?? "";
    if (!verifyChallengeToken(challenge, publicKey)) {
      return unauthorizedError("Challenge expired or invalid. Request a fresh challenge and try again.");
    }
    // The message embeds the challenge token, so this signature is bound to
    // this specific (expiring) challenge and can't be replayed later.
    const message = challengeMessage(publicKey, challenge);
    if (!verifyWalletSignature(message, signature, publicKey)) {
      return unauthorizedError(
        "Signature does not match the wallet public key. The session was not issued."
      );
    }
  }

  const response = successResponse({ authenticated: true, publicKey, network });

  // Issue (or roll) the cookie: a fresh login always reissues, and an existing
  // session is reissued once it has less than half its TTL left so it never
  // expires out from under an active user.
  const renew = existingSession ? sessionNeedsRenewal(existingSession) : true;
  if (hasProof || renew) {
    response.headers.set("Set-Cookie", buildSessionCookie(publicKey, network));
  }
  return response;
}));

export const DELETE = withMetrics("DELETE /api/auth/session", withRequestLogging(async function DELETE(request: Request) {
  const csrfError = verifyCsrf(request);
  if (csrfError) return csrfError;

  // Logout is cheap, but still bounded per IP to stop cookie-flooding.
  const rateLimited = await enforceAuthRateLimit(request);
  if (rateLimited) return rateLimited;

  // Record the wallet's outstanding tokens as revoked so a cookie copied
  // before logout (another tab, a saved request, an attacker) stops
  // authenticating immediately — clearing the cookie alone only helps the
  // browser that performs the logout (issue #1399).
  const session = readSessionCookie(request);
  if (session) {
    await revokeWalletSessions(session.pk);
  }

  const response = successResponse({ authenticated: false });
  response.headers.set("Set-Cookie", buildLogoutCookie());
  return response;
}));
