// SPDX-License-Identifier: MIT

/**
 * Fee calculation and discount tier rules for OphirPay payment processing.
 * Handles fee percentages (bps), flat network fees, volume discount tiers,
 * account exemptions, and strict stroop-precision arithmetic (issue #1402).
 */

export const STROOPS_PER_XLM = BigInt(10_000_000);
export const BPS_DIVISOR = BigInt(10_000);

/** Standard default transaction fee: 30 bps (0.30%) */
export const DEFAULT_FEE_BPS = 30;

/** Default base network reserve / flat fee per operation: 100 stroops (0.00001 XLM) */
export const DEFAULT_FLAT_FEE_STROOPS = BigInt(100);

/** Default minimum fee floor: 100 stroops */
export const DEFAULT_MIN_FEE_STROOPS = BigInt(100);

/** Default maximum fee cap: 500 XLM = 5,000,000,000 stroops */
export const DEFAULT_MAX_FEE_STROOPS = BigInt("5000000000");

export interface VolumeDiscountTier {
  readonly minVolumeUsd: number;
  readonly discountBps: number;
  readonly name: string;
}

/**
 * Standard 30-day cumulative volume discount tiers.
 * Higher trading volume reduces the variable basis-point fee.
 */
export const DEFAULT_VOLUME_TIERS: readonly VolumeDiscountTier[] = [
  { minVolumeUsd: 100_000, discountBps: 5000, name: "Enterprise (50% off)" },
  { minVolumeUsd: 50_000, discountBps: 2500, name: "Platinum (25% off)" },
  { minVolumeUsd: 10_000, discountBps: 1000, name: "Gold (10% off)" },
  { minVolumeUsd: 0, discountBps: 0, name: "Standard (0% off)" },
] as const;

export interface FeeCalculationParams {
  /** Transaction amount in stroops (1 XLM = 10^7 stroops). Must be non-negative integer. */
  amountStroops: bigint | number | string;
  /** Fee basis points (e.g. 30 = 0.30%, 100 = 1.00%). Defaults to 30 bps. */
  feeBps?: number;
  /** Fixed flat fee in stroops. Defaults to 100 stroops. */
  flatFeeStroops?: bigint | number | string;
  /** Payer or merchant account address for fee exemption checks. */
  account?: string;
  /** Set or list of fee-exempt accounts (e.g. protocol vaults, fee collectors). */
  exemptAccounts?: Iterable<string>;
  /** 30-day rolling transaction volume in USD equivalent. */
  userVolumeUsd?: number;
  /** Custom discount tiers replacing the defaults. */
  customTiers?: readonly VolumeDiscountTier[];
  /** Minimum fee threshold in stroops. Set to 0 to disable floor. */
  minFeeStroops?: bigint | number | string;
  /** Maximum fee cap in stroops. Defaults to 500 XLM. */
  maxFeeStroops?: bigint | number | string;
}

export interface FeeCalculationResult {
  /** Total fee charged in stroops (flat + discounted variable fee clamped to min/max). */
  totalFeeStroops: bigint;
  /** Gross variable fee before volume discounts in stroops. */
  grossVariableFeeStroops: bigint;
  /** Final variable fee after volume discounts in stroops. */
  variableFeeStroops: bigint;
  /** Flat fee component in stroops. */
  flatFeeStroops: bigint;
  /** Percentage discount applied to variable fee in basis points. */
  discountAppliedBps: number;
  /** Absolute discount amount saved in stroops. */
  discountAmountStroops: bigint;
  /** Effective total fee rate in basis points relative to gross amount. */
  effectiveRateBps: number;
  /** Whether the account qualified for 100% fee exemption. */
  isExempt: boolean;
  /** Name of the active volume discount tier. */
  tierName: string;
  /** Total fee formatted as human-readable XLM decimal string (7 decimals). */
  totalFeeXlm: string;
  /** Net amount received after fee deduction (amount - totalFee) in stroops. */
  netAmountStroops: bigint;
  /** Net amount formatted as human-readable XLM decimal string. */
  netAmountXlm: string;
}

