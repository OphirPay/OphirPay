// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";

/**
 * POST /api/auth/sudo — mint a step-up re-authentication token.
 *
 * Critical admin operations (fee config, RBAC, key rotation) require a
 * fresh wallet signature no older than 15 minutes. This endpoint verifies
 * the challenge signature and returns a short-lived sudo token that the
 * client sends back as `X-Sudo-Token` on the admin request.
 *
 * Body: { publicKey, challenge, signature }
 * Response: { sudoToken, expiresIn }
 *
 * The sudo token is stateless (HMAC-signed with AUTH_SECRET), bound to the
 * public key, and expires after SUDO_MAX_AGE_MS. See lib/session-sudo.ts.
 */

import {
  createSudoToken,
  SUDO_MAX_AGE_MS,
} from "@/lib/session-sudo";
import {
  verifyChallengeToken,
  challengeMessage,
  verifyWalletSignature,
} from "@/lib/challenge";
import { isValidStellarAddress } from "@/lib/stellar";
import { successResponse, badRequestError, unauthorizedError } from "@/lib/api-response";
import { verifyCsrf } from "@/lib/csrf";
import { withRequestLogging } from "@/lib/request-logging";
import { enforceAuthRateLimit } from "@/lib/auth-rate-limit";

export const POST = withMetrics("POST /api/auth/sudo", withRequestLogging(async function POST(request: Request) {
  const csrfError = verifyCsrf(request);
  if (csrfError) return csrfError;

  const body = await request.json().catch(() => null) as
    | { publicKey?: string; challenge?: string; signature?: string }
    | null;

  const publicKey = body?.publicKey?.trim() ?? "";
  if (!isValidStellarAddress(publicKey)) {
    return badRequestError(
      "A valid Stellar public key (G...) is required for sudo verification."
    );
  }

  const rateLimited = await enforceAuthRateLimit(request, { publicKey });
  if (rateLimited) return rateLimited;

  const challenge = body?.challenge ?? "";
  const signature = body?.signature ?? "";

  if (!challenge || !signature) {
    return badRequestError(
      "Both challenge and signature are required. Request a fresh challenge via GET /api/auth/challenge."
    );
  }

  if (!verifyChallengeToken(challenge, publicKey)) {
    return unauthorizedError(
      "Challenge expired or invalid. Request a fresh challenge and try again."
    );
  }

  const message = challengeMessage(publicKey, challenge);
  if (!verifyWalletSignature(message, signature, publicKey)) {
    return unauthorizedError(
      "Signature does not match the wallet public key. Sudo verification failed."
    );
  }

  const sudoToken = createSudoToken(publicKey);
  return successResponse({
    sudoToken,
    expiresIn: SUDO_MAX_AGE_MS,
  });
}));
