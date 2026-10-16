// SPDX-License-Identifier: MIT

/**
 * Fee calculation and discount tier rules for OphirPay (Issue #1402).
 *
 * Provides deterministic, lossless fee calculations with support for:
 * - Basis points percentages (1 bps = 0.01%)
 * - Volume-based discount tiers with exact threshold switching
 * - Flat fees and base reserves
 * - Minimum fee floors and maximum fee caps
 * - Fractional stroop rounding without floating-point drift
 * - Fee-exempt accounts
 * - Full protection against NaN, arithmetic panics, and negative inputs
 */

import { STROOPS_PER_XLM, formatXlmAmount } from "@/lib/stellar-amount";

/** Standard 1 XLM = 10,000,000 stroops */
export const STROOP_PRECISION = STROOPS_PER_XLM;

/** Maximum allowed fee in basis points (1000 bps = 10%) */
export const MAX_ALLOWED_FEE_BPS = 1000;

/** Default base transaction fee in basis points (50 bps = 0.5%) */
export const DEFAULT_BASE_FEE_BPS = 50;

/** Default minimum fee in stroops (0.0000100 XLM = 100 stroops) */
export const DEFAULT_MIN_FEE_STROOPS = BigInt(100);

/** Default maximum fee cap in stroops (50 XLM = 500,000,000 stroops) */
export const DEFAULT_MAX_FEE_CAP_STROOPS = BigInt(500_000_000);

/**
 * Volume discount tier definition.
 * Threshold is denominated in stroops (or base units).
 * Discount is in basis points of the fee (e.g. 1000 bps = 10% discount).
 */
export interface VolumeTier {
  readonly tier: number;
  readonly name: string;
  readonly thresholdStroops: bigint;
  readonly discountBps: number;
}

/**
 * Standard volume discount tiers.
 * Tier switch occurs at exactly 10,000 XLM ($10,000 equivalent).
 */
export const VOLUME_DISCOUNT_TIERS: readonly VolumeTier[] = [
  {
    tier: 0,
    name: "Standard",
    thresholdStroops: BigInt(0),
    discountBps: 0, // 0% discount
  },
  {
    tier: 1,
    name: "Tier 1 ($10k+)",
    thresholdStroops: BigInt(10_000) * STROOPS_PER_XLM, // 10,000 XLM
    discountBps: 1000, // 10% discount
  },
  {
    tier: 2,
    name: "Tier 2 ($50k+)",
    thresholdStroops: BigInt(50_000) * STROOPS_PER_XLM, // 50,000 XLM
    discountBps: 2000, // 20% discount
  },
  {
    tier: 3,
    name: "Tier 3 ($250k+)",
    thresholdStroops: BigInt(250_000) * STROOPS_PER_XLM, // 250,000 XLM
    discountBps: 3500, // 35% discount
  },
] as const;

/** Rounding strategy for fractional stroop calculations */
export type RoundingMode = "round" | "ceil" | "floor";

export interface FeeCalculationOptions {
  /** Transaction amount in stroops or XLM string/number */
  amount: bigint | number | string;
  /** Custom base fee in basis points (defaults to 50 bps) */
  baseFeeBps?: number;
  /** Optional flat fee in stroops to add (e.g. base reserve) */
  flatFeeStroops?: bigint | number | string;
  /** 30-day cumulative volume in stroops or XLM string/number */
  monthlyVolumeStroops?: bigint | number | string;
  /** Whether this account is exempt from all fees */
  isExempt?: boolean;
  /** Explicit minimum fee floor in stroops (defaults to 100 stroops) */
  minFeeStroops?: bigint | number | string | null;
  /** Explicit maximum fee cap in stroops (defaults to 50 XLM) */
  maxFeeCapStroops?: bigint | number | string | null;
  /** Rounding mode for fractional stroops (default: 'round') */
  roundingMode?: RoundingMode;
  /** Custom volume discount tiers (defaults to VOLUME_DISCOUNT_TIERS) */
  tiers?: readonly VolumeTier[];
}

