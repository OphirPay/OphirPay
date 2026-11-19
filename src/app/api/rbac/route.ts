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
import { nativeToScVal } from "@stellar/stellar-sdk";
import { withRequestLogging } from "@/lib/request-logging";
import { enforceLookupRateLimit } from "@/lib/lookup-rate-limit";
import { verifyCsrf } from "@/lib/csrf";
import { isValidStellarAddress } from "@/lib/stellar";
import {
  buildSudoCookie,
  enforceSudo,
  SUDO_TTL_MS,
  verifySudoProof,
} from "@/lib/session-sudo";

/**
 * GET /api/rbac — look up role assignments from the Soroban contract.
 * Reads from OphirPayContract.get_role(addr) for a specific address.
 * Use query param `addr` to look up a specific address's role.
 */
export const GET = withMetrics("GET /api/rbac", withRequestLogging(async function GET(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError("Authentication required. Connect your wallet or provide an API key.");
    }

    const { searchParams } = new URL(request.url);
    const addr = searchParams.get("addr");

    // Enforce per-IP and per-address rate limiting to prevent enumeration
    const rateLimited = await enforceLookupRateLimit(request, {
      address: addr ? addr.trim() : undefined,
    });
    if (rateLimited) return rateLimited;

    if (!addr) {
      // Without a specific address, return contract availability
      const countResult = await simulateContractCall(
        DEFAULT_CONTRACT_ID,
        "get_audit_log_count",
        CHAIN_READ_SOURCE
      );
      return successResponse({
        available: countResult.status !== "SIMULATION_FAILED",
        message: "Provide ?addr=G... to look up a specific address role",
      });
    }

    const result = await simulateContractCall(
      DEFAULT_CONTRACT_ID,
      "get_role",
      CHAIN_READ_SOURCE,
      [nativeToScVal(addr, { type: "address" })]
    );

    if (result.status === "SIMULATION_FAILED") {
      return successResponse({ available: false, address: addr });
    }

    return successResponse({ address: addr, role: result.returnValue });
  } catch (err) {
    return handleApiError(err, "GET /api/rbac");
  }
}));

/** Roles mirror `Role` in the Soroban contract: 0 Admin, 1 Operator, 2 Auditor. */
const ROLE_VALUES = [0, 1, 2] as const;

/** Body for the step-up role mutation. */
const rbacMutationSchema = z.object({
  action: z.enum(["grant", "revoke"]),
  address: z.string().trim().min(1),
  role: z.number().int().min(0).max(2).optional(),
  // Present only on the retry that answers a SUDO_REQUIRED challenge.
  challenge: z.string().min(1).optional(),
  signature: z.string().min(1).optional(),
});

/**
 * POST /api/rbac — authorize a role grant/revoke.
 *
 * Role assignments are a critical administrative action, so this route is the
 * server-side **step-up gate** for them (issue #1389). The on-chain write is
 * performed by the connected wallet in the browser; before it may proceed the
 * client must present a sudo grant here. When the session's last cryptographic
 * verification is older than 15 minutes the route answers `403 SUDO_REQUIRED`
 * with a fresh challenge; signing it and retrying with `{ challenge, signature }`
 * mints the grant and authorizes the mutation in one round-trip.
 *
 * Responds `{ authorized: true, action, address, role?, sudoExpiresAt }`.
 */
export const POST = withMetrics("POST /api/rbac", withRequestLogging(async function POST(request: Request) {
  try {
    const csrfError = verifyCsrf(request);
    if (csrfError) return csrfError;

    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError("Authentication required. Connect your wallet or provide an API key.");
    }

    const parsed = rbacMutationSchema.safeParse(
      await request.json().catch(() => null)
    );
    if (!parsed.success) return validationError(parsed.error);
    const { action, address, role, challenge, signature } = parsed.data;

    if (!isValidStellarAddress(address)) {
      return badRequestError(
        "address must be a valid Stellar account address (G…, 56 characters)."
      );
    }
    if (action === "grant" && typeof role !== "number") {
      return badRequestError(
        `A role is required when action is "grant" (${ROLE_VALUES.join(", ")}).`
      );
    }

    // Step-up is a wallet-session concept: an API key has no wallet to re-sign.
    if (!auth.publicKey) {
      return forbiddenError(
        "Changing role assignments requires a connected wallet session."
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
      action: action === "grant" ? "grant_role" : "revoke_role",
      address,
      ...(action === "grant" ? { role } : {}),
      sudoExpiresAt: new Date(Date.now() + SUDO_TTL_MS).toISOString(),
    });
    if (verifiedNow) {
      response.headers.set("Set-Cookie", buildSudoCookie(auth.publicKey));
    }
    return response;
  } catch (err) {
    return handleApiError(err, "POST /api/rbac");
  }
}));
