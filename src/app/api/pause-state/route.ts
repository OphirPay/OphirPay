// SPDX-License-Identifier: MIT

import { successResponse, handleApiError, unauthorizedError } from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { simulateContractCall, DEFAULT_CONTRACT_ID, CHAIN_READ_SOURCE } from "@/lib/contracts";

export const KNOWN_SCOPES = [
  "payments",
  "escrows",
  "streams",
  "recurring",
  "refunds",
  "governance",
  "hooks",
  "batches",
] as const;

export type ScopeName = (typeof KNOWN_SCOPES)[number];

/**
 * GET /api/pause-state — current global and scoped pause state from the Soroban contract.
 * Simulates read-only calls to OphirPayContract.is_paused() and OphirPayContract.get_paused_scopes().
 *
 * Response shapes:
 *   {
 *     paused: boolean,
 *     available: true,
 *     scopes: Record<string, boolean>,
 *     pausedScopes: string[]
 *   }
 *   { paused: "unknown", available: false, error?: string, scopes: {}, pausedScopes: [] }
 */
export async function GET(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError("Authentication required. Connect your wallet or provide an API key.");
    }

    const globalResult = await simulateContractCall(
      DEFAULT_CONTRACT_ID,
      "is_paused",
      CHAIN_READ_SOURCE
    );

    if (globalResult.status === "SIMULATION_FAILED") {
      // Contract not deployed or unreachable — explicitly report unknown state
      return successResponse({
        paused: "unknown" as const,
        available: false,
        error: globalResult.error,
        scopes: {},
        pausedScopes: [],
      });
    }

    const scopesResult = await simulateContractCall(
      DEFAULT_CONTRACT_ID,
      "get_paused_scopes",
      CHAIN_READ_SOURCE
    );

    const pausedScopes: string[] =
      scopesResult.status === "SUCCESS" && Array.isArray(scopesResult.returnValue)
        ? scopesResult.returnValue.map((item: unknown) => String(item))
        : [];

    const scopes: Record<string, boolean> = {};
    for (const scope of KNOWN_SCOPES) {
      scopes[scope] = pausedScopes.includes(scope);
    }
    // Also include any unknown scopes that were paused
    for (const scope of pausedScopes) {
      if (scopes[scope] === undefined) {
        scopes[scope] = true;
      }
    }

    return successResponse({
      paused: globalResult.returnValue === true,
      available: true,
      scopes,
      pausedScopes,
    });
  } catch (err) {
    return handleApiError(err, "GET /api/pause-state");
  }
}
