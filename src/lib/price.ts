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

import { getPriceTimeoutMs } from "./timeout";

export const PRICE_CACHE_TTL_MS = 60_000; // 60 seconds
/** Do not use a cached quote after this grace period, even with a custom TTL. */
export const PRICE_CACHE_MAX_AGE_MS = 5 * 60_000;
/** Default when `PRICE_REQUEST_TIMEOUT_MS` is unset (see `lib/timeout.ts`). */
export const DEFAULT_PRICE_TIMEOUT_MS = 5_000; // 5 seconds
/** Broad safety limits: quotes outside this range are treated as unavailable. */
export const MIN_XLM_USD_PRICE = 0.000001;
export const MAX_XLM_USD_PRICE = 10;

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

const NUMERIC_PRICE = /^[+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const NUMERIC_AMOUNT = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function isValidPrice(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= MIN_XLM_USD_PRICE &&
    value <= MAX_XLM_USD_PRICE
  );
}

function parsePrice(value: unknown): number | null {
  if (typeof value === "number") return isValidPrice(value) ? value : null;
  if (typeof value !== "string" || !NUMERIC_PRICE.test(value.trim())) return null;
  const parsed = Number(value);
  return isValidPrice(parsed) ? parsed : null;
}

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
  if (!isValidPrice(price)) {
    priceCache = null;
    return;
  }
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
  const requestedTtl = options?.ttlMs;
  const ttl =
    requestedTtl === undefined
      ? PRICE_CACHE_TTL_MS
      : Number.isFinite(requestedTtl)
        ? Math.max(0, Math.min(requestedTtl, PRICE_CACHE_MAX_AGE_MS))
        : 0;
  // Configurable per environment (`PRICE_REQUEST_TIMEOUT_MS`), issue #747.
  const timeoutMs = options?.timeoutMs ?? getPriceTimeoutMs();
  const now = Date.now();

  // 1. Check in-memory cache
  const cached = priceCache;
  const cacheAge = cached ? now - cached.timestamp : -1;
  const cacheIsUsable =
    cached !== null &&
    isValidPrice(cached.price) &&
    cacheAge >= 0 &&
    cacheAge <= PRICE_CACHE_MAX_AGE_MS;
  if (!options?.forceRefresh && cacheIsUsable && cacheAge < ttl) {
    return {
      price: cached.price,
      source: "cached",
      timestamp: cached.timestamp,
    };
  }

  // 2. Deduplicate concurrent requests
  if (pendingPriceFetch && !options?.forceRefresh) {
    return pendingPriceFetch;
  }

  const fetchPromise = (async (): Promise<PriceResult> => {
    // Primary: CoinGecko
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      const combinedSignal = options?.signal
        ? anySignal([options.signal, controller.signal])
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
        const price = parsePrice(data?.stellar?.usd);
        if (price !== null) {
          priceCache = { price, source: "coingecko", timestamp: Date.now() };
          return { price, source: "coingecko", timestamp: priceCache.timestamp };
        }
      }
    } catch {
      // Fall through to secondary source
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }

    // Secondary: Coinbase
    let secondaryTimeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const controller = new AbortController();
      secondaryTimeoutId = setTimeout(() => controller.abort(), timeoutMs);
      const combinedSignal = options?.signal
        ? anySignal([options.signal, controller.signal])
        : controller.signal;

      const res = await fetch("https://api.coinbase.com/v2/prices/XLM-USD/spot", {
        headers: { Accept: "application/json" },
        signal: combinedSignal,
      });

      if (res.ok) {
        const data = await res.json();
        const price = parsePrice(data?.data?.amount);
        if (price !== null) {
          priceCache = { price, source: "coinbase", timestamp: Date.now() };
          return { price, source: "coinbase", timestamp: priceCache.timestamp };
        }
      }
    } catch {
      // All sources failed
    } finally {
      if (secondaryTimeoutId) {
        clearTimeout(secondaryTimeoutId);
      }
    }

    // If cache has a stale price, return it with error indication rather than complete failure if available
    if (cacheIsUsable && cached) {
      return {
        price: cached.price,
        source: "cached",
        error: "Price sources currently unreachable, using last known price",
        timestamp: cached.timestamp,
      };
    }

    return {
      price: null,
      source: null,
      error: "XLM/USD price sources unavailable",
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
  if (!isValidPrice(pricePerXlm)) {
    return null;
  }
  const xlm = typeof xlmAmount === "string"
    ? NUMERIC_AMOUNT.test(xlmAmount.trim()) ? Number(xlmAmount) : NaN
    : xlmAmount;
  if (!Number.isFinite(xlm)) return null;

  const usd = xlm * pricePerXlm;
  return Number.isFinite(usd) && Math.abs(usd) <= Number.MAX_SAFE_INTEGER ? usd : null;
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
  if (usdAmount === null || usdAmount === undefined || !Number.isFinite(usdAmount)) {
    return fallback;
  }

  const prefix = options?.showApprox ? "~" : "";

  // Exact zero
  if (usdAmount === 0) {
    return `${prefix}$0.00`;
  }

  const absAmount = Math.abs(usdAmount);

  // Micro amounts between 0 and 0.01
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

  // Standard USD formatting
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: options?.minDecimals ?? ROUNDING_RULES.USD_STANDARD_DECIMALS,
    maximumFractionDigits: options?.maxDecimals ?? ROUNDING_RULES.USD_STANDARD_DECIMALS,
  }).format(usdAmount);

  return `${prefix}${formatted}`;
}

/**
 * Helper to combine abort signals across environments.
 */
function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort();
      return signal;
    }
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return controller.signal;
}
