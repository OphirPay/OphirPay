// SPDX-License-Identifier: MIT

import { MAX_FEE_BPS } from "@/lib/fee-config";

/** Stellar asset precision: 7 decimal places (1 XLM = 10^7 stroops). */
export const STELLAR_DECIMALS = 7;
export const STROOPS_PER_UNIT = 10_000_000;

/** Default protocol fee in basis points (0.50% = 50 bps). */
export const DEFAULT_PAYMENT_FEE_BPS = 50;

export type DiscountTierName =
  | "exempt"
  | "standard"
  | "growth"
  | "scale"
  | "enterprise";

export interface VolumeDiscountTier {
  name: Exclude<DiscountTierName, "exempt">;
  /** Minimum 30-day volume (inclusive) in USD/asset units to qualify. */
  minVolume: number;
  /** Percentage discount applied to the base fee bps (0..100). */
  discountPercent: number;
}

/**
 * Canonical volume discount schedule.
 * Boundary tiers:
 * - standard:   $0.00       – $9,999.99   (0% discount)
 * - growth:     $10,000.00  – $49,999.99  (20% discount)
 * - scale:      $50,000.00  – $249,999.99 (40% discount)
 * - enterprise: $250,000.00+              (60% discount)
 */
export const VOLUME_DISCOUNT_TIERS: readonly VolumeDiscountTier[] = [
  { name: "enterprise", minVolume: 250_000, discountPercent: 60 },
  { name: "scale", minVolume: 50_000, discountPercent: 40 },
  { name: "growth", minVolume: 10_000, discountPercent: 20 },
  { name: "standard", minVolume: 0, discountPercent: 0 },
] as const;

export interface FeeCalculationInput {
  /** Payment amount in asset units (must be finite and >= 0). */
  amount: number;
  /** Base fee rate in basis points (0..1000). Defaults to 50 bps (0.50%). */
  baseFeeBps?: number;
  /** Rolling 30-day volume in USD/asset units used to select discount tier. */
  monthlyVolume?: number;
  /** Optional maximum fee cap in asset units (must be >= 0 when provided). */
  maxFeeCap?: number;
  /** Explicit fee-exempt flag for the payer/destination account. */
  isExempt?: boolean;
  /** Payer Stellar account address to check against `exemptAccounts`. */
  accountAddress?: string;
  /** Allowlist of fee-exempt Stellar account addresses. */
  exemptAccounts?: Iterable<string>;
  /** Global fee switch; when false, all fees evaluate to 0. */
  feeEnabled?: boolean;
  /** Decimal precision for rounding (defaults to 7 for Stellar assets). */
  decimals?: number;
}

export interface FeeCalculationResult {
  grossAmount: number;
  feeAmount: number;
  netAmount: number;
  baseFeeBps: number;
  effectiveFeeBps: number;
  discountPercent: number;
  tier: DiscountTierName;
  capped: boolean;
  exempt: boolean;
}

/**
 * Round a non-negative number to the specified decimal precision using
 * half-up integer math to avoid IEEE-754 floating-point drift.
 */
export function roundToPrecision(
  value: number,
  decimals: number = STELLAR_DECIMALS
): number {
  if (!Number.isFinite(value)) {
    throw new RangeError("value must be a finite number");
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 12) {
    throw new RangeError("decimals must be an integer between 0 and 12");
  }
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * Resolve the volume discount tier for a given 30-day volume.
 */
export function resolveDiscountTier(monthlyVolume: number = 0): VolumeDiscountTier {
  if (!Number.isFinite(monthlyVolume) || monthlyVolume < 0) {
    throw new RangeError("monthlyVolume must be a finite non-negative number");
  }
  for (const tier of VOLUME_DISCOUNT_TIERS) {
    if (monthlyVolume >= tier.minVolume) {
      return tier;
    }
  }
  return VOLUME_DISCOUNT_TIERS[VOLUME_DISCOUNT_TIERS.length - 1];
}

/**
 * Check whether an account is exempt from protocol fees.
 */
export function isAccountFeeExempt(options: {
  isExempt?: boolean;
  accountAddress?: string;
  exemptAccounts?: Iterable<string>;
  feeEnabled?: boolean;
}): boolean {
  if (options.feeEnabled === false) return true;
  if (options.isExempt === true) return true;
  if (options.accountAddress && options.exemptAccounts) {
    const normalized = options.accountAddress.trim().toUpperCase();
    for (const addr of options.exemptAccounts) {
      if (addr.trim().toUpperCase() === normalized) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Calculate the protocol fee, effective basis points, discount tier, and net
 * settlement amount for a single payment.
 */
export function calculatePaymentFee(
  input: FeeCalculationInput
): FeeCalculationResult {
  const {
    amount,
    baseFeeBps = DEFAULT_PAYMENT_FEE_BPS,
    monthlyVolume = 0,
    maxFeeCap,
    isExempt,
    accountAddress,
    exemptAccounts,
    feeEnabled = true,
    decimals = STELLAR_DECIMALS,
  } = input;

  if (!Number.isFinite(amount) || amount < 0) {
    throw new RangeError("amount must be a finite non-negative number");
  }
  if (!Number.isFinite(baseFeeBps) || baseFeeBps < 0 || baseFeeBps > MAX_FEE_BPS) {
    throw new RangeError(
      `baseFeeBps must be between 0 and ${MAX_FEE_BPS} basis points`
    );
  }
  if (maxFeeCap !== undefined && (!Number.isFinite(maxFeeCap) || maxFeeCap < 0)) {
    throw new RangeError("maxFeeCap must be a finite non-negative number");
  }

  const grossAmount = roundToPrecision(amount, decimals);
  const exempt = isAccountFeeExempt({
    isExempt,
    accountAddress,
    exemptAccounts,
    feeEnabled,
  });

  if (exempt) {
    return {
      grossAmount,
      feeAmount: 0,
      netAmount: grossAmount,
      baseFeeBps,
      effectiveFeeBps: 0,
      discountPercent: 100,
      tier: "exempt",
      capped: false,
      exempt: true,
    };
  }

  const tierInfo = resolveDiscountTier(monthlyVolume);
  const effectiveFeeBps = roundToPrecision(
    baseFeeBps * (1 - tierInfo.discountPercent / 100),
    4
  );

  if (grossAmount === 0 || effectiveFeeBps === 0) {
    return {
      grossAmount,
      feeAmount: 0,
      netAmount: grossAmount,
      baseFeeBps,
      effectiveFeeBps,
      discountPercent: tierInfo.discountPercent,
      tier: tierInfo.name,
      capped: false,
      exempt: false,
    };
  }

  let feeAmount = roundToPrecision(
    (grossAmount * effectiveFeeBps) / 10_000,
    decimals
  );
  let capped = false;

  if (maxFeeCap !== undefined) {
    const normalizedCap = roundToPrecision(maxFeeCap, decimals);
    if (feeAmount > normalizedCap) {
      feeAmount = normalizedCap;
      capped = true;
    }
  }

  // Fee can never exceed gross amount
  if (feeAmount > grossAmount) {
    feeAmount = grossAmount;
    capped = true;
  }

  const netAmount = roundToPrecision(grossAmount - feeAmount, decimals);

  return {
    grossAmount,
    feeAmount,
    netAmount,
    baseFeeBps,
    effectiveFeeBps,
    discountPercent: tierInfo.discountPercent,
    tier: tierInfo.name,
    capped,
    exempt: false,
  };
}
