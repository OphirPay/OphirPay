// SPDX-License-Identifier: MIT

import { successResponse, handleApiError, unauthorizedError } from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { simulateContractCall, DEFAULT_CONTRACT_ID, CHAIN_READ_SOURCE } from "@/lib/contracts";
import { createGovernanceProposal } from "@/lib/contract-advanced";
import { cachedFetch, cacheDelete } from "@/lib/api-cache";
import { verifyCsrf } from "@/lib/csrf";
import { validateBody, createProposalSchema } from "@/lib/validation-schemas";
import { nativeToScVal } from "@stellar/stellar-sdk";
import { withRequestLogging } from "@/lib/request-logging";

/**
 * GET /api/governance/proposals — list governance proposals
 * Reads from OphirPayContract.get_proposal() on-chain.
 * Cached for 30 seconds to reduce RPC load.
 */
export const GET = withRequestLogging(async function GET(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError("Authentication required. Connect your wallet or provide an API key.");
    }

    // First get total count (cached, 30s TTL)
    const countResult = await cachedFetch(
      "gov:proposal_count",
      () => simulateContractCall(DEFAULT_CONTRACT_ID, "get_proposal_count", CHAIN_READ_SOURCE),
      30_000,
    );

    if (countResult.status === "SIMULATION_FAILED") {
      return successResponse({ items: [], total: 0, truncated: false });
    }

    const totalCount = Number(countResult.returnValue ?? 0);
    if (totalCount === 0) {
      return successResponse({ items: [], total: 0, truncated: false });
    }

    // Enumerate proposals by id (most recent last). Cap the loop to bound the
    // N+1 read pattern (one RPC per proposal). When the chain has more than
    // the cap, enumerate the TAIL (most recent) so truncation drops the
    // oldest proposals — never the ones users are actively voting on — and
    // surface the truncation explicitly so callers know the list is partial.
    const maxProposals = 100;
    const truncated = totalCount > maxProposals;
    const startId = truncated ? totalCount - maxProposals + 1 : 1;
    const endId = totalCount;

    const items: unknown[] = [];
    for (let id = startId; id <= endId; id++) {
      const result = await cachedFetch(
        `gov:proposal:${id}`,
        () => simulateContractCall(
          DEFAULT_CONTRACT_ID,
          "get_proposal",
          CHAIN_READ_SOURCE,
          [nativeToScVal(id, { type: "u64" })]
        ),
        30_000,
      );
      if (result.status !== "SIMULATION_FAILED" && result.returnValue) {
        items.push(result.returnValue);
      }
    }

    return successResponse({ items, total: totalCount, truncated });
  } catch (err) {
    return handleApiError(err, "GET /api/governance/proposals");
  }
});

/**
 * POST /api/governance/proposals — create a new proposal
 * Calls OphirPayContract.create_proposal() on-chain.
 */
export const POST = withRequestLogging(async function POST(request: Request) {
  try {
    const csrfError = verifyCsrf(request);
    if (csrfError) return csrfError;

    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError("Authentication required. Connect your wallet or provide an API key.");
    }

    const parsed = await validateBody(request, createProposalSchema);
    if (!parsed.success) return parsed.response;
    const { proposer, title, description, actionType, target, data, depositAsset, depositAmount } = parsed.data;

    const result = await createGovernanceProposal(
      proposer,
      title,
      description ?? "",
      actionType ?? "custom",
      target ?? "",
      data ?? "",
      depositAsset ?? "",
      depositAmount ?? 0
    );

    if (!result.success) {
      return Response.json(
        { success: false, error: { code: "CONTRACT_ERROR", message: result.error } },
        { status: 400 }
      );
    }

    // A new proposal increments the count — drop the cached count so the
    // next list fetch includes it.
    cacheDelete("gov:proposal_count");
    return successResponse({ txHash: result.txHash, proposalId: result.data }, undefined, 201);
  } catch (err) {
    return handleApiError(err, "POST /api/governance/proposals");
  }
});