/**
 * Format bigint stroops into exact decimal XLM string with 7 decimal places.
 */
export function stroopsToXlm(stroops: bigint): string {
  const isNegative = stroops < BigInt(0);
  const abs = isNegative ? -stroops : stroops;
  const integerPart = abs / STROOPS_PER_XLM;
  const fractionPart = abs % STROOPS_PER_XLM;
  const paddedFraction = fractionPart.toString().padStart(7, "0");
  const result = `${integerPart}.${paddedFraction}`;
  return isNegative ? `-${result}` : result;
}

/**
 * Parse an input amount into validated BigInt stroops.
 * Rejects negative numbers, NaN, and invalid numeric strings.
 */
export function toBigIntStroops(val: bigint | number | string, paramName = "amount"): bigint {
  if (typeof val === "bigint") {
    if (val < BigInt(0)) {
      throw new RangeError(`${paramName} cannot be negative: ${val}`);
    }
    return val;
  }

  if (typeof val === "number") {
    if (Number.isNaN(val) || !Number.isFinite(val)) {
      throw new TypeError(`${paramName} must be a finite number: ${val}`);
    }
    if (val < 0) {
      throw new RangeError(`${paramName} cannot be negative: ${val}`);
    }
    return BigInt(Math.floor(val));
  }

  if (typeof val === "string") {
    const trimmed = val.trim();
    if (!/^\d+$/.test(trimmed)) {
      throw new TypeError(`${paramName} string must contain only digits: "${val}"`);
    }
    return BigInt(trimmed);
  }

  throw new TypeError(`Unsupported type for ${paramName}`);
}

/**
 * Resolve active volume discount tier based on 30-day cumulative USD volume.
 */
export function resolveDiscountTier(
  volumeUsd: number,
  tiers: readonly VolumeDiscountTier[] = DEFAULT_VOLUME_TIERS
): VolumeDiscountTier {
  if (Number.isNaN(volumeUsd) || !Number.isFinite(volumeUsd) || volumeUsd <= 0) {
    return tiers[tiers.length - 1] ?? { minVolumeUsd: 0, discountBps: 0, name: "Standard" };
  }

  // Tiers must be sorted descending by minVolumeUsd
  const sorted = [...tiers].sort((a, b) => b.minVolumeUsd - a.minVolumeUsd);
  for (const tier of sorted) {
    if (volumeUsd >= tier.minVolumeUsd) {
      return tier;
    }
  }

  return sorted[sorted.length - 1] ?? { minVolumeUsd: 0, discountBps: 0, name: "Standard" };
}

/**
 * Calculate precise transaction fee and discount tiers.
 * Guarantees zero NaN values, strict integer stroop rounding, and clamp enforcement.
 */
