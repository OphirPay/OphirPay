// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchXlmPrice,
  convertXlmToUsd,
  formatFiatAmount,
  formatPriceOrAsset,
  clearPriceCache,
  clearRateLimitState,
  setCachedPrice,
  parseRetryAfter,
  isSourceRateLimited,
  ROUNDING_RULES,
  PRICE_CACHE_TTL_MS,
  PRICE_STALE_THRESHOLD_MS,
  DEFAULT_RATE_LIMIT_COOLDOWN_MS,
} from "@/lib/price";

describe("Price Utility & Precision Rules", () => {
  beforeEach(() => {
    clearPriceCache();
    clearRateLimitState();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    clearPriceCache();
    clearRateLimitState();
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
      expect(DEFAULT_RATE_LIMIT_COOLDOWN_MS).toBe(30_000);
    });
  });

  describe("parseRetryAfter", () => {
    it("parses numeric seconds into milliseconds", () => {
      expect(parseRetryAfter("60")).toBe(60_000);
      expect(parseRetryAfter("15")).toBe(15_000);
      expect(parseRetryAfter("0")).toBe(0);
    });

    it("parses valid HTTP dates into relative milliseconds from now", () => {
      const futureDate = new Date(Date.now() + 45_000).toUTCString();
      const parsed = parseRetryAfter(futureDate);
      expect(parsed).toBeGreaterThanOrEqual(44_000);
      expect(parsed).toBeLessThanOrEqual(46_000);
    });

    it("falls back to default cooldown on null, empty, or invalid header", () => {
      expect(parseRetryAfter(null)).toBe(DEFAULT_RATE_LIMIT_COOLDOWN_MS);
      expect(parseRetryAfter(undefined)).toBe(DEFAULT_RATE_LIMIT_COOLDOWN_MS);
      expect(parseRetryAfter("invalid-format")).toBe(DEFAULT_RATE_LIMIT_COOLDOWN_MS);
    });
  });

  describe("Rate-Limit (429) Backoff & Failover", () => {
    it("parses 429 Retry-After header and enters cooldown for CoinGecko while falling back to Coinbase", async () => {
      const mockFetch = vi
        .fn()
        // CoinGecko returns 429 with Retry-After: 45
        .mockResolvedValueOnce({
          status: 429,
          headers: new Headers({ "retry-after": "45" }),
          ok: false,
        })
        // Coinbase succeeds
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
          json: async () => ({ data: { base: "XLM", currency: "USD", amount: "0.14" } }),
        });
      global.fetch = mockFetch;

      const result = await fetchXlmPrice();
      expect(result.price).toBe(0.14);
      expect(result.source).toBe("coinbase");
      expect(isSourceRateLimited("coingecko")).toBe(true);
      expect(isSourceRateLimited("coinbase")).toBe(false);

      // Next call with forceRefresh should skip CoinGecko while in cooldown and hit Coinbase directly
      const mockFetch2 = vi.fn().mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ data: { base: "XLM", currency: "USD", amount: "0.142" } }),
      });
      global.fetch = mockFetch2;

      const result2 = await fetchXlmPrice({ forceRefresh: true });
      expect(result2.price).toBe(0.142);
      expect(result2.source).toBe("coinbase");
      expect(mockFetch2).toHaveBeenCalledTimes(1); // CoinGecko was skipped
    });

    it("returns defined non-throwing result with rateLimited: true when all sources are 429 and cache exists", async () => {
      setCachedPrice(0.12, "coingecko", Date.now() - 10_000);

      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          status: 429,
          headers: new Headers({ "retry-after": "60" }),
          ok: false,
        })
        .mockResolvedValueOnce({
          status: 429,
          headers: new Headers({ "retry-after": "60" }),
          ok: false,
        });
      global.fetch = mockFetch;

      const result = await fetchXlmPrice({ forceRefresh: true });
      expect(result.price).toBe(0.12);
      expect(result.source).toBe("cached");
      expect(result.rateLimited).toBe(true);
      expect(result.error).toContain("rate-limit");
    });

    it("returns null price with rateLimited: true when all sources are 429 and no cache exists", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          status: 429,
          headers: new Headers({ "retry-after": "30" }),
          ok: false,
        })
        .mockResolvedValueOnce({
          status: 429,
          headers: new Headers({ "retry-after": "30" }),
          ok: false,
        });
      global.fetch = mockFetch;

      const result = await fetchXlmPrice();
      expect(result.price).toBeNull();
      expect(result.source).toBeNull();
      expect(result.rateLimited).toBe(true);
      expect(result.error).toBeDefined();
    });
  });

  describe("Staleness Policy & SWR Background Revalidation", () => {
    it("marks cached price as stale when age exceeds staleness threshold", async () => {
      // Set cache older than 5 minutes (300,000ms)
      const sixMinutesAgo = Date.now() - 360_000;
      setCachedPrice(0.115, "coingecko", sixMinutesAgo);

      // Upstream sources fail
      const mockFetch = vi.fn().mockRejectedValue(new Error("Oracle down"));
      global.fetch = mockFetch;

      const result = await fetchXlmPrice({ forceRefresh: true });
      expect(result.price).toBe(0.115);
      expect(result.source).toBe("cached");
      expect(result.isStale).toBe(true);
      expect(result.staleAgeMs).toBeGreaterThanOrEqual(360_000);
      expect(result.staleReason).toBeDefined();
    });

    it("serves cached price immediately and triggers background revalidation in SWR window", async () => {
      // Cache is 90 seconds old (exceeds 60s TTL, but within 300s stale threshold)
      const ninetySecsAgo = Date.now() - 90_000;
      setCachedPrice(0.12, "coingecko", ninetySecsAgo);

      let revalidationCalled = false;
      const mockFetch = vi.fn().mockImplementation(async () => {
        revalidationCalled = true;
        return {
          ok: true,
          json: async () => ({ stellar: { usd: 0.125 } }),
        };
      });
      global.fetch = mockFetch;

      const result = await fetchXlmPrice();
      expect(result.price).toBe(0.12);
      expect(result.source).toBe("cached");
      expect(result.isStale).toBe(false);

      // Revalidation was triggered in the background
      await vi.waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
        expect(revalidationCalled).toBe(true);
      });
    });
  });

  describe("API Key Header Injection", () => {
    it("attaches x-cg-demo-api-key header when apiKey is supplied", async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ stellar: { usd: 0.13 } }),
      });
      global.fetch = mockFetch;

      await fetchXlmPrice({ apiKey: "test-api-key-123", forceRefresh: true });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("coingecko.com"),
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-cg-demo-api-key": "test-api-key-123",
          }),
        })
      );
    });
  });

  describe("formatPriceOrAsset", () => {
    it("formats fresh price correctly in USD", () => {
      const result = formatPriceOrAsset(100, {
        price: 0.15,
        source: "coingecko",
        isStale: false,
      });

      expect(result.formatted).toBe("$15.00");
      expect(result.isFallback).toBe(false);
      expect(result.isStale).toBe(false);
    });

    it("formats stale price with (USD price stale) notice", () => {
      const result = formatPriceOrAsset(100, {
        price: 0.15,
        source: "cached",
        isStale: true,
      });

      expect(result.formatted).toBe("$15.00 (USD price stale)");
      expect(result.isFallback).toBe(false);
      expect(result.isStale).toBe(true);
    });

    it("falls back to asset unit when price is null or unavailable", () => {
      const result = formatPriceOrAsset(100, {
        price: null,
        source: null,
        error: "Unavailable",
      });

      expect(result.formatted).toBe("100 XLM (USD unavailable)");
      expect(result.isFallback).toBe(true);
      expect(result.isStale).toBe(false);
    });

    it("handles undefined or missing price result safely", () => {
      const result = formatPriceOrAsset("50.5", null);
      expect(result.formatted).toBe("50.5 XLM (USD unavailable)");
      expect(result.isFallback).toBe(true);
    });
  });
});
