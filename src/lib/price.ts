// SPDX-License-Identifier: MIT

/**
 * XLM / USD Price Utility & Conversion Service.
 *
 * Provides live spot pricing for Stellar Lumens (XLM) to USD with automatic
 * failover between price oracles (CoinGecko -> Coinbase), in-memory TTL caching,
 * stale-while-revalidate policy, 429 rate-limit backoff handling,
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
 * 5. Unavailable / Stale / Error Fallback:
 *    - When price source is unreachable or stale beyond threshold, falls back to displaying asset unit.
 */

export const PRICE_CACHE_TTL_MS = 60_000; // 60 seconds TTL
export const PRICE_STALE_THRESHOLD_MS = 5 * 60_000; // 5 minutes staleness threshold
export const PRICE_BACKOFF_MS = 30_000; // 30 seconds default backoff after 429 / upstream errors
export const DEFAULT_PRICE_TIMEOUT_MS = 5_000; // 5 seconds request timeout

export const ROUNDING_RULES = {
  USD_STANDARD_DECIMALS: 2,
  USD_MICRO_DECIMALS: 4,
  MICRO_THRESHOLD: 0.01,
  XLM_MIN_DECIMALS: 2,
  XLM_MAX_DECIMALS: 7,
} as const;

export type PriceStaleReason = "expired" | "rate_limited" | "upstream_error";

export interface PriceResult {
  price: number | null;
  source: "coingecko" | "coinbase" | "cached" | null;
  error?: string;
  timestamp?: number;
  isStale?: boolean;
  staleAgeMs?: number;
  rateLimited?: boolean;
  staleReason?: PriceStaleReason | null;
}

export interface FetchXlmPriceOptions {
  forceRefresh?: boolean;
  ttlMs?: number;
  staleThresholdMs?: number;
  timeoutMs?: number;
  apiKey?: string;
  staleWhileRevalidate?: boolean;
  signal?: AbortSignal;
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
 * Clear cached price and reset rate-limit cooldowns.
 * Primarily for testing or manual cache busting.
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
  source: "coingecko" | "coinbase" = "coingecko",
  timestamp: number = Date.now()
): void {
  priceCache = {
    price,
    source,
    timestamp,
  };
}

/**
 * Get configured price provider API key from options or environment variables.
 */
export function getPriceProviderApiKey(): string | undefined {
  return (
    process.env.NEXT_PUBLIC_PRICE_PROVIDER_API_KEY ??
    process.env.NEXT_PUBLIC_COINGECKO_API_KEY ??
    process.env.PRICE_PROVIDER_API_KEY ??
    process.env.COINGECKO_API_KEY
  );
}

/**
 * Build request headers including optional API key.
 */
