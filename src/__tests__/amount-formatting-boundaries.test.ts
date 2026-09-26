// SPDX-License-Identifier: MIT

/**
 * Boundary tests for amount and currency formatting (issue #722).
 *
 * Money formatting is the most user-visible surface in a payments product, so
 * the edges are pinned rather than sampled: Stellar's 7-decimal precision
 * limit, rounding at the display boundary, very large and very small
 * magnitudes, negatives/zero, and non-finite input.
 *
 * Two behaviours are asserted as a contract, not as an accident:
 *   • Rounding is **half away from zero** (`2.5 → "3"`), not banker's rounding.
 *   • A non-finite value renders as `"—"` — never `NaN`, `Infinity` or `∞`.
 */

import { describe, it, expect } from "vitest";
import {
  NON_FINITE_AMOUNT,
  formatCompactAmount,
  formatDecimal,
  formatAmountRange,
  stroopsToDisplay,
} from "@/lib/amount";
import {
  formatXlm,
  formatFiat,
  formatTokenAmount,
  formatCompact,
} from "@/lib/format-currency";

const ONE_STROOP_IN_XLM = 1e-7;

describe("Stellar 7-decimal precision (amount.ts)", () => {
  it.each([
    [0, "0"],
    [1, "0.0000001"], // one stroop — the smallest representable amount
    [10, "0.000001"],
    [100, "0.00001"],
    [1_000, "0.0001"],
    [10_000, "0.001"],
    [100_000, "0.01"],
    [1_000_000, "0.1"],
    [10_000_000, "1"],
    [12_500_000, "1.25"],
    [10_001, "0.0010001"],
    [123_456_789, "12.3456789"],
  ])("stroopsToDisplay(%i) → %s", (stroops, expected) => {
    expect(stroopsToDisplay(stroops)).toBe(expected);
  });

  it("never renders a small magnitude in exponential notation", () => {
    // `parseFloat(x.toFixed(7)).toString()` used to turn one stroop into
    // "1e-7" — a value a user is asked to pay.
    expect(stroopsToDisplay(1)).toBe("0.0000001");
    expect(stroopsToDisplay(1)).not.toMatch(/e/i);

    for (const stroops of [1, 2, 9, 11, 101, 9_999, 1_000_001]) {
      const display = stroopsToDisplay(stroops);
      expect(display, `stroops=${stroops}`).not.toMatch(/[eE]\+?\d/);
      expect(display).not.toContain("Infinity");
      expect(display).not.toContain("NaN");
    }
  });

  it("keeps the 7-decimal precision limit exact at the tenth-of-a-stroop edge", () => {
    // 1e-8 XLM is below one stroop: at 7 decimals it collapses to zero rather
    // than rounding up to a payment nobody can actually make.
    expect(formatDecimal(ONE_STROOP_IN_XLM)).toBe("0.0000001");
    expect(formatDecimal(ONE_STROOP_IN_XLM / 10)).toBe("0");
    expect(stroopsToDisplay(0.4)).toBe("0");
  });

  it("handles the largest amount a JS number can hold as a stroop count", () => {
    expect(stroopsToDisplay(Number.MAX_SAFE_INTEGER)).toBe("900719925.4740992");
  });

  it("keeps negative stroops signed", () => {
    expect(stroopsToDisplay(-1)).toBe("-0.0000001");
    expect(stroopsToDisplay(-10_000_000)).toBe("-1");
  });
});

describe("rounding at the display boundary", () => {
  it("rounds half away from zero, not to even", () => {
    // Banker's rounding would give "2" for 2.5 and "0" for 0.5.
    expect(formatDecimal(2.5, 0)).toBe("3");
    expect(formatDecimal(0.5, 0)).toBe("1");
    expect(formatDecimal(1.5, 0)).toBe("2");
    expect(formatDecimal(3.5, 0)).toBe("4");
    expect(formatDecimal(-2.5, 0)).toBe("-3");
  });

  it.each([
    [12.345, "12.35"],
    [12.344, "12.34"],
    [0.005, "0.01"],
    [0.004, "0"],
    [-0.005, "-0.01"],
    [1.999, "2"],
  ])("formatDecimal(%s, 2) → %s", (value, expected) => {
    expect(formatDecimal(value, 2)).toBe(expected);
  });

  it("rounds the binary value, so a decimal that is not exact rounds down", () => {
    // 2.675 is really 2.67499999999999982… — documented so the behaviour is
    // never mistaken for a bug.
    expect(formatDecimal(2.675, 2)).toBe("2.67");
    expect(formatDecimal(999_999.995, 2)).toBe("999999.99");
  });

  it("strips trailing zeros rather than padding to a fixed width", () => {
    expect(formatDecimal(1.5)).toBe("1.5");
    expect(formatDecimal(1.005, 2)).toBe("1");
    expect(formatDecimal(0)).toBe("0");
    expect(formatDecimal(-0)).toBe("0");
  });
});

