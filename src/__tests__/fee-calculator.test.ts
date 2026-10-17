// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  STELLAR_DECIMALS,
  DEFAULT_PAYMENT_FEE_BPS,
  VOLUME_DISCOUNT_TIERS,
  roundToPrecision,
  resolveDiscountTier,
  isAccountFeeExempt,
  calculatePaymentFee,
} from "@/lib/fee-calculator";

describe("Fee Calculator & Volume Discount Tier Rules (#1402)", () => {
  describe("zero and negative amount handling", () => {
    it("returns 0 fee and 0 net amount for a 0 amount payment", () => {
      const res = calculatePaymentFee({ amount: 0, baseFeeBps: 50 });
      expect(res.grossAmount).toBe(0);
      expect(res.feeAmount).toBe(0);
      expect(res.netAmount).toBe(0);
      expect(res.tier).toBe("standard");
      expect(res.capped).toBe(false);
      expect(res.exempt).toBe(false);
    });

    it("returns 0 fee when baseFeeBps is 0 on a positive amount", () => {
      const res = calculatePaymentFee({ amount: 250, baseFeeBps: 0 });
      expect(res.feeAmount).toBe(0);
      expect(res.netAmount).toBe(250);
      expect(res.effectiveFeeBps).toBe(0);
    });

    it("throws RangeError for negative, NaN, or non-finite amounts", () => {
      expect(() => calculatePaymentFee({ amount: -0.01 })).toThrow(RangeError);
      expect(() => calculatePaymentFee({ amount: -100 })).toThrow(RangeError);
      expect(() => calculatePaymentFee({ amount: Number.NaN })).toThrow(
        RangeError
      );
      expect(() =>
        calculatePaymentFee({ amount: Number.POSITIVE_INFINITY })
      ).toThrow(RangeError);
    });

    it("throws RangeError for invalid baseFeeBps, monthlyVolume, maxFeeCap, or decimals", () => {
      expect(() =>
        calculatePaymentFee({ amount: 100, baseFeeBps: -1 })
      ).toThrow(RangeError);
      expect(() =>
        calculatePaymentFee({ amount: 100, baseFeeBps: 1001 })
      ).toThrow(RangeError);
      expect(() =>
        calculatePaymentFee({ amount: 100, monthlyVolume: -5 })
      ).toThrow(RangeError);
      expect(() =>
        calculatePaymentFee({ amount: 100, maxFeeCap: -1 })
      ).toThrow(RangeError);
      expect(() => roundToPrecision(Number.NaN)).toThrow(RangeError);
      expect(() => roundToPrecision(1.23, -1)).toThrow(RangeError);
      expect(() => roundToPrecision(1.23, 15)).toThrow(RangeError);
    });
  });

  describe("volume discount tier boundaries ($9,999.99 vs $10,000.00)", () => {
    it("applies standard tier (0% discount) at $0 and $9,999.99", () => {
      const atZero = calculatePaymentFee({
        amount: 1000,
        baseFeeBps: 100, // 1.00%
        monthlyVolume: 0,
      });
      expect(atZero.tier).toBe("standard");
      expect(atZero.discountPercent).toBe(0);
      expect(atZero.effectiveFeeBps).toBe(100);
      expect(atZero.feeAmount).toBe(10);

      const justBelowGrowth = calculatePaymentFee({
        amount: 1000,
        baseFeeBps: 100,
        monthlyVolume: 9_999.99,
      });
      expect(justBelowGrowth.tier).toBe("standard");
      expect(justBelowGrowth.discountPercent).toBe(0);
      expect(justBelowGrowth.effectiveFeeBps).toBe(100);
      expect(justBelowGrowth.feeAmount).toBe(10);
    });

    it("applies growth tier (20% discount) at exact $10,000.00 boundary and up to $49,999.99", () => {
      const atGrowthBoundary = calculatePaymentFee({
        amount: 1000,
        baseFeeBps: 100, // 1.00% -> 0.80% (80 bps)
        monthlyVolume: 10_000.0,
      });
      expect(atGrowthBoundary.tier).toBe("growth");
      expect(atGrowthBoundary.discountPercent).toBe(20);
      expect(atGrowthBoundary.effectiveFeeBps).toBe(80);
      expect(atGrowthBoundary.feeAmount).toBe(8);
      expect(atGrowthBoundary.netAmount).toBe(992);

      const belowScale = resolveDiscountTier(49_999.99);
      expect(belowScale.name).toBe("growth");
      expect(belowScale.discountPercent).toBe(20);
    });

    it("applies scale tier (40% discount) at $50,000.00 and enterprise tier (60% discount) at $250,000.00", () => {
      const atScale = calculatePaymentFee({
        amount: 1000,
        baseFeeBps: 100, // 1.00% -> 0.60% (60 bps)
        monthlyVolume: 50_000.0,
      });
      expect(atScale.tier).toBe("scale");
      expect(atScale.discountPercent).toBe(40);
      expect(atScale.effectiveFeeBps).toBe(60);
      expect(atScale.feeAmount).toBe(6);

      const belowEnterprise = resolveDiscountTier(249_999.99);
      expect(belowEnterprise.name).toBe("scale");

      const atEnterprise = calculatePaymentFee({
        amount: 1000,
        baseFeeBps: 100, // 1.00% -> 0.40% (40 bps)
        monthlyVolume: 250_000.0,
      });
      expect(atEnterprise.tier).toBe("enterprise");
      expect(atEnterprise.discountPercent).toBe(60);
      expect(atEnterprise.effectiveFeeBps).toBe(40);
      expect(atEnterprise.feeAmount).toBe(4);
      expect(atEnterprise.netAmount).toBe(996);
    });

    it("exposes ordered canonical VOLUME_DISCOUNT_TIERS and default constants", () => {
      expect(STELLAR_DECIMALS).toBe(7);
      expect(DEFAULT_PAYMENT_FEE_BPS).toBe(50);
      expect(VOLUME_DISCOUNT_TIERS).toHaveLength(4);
    });
  });

  describe("precision rounding (7-decimal Stellar stroop precision)", () => {
    it("rounds fractional stroop fees to 7 decimal places accurately", () => {
      // 0.1234567 XLM * 33 bps (0.0033) = 0.00040740711 -> rounds to 0.0004074
      const res = calculatePaymentFee({
        amount: 0.1234567,
        baseFeeBps: 33,
      });
      expect(res.feeAmount).toBe(0.0004074);
      expect(res.netAmount).toBe(0.1230493);
      expect(roundToPrecision(res.feeAmount + res.netAmount)).toBe(
        res.grossAmount
      );
    });

    it("supports custom decimal precision (e.g. 2 decimals for USD cents)", () => {
      const res = calculatePaymentFee({
        amount: 19.99,
        baseFeeBps: 50, // 0.5% of 19.99 = 0.09995 -> rounds to 0.10
        decimals: 2,
      });
      expect(res.feeAmount).toBe(0.1);
      expect(res.netAmount).toBe(19.89);
    });
  });

  describe("max fee cap enforcement", () => {
    it("caps the fee at maxFeeCap when raw fee exceeds the cap", () => {
      const res = calculatePaymentFee({
        amount: 100_000,
        baseFeeBps: 50, // raw fee = 500
        maxFeeCap: 25,
      });
      expect(res.feeAmount).toBe(25);
      expect(res.netAmount).toBe(99_975);
      expect(res.capped).toBe(true);
    });

    it("does not mark capped when raw fee is at or below maxFeeCap", () => {
      const res = calculatePaymentFee({
        amount: 1000,
        baseFeeBps: 50, // raw fee = 5
        maxFeeCap: 25,
      });
      expect(res.feeAmount).toBe(5);
      expect(res.capped).toBe(false);
    });

    it("clamps fee to grossAmount when tiny sub-stroop rounding would exceed grossAmount", () => {
      // With decimals=2, amount=0.01 and maxFeeCap undefined
      const res = calculatePaymentFee({
        amount: 0.01,
        baseFeeBps: 1000,
        decimals: 2,
      });
      expect(res.feeAmount).toBeLessThanOrEqual(res.grossAmount);
    });
  });

  describe("exempt account flags and global fee toggle", () => {
    it("waives fees when isExempt is true", () => {
      const res = calculatePaymentFee({
        amount: 50_000,
        baseFeeBps: 100,
        isExempt: true,
      });
      expect(res.exempt).toBe(true);
      expect(res.tier).toBe("exempt");
      expect(res.feeAmount).toBe(0);
      expect(res.netAmount).toBe(50_000);
      expect(res.effectiveFeeBps).toBe(0);
      expect(res.discountPercent).toBe(100);
    });

    it("waives fees when accountAddress matches exemptAccounts (case-insensitive)", () => {
      const treasury = "GTREASURYACCOUNTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
      const res = calculatePaymentFee({
        amount: 25_000,
        baseFeeBps: 75,
        accountAddress: treasury.toLowerCase(),
        exemptAccounts: new Set([treasury]),
      });
      expect(res.exempt).toBe(true);
      expect(res.feeAmount).toBe(0);
      expect(res.netAmount).toBe(25_000);
    });

    it("charges normal fees when accountAddress is not in exemptAccounts", () => {
      const res = calculatePaymentFee({
        amount: 1000,
        baseFeeBps: 50,
        accountAddress: "GUSER1XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
        exemptAccounts: ["GTREASURYACCOUNTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"],
      });
      expect(res.exempt).toBe(false);
      expect(res.feeAmount).toBe(5);
    });

    it("waives fees when feeEnabled is false", () => {
      expect(isAccountFeeExempt({ feeEnabled: false })).toBe(true);
      const res = calculatePaymentFee({
        amount: 10_000,
        baseFeeBps: 100,
        feeEnabled: false,
      });
      expect(res.exempt).toBe(true);
      expect(res.feeAmount).toBe(0);
      expect(res.netAmount).toBe(10_000);
    });
  });
});