export interface FeeCalculationResult {
  /** Gross payment amount in stroops */
  amountStroops: bigint;
  /** Calculated total fee in stroops */
  feeStroops: bigint;
  /** Net amount received after fee deduction */
  netAmountStroops: bigint;
  /** Base fee before volume discount, in basis points */
  baseFeeBps: number;
  /** Effective percentage fee applied after discount, in basis points */
  effectiveBps: number;
  /** Volume discount tier applied (0-3) */
  tier: number;
  /** Name of the discount tier applied */
  tierName: string;
  /** Discount percentage applied to the base fee (0 - 100) */
  discountPercent: number;
  /** Flat fee component included */
  flatFeeStroops: bigint;
  /** Percentage fee component before floor/cap adjustments */
  percentageFeeStroops: bigint;
  /** Whether the fee was zeroed due to exemption */
  isExempt: boolean;
  /** Whether the fee was capped by maxFeeCap */
  isCapped: boolean;
  /** Whether the fee was elevated by minFee floor */
  isFloor: boolean;
  /** Formatted fee in XLM decimal string */
  formattedFee: string;
  /** Formatted net amount in XLM decimal string */
  formattedNetAmount: string;
}

/**
 * Safely parse any input amount into a non-negative BigInt stroop value.
 * Returns BigInt(0) for negative, NaN, null, or malformed inputs without throwing.
 */
export function toStroopsSafe(value: bigint | number | string | null | undefined): bigint {
  if (value === null || value === undefined) {
    return BigInt(0);
  }

  if (typeof value === "bigint") {
    return value < BigInt(0) ? BigInt(0) : value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value) || Number.isNaN(value) || value <= 0) {
      return BigInt(0);
    }
    // Convert float to integer stroops safely
    return BigInt(Math.floor(value));
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed.startsWith("-")) {
      return BigInt(0);
    }
    // Check if integer
    if (/^\d+$/.test(trimmed)) {
      try {
        return BigInt(trimmed);
      } catch {
        return BigInt(0);
      }
    }
    // Check if decimal XLM string
    const match = /^(\d+)(?:\.(\d{0,7}))?$/.exec(trimmed);
    if (match) {
      try {
        const whole = BigInt(match[1]) * STROOPS_PER_XLM;
        const frac = BigInt((match[2] ?? "").padEnd(7, "0") || "0");
        return whole + frac;
      } catch {
        return BigInt(0);
      }
    }
  }

  return BigInt(0);
}

/**
 * Resolve the applicable volume discount tier based on cumulative volume.
 */
export function resolveVolumeTier(
  volumeStroops: bigint,
  tiers: readonly VolumeTier[] = VOLUME_DISCOUNT_TIERS
): VolumeTier {
  const safeVolume = volumeStroops < BigInt(0) ? BigInt(0) : volumeStroops;
  const sorted = [...tiers].sort((a, b) => {
    if (a.thresholdStroops < b.thresholdStroops) return -1;
    if (a.thresholdStroops > b.thresholdStroops) return 1;
    return 0;
  });

  let matched: VolumeTier = sorted[0] ?? VOLUME_DISCOUNT_TIERS[0];
  for (const t of sorted) {
    if (safeVolume >= t.thresholdStroops) {
      matched = t;
    } else {
      break;
    }
  }

  return matched;
}

/**
 * Divide BigInt with deterministic rounding without floating-point drift.
 */
export function divideBigIntWithRounding(
  numerator: bigint,
  denominator: bigint,
  mode: RoundingMode = "round"
): bigint {
  if (denominator === BigInt(0)) {
    return BigInt(0);
  }
  if (numerator <= BigInt(0)) {
    return BigInt(0);
  }

  const quotient = numerator / denominator;
  const remainder = numerator % denominator;

  if (remainder === BigInt(0)) {
    return quotient;
  }

  switch (mode) {
    case "floor":
      return quotient;
    case "ceil":
      return quotient + BigInt(1);
    case "round":
    default: {
      // Round half-up: remainder * 2 >= denominator -> round up
      return remainder * BigInt(2) >= denominator
        ? quotient + BigInt(1)
        : quotient;
    }
  }
}

