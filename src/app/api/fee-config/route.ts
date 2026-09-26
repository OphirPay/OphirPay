// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";

import { successResponse, handleApiError, unauthorizedError } from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { simulateContractCall, DEFAULT_CONTRACT_ID, CHAIN_READ_SOURCE } from "@/lib/contracts";
import { withRequestLogging } from "@/lib/request-logging";
import { cachedRead, readCacheKey, READ_TTL_MS } from "@/lib/api-cache";
import { readCacheHeaders } from "@/lib/cache";

/**
 * GET /api/fee-config — current fee configuration from the Soroban contract.
 * Simulates a read-only call to OphirPayContract.get_fee_config().
 *
 * Cached for a few seconds (#741). A fee config change invalidates the key
 * immediately via `invalidateCache("fee-config")` — see docs/PERFORMANCE.md
 * for the invalidation matrix.
 */
export const GET = withMetrics("GET /api/fee-config", withRequestLogging(async function GET(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError("Authentication required. Connect your wallet or provide an API key.");
    }

    const { value: result, status } = await cachedRead(
      readCacheKey("fee-config", DEFAULT_CONTRACT_ID || "default"),
      () =>
        simulateContractCall(DEFAULT_CONTRACT_ID, "get_fee_config", CHAIN_READ_SOURCE),
      READ_TTL_MS["fee-config"]
    );

    if (result.status === "SIMULATION_FAILED") {
      // Contract not deployed or unreachable — return the safe default without
      // caching it, so a transient outage is not pinned for the TTL.
      return successResponse(
        { available: false, error: result.error },
        undefined,
        200,
        readCacheHeaders("MISS")
      );
    }

    return successResponse(result.returnValue, undefined, 200, readCacheHeaders(status));
  } catch (err) {
    return handleApiError(err, "GET /api/fee-config");
  }
}));
