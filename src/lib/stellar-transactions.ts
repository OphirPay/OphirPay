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
import { getActiveWalletConnector } from "@/lib/wallets";
import { checkTrustline, type TrustlineInfo } from "@/lib/trustline";

export const DEFAULT_TRUSTLINE_LIMIT = "922337203685.4775807";

/**
 * Validates Stellar public key format (G... 56 characters).
 */
export function isValidStellarPublicKey(key: string): boolean {
  return /^G[A-Z2-7]{55}$/.test(key.trim());
}

/**
 * Validates Stellar asset code (1 to 12 alphanumeric characters).
 */
export function isValidAssetCode(code: string): boolean {
  return /^[a-zA-Z0-9]{1,12}$/.test(code.trim());
}

/**
 * Builds an unsigned changeTrust transaction envelope for adding or modifying
 * a trustline for a non-native Stellar asset.
 */
export async function buildChangeTrustTransaction(
  publicKey: string,
  assetCode: string,
  assetIssuer: string,
  limit: string = DEFAULT_TRUSTLINE_LIMIT,
): Promise<{ xdr: string; transaction: xdr.TransactionEnvelope }> {
  const cleanKey = publicKey.trim();
  const cleanCode = assetCode.trim();
  const cleanIssuer = assetIssuer.trim();

  if (!isValidStellarPublicKey(cleanKey)) {
    throw new Error("Invalid account public key.");
  }
  if (!isValidAssetCode(cleanCode)) {
    throw new Error("Invalid asset code. Must be 1-12 alphanumeric characters.");
  }
  if (!isValidStellarPublicKey(cleanIssuer)) {
    throw new Error("Invalid issuer public key.");
  }

  const server = getHorizonServer();
  const account = await server.loadAccount(cleanKey);
  const asset = new Asset(cleanCode, cleanIssuer);

  const tx = new TransactionBuilder(account, {
    fee: "100000",
    networkPassphrase: NETWORK_PASSPHRASE,
    timebounds: { minTime: 0, maxTime: Math.floor(Date.now() / 1000) + 300 },
  })
    .addOperation(
      Operation.changeTrust({
        asset,
        limit,
      }),
    )
    .build();

  return { xdr: tx.toXDR(), transaction: tx.toEnvelope() };
}

/**
 * Submits changeTrust operation directly through the connected wallet extension.
 */
export async function submitChangeTrustWithWallet(
  publicKey: string,
  assetCode: string,
  assetIssuer: string,
  limit?: string,
): Promise<{ success: boolean; hash?: string; trustline: TrustlineInfo }> {
  const connector = getActiveWalletConnector();
  if (!connector) {
    throw new Error("No connected wallet found. Please connect Freighter or another supported wallet.");
  }

  const { xdr } = await buildChangeTrustTransaction(publicKey, assetCode, assetIssuer, limit);
  const result = await connector.signAndSubmit(xdr);

  // Verify that trustline is now present on-chain
  const trustline = await checkTrustline(publicKey, assetCode, assetIssuer);

  return {
    success: true,
    hash: (result as { hash?: string })?.hash,
    trustline,
  };
}
