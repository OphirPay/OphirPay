// SPDX-License-Identifier: MIT

import { successResponse, handleApiError, unauthorizedError } from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { withRequestLogging } from "@/lib/request-logging";

/**
 * GET /api/multisig/requests — list pending approval requests
 * Reads from OphirPayContract.get_approval_request() on-chain.
 * Note: contract iteration requires knowing the total count first,
 * then fetching each request by ID. For now, returns latest requests.
 */
export const GET = withRequestLogging(async function GET(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError("Authentication required. Connect your wallet or provide an API key.");
    }

    // The contract has no approval-request enumeration function (each request
    // is read by id), so a full list cannot be assembled on-chain. Return an
    // empty array with an `available` flag so clients can degrade gracefully.
    return successResponse({ requests: [], available: false });
  } catch (err) {
    return handleApiError(err, "GET /api/multisig/requests");
  }
});
