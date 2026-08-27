// SPDX-License-Identifier: MIT

import { successResponse, handleApiError, unauthorizedError } from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { simulateContractCall, DEFAULT_CONTRACT_ID, CHAIN_READ_SOURCE } from "@/lib/contracts";
import { withRequestLogging } from "@/lib/request-logging";

/**
 * GET /api/policy-versions — fee config + multisig config version history.
 * Reads from OphirPayContract.get_fee_config_history() and get_multisig_config_history().
 */
export const GET = withRequestLogging(async function GET(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError("Authentication required. Connect your wallet or provide an API key.");
    }

    const [feeResult, multisigResult] = await Promise.all([
      simulateContractCall(DEFAULT_CONTRACT_ID, "get_fee_config_history", CHAIN_READ_SOURCE),
      simulateContractCall(DEFAULT_CONTRACT_ID, "get_multisig_config_history", CHAIN_READ_SOURCE),
    ]);

    return successResponse({
      feeConfigHistory: feeResult.status === "SIMULATION_FAILED" ? [] : (feeResult.returnValue ?? []),
      multisigHistory: multisigResult.status === "SIMULATION_FAILED" ? [] : (multisigResult.returnValue ?? []),
    });
  } catch (err) {
    return handleApiError(err, "GET /api/policy-versions");
  }
});
