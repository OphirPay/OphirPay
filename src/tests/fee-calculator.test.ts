// SPDX-License-Identifier: MIT

/**
 * Unit test suite for fee calculation, boundary conditions, and discount tier rules.
 * Issue #1402 — 100% code coverage, stroop precision assertions, zero NaN returns.
 */

import { describe, it, expect } from "vitest";
import {
  calculateFee,
  resolveDiscountTier,
  stroopsToXlm,
  toBigIntStroops,
  DEFAULT_FEE_BPS,
  DEFAULT_FLAT_FEE_STROOPS,
  DEFAULT_MIN_FEE_STROOPS,
  DEFAULT_MAX_FEE_STROOPS,
  DEFAULT_VOLUME_TIERS,
  STROOPS_PER_XLM,
  BPS_DIVISOR,
  type VolumeDiscountTier,
} from "@/lib/fee-calculator";

describe("default fee constants (#1402)", () => {
  it("exposes expected protocol default values", () => {
    expect(DEFAULT_FEE_BPS).toBe(30);
    expect(DEFAULT_FLAT_FEE_STROOPS).toBe(BigInt(100));
    expect(DEFAULT_MIN_FEE_STROOPS).toBe(BigInt(100));
    expect(DEFAULT_MAX_FEE_STROOPS).toBe(BigInt("5000000000"));
    expect(DEFAULT_VOLUME_TIERS.length).toBeGreaterThan(0);
    expect(STROOPS_PER_XLM).toBe(BigInt(10_000_000));
    expect(BPS_DIVISOR).toBe(BigInt(10_000));
  });
});

describe("stroopsToXlm formatting (#1402)", () => {
  it("formats positive stroops into standard 7-decimal XLM strings", () => {
    expect(stroopsToXlm(BigInt(0))).toBe("0.0000000");
    expect(stroopsToXlm(BigInt(1))).toBe("0.0000001");
    expect(stroopsToXlm(BigInt(100))).toBe("0.0000100");
    expect(stroopsToXlm(BigInt(10_000_000))).toBe("1.0000000");
    expect(stroopsToXlm(BigInt(12_345_678))).toBe("1.2345678");
    expect(stroopsToXlm(BigInt("500000000000"))).toBe("50000.0000000");
  });

  it("handles negative stroops gracefully", () => {
    expect(stroopsToXlm(BigInt(-10_000_000))).toBe("-1.0000000");
    expect(stroopsToXlm(BigInt(-500))).toBe("-0.0000500");
  });
});

describe("toBigIntStroops input parsing (#1402)", () => {
  it("accepts valid BigInt values", () => {
    expect(toBigIntStroops(BigInt(1000))).toBe(BigInt(1000));
  });

  it("accepts valid positive numbers and floors decimals", () => {
    expect(toBigIntStroops(500)).toBe(BigInt(500));
    expect(toBigIntStroops(123.75)).toBe(BigInt(123));
  });

  it("accepts numeric strings", () => {
    expect(toBigIntStroops("10000000")).toBe(BigInt(10_000_000));
  });

  it("rejects negative numbers and BigInts", () => {
    expect(() => toBigIntStroops(BigInt(-1))).toThrow(RangeError);
    expect(() => toBigIntStroops(-50)).toThrow(RangeError);
  });

  it("rejects NaN, Infinity, and non-numeric strings", () => {
    expect(() => toBigIntStroops(Number.NaN)).toThrow(TypeError);
    expect(() => toBigIntStroops(Number.POSITIVE_INFINITY)).toThrow(TypeError);
    expect(() => toBigIntStroops("invalid-123")).toThrow(TypeError);
    expect(() => toBigIntStroops("12.34")).toThrow(TypeError);
    expect(() => toBigIntStroops({} as unknown as number)).toThrow(TypeError);
  });
});

