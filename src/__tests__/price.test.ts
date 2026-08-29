// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isFinitePositiveNumber,
  normalizeCurrencyDisplay,
  formatXlmAmount,
  formatUsdAmount,
  convertXlmToUsd,
  formatPaymentRowAmount,
  fetchXlmPrice,
  STORAGE_KEYS,
  DEFAULT_CURRENCY,
  XLM_STROOPS,
  XLM_DECIMALS,
  USD_DECIMALS,
} from "@/lib/price";

describe("Price Constants and Configuration", () => {
  it("defines standard constants correctly", () => {
    expect(STORAGE_KEYS.currencyDisplay).toBe("payments.currencyDisplay");
    expect(DEFAULT_CURRENCY).toBe("XLM");
    expect(XLM_STROOPS).toBe(10_000_000);
    expect(XLM_DECIMALS).toBe(7);
    expect(USD_DECIMALS).toBe(2);
  });
});

describe("isFinitePositiveNumber", () => {
  it("returns true for valid non-negative finite numbers", () => {
    expect(isFinitePositiveNumber(0)).toBe(true);
    expect(isFinitePositiveNumber(100)).toBe(true);
    expect(isFinitePositiveNumber(0.0000001)).toBe(true);
    expect(isFinitePositiveNumber(123456789.9876543)).toBe(true);
  });

  it("returns false for negative numbers, NaN, Infinity, and non-numbers", () => {
    expect(isFinitePositiveNumber(-1)).toBe(false);
    expect(isFinitePositiveNumber(-0.0001)).toBe(false);
    expect(isFinitePositiveNumber(NaN)).toBe(false);
    expect(isFinitePositiveNumber(Infinity)).toBe(false);
    expect(isFinitePositiveNumber(-Infinity)).toBe(false);
    expect(isFinitePositiveNumber("100")).toBe(false);
    expect(isFinitePositiveNumber(null)).toBe(false);
    expect(isFinitePositiveNumber(undefined)).toBe(false);
    expect(isFinitePositiveNumber({})).toBe(false);
  });
});

describe("normalizeCurrencyDisplay", () => {
  it("returns USD when given 'USD'", () => {
    expect(normalizeCurrencyDisplay("USD")).toBe("USD");
  });

  it("returns XLM for 'XLM', invalid strings, or other types", () => {
    expect(normalizeCurrencyDisplay("XLM")).toBe("XLM");
    expect(normalizeCurrencyDisplay("usd")).toBe("XLM");
    expect(normalizeCurrencyDisplay("EUR")).toBe("XLM");
    expect(normalizeCurrencyDisplay("")).toBe("XLM");
    expect(normalizeCurrencyDisplay(null)).toBe("XLM");
    expect(normalizeCurrencyDisplay(undefined)).toBe("XLM");
    expect(normalizeCurrencyDisplay(123)).toBe("XLM");
  });
});

describe("formatXlmAmount", () => {
  it("formats positive XLM amounts with locale separators and proper decimals", () => {
    expect(formatXlmAmount(10)).toBe("10.00");
    expect(formatXlmAmount(1234.56)).toBe("1,234.56");
    expect(formatXlmAmount(0.1234567)).toBe("0.1234567");
    expect(formatXlmAmount(0)).toBe("0.00");
  });

  it("handles maximum 7 decimal places for XLM (Stellar Stroop precision)", () => {
    expect(formatXlmAmount(1.123456789)).toBe("1.1234568");
  });

  it("returns '—' for invalid or negative amounts", () => {
    expect(formatXlmAmount(-1)).toBe("—");
    expect(formatXlmAmount(NaN)).toBe("—");
    expect(formatXlmAmount(Infinity)).toBe("—");
  });
});

describe("formatUsdAmount", () => {
  it("formats valid USD amounts to standard 2-decimal currency representation", () => {
    expect(formatUsdAmount(10)).toBe("$10.00");
    expect(formatUsdAmount(1234.56)).toBe("$1,234.56");
    expect(formatUsdAmount(0)).toBe("$0.00");
    expect(formatUsdAmount(0.004)).toBe("$0.00");
    expect(formatUsdAmount(0.005)).toBe("$0.01");
  });

  it("returns 'Unavailable' fallback for null, undefined, negative, or invalid amounts", () => {
    expect(formatUsdAmount(null)).toBe("Unavailable");
    expect(formatUsdAmount(undefined)).toBe("Unavailable");
    expect(formatUsdAmount(-5)).toBe("Unavailable");
    expect(formatUsdAmount(NaN)).toBe("Unavailable");
    expect(formatUsdAmount(Infinity)).toBe("Unavailable");
  });
});

