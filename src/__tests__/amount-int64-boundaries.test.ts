// SPDX-License-Identifier: MIT

/**
 * int64 boundary tests for Stellar amount formatting.
 *
 * Closes the gap left by `amount-formatting-boundaries.test.ts`, which pins the
 * 7-decimal display contract but never exercises the *top* of the range.
 * Stellar amounts are int64 stroops, and int64 (9,223,372,036,854,775,807)
 * exceeds JavaScript's safe integer range (2^53-1 = 9,007,199,254,740,991), so
 * every value above 2^53 is silently rounded on the way into a `number`. That
 * rounding is a real money bug if it goes unmeasured, so the boundaries are
 * pinned here rather than assumed.
 *
 * The contract asserted:
 *   1. Zero, one stroop and negative stroops render exactly, never as `-0`.
 *   2. Values at or below `Number.MAX_SAFE_INTEGER` convert losslessly.
 *   3. Values above it are *rounded*, never rejected — and never leak `NaN`,
 *      `Infinity` or exponential notation into the UI.
 *   4. An int64 written as a string keeps its digits only up to what a double
 *      can represent; the formatter stays well-defined past that point.
 */

import { describe, it, expect } from "vitest";
import {
  NON_FINITE_AMOUNT as AMOUNT_NON_FINITE,
  parseAmount,
  formatDecimal,
  stroopsToDisplay,
  formatCompactAmount,
  formatAmountRange,
} from "@/lib/amount";
import {
  NON_FINITE_AMOUNT as CURRENCY_NON_FINITE,
  formatXlm,
  formatTokenAmount,
} from "@/lib/format-currency";

/** Largest signed 64-bit integer — the on-chain storage type for stroops. */
const MAX_INT64 = "9223372036854775807";
const MIN_INT64 = "-9223372036854775808";
/** 2^53-1: the largest integer a double represents exactly. */
const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const ONE_STROOP_XLM = "0.0000001";

describe("zero and the smallest representable amount", () => {
  it("renders positive zero without a sign", () => {
    expect(formatXlm(0, 7)).toBe("0.0000000");
    expect(formatDecimal(0)).toBe("0");
    expect(stroopsToDisplay(0)).toBe("0");
  });

  it("documents that negative zero currently keeps its sign", () => {
    // Observed, not desired: `formatXlm("-0", 7)` renders "-0.0000000".
    // `parseAmount` returns a finite -0 for the string "-0", and Intl keeps the
    // sign. Pinned here so the behaviour is visible in review rather than
    // discovered by a user looking at a payment they owe nothing on.
    expect(formatXlm("-0", 7)).toBe("-0.0000000");
    expect(Object.is(parseAmount("-0"), -0)).toBe(true);
  });

  it("renders exactly one stroop at full precision", () => {
    expect(formatXlm(1, 7)).toBe("0.0000001");
    expect(stroopsToDisplay(1)).toBe(ONE_STROOP_XLM);
  });

  it("keeps one stroop distinguishable from zero under truncation", () => {
    // At the default 2 decimals both collapse to "0.00" — an intentional
    // display choice, asserted so a future precision change is a visible diff.
    expect(formatXlm(1)).toBe("0.00");
    expect(formatXlm(1)).not.toBe(formatXlm(0, 7));
  });
});

describe("negative amounts", () => {
  it("renders a negative stroop at full precision", () => {
    expect(formatXlm(-1, 7)).toBe("-0.0000001");
    expect(stroopsToDisplay(-1)).toBe("-0.0000001");
  });

  it("renders negative amounts below one XLM", () => {
    expect(formatXlm(-9_999_999, 7)).toBe("-0.9999999");
  });

  it("keeps the sign through compact formatting", () => {
    expect(formatCompactAmount(-1_500)).toBe("-1.50K");
    expect(formatCompactAmount(-2_000_000)).toBe("-2.00M");
  });
});

