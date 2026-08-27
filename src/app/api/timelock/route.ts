// SPDX-License-Identifier: MIT

import { successResponse, handleApiError, unauthorizedError } from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { simulateContractCall, DEFAULT_CONTRACT_ID, CHAIN_READ_SOURCE } from "@/lib/contracts";
import { nativeToScVal } from "@stellar/stellar-sdk";
import { withRequestLogging } from "@/lib/request-logging";

/**
 * GET /api/timelock — list pending timelocked actions from the Soroban contract.
 * Reads total count from OphirPayContract.get_timelock_count().
 * Use query param `id` to look up a specific action.
 */
export const GET = withRequestLogging(async function GET(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError("Authentication required. Connect your wallet or provide an API key.");
    }

    const { searchParams } = new URL(request.url);
    const actionId = searchParams.get("id");

    if (actionId) {
      // Validate before encoding — garbage input would otherwise throw inside
      // nativeToScVal and surface as a 500 instead of a clean 400.
      if (!/^\d+$/.test(actionId)) {
        return Response.json(
          { success: false, error: { code: "VALIDATION_ERROR", message: "action id must be a positive integer" } },
          { status: 400 }
        );
      }
      const result = await simulateContractCall(
        DEFAULT_CONTRACT_ID,
        "get_timelocked_action",
        CHAIN_READ_SOURCE,
        [nativeToScVal(actionId, { type: "u64" })]
      );

      if (result.status === "SIMULATION_FAILED") {
        return successResponse({ available: false });
      }
      return successResponse(result.returnValue);
    }

    // Enumerate actions: read the count, then fetch each action by id.
    const countResult = await simulateContractCall(
      DEFAULT_CONTRACT_ID,
      "get_timelock_count",
      CHAIN_READ_SOURCE
    );

    if (countResult.status === "SIMULATION_FAILED") {
      return successResponse([]);
    }

    const totalCount = Number(countResult.returnValue ?? 0);
    if (totalCount === 0) return successResponse([]);

    // Cap enumeration to bound the N+1 read pattern (one RPC per action).
    const maxActions = 100;
    const toFetch = Math.min(totalCount, maxActions);

    const actions: unknown[] = [];
    for (let id = 1; id <= toFetch; id++) {
      const result = await simulateContractCall(
        DEFAULT_CONTRACT_ID,
        "get_timelocked_action",
        CHAIN_READ_SOURCE,
        [nativeToScVal(id, { type: "u64" })]
      );
      if (result.status !== "SIMULATION_FAILED" && result.returnValue) {
        actions.push(result.returnValue);
      }
    }

    return successResponse(actions);
  } catch (err) {
    return handleApiError(err, "GET /api/timelock");
  }
});
