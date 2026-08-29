// SPDX-License-Identifier: MIT

import { getHorizonServer } from "@/lib/stellar";

export type PaymentType = "single" | "batch" | "scheduled";

export interface FeeBreakdown {
  networkFeeStroops: string;
  networkFeeXlm: string;
  protocolFeeBps: number;
  protocolFeeStroops: string;
  protocolFeeXlm: string;
  totalEstimatedFeeStroops: string;
  totalEstimatedFeeXlm: string;
}

export interface DetailedFeeEstimate {
  paymentType: PaymentType;
  operations: number;
  baseFeeStroops: string;
  breakdown: FeeBreakdown;
  networkCongestion: "low" | "medium" | "high";
  warning: string | null;
}

export interface FeeEstimateOptions {
  paymentType?: PaymentType;
  amountStroops?: string | number | bigint;
  recipientCount?: number;
  scheduledIntervals?: number;
  protocolFeeBps?: number;
  maxFeeThresholdStroops?: string | number | bigint;
}

const DEFAULT_BASE_FEE_STROOPS = 100;
const STROOPS_PER_XLM = 10_000_000n;
const DEFAULT_PROTOCOL_FEE_BPS = 25; // 0.25% default
const DEFAULT_MAX_FEE_THRESHOLD_STROOPS = 1_000_000n; // 0.1 XLM

/**
 * Convert stroops string/number/bigint to XLM string with precision.
 */
export function stroopsToXlm(stroops: bigint | number | string): string {
  const bigStroops = typeof stroops === "bigint" ? stroops : BigInt(Math.floor(Number(stroops)));
  const integerPart = bigStroops / STROOPS_PER_XLM;
  const fractionalPart = (bigStroops % STROOPS_PER_XLM).toString().padStart(7, "0").replace(/0+$/, "");
  return fractionalPart ? `${integerPart}.${fractionalPart}` : `${integerPart}`;
}

/**
 * Fetch current Stellar base fee from Horizon or fallback to default.
 */
export async function getNetworkBaseFee(): Promise<number> {
  try {
    const server = getHorizonServer();
    const baseFeeResponse = await server.fetchBaseFee();
    const baseFee = parseFloat(baseFeeResponse.toString());
    return Number.isFinite(baseFee) && baseFee > 0 ? baseFee : DEFAULT_BASE_FEE_STROOPS;
  } catch {
    return DEFAULT_BASE_FEE_STROOPS;
  }
}

/**
 * Estimate total fees (network + protocol) for single, batch, and scheduled payments.
 */
export async function estimateTotalPaymentFees(
  options: FeeEstimateOptions = {}
): Promise<DetailedFeeEstimate> {
  const paymentType = options.paymentType || "single";
  const recipientCount = Math.max(1, options.recipientCount || 1);
  const scheduledIntervals = Math.max(1, options.scheduledIntervals || 1);
  const protocolFeeBps = options.protocolFeeBps !== undefined ? options.protocolFeeBps : DEFAULT_PROTOCOL_FEE_BPS;

  const baseFee = await getNetworkBaseFee();

  let operations = 1;
  if (paymentType === "batch") {
    // 1 op per recipient payment + envelope overhead
    operations = recipientCount;
  } else if (paymentType === "scheduled") {
    // Escrow/stream setup op + execution ops for intervals
    operations = 1 + scheduledIntervals;
  }

  const networkFeeStroops = BigInt(Math.ceil(baseFee * operations));
  const networkFeeXlm = stroopsToXlm(networkFeeStroops);

  let protocolFeeStroops = 0n;
  if (options.amountStroops) {
    const principal = BigInt(options.amountStroops.toString());
    if (principal > 0n && protocolFeeBps > 0) {
      protocolFeeStroops = (principal * BigInt(protocolFeeBps)) / 10_000n;
    }
  }
  const protocolFeeXlm = stroopsToXlm(protocolFeeStroops);

  const totalEstimatedFeeStroops = networkFeeStroops + protocolFeeStroops;
  const totalEstimatedFeeXlm = stroopsToXlm(totalEstimatedFeeStroops);

  let congestion: DetailedFeeEstimate["networkCongestion"] = "low";
  if (baseFee > 200) congestion = "high";
  else if (baseFee > 100) congestion = "medium";

  let warning: string | null = null;
  const maxThreshold = options.maxFeeThresholdStroops !== undefined
    ? BigInt(options.maxFeeThresholdStroops.toString())
    : DEFAULT_MAX_FEE_THRESHOLD_STROOPS;

  if (totalEstimatedFeeStroops > maxThreshold) {
    warning = `Estimated fee (${totalEstimatedFeeXlm} XLM) exceeds maximum threshold (${stroopsToXlm(maxThreshold)} XLM).`;
  } else if (congestion === "high") {
    warning = `High network congestion detected on Stellar Horizon (base fee: ${baseFee} stroops). Transactions may incur surge pricing.`;
  } else if (paymentType === "batch" && recipientCount > 50) {
    warning = `Batch size (${recipientCount} recipients) is large. Consider chunking into multiple smaller batches if ledger limit is reached.`;
  }

  return {
    paymentType,
    operations,
    baseFeeStroops: baseFee.toString(),
    breakdown: {
      networkFeeStroops: networkFeeStroops.toString(),
      networkFeeXlm,
      protocolFeeBps,
      protocolFeeStroops: protocolFeeStroops.toString(),
      protocolFeeXlm,
      totalEstimatedFeeStroops: totalEstimatedFeeStroops.toString(),
      totalEstimatedFeeXlm,
    },
    networkCongestion: congestion,
    warning,
  };
}

/**
 * Legacy wrapper for backward compatibility.
 */
export async function estimateTransactionFee(
  numOperations = 1
): Promise<{
  baseFee: string;
  estimatedFee: string;
  operations: number;
  networkCongestion: "low" | "medium" | "high";
}> {
  const baseFee = await getNetworkBaseFee();
  const estimated = baseFee * numOperations;

  let congestion: "low" | "medium" | "high" = "low";
  if (baseFee > 200) congestion = "high";
  else if (baseFee > 100) congestion = "medium";

  return {
    baseFee: baseFee.toString(),
    estimatedFee: estimated.toString(),
    operations: numOperations,
    networkCongestion: congestion,
  };
}

/**
 * Calculate the estimated total fee for a batch payment with N recipients.
 */
export function estimateBatchFee(recipientCount: number, baseFee = 100): string {
  return (baseFee * recipientCount).toString();
}
