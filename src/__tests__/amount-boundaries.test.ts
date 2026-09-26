// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  formatCompactAmount,
  stroopsToDisplay,
  formatDecimal,
  formatAmountRange,
  STELLAR_MAX_DECIMALS,
  STROOPS_PER_XLM,
} from "@/lib/amount";
import {
  formatXlm,
  formatFiat,
  formatTokenAmount,
  formatCompact,
  DEFAULT_LOCALE,
} from "@/lib/format-currency";

describe("Amount & Currency Arithmetic Boundaries (Issue #722)", () => {
  // ── 1. Seven-Decimal Stellar Precision Limit ──────────────────
  describe("Seven-decimal Stellar precision limit", () => {
    it("pins constants to Stellar protocol specification (10^7 stroops = 1 XLM)", () => {
      expect(STELLAR_MAX_DECIMALS).toBe(7);
      expect(STROOPS_PER_XLM).toBe(10_000_000);
    });

    const precisionTable = [
      { stroops: 1, expectedDisplay: "0.0000001", description: "1 stroop (minimum ledger unit)" },
      { stroops: 10, expectedDisplay: "0.000001", description: "10 stroops" },
      { stroops: 100, expectedDisplay: "0.00001", description: "100 stroops" },
      { stroops: 1_000, expectedDisplay: "0.0001", description: "1,000 stroops" },
      { stroops: 10_000, expectedDisplay: "0.001", description: "10,000 stroops" },
      { stroops: 100_000, expectedDisplay: "0.01", description: "100,000 stroops" },
      { stroops: 1_000_000, expectedDisplay: "0.1", description: "1,000,000 stroops" },
      { stroops: 10_000_000, expectedDisplay: "1", description: "10,000,000 stroops (exact 1 XLM)" },
      { stroops: 12_345_678, expectedDisplay: "1.2345678", description: "Full 7-decimal arbitrary fraction" },
      { stroops: 99_999_999, expectedDisplay: "9.9999999", description: "Repeated nines at 7 decimals" },
    ];

    for (const { stroops, expectedDisplay, description } of precisionTable) {
      it(`formats ${description}: ${stroops} stroops -> ${expectedDisplay}`, () => {
        expect(stroopsToDisplay(stroops, 7)).toBe(expectedDisplay);
      });
    }

    it("clamps decimals to 7 maximum to prevent floating point garbage beyond Stellar precision", () => {
      // 1 stroop formatted with maxDecimals=10 should still be capped at 7
      expect(stroopsToDisplay(1, 10)).toBe("0.0000001");
    });
  });

  // ── 2. Rounding at Display Boundary ───────────────────────────
  describe("Rounding at display boundaries (half-up vs half-even)", () => {
    it("applies standard half-up (halfExpand) rounding at boundary", () => {
      // 1.005 rounds up to 1.01 in halfExpand
      expect(formatFiat(1.005, "USD", 2, { roundingMode: "halfExpand" })).toBe("$1.01");
      // 1.015 rounds up to 1.02 in halfExpand
      expect(formatFiat(1.015, "USD", 2, { roundingMode: "halfExpand" })).toBe("$1.02");
    });

    it("applies banker's rounding (halfEven) at boundary", () => {
      // 1.005 rounds to nearest even (1.00) in halfEven
      expect(formatFiat(1.005, "USD", 2, { roundingMode: "halfEven" })).toBe("$1.00");
      // 1.015 rounds to nearest even (1.02) in halfEven
      expect(formatFiat(1.015, "USD", 2, { roundingMode: "halfEven" })).toBe("$1.02");
    });

    const roundingTable = [
      { input: 10.004, decimals: 2, expected: "$10.00" },
      { input: 10.006, decimals: 2, expected: "$10.01" },
      { input: 10.005, decimals: 2, expected: "$10.01" }, // default Intl round half-up in en-US
      { input: 99.999, decimals: 2, expected: "$100.00" },
    ];

    for (const { input, decimals, expected } of roundingTable) {
      it(`rounds ${input} to ${decimals} decimals -> ${expected}`, () => {
        expect(formatFiat(input, "USD", decimals)).toBe(expected);
      });
    }
  });

  // ── 3. Zero and Negative Inputs ───────────────────────────────
  describe("Zero and negative inputs", () => {
    it("handles positive and negative zero consistently", () => {
      expect(stroopsToDisplay(0)).toBe("0");
      expect(stroopsToDisplay(-0)).toBe("0");
      expect(formatDecimal(0)).toBe("0");
      expect(formatDecimal(-0)).toBe("0");
      expect(formatXlm(0)).toBe("0.00");
      expect(formatFiat(0)).toBe("$0.00");
      expect(formatTokenAmount(0, "USDC")).toBe("0.00 USDC");
    });

    it("handles negative stroops and amounts cleanly without silent sign omission", () => {
      expect(stroopsToDisplay(-10_000_000)).toBe("-1");
      expect(stroopsToDisplay(-12_500_000)).toBe("-1.25");
      expect(formatDecimal(-42.5)).toBe("-42.5");
      expect(formatCompactAmount(-1_500_000)).toBe("-1.50M");
      expect(formatXlm(-10_000_000)).toBe("-1.00");
      expect(formatFiat(-12.5)).toBe("-$12.50");
      expect(formatTokenAmount(-50, "XLM")).toBe("-50.00 XLM");
    });

    it("formats ranges with negative or zero bounds correctly", () => {
      expect(formatAmountRange(0, 0, "$")).toBe("$0");
      expect(formatAmountRange(10, 10, "$")).toBe("$10");
      expect(formatAmountRange(10, 50, "$")).toBe("$10 — $50");
      expect(formatAmountRange(-5, 5, "$")).toBe("$-5 — $5");
    });
  });

  // ── 4. Non-Finite Inputs (No NaN or Infinity) ─────────────────
  describe("Non-finite inputs (guards against NaN and Infinity)", () => {
    const nonFiniteValues = [
      { val: NaN, label: "NaN" },
      { val: Infinity, label: "Infinity" },
      { val: -Infinity, label: "-Infinity" },
      { val: "not-a-number", label: "invalid string" },
      { val: "", label: "empty string" },
      { val: null, label: "null" },
      { val: undefined, label: "undefined" },
    ];

    for (const { val, label } of nonFiniteValues) {
      it(`never emits NaN or Infinity for ${label} in stroopsToDisplay`, () => {
        // @ts-expect-error test non-finite runtime inputs
        const res = stroopsToDisplay(val);
        expect(res).not.toContain("NaN");
        expect(res).not.toContain("Infinity");
        expect(res).toBe("—");
      });

      it(`never emits NaN or Infinity for ${label} in formatCompactAmount`, () => {
        // @ts-expect-error test non-finite runtime inputs
        const res = formatCompactAmount(val);
        expect(res).not.toContain("NaN");
        expect(res).not.toContain("Infinity");
        expect(res).toBe("—");
      });

      it(`never emits NaN or Infinity for ${label} in formatDecimal`, () => {
        // @ts-expect-error test non-finite runtime inputs
        const res = formatDecimal(val);
        expect(res).not.toContain("NaN");
        expect(res).not.toContain("Infinity");
        expect(res).toBe("—");
      });

      it(`never emits NaN or Infinity for ${label} in formatXlm`, () => {
        // @ts-expect-error test non-finite runtime inputs
        const res = formatXlm(val);
        expect(res).not.toContain("NaN");
        expect(res).not.toContain("Infinity");
        expect(res).toBe("—");
      });

      it(`never emits NaN or Infinity for ${label} in formatFiat`, () => {
        // @ts-expect-error test non-finite runtime inputs
        const res = formatFiat(val);
        expect(res).not.toContain("NaN");
        expect(res).not.toContain("Infinity");
        expect(res).toBe("—");
      });

      it(`never emits NaN or Infinity for ${label} in formatTokenAmount`, () => {
        // @ts-expect-error test non-finite runtime inputs
        const res = formatTokenAmount(val, "XLM");
        expect(res).not.toContain("NaN");
        expect(res).not.toContain("Infinity");
        expect(res).toBe("—");
      });

      it(`never emits NaN or Infinity for ${label} in formatCompact`, () => {
        // @ts-expect-error test non-finite runtime inputs
        const res = formatCompact(val);
        expect(res).not.toContain("NaN");
        expect(res).not.toContain("Infinity");
        expect(res).toBe("—");
      });
    }
  });

  // ── 5. Large Magnitudes ───────────────────────────────────────
  describe("Extremely large magnitudes", () => {
    it("formats thousands (K), millions (M), and billions (B) cleanly", () => {
      expect(formatCompactAmount(1_500)).toBe("1.50K");
      expect(formatCompactAmount(2_500_000)).toBe("2.50M");
      expect(formatCompactAmount(3_750_000_000)).toBe("3.75B");
      expect(formatCompactAmount(4_100_000_000_000)).toBe("4100.00B");
    });

    it("handles large stroop balances without scientific notation corruption", () => {
      // 50 billion XLM = 50_000_000_000 * 10^7 stroops = 5e17 stroops
      const stroops50B = 500_000_000_000_000_000;
      const display = stroopsToDisplay(stroops50B, 2);
      expect(display).toBe("50000000000");
    });
  });

  // ── 6. Locale Stability ───────────────────────────────────────
  describe("Locale independence and stability", () => {
    it("pins DEFAULT_LOCALE to en-US for deterministic grouping and decimal symbols", () => {
      expect(DEFAULT_LOCALE).toBe("en-US");
    });

    it("consistently formats thousands separators with comma and decimals with point", () => {
      expect(formatFiat(1234567.89)).toBe("$1,234,567.89");
      expect(formatXlm(12345678900000)).toBe("1,234,567.89");
      expect(formatTokenAmount(1000000, "XLM")).toBe("1,000,000.00 XLM");
    });
  });
});
