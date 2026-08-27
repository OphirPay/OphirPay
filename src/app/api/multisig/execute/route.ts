// SPDX-License-Identifier: MIT

import { successResponse, unauthorizedError, handleApiError } from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { verifyCsrf } from "@/lib/csrf";
import { validateBody, executeMultisigSchema } from "@/lib/validation-schemas";
import { executeApprovedPayment } from "@/lib/contract-advanced";
import { withRequestLogging } from "@/lib/request-logging";

/**
 * POST /api/multisig/execute — execute a fully approved payment
 * Calls OphirPayContract.execute_approved_payment() on-chain.
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

    const parsed = await validateBody(request, executeMultisigSchema);
    if (!parsed.success) return parsed.response;
    const { requestId } = parsed.data;

    const result = await executeApprovedPayment(auth.publicKey ?? auth.userId, requestId);

    if (!result.success) {
      return Response.json(
        { success: false, error: { code: "CONTRACT_ERROR", message: result.error } },
        { status: 400 }
      );
    }

    return successResponse({ executed: true, requestId, txHash: result.txHash });
  } catch (err) {
    return handleApiError(err, "POST /api/multisig/execute");
  }
});
