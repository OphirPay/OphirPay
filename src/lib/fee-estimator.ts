// SPDX-License-Identifier: MIT

import { getHorizonServer } from "@/lib/stellar";

interface FeeEstimate {
  baseFee: string;
  estimatedFee: string;
  operations: number;
  networkCongestion: "low" | "medium" | "high";
}

/**
 * Estimate the fee for a Stellar transaction based on the current base fee
 * and the number of operations.
 */
export async function estimateTransactionFee(
  numOperations = 1
): Promise<FeeEstimate> {
  try {
    const server = getHorizonServer();
    const baseFeeResponse = await server.fetchBaseFee();
    const baseFee = parseFloat(baseFeeResponse.toString());
    const estimated = baseFee * numOperations;

    let congestion: FeeEstimate["networkCongestion"] = "low";
    if (baseFee > 200) congestion = "high";
    else if (baseFee > 100) congestion = "medium";

    return {
      baseFee: baseFee.toString(),
      estimatedFee: estimated.toString(),
      operations: numOperations,
      networkCongestion: congestion,
    };
  } catch {
    // Fallback to standard base fee of 100 stroops
    return {
      baseFee: "100",
      estimatedFee: (100 * numOperations).toString(),
      operations: numOperations,
      networkCongestion: "low",
    };
  }
}

/**
 * Calculate the estimated total fee for a batch payment with N recipients.
 * Each recipient = 1 payment operation.
 */
export function estimateBatchFee(recipientCount: number, baseFee = 100): string {
  return (baseFee * recipientCount).toString();
}
