// SPDX-License-Identifier: MIT

/**
 * XLM / USD Price Utility & Conversion Service.
 *
 * Provides live spot pricing for Stellar Lumens (XLM) to USD with automatic
 * failover between price oracles (CoinGecko -> Coinbase), in-memory TTL caching,
 * request deduplication, timeout protection, and documented precision/rounding rules.
 *
 * ## Rounding Rules Specification:
 * 1. Standard USD Amounts (>= $0.01):
 *    - Formatted using standard currency formatting with 2 decimal places (e.g. "$12.34").
 *    - Standard half-up financial rounding applied via Intl.NumberFormat.
 * 2. Micro Amounts (0 < amount < $0.01):
 *    - Formatted as "<$0.01" to avoid misleading zero display when value exists,
 *      or optionally up to 4 decimals (e.g. "$0.0045") if precision is requested.
 * 3. Zero Amounts (amount === 0):
 *    - Formatted as "$0.00".
 * 4. XLM Amounts:
 *    - 2 to 7 decimal places (1 XLM = 10,000,000 stroops).
 * 5. Unavailable / Error Fallback:
 *    - When price source is unreachable, returns null / "Unavailable" / fallback string.
 */

import {
  combineSignals,
  PRICE_TIMEOUT_MS,
  isTimeoutError,
} from "@/lib/timeout";

export const PRICE_CACHE_TTL_MS = 60_000;
export const DEFAULT_PRICE_TIMEOUT_MS = PRICE_TIMEOUT_MS;

export const ROUNDING_RULES = {
  USD_STANDARD_DECIMALS: 2,
  USD_MICRO_DECIMALS: 4,
  MICRO_THRESHOLD: 0.01,
  XLM_MIN_DECIMALS: 2,
  XLM_MAX_DECIMALS: 7,
} as const;

export interface PriceResult {
  price: number | null;
  source: "coingecko" | "coinbase" | "cached" | null;
  error?: string;
  timestamp?: number;
}

interface CacheEntry {
  price: number;
  source: "coingecko" | "coinbase";
  timestamp: number;
}

let priceCache: CacheEntry | null = null;
let pendingPriceFetch: Promise<PriceResult> | null = null;

/**
 * Clear cached price. Primarily for testing or manual cache busting.
 */
export function clearPriceCache(): void {
  priceCache = null;
  pendingPriceFetch = null;
}

/**
 * Set a manual cache entry (useful for testing or SSR bootstrapping).
 */
export function setCachedPrice(
  price: number,
  source: "coingecko" | "coinbase" = "coingecko"
): void {
  priceCache = {
    price,
    source,
    timestamp: Date.now(),
  };
}

/**
 * Fetch current XLM spot price in USD with automatic multi-source fallback.
 *
 * Source priority:
 * 1. CoinGecko Simple Price API
 * 2. Coinbase Spot Price API
 */