describe("very large magnitudes", () => {
  it("does not fall back to exponential notation beyond the toFixed limit", () => {
    // (1e21).toFixed(7) is "1e+21"; the formatter must still print digits.
    expect(formatDecimal(1e21)).toBe("1000000000000000000000");
    expect(formatDecimal(1e21)).not.toMatch(/e/i);
  });

  it.each([
    [0, "0.00"],
    [42.5, "42.50"],
    [999, "999.00"],
    [1_000, "1.00K"],
    [8_500, "8.50K"],
    [4_200_000, "4.20M"],
    [1_500_000_000, "1.50B"],
    [1e12, "1000.00B"],
    [-8_500, "-8.50K"],
  ])("formatCompactAmount(%s) → %s", (value, expected) => {
    expect(formatCompactAmount(value as number)).toBe(expected);
  });
});

describe("non-finite and unparseable input", () => {
  const nonFinite = [NaN, Infinity, -Infinity];

  it.each(nonFinite)("amount.ts renders %s as the documented placeholder", (value) => {
    expect(formatDecimal(value)).toBe(NON_FINITE_AMOUNT);
    expect(stroopsToDisplay(value)).toBe(NON_FINITE_AMOUNT);
    expect(formatCompactAmount(value)).toBe(NON_FINITE_AMOUNT);
    expect(formatAmountRange(value, 10)).toBe(NON_FINITE_AMOUNT);
    expect(formatAmountRange(0, value)).toBe(NON_FINITE_AMOUNT);
  });

  it.each(nonFinite)("format-currency renders %s as the documented placeholder", (value) => {
    expect(formatXlm(value)).toBe(NON_FINITE_AMOUNT);
    expect(formatFiat(value)).toBe(NON_FINITE_AMOUNT);
    expect(formatTokenAmount(value, "XLM")).toBe(NON_FINITE_AMOUNT);
    expect(formatCompact(value)).toBe(NON_FINITE_AMOUNT);
  });

  it.each(["", "abc", "1,234.50", "12px"])(
    "treats the unparseable string %j as non-finite",
    (value) => {
      expect(formatXlm(value)).toBe(NON_FINITE_AMOUNT);
      expect(formatFiat(value)).toBe(NON_FINITE_AMOUNT);
      expect(formatTokenAmount(value, "XLM")).toBe(NON_FINITE_AMOUNT);
      expect(formatCompact(value)).toBe(NON_FINITE_AMOUNT);
    }
  );

  it("never leaks NaN or Infinity into any formatted string", () => {
    const suspicious = [NaN, Infinity, -Infinity];
    const outputs = suspicious.flatMap((value) => [
      formatDecimal(value),
      stroopsToDisplay(value),
      formatCompactAmount(value),
      formatAmountRange(value, value),
      formatXlm(value),
      formatFiat(value),
      formatTokenAmount(value, "XLM"),
      formatCompact(value),
    ]);

    for (const output of outputs) {
      expect(output).not.toContain("NaN");
      expect(output).not.toContain("Infinity");
      expect(output).not.toContain("∞");
    }
  });

  it("still formats valid numeric strings", () => {
    expect(formatXlm("10000000")).toBe("1.00");
    expect(formatFiat("12.5")).toBe("$12.50");
    expect(formatTokenAmount("1234.5", "USDC")).toBe("1,234.50 USDC");
    expect(formatCompact("1500")).toBe("1.5K");
  });
});

describe("locale-independent output", () => {
  it("always uses en-US separators regardless of the runtime locale", () => {
    // A locale-dependent implementation renders "$1.234,50" under de-DE.
    expect(formatFiat(1234.5)).toBe("$1,234.50");
    expect(formatTokenAmount(1234.5, "USDC")).toBe("1,234.50 USDC");
    expect(formatXlm(12_500_000)).toBe("1.25");
  });

  it("keeps grouping, sign and zero handling consistent", () => {
    expect(formatFiat(0)).toBe("$0.00");
    expect(formatFiat(-12.5)).toBe("-$12.50");
    expect(formatFiat(1e21)).toBe("$1,000,000,000,000,000,000,000.00");
    expect(formatXlm(0)).toBe("0.00");
    expect(formatXlm(1, 7)).toBe("0.0000001");
    expect(formatCompact(0)).toBe("0");
    expect(formatCompact(-1500)).toBe("-1.5K");
  });

  it("honours the requested decimal places", () => {
    expect(formatFiat(12.345, "USD", 1)).toBe("$12.3");
    expect(formatTokenAmount(12.3456, "USDC", 4)).toBe("12.3456 USDC");
  });
});

describe("formatAmountRange", () => {
  it("collapses an equal range and elides the symbol otherwise", () => {
    expect(formatAmountRange(25, 25, "$")).toBe("$25");
    expect(formatAmountRange(10, 50, "$")).toBe("$10 — $50");
    expect(formatAmountRange(10, 50)).toBe("10 — 50");
    expect(formatAmountRange(10, 50, "XLM ")).toBe("XLM 10 — XLM 50");
  });

  it("keeps fractional bounds", () => {
    expect(formatAmountRange(10.5, 10.5, "$")).toBe("$10.5");
    expect(formatAmountRange(0.25, 0.5, "$")).toBe("$0.25 — $0.5");
    expect(formatAmountRange(-5, -1, "$")).toBe("$-5 — $-1");
  });
});
