// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";

import {
  createChallengeToken,
  challengeMessage,
} from "@/lib/challenge";
import { isValidStellarAddress } from "@/lib/stellar";
import { successResponse, badRequestError } from "@/lib/api-response";
import { withRequestLogging } from "@/lib/request-logging";
import { enforceAuthRateLimit } from "@/lib/auth-rate-limit";

/**
 * GET /api/auth/challenge?publicKey=G... — mint a proof-of-ownership challenge.
 *
 * Returns a short-lived, server-signed challenge plus the exact message the
 * wallet must sign. POST /api/auth/session only issues a session cookie when
 * the signature over this message verifies against the public key.
 *
 * Rate-limited per IP and per wallet public key (see lib/auth-rate-limit.ts)
 * BEFORE minting — challenge creation is the expensive work here.
 */
export const GET = withMetrics("GET /api/auth/challenge", withRequestLogging(async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const publicKey = (searchParams.get("publicKey") ?? "").trim();

  if (!isValidStellarAddress(publicKey)) {
    return badRequestError(
      "A valid Stellar public key (G...) is required to mint a challenge."
    );
  }

  const rateLimited = await enforceAuthRateLimit(request, { publicKey });
  if (rateLimited) return rateLimited;

  const challenge = createChallengeToken(publicKey);
  return successResponse({
    challenge,
    // The message embeds the challenge token so the signature is single-use.
    message: challengeMessage(publicKey, challenge),
    expiresIn: 300, // seconds
  });
}));
