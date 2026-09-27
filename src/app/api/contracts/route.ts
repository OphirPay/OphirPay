// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";

import { successResponse, handleApiError, unauthorizedError } from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { simulateContractCall, DEFAULT_CONTRACT_ID, EMITTER_CONTRACT_ID, CHAIN_READ_SOURCE } from "@/lib/contracts";
import { STELLAR_NETWORK, SOROBAN_RPC_URL } from "@/lib/stellar";
import { withRequestLogging } from "@/lib/request-logging";
import { cachedRead, readCacheKey, READ_TTL_MS } from "@/lib/api-cache";
import { readCacheHeaders } from "@/lib/cache";

/**
 * GET /api/contracts — contract deployment info and version
 * Reads contract version and owner from OphirPayContract on-chain.
 *
 * Two contract simulations per request, cached for a minute (#741): the
 * version and owner of a deployed contract change only through an upgrade or
 * an ownership transfer, both of which are rare and explicitly invalidated.
 */
export const GET = withMetrics("GET /api/contracts", withRequestLogging(async function GET(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError("Authentication required. Connect your wallet or provide an API key.");
    }

    const { value: reads, status } = await cachedRead(
      readCacheKey("contracts", DEFAULT_CONTRACT_ID || "default"),
      () =>
        Promise.all([
          simulateContractCall(DEFAULT_CONTRACT_ID, "get_version", CHAIN_READ_SOURCE),
          simulateContractCall(DEFAULT_CONTRACT_ID, "get_owner", CHAIN_READ_SOURCE),
        ]),
      READ_TTL_MS.contracts
    );

    const [versionResult, ownerResult] = reads;
    const reachable = versionResult.status !== "SIMULATION_FAILED";

    return successResponse({
      network: STELLAR_NETWORK,
      rpcUrl: SOROBAN_RPC_URL,
      reachable,
      contracts: {
        ophirpay: {
          id: DEFAULT_CONTRACT_ID,
          version: reachable ? versionResult.returnValue : null,
          owner: reachable ? ownerResult.returnValue : null,
        },
        emitter: {
          id: EMITTER_CONTRACT_ID,
        },
      },
    }, undefined, 200, readCacheHeaders(status));
  } catch (err) {
    return handleApiError(err, "GET /api/contracts");
  }
}));
