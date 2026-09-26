// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";

import { successResponse, handleApiError, unauthorizedError } from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { simulateContractCall, DEFAULT_CONTRACT_ID, CHAIN_READ_SOURCE } from "@/lib/contracts";
import { withRequestLogging } from "@/lib/request-logging";
import { cachedRead, readCacheKey, READ_TTL_MS } from "@/lib/api-cache";
import { readCacheHeaders } from "@/lib/cache";

/**
 * GET /api/fee-config/history — fee config version history from the Soroban contract.
 * Simulates a read-only call to OphirPayContract.get_fee_config_history().
 * Returns up to 100 version entries (capped by the contract).
 */
export const GET = withMetrics("GET /api/fee-config/history", withRequestLogging(async function GET(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError("Authentication required. Connect your wallet or provide an API key.");
    }

    const { value: result, status } = await cachedRead(
      readCacheKey("fee-config", `history:${DEFAULT_CONTRACT_ID || "default"}`),
      () =>
        simulateContractCall(DEFAULT_CONTRACT_ID, "get_fee_config_history", CHAIN_READ_SOURCE),
      READ_TTL_MS["fee-config"]
    );

    if (result.status === "SIMULATION_FAILED") {
      return successResponse(
        { versions: [], available: false, error: result.error },
        undefined,
        200,
        readCacheHeaders("MISS")
      );
    }

    return successResponse(result.returnValue ?? [], undefined, 200, readCacheHeaders(status));
  } catch (err) {
    return handleApiError(err, "GET /api/fee-config/history");
  }
}));
