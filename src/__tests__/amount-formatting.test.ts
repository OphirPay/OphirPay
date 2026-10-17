// SPDX-License-Identifier: MIT

/**
 * Property-based fuzz tests for currency amount formatting and parsing
 * (issue #1406).
 *
 * Money formatting is the surface a user is asked to approve, so the edges are
 * exercised with generated input rather than a handful of hand-picked examples:
 *
 *   • Round trip — `parse(format(x)) === x` must hold exactly for every
 *     non-negative stroop count, including amounts far above 2^53 that a float
 *     would silently mis-round. The two paths that carry money through the app
 *     are both covered: the exact `bigint` formatter (`formatXlmAmount`) and the
 *     user-facing display formatter (`stroopsToDisplay`).
 *   • Graceful degradation — arbitrary strings (including Unicode whitespace,
 *     separators, exponents and partial numbers) must never throw and must
 *     resolve to an explicit `null` / placeholder, never `NaN` or `Infinity`.
 *
 * Lives under the sanctioned `src/__tests__` root (repo hygiene #688) — the
 * issue's `src/tests/` path is not collected by Vitest (see vitest.config.ts),
 * so a suite there would silently never run.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  STROOPS_PER_XLM,
  formatXlmAmount,
  formatXlmStroops,
  parseXlmAmount,
} from "@/lib/stellar-amount";
import {
  NON_FINITE_AMOUNT,
  formatDecimal,
  parseAmount,
  stroopsToDisplay,
} from "@/lib/amount";

/** Upper bound for generated stroop counts: well past 2^53, still exact. */
// Built with BigInt(...) rather than a `0n` literal — the project targets
// ES2017, where BigInt literals are a TypeScript error.
const MAX_STROOPS = BigInt(10) ** BigInt(18);
const ZERO = BigInt(0);

/** 5,000 generated cases, matching the issue's stated run count. */
const FUZZ_RUNS = 5000;

describe("amount round trip (property-based, issue #1406)", () => {
  it("parseXlmAmount(formatXlmAmount(s)) === s for every non-negative stroop count", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: ZERO, max: MAX_STROOPS }), (stroops) => {
        expect(parseXlmAmount(formatXlmAmount(stroops))).toBe(stroops);
      }),
      { numRuns: FUZZ_RUNS }
    );
  });

  it("formats an exact plain decimal that never uses grouping, units or exponent", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: ZERO, max: MAX_STROOPS }), (stroops) => {
        const formatted = formatXlmAmount(stroops);
        expect(formatted).toMatch(/^\d+(\.\d{1,7})?$/);
      }),
      { numRuns: FUZZ_RUNS }
    );
  });

  it("parseXlmAmount(stroopsToDisplay(s)) === BigInt(s) across the display path", () => {
    // The display path used by the send form: stroops → display string →
    // parse. `stroopsToDisplay` divides by 1e7 through a double, so the
    // round trip is only exact while the fractional error stays under half a
    // 7th decimal. At the bound below the error is ~2e-9 XLM (5e-8 flips a
    // rounding step); this is exactly why the exact formatter above builds the
    // string from a bigint and is what `formatXlmAmount` exists for. The bound
    // is 100,000,000 XLM — orders of magnitude past any real payment.
    const DISPLAY_SAFE_MAX = BigInt(10) ** BigInt(14);
    fc.assert(
      fc.property(fc.bigInt({ min: ZERO, max: DISPLAY_SAFE_MAX }), (stroops) => {
        expect(parseXlmAmount(stroopsToDisplay(Number(stroops)))).toBe(stroops);
      }),
      { numRuns: FUZZ_RUNS }
    );
  });

  it("keeps the display formatter grouped, suffixed and free of scientific notation", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: ZERO, max: MAX_STROOPS }), (stroops) => {
        const display = formatXlmStroops(stroops);
        expect(display.endsWith(" XLM")).toBe(true);
        expect(display).not.toMatch(/[eE][+-]?\d/);
        expect(display).not.toContain("NaN");
        expect(display).not.toContain("Infinity");
      }),
      { numRuns: FUZZ_RUNS }
    );
  });

  it("agrees on the same amount across both formatters", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: ZERO, max: MAX_STROOPS }), (stroops) => {
        const stripped = formatXlmStroops(stroops).replace(" XLM", "").replace(/,/g, "");
        // The grouped display pads to a minimum of two decimals; the exact
        // formatter trims them. Parsing must recover the same stroops either way.
        expect(parseXlmAmount(stripped)).toBe(stroops);
      }),
      { numRuns: FUZZ_RUNS }
    );
  });
});

