// SPDX-License-Identifier: MIT

import { successResponse, handleApiError, notFoundError, unauthorizedError } from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { simulateContractCall, DEFAULT_CONTRACT_ID, CHAIN_READ_SOURCE } from "@/lib/contracts";
import { nativeToScVal } from "@stellar/stellar-sdk";
import { withRequestLogging } from "@/lib/request-logging";

/**
 * GET /api/streams/[id] — single stream lookup
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
    const streamId = parseInt(id, 10);

    if (isNaN(streamId)) {
      return notFoundError("Invalid stream ID");
    }

    const result = await simulateContractCall(
      DEFAULT_CONTRACT_ID,
      "get_stream",
      CHAIN_READ_SOURCE,
      [nativeToScVal(streamId, { type: "u64" })]
    );

    if (result.status === "SIMULATION_FAILED" || !result.returnValue) {
      return notFoundError(`Stream ${id} not found`);
    }

    return successResponse(result.returnValue);
  } catch (err) {
    return handleApiError(err, "GET /api/streams/[id]");
  }
});
