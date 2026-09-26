// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";

import { successResponse, handleApiError, unauthorizedError } from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { simulateContractCall, DEFAULT_CONTRACT_ID, CHAIN_READ_SOURCE } from "@/lib/contracts";
import { withRequestLogging } from "@/lib/request-logging";
import { cachedRead, readCacheKey, READ_TTL_MS } from "@/lib/api-cache";
import { readCacheHeaders } from "@/lib/cache";

/**
 * GET /api/stats — aggregate contract statistics
 * Reads from OphirPayContract.get_stats() on-chain.
 * Returns counters for payments, escrows, streams, batches, and total amounts.
 *
 * Served from the read cache for a few seconds (#741): this is the most
 * expensive read in the app (one Soroban simulation per request). The response
 * is authenticated and derived, so it is never cacheable by an intermediary —
 * see `READ_CACHE_CONTROL`.
 */
export const GET = withMetrics("GET /api/stats", withRequestLogging(async function GET(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError("Authentication required. Connect your wallet or provide an API key.");
    }

    const { value: result, status } = await cachedRead(
      readCacheKey("stats", DEFAULT_CONTRACT_ID || "default"),
      () => simulateContractCall(DEFAULT_CONTRACT_ID, "get_stats", CHAIN_READ_SOURCE),
      READ_TTL_MS.stats
    );

    if (result.status === "SIMULATION_FAILED") {
      // The unavailable fallback is deliberately NOT cached — a transient RPC
      // outage must not pin `available: false` for the whole TTL.
      return successResponse(
        {
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
        },
        undefined,
        200,
        readCacheHeaders("MISS")
      );
    }

    return successResponse(
      result.returnValue ?? {},
      undefined,
      200,
      readCacheHeaders(status)
    );
  } catch (err) {
    return handleApiError(err, "GET /api/stats");
  }
}));
