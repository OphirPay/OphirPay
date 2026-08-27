// SPDX-License-Identifier: MIT

import { successResponse, unauthorizedError, handleApiError } from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { verifyCsrf } from "@/lib/csrf";
import { voteOnProposal } from "@/lib/contract-advanced";
import { validateBody, voteOnProposalSchema } from "@/lib/validation-schemas";
import { cacheDelete } from "@/lib/api-cache";
import { withRequestLogging } from "@/lib/request-logging";

/** Invalidate the cached proposal reads so a refetch shows the fresh vote. */
function invalidateProposalCache(proposalId: number) {
  cacheDelete("gov:proposal_count");
  cacheDelete(`gov:proposal:${proposalId}`);
}

/**
 * POST /api/governance/vote — cast a vote on a proposal
 * Calls OphirPayContract.vote_on_proposal() on-chain.
 */
export const POST = withRequestLogging(async function POST(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError(
        "Authentication required. Connect your wallet or provide an API key."
      );
    }

    const csrfError = verifyCsrf(request);
    if (csrfError) return csrfError;

    const parsed = await validateBody(request, voteOnProposalSchema);
    if (!parsed.success) return parsed.response;
    const { voter, proposalId, support } = parsed.data;

    const result = await voteOnProposal(voter, proposalId, support);

    if (!result.success) {
      return Response.json(
        { success: false, error: { code: "CONTRACT_ERROR", message: result.error } },
        { status: 400 }
      );
    }

    invalidateProposalCache(proposalId);
    return successResponse({ voted: true, proposalId, txHash: result.txHash });
  } catch (err) {
    return handleApiError(err, "POST /api/governance/vote");
  }
});
