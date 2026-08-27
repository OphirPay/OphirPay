// SPDX-License-Identifier: MIT

import { successResponse, unauthorizedError, handleApiError } from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { verifyCsrf } from "@/lib/csrf";
import { validateBody, proposeMultisigPaymentSchema } from "@/lib/validation-schemas";
import { proposeMultisigPayment } from "@/lib/contract-advanced";
import { withRequestLogging } from "@/lib/request-logging";

/**
 * POST /api/multisig/propose — propose a payment for multisig approval
 * Calls OphirPayContract.propose_payment() on-chain.
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

    const parsed = await validateBody(request, proposeMultisigPaymentSchema);
    if (!parsed.success) return parsed.response;
    const { payee, amount, assetCode, memo } = parsed.data;

    const result = await proposeMultisigPayment(
      auth.publicKey ?? auth.userId,
      payee,
      amount,
      assetCode ?? "native",
      memo ?? `multisig_${Date.now().toString(36)}`
    );

    if (!result.success) {
      return Response.json(
        { success: false, error: { code: "CONTRACT_ERROR", message: result.error } },
        { status: 400 }
      );
    }

    return successResponse({ txHash: result.txHash, proposalId: result.data }, undefined, 201);
  } catch (err) {
    return handleApiError(err, "POST /api/multisig/propose");
  }
});
