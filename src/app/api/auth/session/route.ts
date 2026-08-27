// SPDX-License-Identifier: MIT

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
 * cookie is HttpOnly + SameSite=Lax + signed with AUTH_SECRET, and all
 * data-bearing routes resolve the user from it via getAuthContext().
 */

import {
  buildSessionCookie,
  buildLogoutCookie,
  readSessionCookie,
} from "@/lib/auth-session";
import { verifyChallengeToken, challengeMessage, verifyWalletSignature } from "@/lib/challenge";
import { isValidStellarAddress } from "@/lib/stellar";
import { successResponse, badRequestError, unauthorizedError } from "@/lib/api-response";
import { verifyCsrf } from "@/lib/csrf";
import { withRequestLogging } from "@/lib/request-logging";

export const POST = withRequestLogging(async function POST(request: Request) {
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
  response.headers.set("Set-Cookie", buildSessionCookie(publicKey, network));
  return response;
});

export const DELETE = withRequestLogging(async function DELETE() {
  const response = successResponse({ authenticated: false });
  response.headers.set("Set-Cookie", buildLogoutCookie());
  return response;
});
