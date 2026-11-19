// SPDX-License-Identifier: MIT

/**
 * Pure fee calculation for OphirPay payments (issue #1402).
 *
 * The calculator is deliberately integer-only: every amount is a Stellar
 * stroop (`bigint`), and the result is always a whole number of stroops.
 * Floating point is never involved, so a caller cannot produce `NaN`,
 * `Infinity`, or a fee that silently drifts by one stroop as an amount grows
 * past `Number.MAX_SAFE_INTEGER`.
 *
 * The fee has three components:
 *
 *   1. a percentage of the payment (`feeBps`, basis points);
 *   2. a flat base reserve in stroops; and
 *   3. an optional volume discount applied to the percentage component.
 *
 * The total is then clamped to the configured minimum and maximum. Exempt
 * accounts pay nothing at all, including the flat reserve.
 */

/** One basis point is 1/10,000 (0.01%). */
export const BPS_DENOMINATOR = BigInt(10_000);

/**
 * A volume discount tier.
 *
 * Tiers are evaluated in ascending `minVolumeStroops` order. A payment whose
 * trailing volume is exactly equal to a tier's threshold belongs to that tier
 * — the boundary is inclusive.
 */
export interface VolumeTier {
  /** Human-readable tier name, surfaced in receipts and analytics. */
  name: string;
  /** Minimum trailing volume, in stroops, required for this tier. */
  minVolumeStroops: bigint;
  /** Discount off the percentage component, in basis points. */
  discountBps: number;
}

/** Fee policy for a tenant, asset, or operation type. */
export interface FeeSchedule {
  /** Percentage fee in basis points (0–10,000). */
  feeBps: number;
  /** Flat fee added to every non-exempt payment, in stroops. */
  baseReserveStroops: bigint;
  /** Minimum fee charged for a non-exempt payment, in stroops. */
  minFeeStroops: bigint;
  /** Maximum fee charged, in stroops, or `null` for no cap. */
  maxFeeStroops: bigint | null;
  /** Optional volume-discount tiers, ascending by threshold. */
  tiers?: readonly VolumeTier[];
  /** Accounts that are fully exempt from fees. */
  exemptAccounts?: readonly string[];
}

/** Input for a single fee calculation. */
export interface FeeCalculationInput {
  /** Payment amount in stroops. Non-positive amounts are free. */
  amountStroops: bigint;
  /** Trailing volume in stroops used to pick a discount tier. Defaults to 0. */
  volumeStroops?: bigint;
  /** Payer account, matched exactly against `exemptAccounts`. */
  account?: string | null;
}

/** Every intermediate value behind a quoted fee, for receipts and tests. */
export interface FeeBreakdown {
  /** Final fee in stroops. */
  feeStroops: bigint;
  /** Percentage component after the volume discount, before the flat fee. */
  percentageFeeStroops: bigint;
  /** Percentage component before the volume discount. */
  undiscountedPercentageFeeStroops: bigint;
  /** Flat base reserve included in the total. */
  baseReserveStroops: bigint;
  /** Discount applied to the percentage component, in basis points. */
  discountBps: number;
  /** Selected volume tier name (or `"standard"`). */
  tier: string;
  /** True when the minimum-fee floor raised the total. */
  minimumApplied: boolean;
  /** True when the maximum-fee cap lowered the total. */
  capApplied: boolean;
  /** True when the payer was exempt and the fee is zero. */
  exempt: boolean;
  /** True when the amount was non-positive and the fee is zero. */
  nonPositiveAmount: boolean;
}

/**
 * Default policy: 0.5% + 100 stroops, floored at 100 stroops and capped at
 * 50 XLM. Volume discounts switch at 10k / 50k / 100k XLM.
 */
export const DEFAULT_FEE_SCHEDULE: FeeSchedule = {
  feeBps: 50,
  baseReserveStroops: BigInt(100),
  minFeeStroops: BigInt(100),
  maxFeeStroops: BigInt(500_000_000),
  tiers: [
    {
      name: "standard",
      minVolumeStroops: BigInt(0),
      discountBps: 0,
    },
    {
      name: "gold",
      minVolumeStroops: BigInt(10_000) * BigInt(10_000_000),
      discountBps: 1_000,
    },
    {
      name: "platinum",
      minVolumeStroops: BigInt(50_000) * BigInt(10_000_000),
      discountBps: 2_500,
    },
    {
      name: "enterprise",
      minVolumeStroops: BigInt(100_000) * BigInt(10_000_000),
      discountBps: 5_000,
    },
  ],
  exemptAccounts: [],
};

/**
 * Validate a schedule before using it.
 *
 * Invalid policies throw a `RangeError` rather than silently quoting a
 * nonsensical fee: a corrupted `maxFeeStroops` below `minFeeStroops` would
 * otherwise make the clamp order decide the result, and an unsorted tier list
 * would make the boundary behaviour depend on array order.
 */
