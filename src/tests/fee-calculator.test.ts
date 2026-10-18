// SPDX-License-Identifier: MIT

/**
 * Unit test suite for fee calculation and discount tier rules (Issue #1402).
 *
 * Covers:
 * - 100% code coverage of src/lib/fee-calculator.ts
 * - Exact boundary condition testing at $10k, $50k, $250k thresholds
 * - Edge cases: zero amount, negative values, fractional stroops, exempt accounts,
 *   minimum fee floors, maximum fee caps, and invalid inputs
 * - Zero arithmetic panics or NaN return values
 * - Sub-500ms execution target
 */

import { describe, it, expect } from "vitest";
import {
  calculateFee,
  toStroopsSafe,
  resolveVolumeTier,
  divideBigIntWithRounding,
  STROOP_PRECISION,
  MAX_ALLOWED_FEE_BPS,
  DEFAULT_BASE_FEE_BPS,
  DEFAULT_MIN_FEE_STROOPS,
  DEFAULT_MAX_FEE_CAP_STROOPS,
  VOLUME_DISCOUNT_TIERS,
} from "@/lib/fee-calculator";

describe("fee-calculator — unit test suite (#1402)", () => {
  describe("toStroopsSafe conversion helper", () => {
    it("safely parses BigInt values and clamps negative values to 0", () => {
      expect(toStroopsSafe(BigInt(10_000_000))).toBe(BigInt(10_000_000));
      expect(toStroopsSafe(BigInt(0))).toBe(BigInt(0));
      expect(toStroopsSafe(BigInt(-500))).toBe(BigInt(0));
    });

    it("safely handles numbers, NaN, and negative numbers", () => {
      expect(toStroopsSafe(100)).toBe(BigInt(100));
      expect(toStroopsSafe(0)).toBe(BigInt(0));
      expect(toStroopsSafe(-10)).toBe(BigInt(0));
      expect(toStroopsSafe(NaN)).toBe(BigInt(0));
      expect(toStroopsSafe(Infinity)).toBe(BigInt(0));
      expect(toStroopsSafe(-Infinity)).toBe(BigInt(0));
    });

    it("safely parses integer and decimal string amounts", () => {
      expect(toStroopsSafe("500")).toBe(BigInt(500));
      // 1.5 XLM = 15,000,000 stroops
      expect(toStroopsSafe("1.5")).toBe(BigInt(15_000_000));
      // 0.0000001 XLM = 1 stroop
      expect(toStroopsSafe("0.0000001")).toBe(BigInt(1));
      // Trims whitespace
      expect(toStroopsSafe("  25.00  ")).toBe(BigInt(250_000_000));
    });

    it("returns 0 for invalid, null, undefined, or negative strings", () => {
      expect(toStroopsSafe(null)).toBe(BigInt(0));
      expect(toStroopsSafe(undefined)).toBe(BigInt(0));
      expect(toStroopsSafe("")).toBe(BigInt(0));
      expect(toStroopsSafe("   ")).toBe(BigInt(0));
      expect(toStroopsSafe("-100")).toBe(BigInt(0));
      expect(toStroopsSafe("invalid-amount")).toBe(BigInt(0));
    });
  });

  describe("divideBigIntWithRounding helper", () => {
    it("handles zero denominator or numerator safely", () => {
      expect(divideBigIntWithRounding(BigInt(100), BigInt(0))).toBe(BigInt(0));
      expect(divideBigIntWithRounding(BigInt(0), BigInt(100))).toBe(BigInt(0));
      expect(divideBigIntWithRounding(BigInt(-5), BigInt(100))).toBe(BigInt(0));
    });

    it("returns exact quotient when remainder is 0", () => {
      expect(divideBigIntWithRounding(BigInt(100), BigInt(10))).toBe(BigInt(10));
    });

    it("supports 'round' (round-half-up) mode", () => {
      // 15 / 10 = 1.5 -> rounds to 2
      expect(divideBigIntWithRounding(BigInt(15), BigInt(10), "round")).toBe(BigInt(2));
      // 14 / 10 = 1.4 -> rounds to 1
      expect(divideBigIntWithRounding(BigInt(14), BigInt(10), "round")).toBe(BigInt(1));
    });

    it("supports 'ceil' mode", () => {
      // 11 / 10 = 1.1 -> ceil to 2
      expect(divideBigIntWithRounding(BigInt(11), BigInt(10), "ceil")).toBe(BigInt(2));
    });

    it("supports 'floor' mode", () => {
      // 19 / 10 = 1.9 -> floor to 1
      expect(divideBigIntWithRounding(BigInt(19), BigInt(10), "floor")).toBe(BigInt(1));
    });
  });

  describe("resolveVolumeTier", () => {
    const STROOPS_PER_XLM = BigInt(10_000_000);

    it("matches Tier 0 for volume below 10,000 XLM", () => {
      const tier = resolveVolumeTier(BigInt(5_000) * STROOPS_PER_XLM);
      expect(tier.tier).toBe(0);
      expect(tier.discountBps).toBe(0);
    });

    it("matches Tier 1 exactly at 10,000 XLM boundary ($10k equivalent)", () => {
      // Exactly 1 stroop below 10,000 XLM -> Tier 0
      const below = resolveVolumeTier(BigInt(10_000) * STROOPS_PER_XLM - BigInt(1));
      expect(below.tier).toBe(0);

      // Exactly at 10,000 XLM -> Tier 1 (10% discount)
      const exact = resolveVolumeTier(BigInt(10_000) * STROOPS_PER_XLM);
      expect(exact.tier).toBe(1);
      expect(exact.discountBps).toBe(1000);
    });

    it("matches Tier 2 exactly at 50,000 XLM boundary ($50k equivalent)", () => {
      const below = resolveVolumeTier(BigInt(50_000) * STROOPS_PER_XLM - BigInt(1));
      expect(below.tier).toBe(1);

      const exact = resolveVolumeTier(BigInt(50_000) * STROOPS_PER_XLM);
      expect(exact.tier).toBe(2);
      expect(exact.discountBps).toBe(2000);
    });

    it("matches Tier 3 exactly at 250,000 XLM boundary ($250k equivalent)", () => {
      const below = resolveVolumeTier(BigInt(250_000) * STROOPS_PER_XLM - BigInt(1));
      expect(below.tier).toBe(2);

      const exact = resolveVolumeTier(BigInt(250_000) * STROOPS_PER_XLM);
      expect(exact.tier).toBe(3);
      expect(exact.discountBps).toBe(3500);
    });

    it("handles negative volume safely", () => {
      const tier = resolveVolumeTier(BigInt(-100));
      expect(tier.tier).toBe(0);
    });
  });

  describe("calculateFee — core logic & edge cases", () => {
    it("calculates standard 50 bps (0.5%) fee on standard payment", () => {
      // 1,000 XLM = 10,000,000,000 stroops
      // 0.5% fee = 5 XLM = 50,000,000 stroops
      const res = calculateFee({ amount: "1000.0" });
      expect(res.feeStroops).toBe(BigInt(50_000_000));
      expect(res.netAmountStroops).toBe(BigInt(9_950_000_000));
      expect(res.formattedFee).toBe("5");
      expect(res.formattedNetAmount).toBe("995");
      expect(res.effectiveBps).toBe(50);
      expect(res.tier).toBe(0);
      expect(res.isCapped).toBe(false);
      expect(res.isFloor).toBe(false);
    });

    it("handles zero amount cleanly with zero fee and no NaN", () => {
      const res = calculateFee({ amount: 0 });
      expect(res.feeStroops).toBe(BigInt(0));
      expect(res.netAmountStroops).toBe(BigInt(0));
      expect(res.formattedFee).toBe("0");
      expect(res.formattedNetAmount).toBe("0");
      expect(Number.isNaN(Number(res.formattedFee))).toBe(false);
    });

    it("handles negative amount cleanly without panicking", () => {
      const res = calculateFee({ amount: -500 });
      expect(res.amountStroops).toBe(BigInt(0));
      expect(res.feeStroops).toBe(BigInt(0));
      expect(res.netAmountStroops).toBe(BigInt(0));
    });

    it("applies 100% fee exemption for exempt accounts", () => {
      const res = calculateFee({
        amount: "5000.0",
        isExempt: true,
      });
      expect(res.feeStroops).toBe(BigInt(0));
      expect(res.netAmountStroops).toBe(BigInt(50_000_000_000));
      expect(res.isExempt).toBe(true);
      expect(res.discountPercent).toBe(100);
      expect(res.formattedFee).toBe("0");
    });

    it("applies volume discount at exactly $10,000 equivalent", () => {
      // 100 XLM payment with $10,000 monthly volume
      // Base fee = 50 bps
      // Tier 1 discount = 10% -> effective fee = 45 bps
      // 100 XLM * 45 bps = 0.45 XLM = 4,500,000 stroops
      const res = calculateFee({
        amount: "100.0",
        monthlyVolumeStroops: "10000.0",
      });
      expect(res.tier).toBe(1);
      expect(res.effectiveBps).toBe(45);
      expect(res.discountPercent).toBe(10);
      expect(res.feeStroops).toBe(BigInt(4_500_000));
      expect(res.formattedFee).toBe("0.45");
    });

    it("applies maximum fee cap when percentage fee exceeds limit", () => {
      // 1,000,000 XLM payment with default cap of 50 XLM (500,000,000 stroops)
      // Normal 0.5% fee would be 5,000 XLM, capped at 50 XLM
      const res = calculateFee({ amount: "1000000.0" });
      expect(res.isCapped).toBe(true);
      expect(res.feeStroops).toBe(DEFAULT_MAX_FEE_CAP_STROOPS);
      expect(res.formattedFee).toBe("50");
    });

    it("applies custom maximum fee cap", () => {
      const customCap = BigInt(10_000_000); // 1 XLM cap
      const res = calculateFee({
        amount: "1000.0",
        maxFeeCapStroops: customCap,
      });
      expect(res.isCapped).toBe(true);
      expect(res.feeStroops).toBe(customCap);
      expect(res.formattedFee).toBe("1");
    });

    it("applies minimum fee floor for tiny amounts", () => {
      // 0.001 XLM = 10,000 stroops
      // 0.5% would be 50 stroops, which is below DEFAULT_MIN_FEE_STROOPS (100 stroops)
      const res = calculateFee({ amount: "0.001" });
      expect(res.isFloor).toBe(true);
      expect(res.feeStroops).toBe(DEFAULT_MIN_FEE_STROOPS);
    });

    it("ensures fee never exceeds total payment amount for micro-payments", () => {
      // 50 stroops payment with 100 stroop floor -> fee is clamped to 50 stroops
      const res = calculateFee({ amount: BigInt(50) });
      expect(res.feeStroops).toBe(BigInt(50));
      expect(res.netAmountStroops).toBe(BigInt(0));
    });

    it("adds flat fee component properly", () => {
      // 100 XLM (1,000,000,000 stroops) with 0.5% fee = 5,000,000 stroops
      // Plus flat fee of 1 XLM (10,000,000 stroops) = 15,000,000 stroops total
      const res = calculateFee({
        amount: "100.0",
        flatFeeStroops: "1.0",
      });
      expect(res.flatFeeStroops).toBe(BigInt(10_000_000));
      expect(res.percentageFeeStroops).toBe(BigInt(5_000_000));
      expect(res.feeStroops).toBe(BigInt(15_000_000));
      expect(res.formattedFee).toBe("1.5");
    });

    it("clamps base fee bps between 0 and MAX_ALLOWED_FEE_BPS (1000)", () => {
      // Exceeds max 10%
      const high = calculateFee({ amount: "100.0", baseFeeBps: 2000 });
      expect(high.baseFeeBps).toBe(MAX_ALLOWED_FEE_BPS);

      // Negative bps
      const low = calculateFee({ amount: "100.0", baseFeeBps: -50 });
      expect(low.baseFeeBps).toBe(0);

      // NaN bps falls back to default
      const nanBps = calculateFee({ amount: "100.0", baseFeeBps: NaN });
      expect(nanBps.baseFeeBps).toBe(DEFAULT_BASE_FEE_BPS);
    });

    it("supports fractional stroop rounding without rounding drift", () => {
      // Amount 13 stroops at 50 bps:
      // 13 * 50 = 650
      // 650 / 10000 = 0.065
      // With minFee disabled:
      const rounded = calculateFee({
        amount: BigInt(13),
        minFeeStroops: 0,
        roundingMode: "round",
      });
      // 650 * 2 = 1300 < 10000 -> 0
      expect(rounded.percentageFeeStroops).toBe(BigInt(0));

      const ceil = calculateFee({
        amount: BigInt(13),
        minFeeStroops: 0,
        roundingMode: "ceil",
      });
      expect(ceil.percentageFeeStroops).toBe(BigInt(1));

      const floor = calculateFee({
        amount: BigInt(13),
        minFeeStroops: 0,
        roundingMode: "floor",
      });
      expect(floor.percentageFeeStroops).toBe(BigInt(0));
    });

    it("handles large amounts (> 2^53 stroops) without floating point loss", () => {
      // 1 billion XLM = 10,000,000,000,000,000 stroops (exceeds Number.MAX_SAFE_INTEGER 9e15)
      const hugeAmount = BigInt("10000000000000000");
      const res = calculateFee({
        amount: hugeAmount,
        maxFeeCapStroops: null, // uncapped
      });
      // 50 bps = 0.5% = 50,000,000,000,000 stroops
      expect(res.feeStroops).toBe(BigInt("50000000000000"));
      expect(res.netAmountStroops).toBe(BigInt("9950000000000000"));
      expect(res.isCapped).toBe(false);
    });
  });
});
