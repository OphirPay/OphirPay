// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchXlmPrice,
  convertXlmToUsd,
  formatFiatAmount,
  formatPriceOrAsset,
  formatPriceUnavailableFallback,
  clearPriceCache,
  setCachedPrice,
  ROUNDING_RULES,
  PRICE_CACHE_TTL_MS,
  PRICE_STALE_THRESHOLD_MS,
  PRICE_BACKOFF_MS,
  DEFAULT_PRICE_TIMEOUT_MS,
} from "@/lib/price";

describe("Price Utility, Caching, Staleness & Rate-Limit Rules", () => {
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
      expect(result.isStale).toBe(false);
      expect(result.rateLimited).toBe(false);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("falls back to secondary source (Coinbase) when CoinGecko fails", async () => {
      const mockFetch = vi
        .fn()
        // First call: CoinGecko fails (e.g. 429 rate limit or 500 error)
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: new Headers({ "retry-after": "60" }),
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
      expect(result.isStale).toBe(false);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("returns null and error gracefully when all sources fail and no cache exists", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("Network offline"));
      global.fetch = mockFetch;

      const result = await fetchXlmPrice();
      expect(result.price).toBeNull();
      expect(result.source).toBeNull();
      expect(result.isStale).toBe(true);
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
      expect(secondResult.isStale).toBe(false);
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
      expect(result.isStale).toBe(true);
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

  describe("429 Rate-Limit Handling and Cooldown Backoff", () => {
    it("handles 429 on all sources and returns defined non-throwing result with rateLimited flag", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        headers: new Headers({ "retry-after": "45" }),
      });
      global.fetch = mockFetch;

      const result = await fetchXlmPrice();
      expect(result.price).toBeNull();
      expect(result.isStale).toBe(true);
      expect(result.rateLimited).toBe(true);
      expect(result.staleReason).toBe("rate_limited");
      expect(result.error).toContain("429");
    });

    it("falls back to cached price with rateLimited flag when 429 occurs and cache exists within threshold", async () => {
      setCachedPrice(0.14, "coingecko");

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        headers: new Headers({ "retry-after": "30" }),
      });
      global.fetch = mockFetch;

      const result = await fetchXlmPrice({ forceRefresh: true });
      expect(result.price).toBe(0.14);
      expect(result.source).toBe("cached");
      expect(result.isStale).toBe(true);
      expect(result.rateLimited).toBe(true);
      expect(result.staleReason).toBe("rate_limited");
      expect(result.error).toContain("rate-limited");
    });

    it("skips hammering rate-limited upstreams on subsequent calls during active backoff cooldown", async () => {
      setCachedPrice(0.14, "coingecko");

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        headers: new Headers({ "retry-after": "60" }),
      });
      global.fetch = mockFetch;

      // First call triggers 429 on both sources (2 fetches)
      await fetchXlmPrice({ forceRefresh: true });
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Second call during active cooldown should not make network requests
      const cooldownResult = await fetchXlmPrice();
      expect(cooldownResult.price).toBe(0.14);
      expect(cooldownResult.rateLimited).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2); // Still only 2 calls
    });
  });

  describe("Staleness Policy & Thresholds", () => {
    it("marks cached price as stale when age exceeds staleThresholdMs", async () => {
      // Set cache with timestamp 10 minutes ago (> 5m threshold)
      const tenMinutesAgo = Date.now() - 10 * 60_000;
      setCachedPrice(0.11, "coingecko", tenMinutesAgo);

      const mockFetch = vi.fn().mockRejectedValue(new Error("Network down"));
      global.fetch = mockFetch;

      const result = await fetchXlmPrice({ forceRefresh: true });
      // Price is too old to trust, returned as null with expired reason
      expect(result.price).toBeNull();
      expect(result.isStale).toBe(true);
      expect(result.staleReason).toBe("expired");
      expect(result.error).toContain("staleness threshold");
    });

    it("supports stale-while-revalidate policy serving cached data immediately", async () => {
      // Set cache older than TTL (2 minutes old) but within staleness threshold (5 minutes)
      const twoMinutesAgo = Date.now() - 2 * 60_000;
      setCachedPrice(0.125, "coingecko", twoMinutesAgo);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ stellar: { usd: 0.13 } }),
      });
      global.fetch = mockFetch;

      const result = await fetchXlmPrice({ staleWhileRevalidate: true });
      expect(result.price).toBe(0.125);
      expect(result.source).toBe("cached");
      expect(result.isStale).toBe(true);
    });
  });

  describe("Configurable Provider API Key", () => {
    it("passes apiKey in request headers when provided in options", async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ stellar: { usd: 0.125 } }),
      });
      global.fetch = mockFetch;

      await fetchXlmPrice({ apiKey: "test-cg-api-key" });
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const callHeaders = mockFetch.mock.calls[0][1]?.headers;
      expect(callHeaders["x-cg-demo-api-key"]).toBe("test-cg-api-key");
      expect(callHeaders["Authorization"]).toBe("Bearer test-cg-api-key");
    });

    it("reads API key from environment variables when options.apiKey is omitted", async () => {
      process.env.NEXT_PUBLIC_PRICE_PROVIDER_API_KEY = "env-api-key";

      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ stellar: { usd: 0.125 } }),
      });
      global.fetch = mockFetch;

      await fetchXlmPrice();
      const callHeaders = mockFetch.mock.calls[0][1]?.headers;
      expect(callHeaders["x-cg-demo-api-key"]).toBe("env-api-key");

      delete process.env.NEXT_PUBLIC_PRICE_PROVIDER_API_KEY;
    });
  });

  describe("formatPriceOrAsset Fallback Utility", () => {
    it("formats fiat amount when fresh price is available", () => {
      const freshResult = {
        price: 0.15,
        source: "coingecko" as const,
        isStale: false,
        timestamp: Date.now(),
      };
      const formatted = formatPriceOrAsset(100, freshResult);
      expect(formatted.isFiat).toBe(true);
      expect(formatted.isStale).toBe(false);
      expect(formatted.display).toBe("~$15.00");
    });

    it("falls back to displaying asset unit when price is unavailable", () => {
      const formatted = formatPriceOrAsset(10, null);
      expect(formatted.isFiat).toBe(false);
      expect(formatted.isStale).toBe(true);
      expect(formatted.display).toBe("10.00 XLM (USD price unavailable)");
    });

    it("falls back to displaying asset unit with clear stale indication when price is stale", () => {
      const staleResult = {
        price: 0.15,
        source: "cached" as const,
        isStale: true,
        timestamp: Date.now() - 60_000,
      };
      const formatted = formatPriceOrAsset(25, staleResult);
      expect(formatted.isFiat).toBe(false);
      expect(formatted.isStale).toBe(true);
      expect(formatted.display).toBe("25.00 XLM (USD price stale)");
    });

    it("falls back to displaying asset unit when timestamp exceeds staleness threshold", () => {
      const expiredResult = {
        price: 0.15,
        source: "cached" as const,
        isStale: false, // marked false but timestamp is 10m old
        timestamp: Date.now() - 10 * 60_000,
      };
      const formatted = formatPriceOrAsset(50, expiredResult);
      expect(formatted.isFiat).toBe(false);
      expect(formatted.isStale).toBe(true);
      expect(formatted.display).toBe("50.00 XLM (USD price stale)");
    });

    it("handles non-numeric amounts safely", () => {
      const formatted = formatPriceOrAsset("invalid", null);
      expect(formatted.display).toBe("— XLM");
      expect(formatted.amount).toBeNull();
    });
  });

  describe("formatPriceUnavailableFallback", () => {
    it("returns null when fresh price is available", () => {
      expect(formatPriceUnavailableFallback(10, { price: 0.15, isStale: false })).toBeNull();
    });

    it("returns fallback string when price is null", () => {
      expect(formatPriceUnavailableFallback(10, { price: null, isStale: true })).toBe(
        "10 XLM (USD price unavailable)"
      );
    });

    it("returns stale indicator string when price is stale", () => {
      expect(formatPriceUnavailableFallback(10, { price: 0.15, isStale: true })).toBe(
        "10 XLM (USD price stale)"
      );
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
      expect(PRICE_BACKOFF_MS).toBe(30_000);
      expect(DEFAULT_PRICE_TIMEOUT_MS).toBe(5_000);
    });
  });
});
