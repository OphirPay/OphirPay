// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import {
  BPS_DENOMINATOR,
  DEFAULT_FEE_SCHEDULE,
  assertValidFeeSchedule,
  calculateFee,
  calculateFeeStroops,
  type FeeSchedule,
  type VolumeTier,
} from "@/lib/fee-calculator";

const XLM = BigInt(10_000_000);

const schedule = (overrides: Partial<FeeSchedule> = {}): FeeSchedule => ({
  feeBps: 50,
  baseReserveStroops: BigInt(100),
  minFeeStroops: BigInt(100),
  maxFeeStroops: BigInt(500_000_000),
  tiers: [
    { name: "standard", minVolumeStroops: BigInt(0), discountBps: 0 },
    { name: "gold", minVolumeStroops: BigInt(10_000) * XLM, discountBps: 1_000 },
    { name: "platinum", minVolumeStroops: BigInt(50_000) * XLM, discountBps: 2_500 },
    { name: "enterprise", minVolumeStroops: BigInt(100_000) * XLM, discountBps: 5_000 },
  ],
  exemptAccounts: [],
  ...overrides,
});

describe("calculateFee — non-positive and exempt inputs", () => {
  it("charges nothing for a zero amount and never returns NaN", () => {
    const result = calculateFee({ amountStroops: BigInt(0) });
    expect(result.feeStroops).toBe(BigInt(0));
    expect(result.percentageFeeStroops).toBe(BigInt(0));
    expect(result.baseReserveStroops).toBe(BigInt(0));
    expect(result.nonPositiveAmount).toBe(true);
    expect(result.exempt).toBe(false);
    expect(result.discountBps).toBe(0);
    expect(result.tier).toBe("standard");
    expect(Number.isNaN(Number(result.feeStroops))).toBe(false);
  });

  it("charges nothing for a negative amount", () => {
    const result = calculateFee({ amountStroops: BigInt(-1) });
    expect(result.feeStroops).toBe(BigInt(0));
    expect(result.nonPositiveAmount).toBe(true);
  });

  it("waives every component for an exempt account (including the reserve)", () => {
    const result = calculateFee(
      {
        amountStroops: BigInt(1_000_000_000),
        account: "  GEXEMPTACCOUNT  ",
        volumeStroops: BigInt(100_000) * XLM,
      },
      schedule({ exemptAccounts: ["GEXEMPTACCOUNT"] }),
    );
    expect(result).toMatchObject({
      feeStroops: BigInt(0),
      percentageFeeStroops: BigInt(0),
      undiscountedPercentageFeeStroops: BigInt(0),
      baseReserveStroops: BigInt(0),
      discountBps: 0,
      tier: "standard",
      exempt: true,
      nonPositiveAmount: false,
    });
  });

  it("does not treat an account as exempt when the schedule has no list", () => {
    const result = calculateFee(
      { amountStroops: BigInt(1_000_000), account: "GNOTEXEMPT" },
      schedule({ exemptAccounts: undefined }),
    );
    expect(result.exempt).toBe(false);
    expect(result.feeStroops).toBeGreaterThan(BigInt(0));
  });

  it("does not treat an unlisted account as exempt", () => {
    const result = calculateFee(
      { amountStroops: BigInt(1_000_000), account: "GSOMEONEELSE" },
      schedule({ exemptAccounts: ["GEXEMPTACCOUNT"] }),
    );
    expect(result.exempt).toBe(false);
  });

  it("does not exempt a caller that supplies no account", () => {
    const result = calculateFee(
      { amountStroops: BigInt(1_000_000) },
      schedule({ exemptAccounts: ["GEXEMPTACCOUNT"] }),
    );
    expect(result.exempt).toBe(false);
  });
});

