// SPDX-License-Identifier: MIT

import { TransactionBuilder } from "@stellar/stellar-sdk";

import {
  NETWORK_PASSPHRASE,
  STELLAR_NETWORK,
  getHorizonServer,
} from "@/lib/stellar";
import {
  buildTrustlineTransaction,
  checkTrustline,
  type TrustlineInfo,
} from "@/lib/trustline";
import { getActiveWalletConnector } from "@/lib/wallets";

/**
 * Trustline (changeTrust) orchestration for the wallet-selector flow.
 *
 * `@/lib/trustline` owns the pure pieces — how a changeTrust op is built and
 * how an account's existing trustline is inspected. This module owns the
 * *sequential* flow around them, because that flow is where the real failure
 * modes live: no wallet connected, the user rejecting the signature prompt,
 * a submission rejection from Horizon, or a trustline that is created but not
 * yet authorized by the issuer. Keeping it in one place means the modal, and
 * any future caller, cannot accidentally skip the post-submit verification
 * and report success for a trustline that does not actually exist on-chain.
 */

/** Minimal signer surface — a full wallet connector satisfies it structurally. */
export interface TrustlineSigner {
  signTransaction(
    xdr: string,
    opts?: { network?: string; networkPassphrase?: string },
  ): Promise<string>;
}

export interface CreateTrustlineOptions {
  /**
   * Explicit signer. Defaults to the connector of the wallet the user has
   * actually connected (`getActiveWalletConnector`), which falls back to any
   * installed wallet only when no wallet is active.
   */
  signer?: TrustlineSigner | null;
  /** Trustline limit; the protocol maximum is used when omitted. */
  limit?: string;
}

/** Raised when there is no connected wallet able to sign the transaction. */
export class TrustlineWalletError extends Error {
  constructor(message = "Reconnect your wallet to create this trustline.") {
    super(message);
    this.name = "TrustlineWalletError";
  }
}

/**
 * Build, sign, submit and verify a `changeTrust` operation.
 *
 * Resolves with the *verified* trustline state read back from Horizon — not
 * merely a successful submission. A changeTrust can land on-chain and still
 * leave the asset frozen or unauthorized by the issuer, so callers must key
 * their UI off the returned `state`, never off "the submit didn't throw".
 */
export async function createTrustline(
  publicKey: string,
  assetCode: string,
  assetIssuer: string,
  options: CreateTrustlineOptions = {},
): Promise<TrustlineInfo> {
  const signer = options.signer ?? getActiveWalletConnector();
  if (!signer) throw new TrustlineWalletError();

  const { xdr } = await buildTrustlineTransaction(
    publicKey,
    assetCode,
    assetIssuer,
    options.limit,
  );

  const signedXdr = await signer.signTransaction(xdr, {
    network: STELLAR_NETWORK,
    networkPassphrase: NETWORK_PASSPHRASE,
  });

  const transaction = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
  await getHorizonServer().submitTransaction(transaction);

  return checkTrustline(publicKey, assetCode, assetIssuer);
}

export {
  buildTrustlineTransaction,
  checkTrustline,
  getTrustlineMessage,
} from "@/lib/trustline";
export type { TrustlineInfo, TrustlineState } from "@/lib/trustline";
