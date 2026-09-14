// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";

import { successResponse, handleApiError, unauthorizedError } from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { simulateContractCall, DEFAULT_CONTRACT_ID, CHAIN_READ_SOURCE } from "@/lib/contracts";
import { withRequestLogging } from "@/lib/request-logging";
import { enforceLookupRateLimit } from "@/lib/lookup-rate-limit";

/**
 * GET /api/fee-config/collector — current fee collector address
 * Reads from OphirPayContract.get_fee_collector() on-chain.
 */
export const GET = withMetrics("GET /api/fee-config/collector", withRequestLogging(async function GET(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError("Authentication required. Connect your wallet or provide an API key.");
    }

    // Rate-limit address lookups to prevent automated RPC hammering
    const rateLimited = await enforceLookupRateLimit(request);
    if (rateLimited) return rateLimited;

    const result = await simulateContractCall(
      DEFAULT_CONTRACT_ID,
      "get_fee_collector",
      CHAIN_READ_SOURCE
    );

    if (result.status === "SIMULATION_FAILED") {
      return successResponse({ available: false, collector: null });
    }

    return successResponse({ collector: result.returnValue ?? null });
  } catch (err) {
    return handleApiError(err, "GET /api/fee-config/collector");
  }
}));
