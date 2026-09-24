// SPDX-License-Identifier: MIT

import {
  successResponse,
  unauthorizedError,
  handleApiError,
} from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { discoverAnchor } from "@/lib/sep24/discovery";
import { getAnchorTransaction } from "@/lib/sep24/client";
import { recordCompletedAnchorDeposit } from "@/lib/sep24/record";

/**
 * GET /api/fiat/transaction/[id] — check status of an ongoing SEP-24 transaction.
 * If the transaction has completed, syncs the deposit into the user's recorded payments.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError("Authentication required. Connect your wallet or provide an API key.");
    }

    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const domain =
      searchParams.get("domain") ||
      process.env.ANCHOR_DOMAIN ||
      process.env.NEXT_PUBLIC_ANCHOR_DOMAIN ||
      "testnet.kado.sh";
    const assetCode = searchParams.get("assetCode") || "USDC";

    const allowHttp =
      process.env.NODE_ENV !== "production" &&
      (process.env.ANCHOR_ALLOW_HTTP === "true" || searchParams.get("allowHttp") === "true");

    const anchorConfig = await discoverAnchor(domain, allowHttp);
    const tx = await getAnchorTransaction(anchorConfig, id);

    let recordedPaymentId: string | undefined = undefined;

    // If completed deposit, record in payments database
    if (tx.status === "completed" && tx.kind === "deposit") {
      const payment = await recordCompletedAnchorDeposit(
        auth.userId,
        tx,
        domain,
        assetCode
      );
      if (payment) {
        recordedPaymentId = payment.id;
      }
    }

    return successResponse({
      transaction: tx,
      recordedPaymentId,
      anchorDomain: domain,
    });
  } catch (err) {
    return handleApiError(err, "GET /api/fiat/transaction/[id]");
  }
}
