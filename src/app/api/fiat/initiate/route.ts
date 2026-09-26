// SPDX-License-Identifier: MIT

import {
  successResponse,
  badRequestError,
  unauthorizedError,
  handleApiError,
} from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { discoverAnchor } from "@/lib/sep24/discovery";
import {
  initiateInteractiveDeposit,
  initiateInteractiveWithdrawal,
} from "@/lib/sep24/client";

/**
 * POST /api/fiat/initiate — initiate an interactive SEP-24 deposit or withdrawal.
 */
export async function POST(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError("Authentication required. Connect your wallet or provide an API key.");
    }

    const body = await request.json();
    const kind = body.kind?.toLowerCase() || "deposit";
    const assetCode = (body.assetCode || "USDC").toUpperCase();
    const account = body.account;
    const amount = typeof body.amount === "number" ? body.amount : Number(body.amount) || undefined;
    const domain =
      body.domain ||
      process.env.ANCHOR_DOMAIN ||
      process.env.NEXT_PUBLIC_ANCHOR_DOMAIN ||
      "testnet.kado.sh";

    if (!account || !/^G[A-Z0-9]{55}$/.test(account)) {
      return badRequestError("Valid Stellar public key (56 characters starting with 'G') is required");
    }

    if (kind !== "deposit" && kind !== "withdraw" && kind !== "withdrawal") {
      return badRequestError("Field 'kind' must be 'deposit' or 'withdrawal'");
    }

    const allowHttp =
      process.env.NODE_ENV !== "production" &&
      (process.env.ANCHOR_ALLOW_HTTP === "true" || body.allowHttp === true);

    const anchorConfig = await discoverAnchor(domain, allowHttp);

    let session;
    if (kind === "deposit") {
      session = await initiateInteractiveDeposit(anchorConfig, {
        assetCode,
        account,
        amount,
        walletName: "OphirPay",
      });
    } else {
      session = await initiateInteractiveWithdrawal(anchorConfig, {
        assetCode,
        account,
        amount,
      });
    }

    return successResponse({
      transactionId: session.id,
      interactiveUrl: session.url,
      type: session.type,
      kind,
      assetCode,
      anchorDomain: domain,
    });
  } catch (err) {
    return handleApiError(err, "POST /api/fiat/initiate");
  }
}
