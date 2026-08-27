// SPDX-License-Identifier: MIT

import { successResponse, handleApiError, unauthorizedError } from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { simulateContractCall, DEFAULT_CONTRACT_ID, CHAIN_READ_SOURCE } from "@/lib/contracts";
import { nativeToScVal } from "@stellar/stellar-sdk";
import { withRequestLogging } from "@/lib/request-logging";

/**
 * GET /api/rbac — look up role assignments from the Soroban contract.
 * Reads from OphirPayContract.get_role(addr) for a specific address.
 * Use query param `addr` to look up a specific address's role.
 */
export const GET = withRequestLogging(async function GET(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError("Authentication required. Connect your wallet or provide an API key.");
    }

    const { searchParams } = new URL(request.url);
    const addr = searchParams.get("addr");

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
});