export function assertValidFeeSchedule(schedule: FeeSchedule): void {
  if (
    !Number.isInteger(schedule.feeBps) ||
    schedule.feeBps < 0 ||
    schedule.feeBps > 10_000
  ) {
    throw new RangeError("feeBps must be an integer between 0 and 10000");
  }
  if (
    typeof schedule.baseReserveStroops !== "bigint" ||
    schedule.baseReserveStroops < BigInt(0)
  ) {
    throw new RangeError("baseReserveStroops must be a non-negative bigint");
  }
  if (
    typeof schedule.minFeeStroops !== "bigint" ||
    schedule.minFeeStroops < BigInt(0)
  ) {
    throw new RangeError("minFeeStroops must be a non-negative bigint");
  }
  if (
    schedule.maxFeeStroops !== null &&
    (typeof schedule.maxFeeStroops !== "bigint" ||
      schedule.maxFeeStroops < schedule.minFeeStroops)
  ) {
    throw new RangeError(
      "maxFeeStroops must be null or a bigint greater than or equal to minFeeStroops",
    );
  }

  let previousThreshold = BigInt(-1);
  for (const tier of schedule.tiers ?? []) {
    if (
      !Number.isInteger(tier.discountBps) ||
      tier.discountBps < 0 ||
      tier.discountBps > 10_000
    ) {
      throw new RangeError(
        "tier discountBps must be an integer between 0 and 10000",
      );
    }
    if (
      typeof tier.minVolumeStroops !== "bigint" ||
      tier.minVolumeStroops < BigInt(0)
    ) {
      throw new RangeError("tier minVolumeStroops must be non-negative");
    }
    if (tier.minVolumeStroops <= previousThreshold) {
      throw new RangeError(
        "tiers must be sorted in strictly ascending minVolumeStroops order",
      );
    }
    previousThreshold = tier.minVolumeStroops;
  }
}

/** Select the highest tier whose threshold the volume reaches. */
function selectTier(
  tiers: readonly VolumeTier[],
  volumeStroops: bigint,
): VolumeTier | null {
  let selected: VolumeTier | null = null;
  for (const tier of tiers) {
    if (volumeStroops < tier.minVolumeStroops) break;
    selected = tier;
  }
  return selected;
}

/**
 * Calculate a fee for one payment.
 *
 * Rounding rules:
 *   • The percentage component rounds **up** to the next stroop, so a
 *     sub-stroop platform fee is never silently waived.
 *   • The volume discount rounds **down**, i.e. the payer keeps the benefit of
 *     any fractional stroop in the discount.
 *   • The flat reserve is added after the discount and is not discounted.
 *
 * @throws {RangeError} when the schedule is invalid.
 */
export function calculateFee(
  input: FeeCalculationInput,
  schedule: FeeSchedule = DEFAULT_FEE_SCHEDULE,
): FeeBreakdown {
  assertValidFeeSchedule(schedule);

  const zero = (overrides: Partial<FeeBreakdown>): FeeBreakdown => ({
    feeStroops: BigInt(0),
    percentageFeeStroops: BigInt(0),
    undiscountedPercentageFeeStroops: BigInt(0),
    baseReserveStroops: BigInt(0),
    discountBps: 0,
    tier: "standard",
    minimumApplied: false,
    capApplied: false,
    exempt: false,
    nonPositiveAmount: false,
    ...overrides,
  });

  if (input.amountStroops <= BigInt(0)) {
    return zero({ nonPositiveAmount: true });
  }

  const account = input.account?.trim();
  const exempt = Boolean(
    account && schedule.exemptAccounts?.includes(account),
  );
  if (exempt) {
    return zero({ exempt: true });
  }

  const tier = selectTier(schedule.tiers ?? [], input.volumeStroops ?? BigInt(0));
  const discountBps = tier?.discountBps ?? 0;

  const numerator = input.amountStroops * BigInt(schedule.feeBps);
  const undiscountedPercentageFeeStroops =
    (numerator + BPS_DENOMINATOR - BigInt(1)) / BPS_DENOMINATOR;
  const percentageFeeStroops =
    (undiscountedPercentageFeeStroops *
      BigInt(BPS_DENOMINATOR - BigInt(discountBps))) /
    BPS_DENOMINATOR;

  const subtotal = percentageFeeStroops + schedule.baseReserveStroops;

  let feeStroops = subtotal;
  let minimumApplied = false;
  if (feeStroops < schedule.minFeeStroops) {
    feeStroops = schedule.minFeeStroops;
    minimumApplied = true;
  }

  let capApplied = false;
  if (
    schedule.maxFeeStroops !== null &&
    feeStroops > schedule.maxFeeStroops
  ) {
    feeStroops = schedule.maxFeeStroops;
    capApplied = true;
  }

  return {
    feeStroops,
    percentageFeeStroops,
    undiscountedPercentageFeeStroops,
    baseReserveStroops: schedule.baseReserveStroops,
    discountBps,
    tier: tier?.name ?? "standard",
    minimumApplied,
    capApplied,
    exempt: false,
    nonPositiveAmount: false,
  };
}

/** Convenience wrapper for callers that only need the final stroop count. */
export function calculateFeeStroops(
  input: FeeCalculationInput,
  schedule: FeeSchedule = DEFAULT_FEE_SCHEDULE,
): bigint {
  return calculateFee(input, schedule).feeStroops;
}
