// SPDX-License-Identifier: MIT

import { NextRequest } from "next/server";
import { checkTrustline } from "@/lib/trustline";
import { successResponse, badRequest, serverError } from "@/lib/api-response";
import { isValidStellarAddress } from "@/lib/stellar";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const account = searchParams.get("account");
    let code = searchParams.get("code") || searchParams.get("assetCode");
    let issuer = searchParams.get("issuer") || searchParams.get("assetIssuer");

    const assetCombined = searchParams.get("asset");
    if (assetCombined && assetCombined.includes(":")) {
      const parts = assetCombined.split(":");
      code = parts[0];
      issuer = parts[1];
    }

    if (!account || !isValidStellarAddress(account)) {
      return badRequest("Valid Stellar account public key ('account') is required");
    }

    if (!code) {
      return badRequest("Asset code ('code') is required");
    }

    if (code.toUpperCase() === "XLM" || !issuer) {
      return successResponse({
        account,
        assetCode: code.toUpperCase(),
        hasTrustline: true,
        status: "authorized",
        explanation: "Native XLM is accepted by all funded Stellar accounts without establishing a trustline.",
        message: "Native XLM requires no trustline.",
        actionRequired: false,
        reserveRequirementXlm: "0",
      });
    }

    if (!isValidStellarAddress(issuer)) {
      return badRequest("Valid asset issuer address ('issuer') is required");
    }

    const info = await checkTrustline(account, code, issuer);
    return successResponse({
      account,
      ...info,
    });
  } catch (err) {
    return serverError(
      err instanceof Error ? err.message : "Failed to check trustline"
    );
  }
}
