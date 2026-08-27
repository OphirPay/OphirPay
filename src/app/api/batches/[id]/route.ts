// SPDX-License-Identifier: MIT

import { successResponse, handleApiError, notFoundError, unauthorizedError } from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { simulateContractCall, DEFAULT_CONTRACT_ID, CHAIN_READ_SOURCE } from "@/lib/contracts";
import { nativeToScVal } from "@stellar/stellar-sdk";
import { withRequestLogging } from "@/lib/request-logging";

/**
 * GET /api/batches/[id] — single batch lookup
 * Reads from OphirPayContract on-chain. Supports ?payments=true for included payment IDs.
 */
export const GET = withRequestLogging(async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError(
        "Authentication required. Connect your wallet or provide an API key."
      );
    }

    const { id } = await params;
    const batchId = parseInt(id, 10);

    if (isNaN(batchId)) {
      return notFoundError("Invalid batch ID");
    }

    const result = await simulateContractCall(
      DEFAULT_CONTRACT_ID,
      "get_batch",
      CHAIN_READ_SOURCE,
      [nativeToScVal(batchId, { type: "u64" })]
    );

    if (result.status === "SIMULATION_FAILED" || !result.returnValue) {
      return notFoundError(`Batch ${id} not found`);
    }

    const batch = result.returnValue as Record<string, unknown>;

    // Optionally include batch payments
    const { searchParams } = new URL(request.url);
    if (searchParams.get("payments") === "true") {
      const paymentsResult = await simulateContractCall(
        DEFAULT_CONTRACT_ID,
        "get_payments_by_batch",
        CHAIN_READ_SOURCE,
        [nativeToScVal(batchId, { type: "u64" })]
      );
      return successResponse({
        ...batch,
        payments: paymentsResult.status === "SIMULATION_FAILED" ? [] : paymentsResult.returnValue,
      });
    }

    return successResponse(batch);
  } catch (err) {
    return handleApiError(err, "GET /api/batches/[id]");
  }
});
