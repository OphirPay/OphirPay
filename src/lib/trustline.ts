// SPDX-License-Identifier: MIT

import {
  Account,
  Asset,
  Operation,
  Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import {
  getHorizonServer,
  NETWORK_PASSPHRASE,
  STELLAR_NETWORK,
  submitSignedTx,
} from "@/lib/stellar";
import { getWalletConnector, type WalletId } from "@/lib/wallets";

/**
 * Trustline utilities for Stellar assets other than XLM.
 * Before sending or receiving a non-native asset, the destination must establish a trustline.
 */

/**
 * One-sentence plain-English explanation of a Stellar trustline.
 */
export const TRUSTLINE_ONE_SENTENCE_EXPLANATION =
  "A trustline is an explicit agreement on the Stellar network that enables your account to receive and hold a specific non-native asset from an issuer.";

/**
 * Stellar network base reserve per subentry (0.5 XLM per trustline).
 */
export const BASE_RESERVE_PER_TRUSTLINE_XLM = "0.5";

/**
 * Trustline states:
 * - `no_trustline`: Account has not established a trustline for this asset.
 * - `authorized`: Trustline exists and is authorized to receive and hold payments.
 * - `unauthorized`: Trustline exists, but the issuer has not authorized the account to transact.
 * - `frozen`: Trustline exists, but has been frozen by the issuer (cannot receive incoming payments).
 */
export type TrustlineStatus =
  | "no_trustline"
  | "authorized"
  | "unauthorized"
  | "frozen";

export interface TrustlineInfo {
  assetCode: string;
  assetIssuer: string;
  hasTrustline: boolean;
  status: TrustlineStatus;
  balance?: string;
  limit?: string;
  isAuthorized?: boolean;
  isAuthorizedToMaintainLiabilities?: boolean;
  isClawbackEnabled?: boolean;
  explanation: string;
  message: string;
  actionRequired: boolean;
  reserveRequirementXlm: string;
}

/**
 * Generate distinct, accurate messaging for each trustline state.
 */
export function getTrustlineStatusMessage(
  status: TrustlineStatus,
  assetCode: string = "this asset"
): string {
  switch (status) {
    case "authorized":
      return `Trustline active and authorized. Your account is ready to receive payments in ${assetCode}.`;
    case "unauthorized":
      return `Trustline unauthorized: The asset issuer requires explicit authorization before your account can receive or trade ${assetCode}.`;
    case "frozen":
      return `Trustline frozen: The asset issuer has temporarily frozen this trustline for your account. You cannot receive payments until the issuer restores authorization.`;
    case "no_trustline":
    default:
      return `No trustline established. Your account must establish a trustline with the issuer before receiving ${assetCode}.`;
  }
}

/**
 * Classify authorization flags into a TrustlineStatus.
 */
export function classifyTrustlineStatus(balance: {
  is_authorized?: boolean;
  is_authorized_to_maintain_liabilities?: boolean;
}): TrustlineStatus {
  if (balance.is_authorized === false) {
    if (balance.is_authorized_to_maintain_liabilities === true) {
      return "unauthorized";
    }
    return "frozen";
  }
  return "authorized";
}

/**
 * Check if an account has a trustline for a given asset.
 * Returns comprehensive trustline status, explanation, and state messaging.
 */
export async function checkTrustline(
  publicKey: string,
  assetCode: string,
  assetIssuer: string
): Promise<TrustlineInfo> {
  const fallbackInfo: TrustlineInfo = {
    assetCode,
    assetIssuer,
    hasTrustline: false,
    status: "no_trustline",
    explanation: TRUSTLINE_ONE_SENTENCE_EXPLANATION,
    message: getTrustlineStatusMessage("no_trustline", assetCode),
    actionRequired: true,
    reserveRequirementXlm: BASE_RESERVE_PER_TRUSTLINE_XLM,
  };

  try {
    const server = getHorizonServer();
    const account = await server.loadAccount(publicKey);

    const trustline = account.balances.find(
      (b): b is Extract<typeof b, { asset_code: string; asset_issuer: string }> =>
        b.asset_type !== "native" &&
        "asset_code" in b &&
        "asset_issuer" in b &&
        b.asset_code === assetCode &&
        b.asset_issuer === assetIssuer
    );

    if (!trustline) {
      return fallbackInfo;
    }

    const rawAuth = (trustline as unknown as { is_authorized?: boolean }).is_authorized;
    const rawLiabilities = (
      trustline as unknown as { is_authorized_to_maintain_liabilities?: boolean }
    ).is_authorized_to_maintain_liabilities;
    const isClawback = (trustline as unknown as { is_clawback_enabled?: boolean })
      .is_clawback_enabled;

    const status = classifyTrustlineStatus({
      is_authorized: rawAuth,
      is_authorized_to_maintain_liabilities: rawLiabilities,
    });

    return {
      assetCode,
      assetIssuer,
      hasTrustline: true,
      status,
      balance: trustline.balance,
      limit: trustline.limit,
      isAuthorized: rawAuth !== false,
      isAuthorizedToMaintainLiabilities: !!rawLiabilities,
      isClawbackEnabled: !!isClawback,
      explanation: TRUSTLINE_ONE_SENTENCE_EXPLANATION,
      message: getTrustlineStatusMessage(status, assetCode),
      actionRequired: status !== "authorized",
      reserveRequirementXlm: BASE_RESERVE_PER_TRUSTLINE_XLM,
    };
  } catch {
    return fallbackInfo;
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

/**
 * Check if the account has enough XLM balance to satisfy the base reserve
 * required for adding an additional trustline.
 */
export function canAffordTrustlineReserve(
  xlmBalance: string | number,
  currentSubentries: number = 0
): { canAfford: boolean; availableXlm: number; requiredReserveXlm: number } {
  const balance = typeof xlmBalance === "string" ? parseFloat(xlmBalance) : xlmBalance;
  // Stellar reserve = (2 + subentries) * 0.5 XLM
  // Adding a trustline increments subentries by 1, so minimum reserve becomes (3 + subentries) * 0.5
  const requiredReserve = (3 + currentSubentries) * 0.5;
  const canAfford = balance >= requiredReserve;
  return {
    canAfford,
    availableXlm: balance,
    requiredReserveXlm: requiredReserve,
  };
}

export interface CreateChangeTrustParams {
  account: Account;
  assetCode: string;
  assetIssuer: string;
  limit?: string;
  fee?: string;
  networkPassphrase?: string;
  timeoutSeconds?: number;
}

/**
 * Client-side synchronous helper to construct a change_trust transaction.
 * Strictly memo-free, configured with the correct asset, issuer, and limit.
 */
export function createChangeTrustTransaction(
  params: CreateChangeTrustParams
): Transaction {
  const {
    account,
    assetCode,
    assetIssuer,
    limit,
    fee = "100",
    networkPassphrase = NETWORK_PASSPHRASE,
    timeoutSeconds = 300,
  } = params;

  const asset = new Asset(assetCode, assetIssuer);
  const operation = Operation.changeTrust({
    asset,
    ...(limit !== undefined ? { limit } : {}),
  });

  const now = Math.floor(Date.now() / 1000);

  // Memo-free: no memo is attached to the transaction builder
  const tx = new TransactionBuilder(account, {
    fee,
    networkPassphrase,
    timebounds: { minTime: 0, maxTime: now + timeoutSeconds },
  })
    .addOperation(operation)
    .build();

  return tx;
}

export interface BuildTrustlineTxParams {
  publicKey: string;
  assetCode: string;
  assetIssuer: string;
  limit?: string;
  fee?: string;
  networkPassphrase?: string;
  sequence?: string;
}

/**
 * Builds a memo-free change_trust transaction for the specified asset and issuer.
 * If sequence is omitted, queries Horizon for the account's current sequence number.
 */
export async function buildTrustlineTransaction(
  params: BuildTrustlineTxParams
): Promise<Transaction> {
  let sequence = params.sequence;
  if (!sequence) {
    const server = getHorizonServer();
    const account = await server.loadAccount(params.publicKey);
    sequence = account.sequence;
  }

  const account = new Account(params.publicKey, sequence);
  return createChangeTrustTransaction({
    account,
    assetCode: params.assetCode,
    assetIssuer: params.assetIssuer,
    limit: params.limit,
    fee: params.fee,
    networkPassphrase: params.networkPassphrase,
  });
}

export interface EstablishTrustlineWithWalletParams {
  walletId: WalletId;
  publicKey: string;
  assetCode: string;
  assetIssuer: string;
  limit?: string;
}

/**
 * Convenience helper to build, sign, and submit a change_trust transaction
 * using the user's active wallet connector.
 */
export async function establishTrustlineWithWallet(
  params: EstablishTrustlineWithWalletParams
): Promise<{ txHash: string; success: boolean }> {
  const tx = await buildTrustlineTransaction({
    publicKey: params.publicKey,
    assetCode: params.assetCode,
    assetIssuer: params.assetIssuer,
    limit: params.limit,
  });

  const connector = getWalletConnector(params.walletId);
  const signedXdr = await connector.signTransaction(tx.toXDR(), {
    network: STELLAR_NETWORK,
    networkPassphrase: NETWORK_PASSPHRASE,
  });

  const response = await submitSignedTx(signedXdr);
  return {
    txHash: response.hash,
    success: true,
  };
}