describe("resolveDiscountTier volume boundary rules (#1402)", () => {
  it("defaults to standard tier for non-positive or invalid volumes", () => {
    expect(resolveDiscountTier(0).name).toContain("Standard");
    expect(resolveDiscountTier(-100).name).toContain("Standard");
    expect(resolveDiscountTier(Number.NaN).name).toContain("Standard");
    expect(resolveDiscountTier(Number.POSITIVE_INFINITY).name).toContain("Standard");
  });

  it("accurately classifies volume tier boundaries", () => {
    // Standard: < $10,000
    expect(resolveDiscountTier(9_999.99).discountBps).toBe(0);
    // Gold: >= $10,000 and < $50,000
    expect(resolveDiscountTier(10_000).discountBps).toBe(1000);
    expect(resolveDiscountTier(10_000).name).toContain("Gold");
    expect(resolveDiscountTier(49_999.99).discountBps).toBe(1000);
    // Platinum: >= $50,000 and < $100,000
    expect(resolveDiscountTier(50_000).discountBps).toBe(2500);
    expect(resolveDiscountTier(50_000).name).toContain("Platinum");
    expect(resolveDiscountTier(99_999.99).discountBps).toBe(2500);
    // Enterprise: >= $100,000
    expect(resolveDiscountTier(100_000).discountBps).toBe(5000);
    expect(resolveDiscountTier(100_000).name).toContain("Enterprise");
    expect(resolveDiscountTier(1_000_000).discountBps).toBe(5000);
  });

  it("supports custom tier hierarchies and fallbacks", () => {
    const customTiers: VolumeDiscountTier[] = [
      { minVolumeUsd: 1000, discountBps: 2000, name: "VIP" },
      { minVolumeUsd: 0, discountBps: 0, name: "Normal" },
    ];
    expect(resolveDiscountTier(500, customTiers).name).toBe("Normal");
    expect(resolveDiscountTier(1500, customTiers).name).toBe("VIP");

    // Falls back to lowest tier when volume is below all tiers
    const highTiers: VolumeDiscountTier[] = [
      { minVolumeUsd: 100, discountBps: 500, name: "HighTier" },
    ];
    expect(resolveDiscountTier(50, highTiers).name).toBe("HighTier");
    expect(resolveDiscountTier(50, []).name).toBe("Standard");
  });
});

