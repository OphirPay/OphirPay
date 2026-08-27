// SPDX-License-Identifier: MIT

import { successResponse, handleApiError, unauthorizedError } from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { simulateContractCall, DEFAULT_CONTRACT_ID, CHAIN_READ_SOURCE } from "@/lib/contracts";
import { withRequestLogging } from "@/lib/request-logging";

/**
 * GET /api/fee-config — current fee configuration from the Soroban contract.
 * Simulates a read-only call to OphirPayContract.get_fee_config().
 */
export const GET = withRequestLogging(async function GET(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError("Authentication required. Connect your wallet or provide an API key.");
    }

    const result = await simulateContractCall(
      DEFAULT_CONTRACT_ID,
      "get_fee_config",
      CHAIN_READ_SOURCE
    );

    if (result.status === "SIMULATION_FAILED") {
      // Contract not deployed or unreachable — return safe default
      return successResponse({ available: false, error: result.error });
    }

    return successResponse(result.returnValue);
  } catch (err) {
    return handleApiError(err, "GET /api/fee-config");
  }
});
