// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";

import { successResponse, handleApiError, unauthorizedError, badRequestError } from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { simulateContractCall, DEFAULT_CONTRACT_ID, CHAIN_READ_SOURCE } from "@/lib/contracts";
import { cachedFetch } from "@/lib/api-cache";
import { nativeToScVal } from "@stellar/stellar-sdk";
import { withRequestLogging } from "@/lib/request-logging";

/**
 * GET /api/governance/proposals/[id] — single proposal + governance config.
 * Reads get_proposal(id) and get_governance_config() on-chain (cached, 30s
 * TTL) so the detail view shows tally, quorum and timing from contract reads.
 */
export const GET = withMetrics("GET /api/governance/proposals/[id]", withRequestLogging(async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthContext(_request);
    if (!auth) {
      return unauthorizedError("Authentication required. Connect your wallet or provide an API key.");
    }

    const { id } = await params;
    const proposalId = Number(id);
    if (!Number.isInteger(proposalId) || proposalId < 1) {
      return badRequestError("Invalid proposal id");
    }

    const [proposalResult, configResult] = await Promise.all([
      cachedFetch(
        `gov:proposal:${proposalId}`,
        () => simulateContractCall(
          DEFAULT_CONTRACT_ID,
          "get_proposal",
          CHAIN_READ_SOURCE,
          [nativeToScVal(proposalId, { type: "u64" })],
        ),
        30_000,
      ),
      cachedFetch(
        "gov:config",
        () => simulateContractCall(DEFAULT_CONTRACT_ID, "get_governance_config", CHAIN_READ_SOURCE),
        30_000,
      ),
    ]);

    if (proposalResult.status === "SIMULATION_FAILED" || !proposalResult.returnValue) {
      return badRequestError("Proposal not found");
    }

    return successResponse({
      proposal: proposalResult.returnValue,
      config:
        configResult.status === "SIMULATION_FAILED" || !configResult.returnValue
          ? null
          : configResult.returnValue,
    });
  } catch (err) {
    return handleApiError(err, "GET /api/governance/proposals/[id]");
  }
}));
