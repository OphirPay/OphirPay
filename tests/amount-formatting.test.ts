// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  formatAmount,
  parseAmount,
  validateAmount,
  normalizeAmountString,
  formatCompact,
} from "@/components/ui/Amount";
import { useCurrencyDisplay } from "@/hooks/useCurrencyDisplay";

describe("Property-based fuzz testing for currency amounts (5,000 runs)", () => {
  it("round-trips 5,000 arbitrary integer amounts: parseAmount(formatAmount(val)) === val", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000_000_000 }), (val) => {
        const formatted = formatAmount(val);
        const parsed = parseAmount(formatted);
        expect(parsed).toBe(val);
      }),
      { numRuns: 5000 }
    );
  });

  it("round-trips 5,000 arbitrary decimal amounts with Stellar precision (up to 7 decimals)", () => {
    // Generate valid numbers with 1 to 7 decimal places
    const validCurrencyAmount = fc
      .tuple(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 1, max: 7 })
      )
      .map(([units, dec]) => {
        const factor = Math.pow(10, dec);
        return Number((units / factor).toFixed(dec));
      });

    fc.assert(
      fc.property(validCurrencyAmount, (val) => {
        const formatted = formatAmount(val);
        const parsed = parseAmount(formatted);
        expect(parsed).toBe(val);
      }),
      { numRuns: 5000 }
    );
  });

  it("round-trips amounts with arbitrary asset codes (XLM, USDC, EURC, etc.)", () => {
    const assets = ["XLM", "USDC", "EURC", "USD", "EUR", "BTC", "ETH", "AQUA"];
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000_000 }).map((n) => Number((n / 100).toFixed(2))),
        fc.constantFrom(...assets),
        (val, asset) => {
          const formatted = formatAmount(val, asset);
          const parsed = parseAmount(formatted);
          expect(parsed).toBe(val);
        }
      ),
      { numRuns: 1000 }
    );
  });

  it("round-trips amounts with currency symbols ($1,234.56, €1,234.56, etc.)", () => {
    const symbols = ["$", "€", "£", "¥", "₹"];
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000_000 }).map((n) => Number((n / 100).toFixed(2))),
        fc.constantFrom(...symbols),
        (val, sym) => {
          const formatted = `${sym}${formatAmount(val)}`;
          const parsed = parseAmount(formatted);
          expect(parsed).toBe(val);
        }
      ),
      { numRuns: 1000 }
    );
  });
});

describe("Edge-case inputs & Unicode normalization", () => {
  it("handles Unicode non-breaking and thin spaces without error", () => {
    const unicodeSpacedInputs = [
      "1\u00A0234.56 XLM",
      "1\u202F234.56 XLM",
      "1\u200B234.56 XLM",
      " \u3000 1234.56 \t ",
    ];
    for (const input of unicodeSpacedInputs) {
      expect(parseAmount(input)).toBe(1234.56);
    }
  });

  it("handles European decimal separators (comma as decimal, dot as thousand separator)", () => {
    expect(parseAmount("1.234,56")).toBe(1234.56);
    expect(parseAmount("1234,56")).toBe(1234.56);
    expect(parseAmount("12,50 XLM")).toBe(12.5);
    expect(parseAmount("1.000.000,50")).toBe(1000000.5);
  });

  it("handles scientific / exponential notation cleanly", () => {
    expect(parseAmount("1e-4")).toBe(0.0001);
    expect(parseAmount("2.5e3")).toBe(2500);
    expect(parseAmount("1e-7")).toBe(0.0000001);
    // Never leaks scientific notation when formatting
    expect(formatAmount(1e-7)).toBe("0.0000001");
    expect(formatAmount(1e-7)).not.toMatch(/e/i);
  });

  it("handles leading zeros and boundary numbers", () => {
    expect(parseAmount("00123.4500")).toBe(123.45);
    expect(parseAmount("000.05")).toBe(0.05);
    expect(parseAmount("0.0000000")).toBe(0);
    expect(parseAmount("0")).toBe(0);
  });

  it("handles negative numbers and Unicode minus signs", () => {
    expect(parseAmount("-1234.56")).toBe(-1234.56);
    expect(parseAmount("\u22121234.56")).toBe(-1234.56);
    expect(formatAmount(-42.5)).toBe("-42.50");
  });

  it("gracefully returns null on malformed inputs without throwing exceptions", () => {
    const invalidInputs = [
      "",
      "   ",
      "abc",
      "12px",
      "$1.2.3.4",
      "12.34.56",
      "--5",
      "++5",
      "null",
      "undefined",
      NaN,
      Infinity,
      -Infinity,
      null,
      undefined,
    ];

    for (const invalid of invalidInputs) {
      expect(() => parseAmount(invalid as any)).not.toThrow();
      expect(parseAmount(invalid as any)).toBeNull();
    }
  });
});

describe("validateAmount detailed validation", () => {
  it("rejects empty inputs with EMPTY code", () => {
    const res = validateAmount("");
    expect(res.valid).toBe(false);
    expect(res.code).toBe("EMPTY");
  });

  it("rejects non-numeric strings with INVALID_FORMAT code", () => {
    const res = validateAmount("not_a_number");
    expect(res.valid).toBe(false);
    expect(res.code).toBe("INVALID_FORMAT");
  });

  it("rejects negative amounts when allowNegative is false", () => {
    const res = validateAmount("-50.00", { allowNegative: false });
    expect(res.valid).toBe(false);
    expect(res.code).toBe("NEGATIVE_NOT_ALLOWED");
  });

  it("accepts negative amounts when allowNegative is true", () => {
    const res = validateAmount("-50.00", { allowNegative: true });
    expect(res.valid).toBe(true);
    expect(res.value).toBe(-50);
  });

  it("rejects amounts exceeding maximum decimal precision", () => {
    // 8 decimals exceeds Stellar standard max of 7 decimals
    const res = validateAmount("100.12345678", { maxDecimals: 7 });
    expect(res.valid).toBe(false);
    expect(res.code).toBe("EXCESSIVE_DECIMALS");
    expect(res.error).toContain("7 decimal places");

    // 7 decimals is accepted
    const validRes = validateAmount("100.1234567", { maxDecimals: 7 });
    expect(validRes.valid).toBe(true);
    expect(validRes.value).toBe(100.1234567);
  });

  it("enforces minimum and maximum range bounds", () => {
    const minRes = validateAmount("0.5", { min: 1.0 });
    expect(minRes.valid).toBe(false);
    expect(minRes.code).toBe("OUT_OF_RANGE");

    const maxRes = validateAmount("500", { max: 100 });
    expect(maxRes.valid).toBe(false);
    expect(maxRes.code).toBe("OUT_OF_RANGE");

    const passRes = validateAmount("50", { min: 1, max: 100 });
    expect(passRes.valid).toBe(true);
    expect(passRes.value).toBe(50);
  });
});

describe("Compact formatting", () => {
  it("formats large numbers in compact human-readable notation", () => {
    expect(formatCompact(1500)).toBe("1.5K");
    expect(formatCompact(2500000)).toBe("2.5M");
    expect(formatCompact(1200000000)).toBe("1.2B");
    expect(formatCompact(50)).toBe("50.00");
    expect(formatCompact(NaN)).toBe("—");
  });
});