/**
 * Calculate the transaction fee for a given amount and configuration.
 * Fully deterministic, zero floating-point rounding drift, zero NaN/panics.
 */
export function calculateFee(options: FeeCalculationOptions): FeeCalculationResult {
  const amountStroops = toStroopsSafe(options.amount);
  const flatFeeStroops = toStroopsSafe(options.flatFeeStroops);
  const volumeStroops = toStroopsSafe(options.monthlyVolumeStroops);
  const isExempt = Boolean(options.isExempt);
  const roundingMode = options.roundingMode ?? "round";

  // Validate and clamp base fee bps
  const rawBaseBps = options.baseFeeBps ?? DEFAULT_BASE_FEE_BPS;
  const baseFeeBps = Number.isFinite(rawBaseBps)
    ? Math.max(0, Math.min(MAX_ALLOWED_FEE_BPS, Math.floor(rawBaseBps)))
    : DEFAULT_BASE_FEE_BPS;

  // Resolve volume discount tier
  const tier = resolveVolumeTier(volumeStroops, options.tiers);
  const discountPercent = tier.discountBps / 100;

  // Calculate effective fee in basis points
  // effectiveBps = baseFeeBps * (10000 - discountBps) / 10000
  const effectiveBps = Math.max(
    0,
    Math.round((baseFeeBps * (10_000 - tier.discountBps)) / 10_000)
  );

  // If amount is 0 or account is exempt, fee is zero
  if (amountStroops === BigInt(0) || isExempt) {
    return {
      amountStroops,
      feeStroops: BigInt(0),
      netAmountStroops: amountStroops,
      baseFeeBps,
      effectiveBps: isExempt ? 0 : effectiveBps,
      tier: tier.tier,
      tierName: tier.name,
      discountPercent: isExempt ? 100 : discountPercent,
      flatFeeStroops: BigInt(0),
      percentageFeeStroops: BigInt(0),
      isExempt,
      isCapped: false,
      isFloor: false,
      formattedFee: "0",
      formattedNetAmount: formatXlmAmount(amountStroops),
    };
  }

  // Calculate percentage fee in stroops using exact integer arithmetic:
  // percentageFee = (amountStroops * effectiveBps) / 10,000
  const numerator = amountStroops * BigInt(effectiveBps);
  const percentageFeeStroops = divideBigIntWithRounding(
    numerator,
    BigInt(10_000),
    roundingMode
  );

  let rawTotalFee = percentageFeeStroops + flatFeeStroops;

  // Apply minimum fee floor (if defined and positive)
  const minFeeFloor =
    options.minFeeStroops === null
      ? BigInt(0)
      : options.minFeeStroops !== undefined
        ? toStroopsSafe(options.minFeeStroops)
        : DEFAULT_MIN_FEE_STROOPS;

  let isFloor = false;
  if (minFeeFloor > BigInt(0) && rawTotalFee < minFeeFloor) {
    rawTotalFee = minFeeFloor;
    isFloor = true;
  }

  // Apply maximum fee cap (if defined and positive)
  const maxFeeCap =
    options.maxFeeCapStroops === null
      ? BigInt(0)
      : options.maxFeeCapStroops !== undefined
        ? toStroopsSafe(options.maxFeeCapStroops)
        : DEFAULT_MAX_FEE_CAP_STROOPS;

  let isCapped = false;
  if (maxFeeCap > BigInt(0) && rawTotalFee > maxFeeCap) {
    rawTotalFee = maxFeeCap;
    isCapped = true;
  }

  // Ensure fee never exceeds the total amount
  if (rawTotalFee > amountStroops) {
    rawTotalFee = amountStroops;
  }

  const netAmountStroops = amountStroops - rawTotalFee;

  return {
    amountStroops,
    feeStroops: rawTotalFee,
    netAmountStroops,
    baseFeeBps,
    effectiveBps,
    tier: tier.tier,
    tierName: tier.name,
    discountPercent,
    flatFeeStroops,
    percentageFeeStroops,
    isExempt: false,
    isCapped,
    isFloor,
    formattedFee: formatXlmAmount(rawTotalFee),
    formattedNetAmount: formatXlmAmount(netAmountStroops),
  };
}
