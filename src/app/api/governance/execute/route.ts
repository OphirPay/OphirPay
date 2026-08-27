// SPDX-License-Identifier: MIT

import { successResponse, handleApiError, unauthorizedError } from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { verifyCsrf } from "@/lib/csrf";
import { validateBody, executeProposalSchema } from "@/lib/validation-schemas";
import { executeGovernanceProposal } from "@/lib/contract-advanced";
import { cacheDelete } from "@/lib/api-cache";
import { withRequestLogging } from "@/lib/request-logging";

/**
 * POST /api/governance/execute
 * Execute a passed governance proposal on-chain.
 */
export const POST = withRequestLogging(async function POST(request: Request) {
  try {
    const csrfError = verifyCsrf(request);
    if (csrfError) return csrfError;

    const auth = await getAuthContext(request);
    if (!auth?.publicKey) {
      return unauthorizedError(
        "Authentication required. Connect your wallet or provide an API key."
      );
    }

    const parsed = await validateBody(request, executeProposalSchema);
    if (!parsed.success) return parsed.response;
    const { proposalId } = parsed.data;

    const result = await executeGovernanceProposal(auth.publicKey, proposalId);

    if (!result.success) {
      return Response.json(
        { success: false, error: { code: "CONTRACT_ERROR", message: result.error } },
        { status: 400 }
      );
    }

    cacheDelete("gov:proposal_count");
    cacheDelete(`gov:proposal:${proposalId}`);
    return successResponse({ executed: true, proposalId, txHash: result.txHash });
  } catch (error) {
    return handleApiError(error);
  }
});
