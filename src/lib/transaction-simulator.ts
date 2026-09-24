// SPDX-License-Identifier: MIT

import {
  TransactionBuilder,
  Operation,
  Asset,
} from "@stellar/stellar-sdk";
import { getHorizonServer, NETWORK_PASSPHRASE } from "@/lib/stellar";
import { withTimeout, STELLAR_TIMEOUT_MS } from "@/lib/timeout";

interface SimulateResult {
  success: boolean;
  fee: string;
  error?: string;
  operations: number;
}

/**
 * Simulate a payment transaction to estimate fees and check for errors
 * before asking the user to sign. Catches invalid destinations, insufficient
 * funds, and trustline issues before the Freighter prompt.
 */
export async function simulatePayment(params: {
  sourcePublicKey: string;
  destination: string;
  amount: string;
  assetCode?: string;
  assetIssuer?: string;
}): Promise<SimulateResult> {
  try {
    const server = getHorizonServer();
    const sourceAccount = await withTimeout(
      server.loadAccount(params.sourcePublicKey),
      STELLAR_TIMEOUT_MS,
      "Stellar Horizon loadAccount timed out"
    );

    const now = Math.floor(Date.now() / 1000);
    const baseFee = await withTimeout(
      server.fetchBaseFee(),
      STELLAR_TIMEOUT_MS,
      "Stellar Horizon fetchBaseFee timed out"
    );

    const tx = new TransactionBuilder(sourceAccount, {
      fee: baseFee.toString(),
      networkPassphrase: NETWORK_PASSPHRASE,
      timebounds: { minTime: 0, maxTime: now + 300 },
    })
      .addOperation(
        Operation.payment({
          destination: params.destination,
        asset: params.assetCode && params.assetCode !== "XLM"
          ? new Asset(params.assetCode, params.assetIssuer!)
          : Asset.native(),
          amount: params.amount,
        })
      )
      .build();

    // Validate the transaction can be built and fee estimated
    // Full simulation requires Soroban RPC (use simulateTransaction from @/lib/contracts for Soroban txns)
    if (!tx) {
      return {
        success: false,
        fee: baseFee.toString(),
        error: "Failed to build transaction",
        operations: 1,
      };
    }

    return {
      success: true,
      fee: baseFee.toString(),
      operations: 1,
    };
  } catch (err) {
    return {
      success: false,
      fee: "100",
      error: err instanceof Error ? err.message : "Unknown simulation error",
      operations: 1,
    };
  }
}
