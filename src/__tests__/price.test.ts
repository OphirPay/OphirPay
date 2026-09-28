// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchXlmPrice,
  convertXlmToUsd,
  formatFiatAmount,
  clearPriceCache,
  setCachedPrice,
  ROUNDING_RULES,
  PRICE_CACHE_TTL_MS,
  PRICE_STALE_AFTER_MS,
  PRICE_BACKOFF_BASE_MS,
  isPriceStale,
  getPriceProvider,
} from "@/lib/price";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useXlmPrice } from "@/hooks/usePrice";

const okGecko = (usd: number) => ({ ok: true, json: async () => ({ stellar: { usd } }) });
const okCoinbase = (amount: string) => ({
  ok: true,
  json: async () => ({ data: { amount } }),
});
const rateLimited = (retryAfter?: string) => ({
  ok: false,
  status: 429,
  headers: { get: (h: string) => (h === "Retry-After" ? (retryAfter ?? null) : null) },
});

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
    });
  });
  describe("hardening: cache, SWR, backoff, staleness", () => {
    const T0 = 1_700_000_000_000;

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(T0);
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    });

    it("does not hit upstream for repeated lookups within the TTL", async () => {
      const fetchMock = vi.fn().mockResolvedValue(okGecko(0.11));
      vi.stubGlobal("fetch", fetchMock);

      await fetchXlmPrice();
      vi.setSystemTime(T0 + PRICE_CACHE_TTL_MS - 1);
      const results = await Promise.all([fetchXlmPrice(), fetchXlmPrice(), fetchXlmPrice()]);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      for (const r of results) {
        expect(r).toMatchObject({ price: 0.11, source: "cached", timestamp: T0, stale: false });
        expect(r.revalidating).toBeUndefined();
      }
    });

    it("serves the cached value between TTL and threshold and revalidates once in the background", async () => {
      let release!: (v: unknown) => void;
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(okGecko(0.1))
        .mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
      vi.stubGlobal("fetch", fetchMock);

      await fetchXlmPrice();
      vi.setSystemTime(T0 + PRICE_CACHE_TTL_MS + 1);

      const a = await fetchXlmPrice();
      const b = await fetchXlmPrice();
      expect(a).toMatchObject({ price: 0.1, source: "cached", stale: false, revalidating: true });
      expect(b.revalidating).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2); // one initial + ONE deduped refresh

      vi.setSystemTime(T0 + PRICE_CACHE_TTL_MS + 50);
      release(okGecko(0.2));
      await vi.waitFor(async () => {
        expect((await fetchXlmPrice()).price).toBe(0.2);
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("marks the last known price stale beyond the threshold when refresh fails", async () => {
      setCachedPrice(0.12, "coingecko", T0 - PRICE_STALE_AFTER_MS - 1);
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));

      const result = await fetchXlmPrice();
      expect(result).toMatchObject({
        price: 0.12,
        source: "cached",
        stale: true,
        timestamp: T0 - PRICE_STALE_AFTER_MS - 1,
      });
      expect(result.error).toContain("using last known price");
    });

    it("blocks on a refresh once the value is past the threshold and returns the fresh price", async () => {
      setCachedPrice(0.12, "coingecko", T0 - PRICE_STALE_AFTER_MS - 1);
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okGecko(0.3)));

      const result = await fetchXlmPrice();
      expect(result).toMatchObject({ price: 0.3, source: "coingecko", stale: false });
    });

    it("isPriceStale is strictly greater-than the threshold", () => {
      expect(isPriceStale(T0 - 1000, 1000, T0)).toBe(false);
      expect(isPriceStale(T0 - 1001, 1000, T0)).toBe(true);
    });

    it("never throws on upstream errors: 500, 429, bad JSON and network failure", async () => {
      const cases = [
        vi.fn().mockResolvedValue({ ok: false, status: 500 }),
        vi.fn().mockResolvedValue(rateLimited()),
        vi.fn().mockResolvedValue({ ok: true, json: async () => { throw new Error("bad json"); } }),
        vi.fn().mockRejectedValue(new TypeError("fetch failed")),
      ];
      for (const fetchMock of cases) {
        clearPriceCache();
        vi.stubGlobal("fetch", fetchMock);
        const result = await fetchXlmPrice();
        expect(result).toMatchObject({ price: null, source: null });
        expect(result.error).toBeTruthy();
      }
    });

    it("stops calling a rate-limited provider until Retry-After elapses", async () => {
      const fetchMock = vi.fn(async (url: string) =>
        url.includes("coingecko") ? rateLimited("120") : okCoinbase("0.14")
      );
      vi.stubGlobal("fetch", fetchMock);

      await fetchXlmPrice({ forceRefresh: true });
      expect(fetchMock).toHaveBeenCalledTimes(2); // gecko 429 -> coinbase

      // forceRefresh bypasses the cache but NOT the cooldown: coinbase only.
      await fetchXlmPrice({ forceRefresh: true });
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(String(fetchMock.mock.calls[2][0])).toContain("coinbase");

      vi.setSystemTime(T0 + 120_001);
      await fetchXlmPrice({ forceRefresh: true });
      expect(String(fetchMock.mock.calls[3][0])).toContain("coingecko");
    });

    it("reports 'rate limited' with no cache when every provider is cooling down", async () => {
      const fetchMock = vi.fn().mockResolvedValue(rateLimited());
      vi.stubGlobal("fetch", fetchMock);

      const first = await fetchXlmPrice();
      expect(first.error).toContain("rate limited");
      expect(fetchMock).toHaveBeenCalledTimes(2);

      const second = await fetchXlmPrice();
      expect(second).toMatchObject({ price: null, source: null });
      expect(second.error).toContain("rate limited");
      expect(fetchMock).toHaveBeenCalledTimes(2); // no upstream traffic while backed off
    });

    it("backs off exponentially after non-429 failures and recovers on success", async () => {
      const fetchMock = vi.fn().mockRejectedValue(new Error("boom"));
      vi.stubGlobal("fetch", fetchMock);
      vi.stubEnv("PRICE_PROVIDER", "coingecko");

      await fetchXlmPrice();
      await fetchXlmPrice();
      expect(fetchMock).toHaveBeenCalledTimes(1); // second call skipped by cooldown

      vi.setSystemTime(T0 + PRICE_BACKOFF_BASE_MS + 1);
      fetchMock.mockResolvedValueOnce(okGecko(0.15));
      const ok = await fetchXlmPrice();
      expect(ok.price).toBe(0.15);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("does not penalise a provider when the caller aborts", async () => {
      const fetchMock = vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError"));
      vi.stubGlobal("fetch", fetchMock);
      const controller = new AbortController();
      controller.abort();

      await fetchXlmPrice({ signal: controller.signal });
      fetchMock.mockResolvedValue(okGecko(0.16));
      expect((await fetchXlmPrice()).price).toBe(0.16);
    });

    it("passes an abort signal so the outbound request has an explicit timeout", async () => {
      const fetchMock = vi.fn().mockResolvedValue(okGecko(0.1));
      vi.stubGlobal("fetch", fetchMock);
      await fetchXlmPrice();
      expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    });

    it("honours PRICE_PROVIDER (single provider, no failover)", async () => {
      vi.stubEnv("PRICE_PROVIDER", "coinbase");
      expect(getPriceProvider()).toBe("coinbase");
      const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
      vi.stubGlobal("fetch", fetchMock);

      await fetchXlmPrice();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0][0])).toContain("coinbase");

      vi.stubEnv("PRICE_PROVIDER", "nonsense");
      expect(getPriceProvider()).toBe("auto");
    });

    it("sends PRICE_API_KEY to CoinGecko only when configured", async () => {
      const fetchMock = vi.fn().mockResolvedValue(okGecko(0.1));
      vi.stubGlobal("fetch", fetchMock);

      await fetchXlmPrice({ forceRefresh: true });
      expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty("x-cg-demo-api-key");

      vi.stubEnv("PRICE_API_KEY", "demo-key");
      await fetchXlmPrice({ forceRefresh: true });
      expect(fetchMock.mock.calls[1][1].headers["x-cg-demo-api-key"]).toBe("demo-key");
    });

    it("honours PRICE_CACHE_TTL_MS", async () => {
      vi.stubEnv("PRICE_CACHE_TTL_MS", "1000");
      const fetchMock = vi.fn().mockResolvedValue(okGecko(0.1));
      vi.stubGlobal("fetch", fetchMock);
      await fetchXlmPrice();
      vi.setSystemTime(T0 + 1001);
      const r = await fetchXlmPrice();
      expect(r.revalidating).toBe(true);
    });
  });

  describe("useXlmPrice staleness", () => {
    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    it("hides a stale price and exposes the observation timestamp", async () => {
      const observed = Date.now() - PRICE_STALE_AFTER_MS - 1000;
      setCachedPrice(0.12, "coingecko", observed);
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));

      const { result } = renderHook(() => useXlmPrice());
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.price).toBeNull();
      expect(result.current.lastKnownPrice).toBe(0.12);
      expect(result.current.isStale).toBe(true);
      expect(result.current.isUnavailable).toBe(true);
      expect(result.current.observedAt).toBe(observed);
    });

    it("flips a fresh price to stale once the threshold passes, without refetching", async () => {
      vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
      const fetchMock = vi.fn().mockResolvedValue(okGecko(0.2));
      vi.stubGlobal("fetch", fetchMock);

      const { result } = renderHook(() => useXlmPrice({ staleAfterMs: 90_000 }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.price).toBe(0.2);
      expect(result.current.isStale).toBe(false);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(90_002);
      });
      expect(result.current.price).toBeNull();
      expect(result.current.isStale).toBe(true);
    });
  });
});