export async function fetchXlmPrice(options?: {
  forceRefresh?: boolean;
  ttlMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<PriceResult> {
  const ttl = options?.ttlMs ?? PRICE_CACHE_TTL_MS;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_PRICE_TIMEOUT_MS;
  const now = Date.now();

  if (!options?.forceRefresh && priceCache && now - priceCache.timestamp < ttl) {
    return {
      price: priceCache.price,
      source: "cached",
      timestamp: priceCache.timestamp,
    };
  }

  if (pendingPriceFetch && !options?.forceRefresh) {
    return pendingPriceFetch;
  }

  const fetchPromise = (async (): Promise<PriceResult> => {
    let coingeckoTimedOut = false;
    let coinbaseTimedOut = false;

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      const combinedSignal = options?.signal
        ? combineSignals([options.signal, controller.signal])
        : controller.signal;

      const res = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd",
        {
          headers: { Accept: "application/json" },
          signal: combinedSignal,
        }
      );

      if (res.ok) {
        const data = await res.json();
        const price = data?.stellar?.usd;
        if (typeof price === "number" && !isNaN(price) && price > 0) {
          priceCache = { price, source: "coingecko", timestamp: Date.now() };
          return { price, source: "coingecko", timestamp: priceCache.timestamp };
        }
      }
    } catch (err) {
      if (isTimeoutError(err)) coingeckoTimedOut = true;
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }

    let secondaryTimeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const controller = new AbortController();
      secondaryTimeoutId = setTimeout(() => controller.abort(), timeoutMs);
      const combinedSignal = options?.signal
        ? combineSignals([options.signal, controller.signal])
        : controller.signal;

      const res = await fetch("https://api.coinbase.com/v2/prices/XLM-USD/spot", {
        headers: { Accept: "application/json" },
        signal: combinedSignal,
      });

      if (res.ok) {
        const data = await res.json();
        const priceStr = data?.data?.amount;
        const price = typeof priceStr === "string" ? parseFloat(priceStr) : Number(priceStr);
        if (typeof price === "number" && !isNaN(price) && price > 0) {
          priceCache = { price, source: "coinbase", timestamp: Date.now() };
          return { price, source: "coinbase", timestamp: priceCache.timestamp };
        }
      }
    } catch (err) {
      if (isTimeoutError(err)) coinbaseTimedOut = true;
    } finally {
      if (secondaryTimeoutId) {
        clearTimeout(secondaryTimeoutId);
      }
    }

    if (priceCache) {
      return {
        price: priceCache.price,
        source: "cached",
        error: coingeckoTimedOut || coinbaseTimedOut
          ? "Price sources timed out, using last known price"
          : "Price sources currently unreachable, using last known price",
        timestamp: priceCache.timestamp,
      };
    }

    return {
      price: null,
      source: null,
      error: coingeckoTimedOut || coinbaseTimedOut
        ? "XLM/USD price sources timed out"
        : "XLM/USD price sources unavailable",
    };
  })();

  pendingPriceFetch = fetchPromise;
  try {
    return await fetchPromise;
  } finally {
    pendingPriceFetch = null;
  }
}

/**
 * Convert an XLM amount to USD using the given exchange rate.
 */
export function convertXlmToUsd(
  xlmAmount: number | string,
  pricePerXlm: number | null | undefined
): number | null {
  if (pricePerXlm === null || pricePerXlm === undefined || isNaN(pricePerXlm) || pricePerXlm <= 0) {
    return null;
  }
  const xlm = typeof xlmAmount === "string" ? parseFloat(xlmAmount) : xlmAmount;
  if (isNaN(xlm)) return null;

  return xlm * pricePerXlm;
}

export interface FormatFiatOptions {
  showApprox?: boolean;
  fallback?: string;
  minDecimals?: number;
  maxDecimals?: number;
  allowMicro?: boolean;
}

/**
 * Format a USD number according to documented OphirPay rounding rules.
 *
 * @example
 * formatFiatAmount(12.3456) => "$12.35"
 * formatFiatAmount(12.3456, { showApprox: true }) => "~$12.35"
 * formatFiatAmount(0.004) => "<$0.01"
 * formatFiatAmount(0.004, { allowMicro: true }) => "$0.0040"
 * formatFiatAmount(null) => "—"
 */
export function formatFiatAmount(
  usdAmount: number | null | undefined,
  options?: FormatFiatOptions
): string {
  const fallback = options?.fallback ?? "—";
  if (usdAmount === null || usdAmount === undefined || isNaN(usdAmount)) {
    return fallback;
  }

  const prefix = options?.showApprox ? "~" : "";

  if (usdAmount === 0) {
    return `${prefix}$0.00`;
  }

  const absAmount = Math.abs(usdAmount);

  if (absAmount > 0 && absAmount < ROUNDING_RULES.MICRO_THRESHOLD) {
    if (options?.allowMicro) {
      const formatted = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: options.minDecimals ?? ROUNDING_RULES.USD_MICRO_DECIMALS,
        maximumFractionDigits: options.maxDecimals ?? ROUNDING_RULES.USD_MICRO_DECIMALS,
      }).format(usdAmount);
      return `${prefix}${formatted}`;
    }
    const sign = usdAmount < 0 ? "-" : "";
    return `${prefix}${sign}<$0.01`;
  }

  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: options?.minDecimals ?? ROUNDING_RULES.USD_STANDARD_DECIMALS,
    maximumFractionDigits: options?.maxDecimals ?? ROUNDING_RULES.USD_STANDARD_DECIMALS,
  }).format(usdAmount);

  return `${prefix}${formatted}`;
}
