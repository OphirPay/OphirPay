// SPDX-License-Identifier: MIT

import { getHorizonServer } from "@/lib/stellar";
import { withTimeout, STELLAR_TIMEOUT_MS } from "@/lib/timeout";

/**
 * Trustline utilities for Stellar assets other than XLM.
 * Before sending a non-native asset, the destination must trust the issuer.
 */

interface TrustlineInfo {
  assetCode: string;
  assetIssuer: string;
  hasTrustline: boolean;
  balance?: string;
  limit?: string;
}

/**
 * Check if an account has a trustline for a given asset.
 * Returns trustline details or null if not found.
 */
export async function checkTrustline(
  publicKey: string,
  assetCode: string,
  assetIssuer: string
): Promise<TrustlineInfo> {
  try {
    const server = getHorizonServer();
    const account = await withTimeout(
      server.loadAccount(publicKey),
      STELLAR_TIMEOUT_MS,
      "Stellar Horizon loadAccount timed out"
    );

    const trustline = account.balances.find(
      (b): b is Extract<typeof b, { asset_code: string; asset_issuer: string }> =>
        b.asset_type !== "native" &&
        "asset_code" in b && "asset_issuer" in b &&
        b.asset_code === assetCode &&
        b.asset_issuer === assetIssuer
    );

    return {
      assetCode,
      assetIssuer,
      hasTrustline: !!trustline,
      balance: trustline?.balance,
      limit: trustline?.limit,
    };
  } catch {
    return { assetCode, assetIssuer, hasTrustline: false };
  }
}

/**
 * Check if sending `amount` of an asset would exceed the trustline limit.
 */
export function wouldExceedTrustlineLimit(
  currentBalance: string,
  amount: string,
  limit: string
): boolean {
  const balance = parseFloat(currentBalance);
  const send = parseFloat(amount);
  const maxLimit = parseFloat(limit);
  return balance + send > maxLimit;
}