describe("calculateFee — arithmetic and rounding", () => {
  it("computes the documented 0.5% + 100 stroop fee exactly", () => {
    const result = calculateFee({ amountStroops: BigInt(1_000_000) });
    expect(result.undiscountedPercentageFeeStroops).toBe(BigInt(5_000));
    expect(result.percentageFeeStroops).toBe(BigInt(5_000));
    expect(result.baseReserveStroops).toBe(BigInt(100));
    expect(result.feeStroops).toBe(BigInt(5_100));
    expect(result.minimumApplied).toBe(false);
    expect(result.capApplied).toBe(false);
  });

  it("rounds a fractional percentage fee up to the next stroop", () => {
    // 333_333 × 150 bps = 4_999.995 stroops → 5_000, never 4_999.
    const result = calculateFee(
      { amountStroops: BigInt(333_333) },
      schedule({ feeBps: 150, baseReserveStroops: BigInt(0), minFeeStroops: BigInt(0) }),
    );
    expect(result.undiscountedPercentageFeeStroops).toBe(BigInt(5_000));
    expect(result.feeStroops).toBe(BigInt(5_000));
  });

  it("rounds a fractional volume discount down in the payer's favour", () => {
    // 1 stroop at 50 bps rounds up to 1; a 50% discount leaves 0.5 → 0.
    const result = calculateFee(
      { amountStroops: BigInt(1), volumeStroops: BigInt(10_000) * XLM },
      schedule({
        baseReserveStroops: BigInt(0),
        minFeeStroops: BigInt(0),
        maxFeeStroops: null,
      }),
    );
    expect(result.undiscountedPercentageFeeStroops).toBe(BigInt(1));
    expect(result.percentageFeeStroops).toBe(BigInt(0));
    expect(result.feeStroops).toBe(BigInt(0));
    expect(result.discountBps).toBe(1_000);
  });

  it("applies a 0 bps schedule without dropping the flat reserve", () => {
    const result = calculateFee(
      { amountStroops: BigInt(1_000_000) },
      schedule({ feeBps: 0 }),
    );
    expect(result.percentageFeeStroops).toBe(BigInt(0));
    expect(result.feeStroops).toBe(BigInt(100));
  });

  it("supports a zero flat reserve", () => {
    const result = calculateFee(
      { amountStroops: BigInt(1_000_000) },
      schedule({ baseReserveStroops: BigInt(0) }),
    );
    expect(result.baseReserveStroops).toBe(BigInt(0));
    expect(result.feeStroops).toBe(BigInt(5_000));
  });
});

describe("calculateFee — minimum and maximum clamps", () => {
  it("raises a sub-minimum fee to the floor", () => {
    const result = calculateFee(
      { amountStroops: BigInt(100) },
      schedule({
        feeBps: 50,
        baseReserveStroops: BigInt(0),
        minFeeStroops: BigInt(10),
      }),
    );
    // 100 × 0.5% = 0.5 → 1 stroop, then the 10-stroop floor applies.
    expect(result.percentageFeeStroops).toBe(BigInt(1));
    expect(result.feeStroops).toBe(BigInt(10));
    expect(result.minimumApplied).toBe(true);
  });

  it("does not flag the floor when the computed fee equals it", () => {
    const result = calculateFee(
      { amountStroops: BigInt(1_000_000) },
      schedule({ minFeeStroops: BigInt(5_100) }),
    );
    expect(result.feeStroops).toBe(BigInt(5_100));
    expect(result.minimumApplied).toBe(false);
  });

  it("caps a large fee at maxFeeStroops", () => {
    const result = calculateFee(
      { amountStroops: BigInt(1_000_000_000_000) },
      schedule({ maxFeeStroops: BigInt(1_000) }),
    );
    expect(result.feeStroops).toBe(BigInt(1_000));
    expect(result.capApplied).toBe(true);
  });

  it("does not flag the cap when the fee equals it", () => {
    const result = calculateFee(
      { amountStroops: BigInt(1_000_000) },
      schedule({ maxFeeStroops: BigInt(5_100) }),
    );
    expect(result.feeStroops).toBe(BigInt(5_100));
    expect(result.capApplied).toBe(false);
  });

  it("does not cap when maxFeeStroops is null", () => {
    const result = calculateFee(
      { amountStroops: BigInt(1_000_000_000_000) },
      schedule({ maxFeeStroops: null }),
    );
    expect(result.capApplied).toBe(false);
    expect(result.feeStroops).toBeGreaterThan(BigInt(5_100));
  });

  it("matches the maximum cap in the default schedule", () => {
    const result = calculateFee({ amountStroops: BigInt(10_000_000_000_000_000) });
    expect(result.feeStroops).toBe(DEFAULT_FEE_SCHEDULE.maxFeeStroops);
    expect(result.capApplied).toBe(true);
  });
});