describe("convertXlmToUsd", () => {
  it("converts XLM to USD accurately with numeric rate", () => {
    expect(convertXlmToUsd(100, 0.12)).toBe(12);
    expect(convertXlmToUsd(50, 0.20)).toBe(10);
    expect(convertXlmToUsd(0, 0.50)).toBe(0);
  });

  it("converts XLM to USD accurately with PriceSource object", () => {
    expect(convertXlmToUsd(100, { xlmUsd: 0.15 })).toBe(15);
    expect(convertXlmToUsd(200, { xlmUsd: 0.25, updatedAt: "2026-08-29" })).toBe(50);
  });

  it("returns null if price rate is null, undefined, 0, or negative", () => {
    expect(convertXlmToUsd(100, null)).toBeNull();
    expect(convertXlmToUsd(100, undefined)).toBeNull();
    expect(convertXlmToUsd(100, 0)).toBeNull();
    expect(convertXlmToUsd(100, -0.15)).toBeNull();
    expect(convertXlmToUsd(100, { xlmUsd: null })).toBeNull();
    expect(convertXlmToUsd(100, { xlmUsd: 0 })).toBeNull();
  });

  it("returns null if XLM amount is negative, NaN, or invalid", () => {
    expect(convertXlmToUsd(-10, 0.15)).toBeNull();
    expect(convertXlmToUsd(NaN, 0.15)).toBeNull();
    expect(convertXlmToUsd(Infinity, 0.15)).toBeNull();
  });
});

describe("formatPaymentRowAmount", () => {
  it("formats correctly in XLM mode", () => {
    expect(formatPaymentRowAmount(10_000_000, "XLM")).toBe("1.00 XLM");
    expect(formatPaymentRowAmount(100_000_000, "XLM")).toBe("10.00 XLM");
    expect(formatPaymentRowAmount(1_234_567_890, "XLM")).toBe("123.456789 XLM");
  });

  it("formats correctly in USD mode when price is available", () => {
    expect(formatPaymentRowAmount(10_000_000, "USD", 0.12)).toBe("$0.12");
    expect(formatPaymentRowAmount(100_000_000, "USD", 0.20)).toBe("$2.00");
    expect(formatPaymentRowAmount(10_000_000, "USD", { xlmUsd: 0.50 })).toBe("$0.50");
  });

  it("returns 'Unavailable' in USD mode when price is unavailable or invalid", () => {
    expect(formatPaymentRowAmount(10_000_000, "USD", null)).toBe("Unavailable");
    expect(formatPaymentRowAmount(10_000_000, "USD", undefined)).toBe("Unavailable");
    expect(formatPaymentRowAmount(10_000_000, "USD", 0)).toBe("Unavailable");
    expect(formatPaymentRowAmount(10_000_000, "USD", { xlmUsd: null })).toBe("Unavailable");
  });

  it("returns '—' for invalid stroop amounts", () => {
    expect(formatPaymentRowAmount(-1000, "XLM")).toBe("—");
    expect(formatPaymentRowAmount(NaN, "USD", 0.12)).toBe("—");
  });
});

describe("fetchXlmPrice", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns parsed price source when API returns valid data", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ price: 0.145, source: "coingecko", updatedAt: "2026-08-29T10:00:00Z" }),
    } as Response);

    const result = await fetchXlmPrice();
    expect(result.xlmUsd).toBe(0.145);
    expect(result.source).toBe("coingecko");
    expect(result.updatedAt).toBe("2026-08-29T10:00:00Z");
  });

  it("returns error PriceSource when API returns HTTP error", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    } as Response);

    const result = await fetchXlmPrice();
    expect(result.xlmUsd).toBeNull();
    expect(result.error).toContain("503");
  });

  it("returns error PriceSource when API returns invalid payload", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ invalid: true }),
    } as Response);

    const result = await fetchXlmPrice();
    expect(result.xlmUsd).toBeNull();
    expect(result.error).toBe("Invalid price rate received");
  });

  it("returns error PriceSource when fetch encounters network error", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network failed"));

    const result = await fetchXlmPrice();
    expect(result.xlmUsd).toBeNull();
    expect(result.error).toBe("Network failed");
  });
});
