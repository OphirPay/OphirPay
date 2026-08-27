// SPDX-License-Identifier: MIT

import { successResponse, unauthorizedError, handleApiError } from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { verifyCsrf } from "@/lib/csrf";
import { validateBody, approveMultisigSchema } from "@/lib/validation-schemas";
import { approveMultisigPayment } from "@/lib/contract-advanced";
import { withRequestLogging } from "@/lib/request-logging";

/**
 * POST /api/multisig/approve — signer approves a pending proposal
 * Calls OphirPayContract.approve_payment() on-chain.
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

    const parsed = await validateBody(request, approveMultisigSchema);
    if (!parsed.success) return parsed.response;
    const { requestId } = parsed.data;

    const result = await approveMultisigPayment(auth.publicKey ?? auth.userId, requestId);

    if (!result.success) {
      return Response.json(
        { success: false, error: { code: "CONTRACT_ERROR", message: result.error } },
        { status: 400 }
      );
    }

    return successResponse({ approved: true, requestId, txHash: result.txHash });
  } catch (err) {
    return handleApiError(err, "POST /api/multisig/approve");
  }
});