export function calculateFee(params: FeeCalculationParams): FeeCalculationResult {
  const amount = toBigIntStroops(params.amountStroops, "amountStroops");

  // Zero-amount edge case
  if (amount === BigInt(0)) {
    return {
      totalFeeStroops: BigInt(0),
      grossVariableFeeStroops: BigInt(0),
      variableFeeStroops: BigInt(0),
      flatFeeStroops: BigInt(0),
      discountAppliedBps: 0,
      discountAmountStroops: BigInt(0),
      effectiveRateBps: 0,
      isExempt: false,
      tierName: "Zero Amount",
      totalFeeXlm: "0.0000000",
      netAmountStroops: BigInt(0),
      netAmountXlm: "0.0000000",
    };
  }

  // Account exemption check
  let isExempt = false;
  if (params.account && params.exemptAccounts) {
    const accountLower = params.account.trim().toLowerCase();
    for (const exempt of params.exemptAccounts) {
      if (exempt.trim().toLowerCase() === accountLower) {
        isExempt = true;
        break;
      }
    }
  }

  if (isExempt) {
    return {
      totalFeeStroops: BigInt(0),
      grossVariableFeeStroops: BigInt(0),
      variableFeeStroops: BigInt(0),
      flatFeeStroops: BigInt(0),
      discountAppliedBps: 10_000,
      discountAmountStroops: BigInt(0),
      effectiveRateBps: 0,
      isExempt: true,
      tierName: "Exempt Account",
      totalFeeXlm: "0.0000000",
      netAmountStroops: amount,
      netAmountXlm: stroopsToXlm(amount),
    };
  }

  const feeBps = params.feeBps !== undefined ? params.feeBps : DEFAULT_FEE_BPS;
  if (typeof feeBps !== "number" || Number.isNaN(feeBps) || !Number.isFinite(feeBps) || feeBps < 0) {
    throw new RangeError(`feeBps must be a non-negative finite number: ${feeBps}`);
  }

  const flatFee =
    params.flatFeeStroops !== undefined
      ? toBigIntStroops(params.flatFeeStroops, "flatFeeStroops")
      : DEFAULT_FLAT_FEE_STROOPS;

  const minFee =
    params.minFeeStroops !== undefined
      ? toBigIntStroops(params.minFeeStroops, "minFeeStroops")
      : DEFAULT_MIN_FEE_STROOPS;

  const maxFee =
    params.maxFeeStroops !== undefined
      ? toBigIntStroops(params.maxFeeStroops, "maxFeeStroops")
      : DEFAULT_MAX_FEE_STROOPS;

  if (maxFee < minFee) {
    throw new RangeError(`maxFeeStroops (${maxFee}) cannot be smaller than minFeeStroops (${minFee})`);
  }

  // 1. Calculate Gross Variable Fee in stroops: ceil((amount * bps) / 10000)
  const bigBps = BigInt(Math.floor(feeBps));
  const variableProduct = amount * bigBps;
  // Fractional stroop ceiling rounding to protect protocol reserves
  const grossVariable =
    variableProduct === BigInt(0)
      ? BigInt(0)
      : (variableProduct + BPS_DIVISOR - BigInt(1)) / BPS_DIVISOR;

  // 2. Resolve Volume Tier Discount
  const tier = resolveDiscountTier(
    params.userVolumeUsd ?? 0,
    params.customTiers ?? DEFAULT_VOLUME_TIERS
  );

  const discountBps = BigInt(tier.discountBps);
  let discountAmount = BigInt(0);
  let netVariable = grossVariable;

  if (discountBps > BigInt(0) && grossVariable > BigInt(0)) {
    // Discount amount rounds down so user gets integer stroop savings
    discountAmount = (grossVariable * discountBps) / BPS_DIVISOR;
    netVariable = grossVariable - discountAmount;
  }

  // 3. Sum total raw fee (flat fee + net variable fee)
  let rawTotal = flatFee + netVariable;

  // 4. Enforce Floor and Ceiling clamps
  if (rawTotal < minFee) {
    rawTotal = minFee;
  }
  if (rawTotal > maxFee) {
    rawTotal = maxFee;
  }

  // Fee cannot exceed original amount to prevent negative balances
  const totalFee = rawTotal > amount ? amount : rawTotal;
  const netAmount = amount - totalFee;

  // Calculate effective fee rate in bps: (totalFee * 10000) / amount
  const effectiveBps = Number((totalFee * BPS_DIVISOR) / amount);

  return {
    totalFeeStroops: totalFee,
    grossVariableFeeStroops: grossVariable,
    variableFeeStroops: netVariable,
    flatFeeStroops: flatFee,
    discountAppliedBps: tier.discountBps,
    discountAmountStroops: discountAmount,
    effectiveRateBps: effectiveBps,
    isExempt: false,
    tierName: tier.name,
    totalFeeXlm: stroopsToXlm(totalFee),
    netAmountStroops: netAmount,
    netAmountXlm: stroopsToXlm(netAmount),
  };
}