describe("graceful fallback (property-based, issue #1406)", () => {
  it("parseXlmAmount never throws and returns bigint or null for arbitrary input", () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const result = parseXlmAmount(input);
        expect(result === null || typeof result === "bigint").toBe(true);
      }),
      { numRuns: FUZZ_RUNS }
    );
  });

  it("parseAmount never throws and returns a finite number or null for arbitrary input", () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const result = parseAmount(input);
        expect(result === null || Number.isFinite(result)).toBe(true);
      }),
      { numRuns: FUZZ_RUNS }
    );
  });

  it("formatDecimal and stroopsToDisplay never leak NaN/Infinity for arbitrary numbers", () => {
    fc.assert(
      fc.property(fc.double({ noNaN: false, noDefaultInfinity: false }), (value) => {
        for (const output of [formatDecimal(value), stroopsToDisplay(value)]) {
          if (Number.isFinite(value)) {
            expect(output).not.toContain("NaN");
            expect(output).not.toContain("Infinity");
            expect(output).not.toMatch(/[eE][+-]?\d/);
          } else {
            expect(output).toBe(NON_FINITE_AMOUNT);
          }
        }
      }),
      { numRuns: FUZZ_RUNS }
    );
  });
});

describe("documented edge cases (issue #1406)", () => {
  it("rejects negative stroop counts on the parse side (the form accepts none)", () => {
    expect(parseXlmAmount("-1")).toBeNull();
    expect(parseXlmAmount("-0.5")).toBeNull();
    // The formatter still renders the sign; the pair round-trips from the
    // absolute value.
    expect(formatXlmAmount(BigInt(-10_000_000))).toBe("-1");
    expect(parseXlmAmount(formatXlmAmount(BigInt(-10_000_000)).slice(1))).toBe(
      BigInt(10_000_000)
    );
  });

  it("rejects more than seven decimals rather than silently rounding", () => {
    expect(parseXlmAmount("1.0000000")).toBe(STROOPS_PER_XLM);
    expect(parseXlmAmount("1.0000001")).toBe(BigInt(10_000_001));
    expect(parseXlmAmount("1.00000001")).toBeNull();
  });

  it("rejects non-numeric and partially-numeric strings", () => {
    // `parseAmount` rejects a numeric *prefix* ("12px") and a locale-formatted
    // decimal ("1,234.50"), which `parseFloat` would silently truncate.
    for (const input of ["", "abc", "12px", "1,234.50", "  ", "0x10", "$"]) {
      expect(parseAmount(input)).toBeNull();
    }
    // The XLM amount parser is stricter still: it only accepts a plain decimal
    // with at most seven fractional digits, never an exponent.
    for (const input of ["", "abc", "12px", "1,234.50", "1e3", "  ", "0x10"]) {
      expect(parseXlmAmount(input)).toBeNull();
    }
  });

  it("tolerates surrounding whitespace, including Unicode whitespace", () => {
    expect(parseXlmAmount("\u00a01.5\u00a0")).toBe(BigInt(15_000_000));
    expect(parseAmount("\u00a012.5\u00a0")).toBe(12.5);
    expect(parseAmount("\t1.5\n")).toBe(1.5);
  });

  it("accepts complete numbers, including an explicit exponent", () => {
    expect(parseAmount("1e3")).toBe(1000);
    expect(parseAmount("-2.5")).toBe(-2.5);
    expect(parseAmount(".5")).toBe(0.5);
    expect(parseAmount("42")).toBe(42);
  });

  it("renders the placeholder for non-finite input instead of throwing", () => {
    for (const value of [NaN, Infinity, -Infinity]) {
      expect(parseAmount(value)).toBeNull();
      expect(formatDecimal(value)).toBe(NON_FINITE_AMOUNT);
      expect(stroopsToDisplay(value)).toBe(NON_FINITE_AMOUNT);
    }
  });
});
