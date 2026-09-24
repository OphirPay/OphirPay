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

export const PRICE_CACHE_TTL_MS = 60_000; // 60 seconds (fresh TTL)
export const PRICE_STALE_THRESHOLD_MS = 300_000; // 5 minutes (stale threshold)
export const DEFAULT_PRICE_TIMEOUT_MS = 5_000; // 5 seconds
export const RATE_LIMIT_COOLDOWN_MS = 30_000; // 30 seconds backoff on HTTP 429

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
  isStale?: boolean;
  staleReason?: "rate_limited" | "upstream_error" | "expired" | null;
}

interface CacheEntry {
  price: number;
  source: "coingecko" | "coinbase";
  timestamp: number;
}

let priceCache: CacheEntry | null = null;
let pendingPriceFetch: Promise<PriceResult> | null = null;
let coingeckoRateLimitedUntil = 0;
let coinbaseRateLimitedUntil = 0;

/**
 * Clear cached price and rate-limit states. Primarily for testing or manual cache busting.
 */
export function clearPriceCache(): void {
  priceCache = null;
  pendingPriceFetch = null;
  coingeckoRateLimitedUntil = 0;
  coinbaseRateLimitedUntil = 0;
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
  staleThresholdMs?: number;
  timeoutMs?: number;
  apiKey?: string;
  signal?: AbortSignal;
}): Promise<PriceResult> {
  const ttl = options?.ttlMs ?? PRICE_CACHE_TTL_MS;
  const staleThreshold = options?.staleThresholdMs ?? PRICE_STALE_THRESHOLD_MS;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_PRICE_TIMEOUT_MS;
  const apiKey =
    options?.apiKey ??
    (typeof process !== "undefined"
      ? process.env?.NEXT_PUBLIC_COINGECKO_API_KEY
      : undefined);
  const now = Date.now();

  // 1. Check in-memory cache
  if (!options?.forceRefresh && priceCache) {
    const age = now - priceCache.timestamp;
    if (age < ttl) {
      return {
        price: priceCache.price,
        source: "cached",
        timestamp: priceCache.timestamp,
        isStale: false,
      };
    }
  }

  // 2. Deduplicate concurrent requests
  if (pendingPriceFetch && !options?.forceRefresh) {
    return pendingPriceFetch;
  }

  const fetchPromise = (async (): Promise<PriceResult> => {
    let lastErrorReason: "rate_limited" | "upstream_error" | null = null;

    // Primary: CoinGecko (unless currently in 429 rate-limit cooldown)
    if (Date.now() >= coingeckoRateLimitedUntil) {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      try {
        const controller = new AbortController();
        timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        const combinedSignal = options?.signal
          ? anySignal([options.signal, controller.signal])
          : controller.signal;

        const headers: Record<string, string> = { Accept: "application/json" };
        if (apiKey) {
          headers["x-cg-demo-api-key"] = apiKey;
        }

        const res = await fetch(
          "https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd",
          {
            headers,
            signal: combinedSignal,
          }
        );

        if (res.status === 429) {
          lastErrorReason = "rate_limited";
          const retryAfter = res.headers?.get?.("retry-after");
          const cooldownSeconds = retryAfter ? parseInt(retryAfter, 10) : NaN;
          const cooldownMs =
            !isNaN(cooldownSeconds) && cooldownSeconds > 0
              ? cooldownSeconds * 1000
              : RATE_LIMIT_COOLDOWN_MS;
          coingeckoRateLimitedUntil = Date.now() + cooldownMs;
        } else if (res.ok) {
          const data = await res.json();
          const price = data?.stellar?.usd;
          if (typeof price === "number" && !isNaN(price) && price > 0) {
            priceCache = { price, source: "coingecko", timestamp: Date.now() };
            return {
              price,
              source: "coingecko",
              timestamp: priceCache.timestamp,
              isStale: false,
            };
          }
        } else {
          lastErrorReason = "upstream_error";
        }
      } catch {
        lastErrorReason = "upstream_error";
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      }
    } else {
      lastErrorReason = "rate_limited";
    }

    // Secondary: Coinbase (unless in cooldown)
    if (Date.now() >= coinbaseRateLimitedUntil) {
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

        if (res.status === 429) {
          lastErrorReason = "rate_limited";
          coinbaseRateLimitedUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
        } else if (res.ok) {
          const data = await res.json();
          const priceStr = data?.data?.amount;
          const price = typeof priceStr === "string" ? parseFloat(priceStr) : Number(priceStr);
          if (typeof price === "number" && !isNaN(price) && price > 0) {
            priceCache = { price, source: "coinbase", timestamp: Date.now() };
            return {
              price,
              source: "coinbase",
              timestamp: priceCache.timestamp,
              isStale: false,
            };
          }
        } else if (!lastErrorReason) {
          lastErrorReason = "upstream_error";
        }
      } catch {
        if (!lastErrorReason) {
          lastErrorReason = "upstream_error";
        }
      } finally {
        if (secondaryTimeoutId) {
          clearTimeout(secondaryTimeoutId);
        }
      }
    }

    // Fallback: If cache has a previous price, return it with defined staleness markers
    if (priceCache) {
      const age = Date.now() - priceCache.timestamp;
      const isPastThreshold = age >= staleThreshold;
      return {
        price: priceCache.price,
        source: "cached",
        isStale: true,
        staleReason: lastErrorReason ?? (isPastThreshold ? "expired" : age >= ttl ? "expired" : null),
        error:
          lastErrorReason === "rate_limited"
            ? "Price sources rate-limited (HTTP 429), using last known price"
            : isPastThreshold
              ? "Price sources currently unreachable, price exceeds staleness threshold"
              : "Price sources currently unreachable, using last known price",
        timestamp: priceCache.timestamp,
      };
    }

    // Complete failure: no cache available
    return {
      price: null,
      source: null,
      isStale: true,
      staleReason: lastErrorReason ?? "upstream_error",
      error:
        lastErrorReason === "rate_limited"
          ? "Price feeds rate-limited (HTTP 429)"
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
 * Format a balance or price display, showing formatted fiat if fresh price is available,
 * or gracefully falling back to displaying the asset unit if price is unavailable or stale.
 */
export function formatPriceOrAsset(
  amount: number | string,
  priceResult: PriceResult | null | undefined,
  assetUnit = "XLM"
): {
  display: string;
  isStale: boolean;
  isFiat: boolean;
} {
  const numAmount = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(numAmount)) {
    return { display: `— ${assetUnit}`, isStale: false, isFiat: false };
  }

  if (!priceResult || priceResult.price === null) {
    return {
      display: `${numAmount} ${assetUnit}`,
      isStale: true,
      isFiat: false,
    };
  }

  const isStale = Boolean(
    priceResult.isStale ||
      (priceResult.timestamp &&
        Date.now() - priceResult.timestamp >= PRICE_STALE_THRESHOLD_MS)
  );

  const fiatValue = convertXlmToUsd(numAmount, priceResult.price);
  if (fiatValue === null) {
    return {
      display: `${numAmount} ${assetUnit}`,
      isStale: true,
      isFiat: false,
    };
  }

  const formattedFiat = formatFiatAmount(fiatValue, { showApprox: true });
  return {
    display: isStale ? `${numAmount} ${assetUnit} (${formattedFiat} stale)` : formattedFiat,
    isStale,
    isFiat: !isStale,
  };
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