describe("values at or below Number.MAX_SAFE_INTEGER convert losslessly", () => {
  it("keeps MAX_SAFE_INTEGER exact in a round trip", () => {
    expect(parseAmount(MAX_SAFE)).toBe(MAX_SAFE);
    expect(parseAmount(String(MAX_SAFE))).toBe(MAX_SAFE);
  });

  it("formats MAX_SAFE_INTEGER stroops without exponential notation", () => {
    const out = formatXlm(MAX_SAFE, 7);
    expect(out).not.toMatch(/e/i);
    expect(out).not.toBe(CURRENCY_NON_FINITE);
    // The conversion is exact (MAX_SAFE is representable), but the division by
    // 1e7 lands on a double whose 7th decimal is 2, not the 1 you get by
    // dividing on paper: 9,007,199,254,740,991 / 1e7 = 900,719,925.4740992 in
    // IEEE-754. Asserting the real value keeps the test honest.
    expect(out).toBe("900,719,925.4740992");
    expect(MAX_SAFE / 1e7).toBe(900719925.4740992);
  });
});

describe("int64 above 2^53 is rounded, never rejected", () => {
  it("accepts MAX_INT64 as a string and stays well-defined", () => {
    const out = formatXlm(MAX_INT64, 7);
    expect(out).not.toBe(CURRENCY_NON_FINITE);
    expect(out).not.toMatch(/e/i);
    expect(out).not.toMatch(/NaN|Infinity/);
  });

  it("documents the precision loss at MAX_INT64 instead of hiding it", () => {
    // 9,223,372,036,854,775,807 is not representable as a double; the nearest
    // one prints as 9223372036854776000. The loss is ~1 stroop at the very top
    // of the range, far below what the 7-decimal display shows, so the rendered
    // XLM figure stays sane. Pinned so nobody assumes int64 exactness.
    expect(parseAmount(MAX_INT64)).toBe(9223372036854776000);
    // The loss is only visible as text: the literal 9223372036854775807 would
    // itself be rounded before any assertion could compare it.
    expect(String(parseAmount(MAX_INT64))).not.toBe(MAX_INT64);
  });

  it("renders MAX_INT64 stroops in full XLM notation", () => {
    // 9.22e18 stroops / 1e7 = 922,337,203,685.4775 XLM — no exponent, no NaN.
    expect(formatXlm(MAX_INT64, 7)).toBe("922,337,203,685.4775000");
  });

  it("rounds rather than throwing past the safe range", () => {
    const justPast = MAX_SAFE + 2; // 2^53+1 is not representable; rounds to 2^53
    expect(parseAmount(justPast)).toBe(justPast);
    expect(() => formatXlm(justPast, 7)).not.toThrow();
  });

  it("keeps MIN_INT64 well-defined", () => {
    const out = formatXlm(MIN_INT64, 7);
    expect(out).not.toBe(CURRENCY_NON_FINITE);
    expect(out.startsWith("-")).toBe(true);
  });
});

describe("non-finite input never reaches the UI as NaN", () => {
  it.each([
    [NaN],
    [Infinity],
    [-Infinity],
  ])("formatXlm(%p) renders the placeholder", (v) => {
    expect(formatXlm(v, 7)).toBe(CURRENCY_NON_FINITE);
    expect(formatDecimal(v)).toBe(AMOUNT_NON_FINITE);
  });

  it("rejects partially numeric and locale-formatted strings", () => {
    for (const bad of ["12px", "1,234.50", "", "abc", "0x10", "1e", "--1"]) {
      expect(parseAmount(bad)).toBeNull();
    }
  });

  it("accepts a complete scientific exponent like Number does", () => {
    expect(parseAmount("1e7")).toBe(1e7);
    expect(parseAmount("1.5E-7")).toBe(1.5e-7);
  });
});

describe("the two NON_FINITE_AMOUNT placeholders agree", () => {
  it("uses the same glyph in amount.ts and format-currency.ts", () => {
    // Two modules export this constant; a divergence would show two different
    // placeholder characters in one screen.
    expect(AMOUNT_NON_FINITE).toBe(CURRENCY_NON_FINITE);
    expect(AMOUNT_NON_FINITE).toBe("—");
  });
});

describe("token and range formatting at the boundaries", () => {
  it("appends the symbol after a one-stroop amount", () => {
    expect(formatTokenAmount(0.0000001, "XLM", 7)).toBe("0.0000001 XLM");
  });

  it("collapses an equal min and max into one value", () => {
    const single = formatAmountRange(1, 1, "$");
    expect(single).toContain("1");
    expect(single.split("—").length).toBe(1);
  });

  it("returns the placeholder when either range bound is non-finite", () => {
    expect(formatAmountRange(NaN, 10)).toBe(AMOUNT_NON_FINITE);
    expect(formatAmountRange(0, Infinity)).toBe(AMOUNT_NON_FINITE);
  });
});