describe("calculateFee — volume tiers", () => {
  it.each([
    [BigInt(0), "standard", 0],
    [BigInt(10_000) * XLM - BigInt(1), "standard", 0],
    [BigInt(10_000) * XLM, "gold", 1_000],
    [BigInt(49_999) * XLM, "gold", 1_000],
    [BigInt(50_000) * XLM, "platinum", 2_500],
    [BigInt(99_999) * XLM, "platinum", 2_500],
    [BigInt(100_000) * XLM, "enterprise", 5_000],
    [BigInt(250_000) * XLM, "enterprise", 5_000],
  ])("selects %s stroops of volume as %s", (volume, tier, discount) => {
    const result = calculateFee(
      { amountStroops: BigInt(1_000_000), volumeStroops: volume as bigint },
      schedule(),
    );
    expect(result.tier).toBe(tier);
    expect(result.discountBps).toBe(discount);
  });

  it("uses zero volume when none is supplied", () => {
    const result = calculateFee(
      { amountStroops: BigInt(1_000_000) },
      schedule({ tiers: undefined }),
    );
    expect(result.tier).toBe("standard");
    expect(result.discountBps).toBe(0);
  });

  it("keeps the flat reserve out of the volume discount", () => {
    const result = calculateFee(
      { amountStroops: BigInt(1_000_000), volumeStroops: BigInt(100_000) * XLM },
      schedule(),
    );
    // 5_000 percentage stroops × 50% discount = 2_500, plus 100 reserve.
    expect(result.percentageFeeStroops).toBe(BigInt(2_500));
    expect(result.feeStroops).toBe(BigInt(2_600));
  });

  it("falls back to standard when volume is below the first threshold", () => {
    const tiers: VolumeTier[] = [
      { name: "gold", minVolumeStroops: BigInt(10), discountBps: 1_000 },
    ];
    const result = calculateFee(
      { amountStroops: BigInt(1_000_000), volumeStroops: BigInt(9) },
      schedule({ tiers }),
    );
    expect(result.tier).toBe("standard");
    expect(result.discountBps).toBe(0);
  });

  it("falls back to standard when no tiers are configured", () => {
    const result = calculateFee(
      { amountStroops: BigInt(1_000_000), volumeStroops: BigInt(1_000_000) },
      schedule({ tiers: [] }),
    );
    expect(result.tier).toBe("standard");
  });

  it("selects the highest qualifying tier", () => {
    const result = calculateFee(
      { amountStroops: BigInt(1_000_000), volumeStroops: BigInt(1_000_000) },
      schedule({
        tiers: [
          { name: "standard", minVolumeStroops: BigInt(0), discountBps: 0 },
          { name: "silver", minVolumeStroops: BigInt(100), discountBps: 500 },
          { name: "gold", minVolumeStroops: BigInt(1_000), discountBps: 1_000 },
        ],
      }),
    );
    expect(result.tier).toBe("gold");
    expect(result.discountBps).toBe(1_000);
  });

  it("treats negative volume as below every configured threshold", () => {
    const result = calculateFee(
      { amountStroops: BigInt(1_000_000), volumeStroops: BigInt(-1) },
      schedule(),
    );
    expect(result.tier).toBe("standard");
  });
});

describe("calculateFeeStroops", () => {
  it("returns the final integer stroop count", () => {
    expect(calculateFeeStroops({ amountStroops: BigInt(1_000_000) })).toBe(
      BigInt(5_100),
    );
  });
});

describe("assertValidFeeSchedule", () => {
  it("accepts the default schedule", () => {
    expect(() => assertValidFeeSchedule(DEFAULT_FEE_SCHEDULE)).not.toThrow();
  });

  it("exports the basis-point denominator", () => {
    expect(BPS_DENOMINATOR).toBe(BigInt(10_000));
  });

  it.each([
    ["feeBps", { feeBps: 1.5 }],
    ["feeBps", { feeBps: -1 }],
    ["feeBps", { feeBps: 10_001 }],
    ["baseReserveStroops", { baseReserveStroops: 1 as unknown as bigint }],
    ["baseReserveStroops", { baseReserveStroops: BigInt(-1) }],
    ["minFeeStroops", { minFeeStroops: 1 as unknown as bigint }],
    ["minFeeStroops", { minFeeStroops: BigInt(-1) }],
    ["maxFeeStroops", { maxFeeStroops: 1 as unknown as bigint }],
    [
      "maxFeeStroops",
      { minFeeStroops: BigInt(100), maxFeeStroops: BigInt(99) },
    ],
  ])("rejects an invalid %s value", (_field, overrides) => {
    expect(() => assertValidFeeSchedule(schedule(overrides))).toThrow(
      RangeError,
    );
  });

  it.each([
    ["discountBps", { discountBps: 1.5 }],
    ["discountBps", { discountBps: -1 }],
    ["discountBps", { discountBps: 10_001 }],
    ["minVolumeStroops", { minVolumeStroops: 1 as unknown as bigint }],
    ["minVolumeStroops", { minVolumeStroops: BigInt(-1) }],
  ])("rejects an invalid tier %s value", (_field, tierOverrides) => {
    const tier = {
      name: "bad",
      minVolumeStroops: BigInt(0),
      discountBps: 0,
      ...tierOverrides,
    } as VolumeTier;
    expect(() =>
      assertValidFeeSchedule(schedule({ tiers: [tier] })),
    ).toThrow(RangeError);
  });

  it("rejects tiers that are not strictly ascending", () => {
    expect(() =>
      assertValidFeeSchedule(
        schedule({
          tiers: [
            { name: "a", minVolumeStroops: BigInt(10), discountBps: 0 },
            { name: "b", minVolumeStroops: BigInt(10), discountBps: 0 },
          ],
        }),
      ),
    ).toThrow(RangeError);
  });

  it("rejects descending tiers", () => {
    expect(() =>
      assertValidFeeSchedule(
        schedule({
          tiers: [
            { name: "a", minVolumeStroops: BigInt(20), discountBps: 0 },
            { name: "b", minVolumeStroops: BigInt(10), discountBps: 0 },
          ],
        }),
      ),
    ).toThrow(RangeError);
  });
});
