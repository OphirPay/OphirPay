// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";

import { z } from "zod";
import {
  successResponse,
  handleApiError,
  unauthorizedError,
  validationError,
  forbiddenError,
  badRequestError,
} from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { simulateContractCall, DEFAULT_CONTRACT_ID, CHAIN_READ_SOURCE } from "@/lib/contracts";
import { withRequestLogging } from "@/lib/request-logging";
import { cachedRead, readCacheKey, READ_TTL_MS } from "@/lib/api-cache";
import { readCacheHeaders } from "@/lib/cache";
import { verifyCsrf } from "@/lib/csrf";
import { validateFeeConfig } from "@/lib/fee-config";
import { isValidStellarAddress } from "@/lib/stellar";
import {
  buildSudoCookie,
  enforceSudo,
  SUDO_TTL_MS,
  verifySudoProof,
} from "@/lib/session-sudo";

/**
 * GET /api/fee-config — current fee configuration from the Soroban contract.
 * Simulates a read-only call to OphirPayContract.get_fee_config().
 *
 * Cached for a few seconds (#741). A fee config change invalidates the key
 * immediately via `invalidateCache("fee-config")` — see docs/PERFORMANCE.md
 * for the invalidation matrix.
 */
export const GET = withMetrics("GET /api/fee-config", withRequestLogging(async function GET(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError("Authentication required. Connect your wallet or provide an API key.");
    }

    const { value: result, status } = await cachedRead(
      readCacheKey("fee-config", DEFAULT_CONTRACT_ID || "default"),
      () =>
        simulateContractCall(DEFAULT_CONTRACT_ID, "get_fee_config", CHAIN_READ_SOURCE),
      READ_TTL_MS["fee-config"]
    );

    if (result.status === "SIMULATION_FAILED") {
      // Contract not deployed or unreachable — return the safe default without
      // caching it, so a transient outage is not pinned for the TTL.
      return successResponse(
        { available: false, error: result.error },
        undefined,
        200,
        readCacheHeaders("MISS")
      );
    }

    return successResponse(result.returnValue, undefined, 200, readCacheHeaders(status));
  } catch (err) {
    return handleApiError(err, "GET /api/fee-config");
  }
}));

/** Body for the step-up fee-configuration mutation. */
const feeConfigAdminSchema = z.object({
  action: z.enum(["set_fee_config", "set_fee_collector"]),
  paymentFeeBps: z.number().int().min(0).optional(),
  escrowFeeBps: z.number().int().min(0).optional(),
  streamFeeBps: z.number().int().min(0).optional(),
  batchBaseFee: z.number().int().min(0).optional(),
  batchPerItemFee: z.number().int().min(0).optional(),
  enabled: z.boolean().optional(),
  collector: z.string().trim().min(1).optional(),
  // Present only on the retry that answers a SUDO_REQUIRED challenge.
  challenge: z.string().min(1).optional(),
  signature: z.string().min(1).optional(),
});

/**
 * POST /api/fee-config — authorize an update to the protocol fee configuration.
 *
 * Changing protocol fees is a critical administrative action, so this route is
 * the server-side **step-up gate** for it (issue #1389). The browser performs
 * the on-chain write with the connected wallet, but it must present a valid
 * sudo grant here first; the route refuses with `403 SUDO_REQUIRED` (plus a
 * fresh challenge) whenever the session's last cryptographic verification is
 * older than 15 minutes. The client signs the challenge and retries with
 * `{ challenge, signature }`, which mints a new grant and authorizes the
 * action in the same round-trip.
 *
 * Covers both `set_fee_config` and `set_fee_collector`. Responds
 * `{ authorized: true, action, config, sudoExpiresAt }` when the caller may
 * proceed, so the UI can carry the authorization into the wallet-signed
 * transaction.
 */
export const POST = withMetrics("POST /api/fee-config", withRequestLogging(async function POST(request: Request) {
  try {
    const csrfError = verifyCsrf(request);
    if (csrfError) return csrfError;

    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError("Authentication required. Connect your wallet or provide an API key.");
    }

    const parsed = feeConfigAdminSchema.safeParse(
      await request.json().catch(() => null)
    );
    if (!parsed.success) return validationError(parsed.error);
    const { action, challenge, signature, ...rest } = parsed.data;

    let config: Record<string, unknown>;
    if (action === "set_fee_config") {
      const { paymentFeeBps, escrowFeeBps, streamFeeBps } = rest;
      if (
        paymentFeeBps === undefined ||
        escrowFeeBps === undefined ||
        streamFeeBps === undefined
      ) {
        return badRequestError(
          "paymentFeeBps, escrowFeeBps and streamFeeBps are required for set_fee_config."
        );
      }
      // Same bounds the client and the contract enforce (MAX_FEE_BPS = 1000).
      const validation = validateFeeConfig(
        paymentFeeBps,
        escrowFeeBps,
        streamFeeBps
      );
      if (!validation.isValid) {
        return badRequestError(validation.errors.join("; "));
      }
      config = {
        paymentFeeBps,
        escrowFeeBps,
        streamFeeBps,
        batchBaseFee: rest.batchBaseFee,
        batchPerItemFee: rest.batchPerItemFee,
        enabled: rest.enabled,
      };
    } else {
      if (!rest.collector) {
        return badRequestError("collector is required for set_fee_collector.");
      }
      if (!isValidStellarAddress(rest.collector)) {
        return badRequestError(
          "collector must be a valid Stellar account address (G…, 56 characters)."
        );
      }
      config = { collector: rest.collector };
    }

    // Step-up is a wallet-session concept: an API key has no wallet to re-sign.
    if (!auth.publicKey) {
      return forbiddenError(
        "Updating fee configuration requires a connected wallet session."
      );
    }

    // A proof supplied with this request refreshes the grant in place.
    let verifiedNow = false;
    if (challenge && signature) {
      if (!verifySudoProof(auth.publicKey, challenge, signature)) {
        return unauthorizedError(
          "Signature does not match the wallet public key. Re-authentication failed."
        );
      }
      verifiedNow = true;
    }

    const sudoError = enforceSudo(request, auth, { verifiedNow });
    if (sudoError) return sudoError;

    const response = successResponse({
      authorized: true,
      action,
      config,
      sudoExpiresAt: new Date(Date.now() + SUDO_TTL_MS).toISOString(),
    });
    if (verifiedNow) {
      response.headers.set("Set-Cookie", buildSudoCookie(auth.publicKey));
    }
    return response;
  } catch (err) {
    return handleApiError(err, "POST /api/fee-config");
  }
}));
