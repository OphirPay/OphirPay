// SPDX-License-Identifier: MIT

import { successResponse, handleApiError, unauthorizedError } from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { simulateContractCall, DEFAULT_CONTRACT_ID, CHAIN_READ_SOURCE } from "@/lib/contracts";
import { withRequestLogging } from "@/lib/request-logging";

/**
 * GET /api/stats — aggregate contract statistics
 * Reads from OphirPayContract.get_stats() on-chain.
 * Returns counters for payments, escrows, streams, batches, and total amounts.
 */
export const GET = withRequestLogging(async function GET(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError("Authentication required. Connect your wallet or provide an API key.");
    }

    const result = await simulateContractCall(DEFAULT_CONTRACT_ID, "get_stats", CHAIN_READ_SOURCE);

    if (result.status === "SIMULATION_FAILED") {
      return successResponse({
        total_payments_recorded: 0,
        total_escrows_created: 0,
        total_escrows_released: 0,
        total_escrows_claimed: 0,
        total_streams_created: 0,
        total_streams_claimed: 0,
        total_streams_cancelled: 0,
        total_batches_processed: 0,
        total_amount_escrowed: 0,
        total_amount_streamed: 0,
        total_amount_batched: 0,
        available: false,
      });
    }

    return successResponse(result.returnValue ?? {});
  } catch (err) {
    return handleApiError(err, "GET /api/stats");
  }
});