export function buildPriceHeaders(apiKey?: string): HeadersInit {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey) {
    headers["x-cg-demo-api-key"] = apiKey;
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

/**
 * Parse Retry-After header into milliseconds of cooldown.
 */
function parseRetryAfterHeader(headerValue: string | null | undefined): number {
  if (!headerValue) return PRICE_BACKOFF_MS;
  const seconds = parseInt(headerValue, 10);
  if (!isNaN(seconds) && seconds > 0) {
    return seconds * 1000;
  }
  const dateMs = Date.parse(headerValue);
  if (!isNaN(dateMs) && dateMs > Date.now()) {
    return dateMs - Date.now();
  }
  return PRICE_BACKOFF_MS;
}

/**
 * Fetch current XLM spot price in USD with automatic multi-source fallback,
 * in-memory caching, stale-while-revalidate, and 429 rate-limit backoff.
 *
 * Source priority:
 * 1. CoinGecko Simple Price API
 * 2. Coinbase Spot Price API
 */
export async function fetchXlmPrice(options?: FetchXlmPriceOptions): Promise<PriceResult> {
  const ttl = options?.ttlMs ?? PRICE_CACHE_TTL_MS;
  const staleThreshold = options?.staleThresholdMs ?? PRICE_STALE_THRESHOLD_MS;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_PRICE_TIMEOUT_MS;
  const apiKey = options?.apiKey ?? getPriceProviderApiKey();
  const now = Date.now();

  // 1. If both sources are currently in rate-limit backoff, do not hammer upstream
  const bothRateLimited = now < coingeckoRateLimitedUntil && now < coinbaseRateLimitedUntil;
  if (!options?.forceRefresh && bothRateLimited) {
    if (priceCache) {
      const age = now - priceCache.timestamp;
      const isPastThreshold = age >= staleThreshold;
      return {
        price: isPastThreshold ? null : priceCache.price,
        source: isPastThreshold ? null : "cached",
        timestamp: priceCache.timestamp,
        isStale: isPastThreshold || age >= ttl,
        staleAgeMs: age,
        rateLimited: true,
        staleReason: isPastThreshold ? "expired" : "rate_limited",
        error: isPastThreshold
          ? "Price feeds rate-limited and cached price exceeded staleness threshold"
          : "Price feed is in backoff cooldown (HTTP 429), using last known price",
      };
    }
    return {
      price: null,
      source: null,
      isStale: true,
      rateLimited: true,
      staleReason: "rate_limited",
      error: "Price feeds rate-limited (HTTP 429)",
    };
  }

  // 2. Check in-memory cache for fresh entry (within TTL)
  if (!options?.forceRefresh && priceCache && now - priceCache.timestamp < ttl) {
    const age = now - priceCache.timestamp;
    return {
      price: priceCache.price,
      source: "cached",
      timestamp: priceCache.timestamp,
      isStale: false,
      staleAgeMs: age,
      rateLimited: false,
      staleReason: null,
    };
  }

  // 3. Stale-While-Revalidate: if explicitly requested and cache is within staleThreshold
  if (!options?.forceRefresh && options?.staleWhileRevalidate && priceCache && now - priceCache.timestamp < staleThreshold) {
    const cachedResult: PriceResult = {
      price: priceCache.price,
      source: "cached",
      timestamp: priceCache.timestamp,
      isStale: true,
      staleAgeMs: now - priceCache.timestamp,
      rateLimited: false,
      staleReason: "expired",
    };
    // Revalidate in background without blocking
    if (!pendingPriceFetch) {
      void fetchXlmPrice({ ...options, staleWhileRevalidate: false, forceRefresh: true }).catch(() => {});
    }
    return cachedResult;
  }

  // 4. Deduplicate concurrent in-flight requests
  if (pendingPriceFetch && !options?.forceRefresh) {
    return pendingPriceFetch;
  }

  const fetchPromise = (async (): Promise<PriceResult> => {
    let wasRateLimited = false;
    let lastErrorReason: PriceStaleReason | null = null;

    // Primary: CoinGecko (skip if in active rate-limit cooldown)
    if (Date.now() >= coingeckoRateLimitedUntil) {
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
            headers: buildPriceHeaders(apiKey),
            signal: combinedSignal,
          }
        );

        if (res.status === 429) {
          wasRateLimited = true;
          lastErrorReason = "rate_limited";
          const retryAfter = res.headers?.get?.("retry-after");
          const cooldownMs = parseRetryAfterHeader(retryAfter);
          coingeckoRateLimitedUntil = Date.now() + cooldownMs;
        } else if (res.ok) {
          const data = await res.json();
          const price = data?.stellar?.usd;
          if (typeof price === "number" && !isNaN(price) && price > 0) {
            priceCache = { price, source: "coingecko", timestamp: Date.now() };
            coingeckoRateLimitedUntil = 0;
            return {
              price,
              source: "coingecko",
              timestamp: priceCache.timestamp,
              isStale: false,
              staleAgeMs: 0,
              rateLimited: false,
              staleReason: null,
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
      wasRateLimited = true;
      lastErrorReason = "rate_limited";
    }

    // Secondary: Coinbase (skip if in active rate-limit cooldown)
    if (Date.now() >= coinbaseRateLimitedUntil) {
      let secondaryTimeoutId: ReturnType<typeof setTimeout> | undefined;
      try {
        const controller = new AbortController();
        secondaryTimeoutId = setTimeout(() => controller.abort(), timeoutMs);
        const combinedSignal = options?.signal
          ? anySignal([options.signal, controller.signal])
          : controller.signal;

        const res = await fetch("https://api.coinbase.com/v2/prices/XLM-USD/spot", {
          headers: buildPriceHeaders(apiKey),
          signal: combinedSignal,
        });

        if (res.status === 429) {
          wasRateLimited = true;
          lastErrorReason = "rate_limited";
          const retryAfter = res.headers?.get?.("retry-after");
          const cooldownMs = parseRetryAfterHeader(retryAfter);
          coinbaseRateLimitedUntil = Date.now() + cooldownMs;
        } else if (res.ok) {
          const data = await res.json();
          const priceStr = data?.data?.amount;
          const price = typeof priceStr === "string" ? parseFloat(priceStr) : Number(priceStr);
          if (typeof price === "number" && !isNaN(price) && price > 0) {
            priceCache = { price, source: "coinbase", timestamp: Date.now() };
            coinbaseRateLimitedUntil = 0;
            return {
              price,
              source: "coinbase",
              timestamp: priceCache.timestamp,
              isStale: false,
              staleAgeMs: 0,
              rateLimited: false,
              staleReason: null,
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
    } else {
      wasRateLimited = true;
      if (!lastErrorReason) {
        lastErrorReason = "rate_limited";
      }
    }

    // Fallback: If cache has a previous price, check against staleness threshold
    if (priceCache) {
      const age = Date.now() - priceCache.timestamp;
      const isPastThreshold = age >= staleThreshold;

      if (isPastThreshold) {
        return {
          price: null,
          source: null,
          isStale: true,
          staleAgeMs: age,
          rateLimited: wasRateLimited,
          staleReason: "expired",
          error: wasRateLimited
            ? "Price feeds rate-limited and cached price exceeded staleness threshold"
            : "Price sources unreachable and cached price exceeded staleness threshold",
          timestamp: priceCache.timestamp,
        };
      }

      return {
        price: priceCache.price,
        source: "cached",
        isStale: true,
        staleAgeMs: age,
        rateLimited: wasRateLimited,
        staleReason: lastErrorReason ?? (age >= ttl ? "expired" : "upstream_error"),
        error:
          lastErrorReason === "rate_limited"
            ? "Price sources rate-limited (HTTP 429), using last known price"
            : "Price sources currently unreachable, using last known price",
        timestamp: priceCache.timestamp,
      };
    }

    // Complete failure: no cache available
    return {
      price: null,
      source: null,
      isStale: true,
      rateLimited: wasRateLimited,
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

export interface FormatPriceOrAssetOptions {
  assetUnit?: string;
  staleThresholdMs?: number;
  showApprox?: boolean;
}

export interface FormattedPriceOrAsset {
  display: string;
  isStale: boolean;
  isFiat: boolean;
  amount: number | null;
}

/**
 * Format a balance or payment amount, displaying formatted fiat if fresh price is available,
 * or gracefully falling back to displaying the asset unit (e.g. "10.00 XLM (USD price unavailable)"
 * or "10.00 XLM (USD price stale)") when the price is stale or unavailable.
 */
export function formatPriceOrAsset(
  amount: number | string,
  priceResult: Pick<PriceResult, "price" | "isStale" | "timestamp"> | null | undefined,
  options?: FormatPriceOrAssetOptions
): FormattedPriceOrAsset {
  const assetUnit = options?.assetUnit ?? "XLM";
  const staleThreshold = options?.staleThresholdMs ?? PRICE_STALE_THRESHOLD_MS;
  const numAmount = typeof amount === "string" ? parseFloat(amount) : amount;

  if (isNaN(numAmount)) {
    return {
      display: `— ${assetUnit}`,
      isStale: false,
      isFiat: false,
      amount: null,
    };
  }

  const isPastTimeThreshold = Boolean(
    priceResult?.timestamp && Date.now() - priceResult.timestamp >= staleThreshold
  );
  const isStale = Boolean(
    priceResult?.isStale || isPastTimeThreshold || !priceResult || priceResult.price === null
  );

  if (isStale || !priceResult || priceResult.price === null) {
    const formattedAsset = `${numAmount.toFixed(2)} ${assetUnit}`;
    const indicator =
      !priceResult || priceResult.price === null
        ? "(USD price unavailable)"
        : "(USD price stale)";
    return {
      display: `${formattedAsset} ${indicator}`,
      isStale: true,
      isFiat: false,
      amount: numAmount,
    };
  }

  const usdVal = convertXlmToUsd(numAmount, priceResult.price);
  const formattedFiat = formatFiatAmount(usdVal, { showApprox: options?.showApprox ?? true });
  return {
    display: formattedFiat,
    isStale: false,
    isFiat: true,
    amount: usdVal,
  };
}

/**
 * Fallback helper when price is unavailable or stale.
 */
export function formatPriceUnavailableFallback(
  xlmAmount: number | string,
  result: Pick<PriceResult, "price" | "isStale"> | null | undefined,
  assetUnit = "XLM"
): string | null {
  if (result?.price !== null && result?.price !== undefined && !result.isStale) {
    return null;
  }
  const amount = typeof xlmAmount === "string" ? xlmAmount : xlmAmount.toString();
  const reason = result?.price !== null && result?.isStale ? "stale" : "unavailable";
  return `${amount} ${assetUnit} (USD price ${reason})`;
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
