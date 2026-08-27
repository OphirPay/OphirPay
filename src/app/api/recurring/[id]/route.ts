// SPDX-License-Identifier: MIT

import { successResponse, handleApiError, notFoundError, unauthorizedError } from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { simulateContractCall, DEFAULT_CONTRACT_ID, CHAIN_READ_SOURCE } from "@/lib/contracts";
import { nativeToScVal } from "@stellar/stellar-sdk";
import { withRequestLogging } from "@/lib/request-logging";

/**
 * GET /api/recurring/[id] — single recurring payment lookup
 * Reads from OphirPayContract on-chain.
 */
export const GET = withRequestLogging(async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError(
        "Authentication required. Connect your wallet or provide an API key."
      );
    }

    const { id } = await params;
    const recurringId = parseInt(id, 10);

    if (isNaN(recurringId)) {
      return notFoundError("Invalid recurring payment ID");
    }

    const result = await simulateContractCall(
      DEFAULT_CONTRACT_ID,
      "get_recurring",
      CHAIN_READ_SOURCE,
      [nativeToScVal(recurringId, { type: "u64" })]
    );

    if (result.status === "SIMULATION_FAILED" || !result.returnValue) {
      return notFoundError(`Recurring payment ${id} not found`);
    }

    return successResponse(result.returnValue);
  } catch (err) {
    return handleApiError(err, "GET /api/recurring/[id]");
  }
});
