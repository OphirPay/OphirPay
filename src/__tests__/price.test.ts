// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchXlmPrice,
  convertXlmToUsd,
  formatFiatAmount,
  formatPriceOrAsset,
  clearPriceCache,
  setCachedPrice,
  ROUNDING_RULES,
  PRICE_CACHE_TTL_MS,
  PRICE_STALE_THRESHOLD_MS,
  RATE_LIMIT_COOLDOWN_MS,
} from "@/lib/price";

describe("Price Utility & Precision Rules", () => {
  beforeEach(() => {
    clearPriceCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    clearPriceCache();
    vi.restoreAllMocks();
  });

  describe("fetchXlmPrice", () => {
    it("fetches XLM price successfully from primary source (CoinGecko)", async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ stellar: { usd: 0.125 } }),
      });
      global.fetch = mockFetch;

      const result = await fetchXlmPrice();
      expect(result.price).toBe(0.125);
      expect(result.source).toBe("coingecko");
      expect(result.error).toBeUndefined();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("falls back to secondary source (Coinbase) when CoinGecko fails", async () => {
      const mockFetch = vi
        .fn()
        // First call: CoinGecko fails (e.g. 429 rate limit or 500 error)
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
        })
        // Second call: Coinbase succeeds
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: { base: "XLM", currency: "USD", amount: "0.1275" } }),
        });
      global.fetch = mockFetch;

      const result = await fetchXlmPrice();
      expect(result.price).toBe(0.1275);
      expect(result.source).toBe("coinbase");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("returns null and error gracefully when all sources fail and no cache exists", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("Network offline"));
      global.fetch = mockFetch;

      const result = await fetchXlmPrice();
      expect(result.price).toBeNull();
      expect(result.source).toBeNull();
      expect(result.error).toBe("XLM/USD price sources unavailable");
    });

    it("serves cached price on subsequent calls within TTL without making new network requests", async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ stellar: { usd: 0.13 } }),
      });
      global.fetch = mockFetch;

      const firstResult = await fetchXlmPrice();
      expect(firstResult.price).toBe(0.13);
      expect(firstResult.source).toBe("coingecko");
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Second call immediately — should use cache
      const secondResult = await fetchXlmPrice();
      expect(secondResult.price).toBe(0.13);
      expect(secondResult.source).toBe("cached");
      expect(mockFetch).toHaveBeenCalledTimes(1); // No new network call
    });

    it("forces network refresh when forceRefresh is true", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ stellar: { usd: 0.13 } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ stellar: { usd: 0.135 } }),
        });
      global.fetch = mockFetch;

      await fetchXlmPrice();
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const refreshed = await fetchXlmPrice({ forceRefresh: true });
      expect(refreshed.price).toBe(0.135);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("returns stale cached price with warning if refresh fails", async () => {
      setCachedPrice(0.12, "coingecko");

      // Network now fails
      const mockFetch = vi.fn().mockRejectedValue(new Error("Network down"));
      global.fetch = mockFetch;

      const result = await fetchXlmPrice({ forceRefresh: true });
      expect(result.price).toBe(0.12);
      expect(result.source).toBe("cached");
      expect(result.error).toContain("using last known price");
    });

    it("handles invalid or non-numeric response gracefully", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ stellar: { usd: "not-a-number" } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: { amount: null } }),
        });
      global.fetch = mockFetch;

      const result = await fetchXlmPrice();
      expect(result.price).toBeNull();
      expect(result.error).toBeDefined();
    });

    it("cleans up timeout timers when fetch rejects immediately", async () => {
      const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
      const mockFetch = vi.fn().mockRejectedValue(new Error("Immediate network drop"));
      global.fetch = mockFetch;

      const result = await fetchXlmPrice();
      expect(result.price).toBeNull();
      // Primary and secondary oracle timeout timers were both cleared in finally blocks
      expect(clearTimeoutSpy).toHaveBeenCalled();
    });

    it("respects external AbortSignal", async () => {
      const controller = new AbortController();
      controller.abort();

      const result = await fetchXlmPrice({ signal: controller.signal });
      expect(result.price).toBeNull();
      expect(result.error).toBeDefined();
    });
  });

  describe("convertXlmToUsd", () => {
    it("converts XLM amounts correctly with given price", () => {
      expect(convertXlmToUsd(100, 0.15)).toBe(15);
      expect(convertXlmToUsd(1, 0.1234)).toBe(0.1234);
      expect(convertXlmToUsd("50", 0.2)).toBe(10);
    });

    it("returns 0 when XLM amount is 0", () => {
      expect(convertXlmToUsd(0, 0.15)).toBe(0);
    });

    it("returns null for invalid inputs or unavailable price", () => {
      expect(convertXlmToUsd(100, null)).toBeNull();
      expect(convertXlmToUsd(100, undefined)).toBeNull();
      expect(convertXlmToUsd(100, 0)).toBeNull();
      expect(convertXlmToUsd(100, -0.1)).toBeNull();
      expect(convertXlmToUsd("invalid", 0.15)).toBeNull();
    });
  });

  describe("formatFiatAmount & Rounding Rules", () => {
    it("formats standard amounts (>= $0.01) with standard 2 decimal places and half-up rounding", () => {
      expect(formatFiatAmount(12.34)).toBe("$12.34");
      expect(formatFiatAmount(12.345)).toBe("$12.35");
      expect(formatFiatAmount(12.344)).toBe("$12.34");
      expect(formatFiatAmount(1000)).toBe("$1,000.00");
    });

    it("includes approximation prefix when showApprox is true", () => {
      expect(formatFiatAmount(12.34, { showApprox: true })).toBe("~$12.34");
      expect(formatFiatAmount(0, { showApprox: true })).toBe("~$0.00");
    });

    it("formats exactly 0 as $0.00", () => {
      expect(formatFiatAmount(0)).toBe("$0.00");
    });

    it("formats micro amounts (0 < amount < 0.01) as <$0.01 by default", () => {
      expect(formatFiatAmount(0.005)).toBe("<$0.01");
      expect(formatFiatAmount(0.0001)).toBe("<$0.01");
      expect(formatFiatAmount(-0.005)).toBe("-<$0.01");
    });

    it("formats micro amounts with custom precision when allowMicro is true", () => {
      expect(formatFiatAmount(0.0045, { allowMicro: true })).toBe("$0.0045");
      expect(formatFiatAmount(0.00456, { allowMicro: true, maxDecimals: 5 })).toBe("$0.00456");
    });

    it("returns fallback for null, undefined, or NaN", () => {
      expect(formatFiatAmount(null)).toBe("—");
      expect(formatFiatAmount(undefined)).toBe("—");
      expect(formatFiatAmount(NaN)).toBe("—");
      expect(formatFiatAmount(null, { fallback: "Unavailable" })).toBe("Unavailable");
    });

    it("exports standard rounding rule constants and cache TTL", () => {
      expect(ROUNDING_RULES.USD_STANDARD_DECIMALS).toBe(2);
      expect(ROUNDING_RULES.MICRO_THRESHOLD).toBe(0.01);
      expect(ROUNDING_RULES.XLM_MIN_DECIMALS).toBe(2);
      expect(ROUNDING_RULES.XLM_MAX_DECIMALS).toBe(7);
      expect(PRICE_CACHE_TTL_MS).toBe(60_000);
      expect(PRICE_STALE_THRESHOLD_MS).toBe(300_000);
      expect(RATE_LIMIT_COOLDOWN_MS).toBe(30_000);
    });
  });

  describe("Rate-Limit (HTTP 429) & Staleness Policy (Issue #814)", () => {
    it("handles 429 rate limit gracefully with defined staleness marker", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        headers: new Headers({ "retry-after": "10" }),
      });
      global.fetch = mockFetch;

      const result = await fetchXlmPrice();
      expect(result.price).toBeNull();
      expect(result.isStale).toBe(true);
      expect(result.staleReason).toBe("rate_limited");
      expect(result.error).toContain("rate-limited");
    });

    it("serves stale cache with defined marker when upstream returns 429", async () => {
      setCachedPrice(0.14, "coingecko");

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
      });
      global.fetch = mockFetch;

      const result = await fetchXlmPrice({ forceRefresh: true });
      expect(result.price).toBe(0.14);
      expect(result.source).toBe("cached");
      expect(result.isStale).toBe(true);
      expect(result.staleReason).toBe("rate_limited");
      expect(result.error).toContain("rate-limited (HTTP 429)");
    });

    it("bypasses rate-limited oracle during cooldown period", async () => {
      // First call triggers 429 on CoinGecko, falls back to Coinbase
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: { amount: "0.128" } }),
        })
        // Next call with forceRefresh: CoinGecko should be skipped due to cooldown!
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: { amount: "0.129" } }),
        });
      global.fetch = mockFetch;

      const first = await fetchXlmPrice();
      expect(first.price).toBe(0.128);
      expect(first.source).toBe("coinbase");
      expect(mockFetch).toHaveBeenCalledTimes(2);

      const second = await fetchXlmPrice({ forceRefresh: true });
      expect(second.price).toBe(0.129);
      expect(second.source).toBe("coinbase");
      // CoinGecko was skipped, so only 1 more call (Coinbase) was made
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("sends API key header when provided in options", async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ stellar: { usd: 0.132 } }),
      });
      global.fetch = mockFetch;

      const result = await fetchXlmPrice({ apiKey: "test-api-key" });
      expect(result.price).toBe(0.132);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("coingecko.com"),
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-cg-demo-api-key": "test-api-key",
          }),
        })
      );
    });
  });

  describe("formatPriceOrAsset", () => {
    it("displays formatted USD when price is fresh", () => {
      const freshResult = {
        price: 0.12,
        source: "coingecko" as const,
        timestamp: Date.now(),
        isStale: false,
      };

      const formatted = formatPriceOrAsset(100, freshResult);
      expect(formatted.display).toBe("~$12.00");
      expect(formatted.isStale).toBe(false);
      expect(formatted.isFiat).toBe(true);
    });

    it("falls back to asset unit when price is unavailable", () => {
      const unavailResult = {
        price: null,
        source: null,
        isStale: true,
      };

      const formatted = formatPriceOrAsset(250, unavailResult, "XLM");
      expect(formatted.display).toBe("250 XLM");
      expect(formatted.isStale).toBe(true);
      expect(formatted.isFiat).toBe(false);
    });

    it("indicates staleness clearly when price is marked stale", () => {
      const staleResult = {
        price: 0.10,
        source: "cached" as const,
        timestamp: Date.now() - PRICE_STALE_THRESHOLD_MS - 1000,
        isStale: true,
      };

      const formatted = formatPriceOrAsset(50, staleResult, "XLM");
      expect(formatted.display).toContain("50 XLM (~$5.00 stale)");
      expect(formatted.isStale).toBe(true);
      expect(formatted.isFiat).toBe(false);
    });
  });
});
