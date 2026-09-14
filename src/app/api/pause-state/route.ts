// SPDX-License-Identifier: MIT

import { successResponse, handleApiError, unauthorizedError } from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { simulateContractCall, DEFAULT_CONTRACT_ID, CHAIN_READ_SOURCE } from "@/lib/contracts";

/**
 * GET /api/pause-state — current pause state from the Soroban contract.
 * Simulates a read-only call to OphirPayContract.is_paused().
 *
 * Response shapes:
 *   { paused: boolean, available: true }  — known state
 *   { paused: "unknown", available: false, error?: string }  — simulation failed / unreachable
 */
export async function GET(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError("Authentication required. Connect your wallet or provide an API key.");
    }

    const result = await simulateContractCall(
      DEFAULT_CONTRACT_ID,
      "is_paused",
      CHAIN_READ_SOURCE
    );

    if (result.status === "SIMULATION_FAILED") {
      // Contract not deployed or unreachable — explicitly report unknown state
      return successResponse({ paused: "unknown" as const, available: false, error: result.error });
    }

    return successResponse({ paused: result.returnValue === true, available: true });
  } catch (err) {
    return handleApiError(err, "GET /api/pause-state");
  }
}
