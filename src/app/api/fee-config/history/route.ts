// SPDX-License-Identifier: MIT

import { successResponse, handleApiError, unauthorizedError } from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { simulateContractCall, DEFAULT_CONTRACT_ID, CHAIN_READ_SOURCE } from "@/lib/contracts";
import { withRequestLogging } from "@/lib/request-logging";

/**
 * GET /api/fee-config/history — fee config version history from the Soroban contract.
 * Simulates a read-only call to OphirPayContract.get_fee_config_history().
 * Returns up to 100 version entries (capped by the contract).
 */
export const GET = withRequestLogging(async function GET(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError("Authentication required. Connect your wallet or provide an API key.");
    }

    const result = await simulateContractCall(
      DEFAULT_CONTRACT_ID,
      "get_fee_config_history",
      CHAIN_READ_SOURCE
    );

    if (result.status === "SIMULATION_FAILED") {
      return successResponse({ versions: [], available: false, error: result.error });
    }

    return successResponse(result.returnValue ?? []);
  } catch (err) {
    return handleApiError(err, "GET /api/fee-config/history");
  }
});