describe("calculateFee core mechanics & edge cases (#1402)", () => {
  it("returns zero fees on 0 amount with no panics or NaNs", () => {
    const res = calculateFee({ amountStroops: BigInt(0) });
    expect(res.totalFeeStroops).toBe(BigInt(0));
    expect(res.grossVariableFeeStroops).toBe(BigInt(0));
    expect(res.variableFeeStroops).toBe(BigInt(0));
    expect(res.flatFeeStroops).toBe(BigInt(0));
    expect(res.discountAppliedBps).toBe(0);
    expect(res.effectiveRateBps).toBe(0);
    expect(res.totalFeeXlm).toBe("0.0000000");
    expect(res.netAmountStroops).toBe(BigInt(0));
    expect(res.tierName).toBe("Zero Amount");
  });

  it("applies 100% exemption for whitelisted accounts (case-insensitive)", () => {
    const exemptAccount = "GAXYZ1234567890ABCDEF";
    const res = calculateFee({
      amountStroops: BigInt(10_000_000), // 1 XLM
      account: "gaxyz1234567890abcdef",
      exemptAccounts: [exemptAccount],
    });

    expect(res.isExempt).toBe(true);
    expect(res.totalFeeStroops).toBe(BigInt(0));
    expect(res.totalFeeXlm).toBe("0.0000000");
    expect(res.netAmountStroops).toBe(BigInt(10_000_000));
    expect(res.effectiveRateBps).toBe(0);
    expect(res.tierName).toBe("Exempt Account");
  });

  it("charges standard fee when account is not in exempt list", () => {
    const res = calculateFee({
      amountStroops: BigInt(100_000_000), // 10 XLM
      account: "GBOTHERACCOUNT",
      exemptAccounts: ["GASOMEOTHERACCOUNT"],
      userVolumeUsd: 0,
    });
    expect(res.isExempt).toBe(false);
    expect(res.totalFeeStroops).toBeGreaterThan(BigInt(0));
  });

  it("calculates exact variable fee with ceiling precision rounding", () => {
    // 100 XLM = 1,000,000,000 stroops
    // 30 bps (0.30%) of 1,000,000,000 = 3,000,000 stroops (0.3 XLM)
    // Flat fee = 100 stroops
    // Total raw fee = 3,000,100 stroops
    const res = calculateFee({
      amountStroops: BigInt(1_000_000_000),
      feeBps: 30,
      userVolumeUsd: 0,
    });

    expect(res.grossVariableFeeStroops).toBe(BigInt(3_000_000));
    expect(res.variableFeeStroops).toBe(BigInt(3_000_000));
    expect(res.flatFeeStroops).toBe(BigInt(100));
    expect(res.totalFeeStroops).toBe(BigInt(3_000_100));
    expect(res.totalFeeXlm).toBe("0.3000100");
    expect(res.netAmountStroops).toBe(BigInt(996_999_900));
    expect(res.netAmountXlm).toBe("99.6999900");
  });

  it("correctly applies volume discounts to the variable fee component", () => {
    // 100 XLM = 1,000,000,000 stroops
    // 30 bps = 3,000,000 stroops variable fee
    // Enterprise tier ($100k+ volume) = 50% discount (5000 bps)
    // Discount amount = 1,500,000 stroops
    // Net variable fee = 1,500,000 stroops
    // Flat fee = 100 stroops
    // Total fee = 1,500,100 stroops
    const res = calculateFee({
      amountStroops: BigInt(1_000_000_000),
      feeBps: 30,
      userVolumeUsd: 150_000,
    });

    expect(res.discountAppliedBps).toBe(5000);
    expect(res.discountAmountStroops).toBe(BigInt(1_500_000));
    expect(res.variableFeeStroops).toBe(BigInt(1_500_000));
    expect(res.totalFeeStroops).toBe(BigInt(1_500_100));
    expect(res.tierName).toContain("Enterprise");
  });

  it("enforces minimum fee threshold", () => {
    // 10 stroops transfer
    // 30 bps -> 1 stroop variable fee + 100 flat fee = 101 stroops
    // If minFee is set to 500 stroops, raw fee is clamped to 500 stroops.
    // But since amount is only 10 stroops, fee cannot exceed amount -> clamped to 10.
    const res = calculateFee({
      amountStroops: BigInt(1000),
      feeBps: 10,
      flatFeeStroops: BigInt(50),
      minFeeStroops: BigInt(200),
    });

    expect(res.totalFeeStroops).toBe(BigInt(200));
  });

  it("never lets fee exceed the gross transaction amount", () => {
    const res = calculateFee({
      amountStroops: BigInt(50),
      flatFeeStroops: BigInt(100),
      minFeeStroops: BigInt(100),
    });

    expect(res.totalFeeStroops).toBe(BigInt(50));
    expect(res.netAmountStroops).toBe(BigInt(0));
  });

  it("enforces maximum fee cap", () => {
    // Huge transaction: 1,000,000 XLM = 10,000,000,000,000 stroops
    // 30 bps would be 30,000,000,000 stroops (3000 XLM)
    // But default max fee cap is 500 XLM = 5,000,000,000 stroops
    const res = calculateFee({
      amountStroops: BigInt("10000000000000"),
      feeBps: 30,
      userVolumeUsd: 0,
    });

    expect(res.totalFeeStroops).toBe(DEFAULT_MAX_FEE_STROOPS);
    expect(res.totalFeeXlm).toBe("500.0000000");
  });

  it("rejects invalid fee configuration parameters", () => {
    expect(() =>
      calculateFee({
        amountStroops: BigInt(1000),
        feeBps: -5,
      })
    ).toThrow(RangeError);

    expect(() =>
      calculateFee({
        amountStroops: BigInt(1000),
        feeBps: Number.NaN,
      })
    ).toThrow(RangeError);

    expect(() =>
      calculateFee({
        amountStroops: BigInt(1000),
        minFeeStroops: BigInt(1000),
        maxFeeStroops: BigInt(500),
      })
    ).toThrow(RangeError);
  });
});
