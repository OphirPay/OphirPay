// SPDX-License-Identifier: MIT

import {
  Asset,
  Operation,
  TransactionBuilder,
  type xdr,
} from "@stellar/stellar-sdk";
import {
  getHorizonServer,
  NETWORK_PASSPHRASE,
} from "@/lib/stellar";

const DEFAULT_TRUSTLINE_LIMIT = "922337203685.4775807";

/**
 * Trustline utilities for Stellar assets other than XLM.
 * Before sending a non-native asset, the destination must trust the issuer.
 */

export type TrustlineState = "missing" | "authorized" | "unauthorized" | "frozen" | "unavailable";

export interface TrustlineInfo {
  assetCode: string;
  assetIssuer: string;
  hasTrustline: boolean;
  state: TrustlineState;
  balance?: string;
  limit?: string;
  isAuthorized?: boolean;
  isFrozen?: boolean;
}

/**
 * Build a signed or unsigned change-trust transaction for a non-native asset.
 * This is the client-side helper used to guide users through the first-run
 * trustline setup flow for assets like USDC.
 */
export async function buildTrustlineTransaction(
  publicKey: string,
  assetCode: string,
  assetIssuer: string,
  limit?: string,
): Promise<{ xdr: string; transaction: xdr.TransactionEnvelope }> {
  const server = getHorizonServer();
  const account = await server.loadAccount(publicKey);
  const asset = new Asset(assetCode, assetIssuer);
  const tx = new TransactionBuilder(account, {
    fee: "100000",
    networkPassphrase: NETWORK_PASSPHRASE,
    timebounds: { minTime: 0, maxTime: Math.floor(Date.now() / 1000) + 300 },
  })
    .addOperation(
      Operation.changeTrust({
        asset,
        limit: limit ?? DEFAULT_TRUSTLINE_LIMIT,
      }),
    )
    .build();

  return { xdr: tx.toXDR(), transaction: tx.toEnvelope() };
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
    const account = await server.loadAccount(publicKey);

    const trustline = account.balances.find(
      (b): b is Extract<typeof b, { asset_code: string; asset_issuer: string }> =>
        b.asset_type !== "native" &&
        "asset_code" in b && "asset_issuer" in b &&
        b.asset_code === assetCode &&
        b.asset_issuer === assetIssuer
    );

    if (!trustline) {
      return {
        assetCode,
        assetIssuer,
        hasTrustline: false,
        state: "missing",
      };
    }

    const flags = trustline as {
      is_authorized?: boolean;
      is_frozen?: boolean;
    };
    const isFrozen = Boolean(flags.is_frozen);
    const isAuthorized = flags.is_authorized !== false && !isFrozen;

    return {
      assetCode,
      assetIssuer,
      hasTrustline: true,
      state: isFrozen ? "frozen" : isAuthorized ? "authorized" : "unauthorized",
      balance: trustline?.balance,
      limit: trustline?.limit,
      isAuthorized,
      isFrozen,
    };
  } catch {
    return { assetCode, assetIssuer, hasTrustline: false, state: "unavailable" };
  }
}

export function getTrustlineMessage(state: TrustlineState, assetCode: string): string {
  switch (state) {
    case "authorized":
      return `${assetCode} is already trusted and ready for incoming transfers.`;
    case "frozen":
      return `${assetCode} is listed but frozen by the issuer. Contact the issuer to re-enable the trustline.`;
    case "unauthorized":
      return `${assetCode} trustline exists, but the issuer has not authorized it for transfers.`;
    case "unavailable":
      return `Could not check the ${assetCode} trustline. Check the network connection and try again.`;
    default:
      return `You need to set up a trustline for ${assetCode} before this account can receive it.`;
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
