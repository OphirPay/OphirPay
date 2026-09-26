// SPDX-License-Identifier: MIT

/**
 * XLM / USD Price Utility & Conversion Service.
 *
 * Provides live spot pricing for Stellar Lumens (XLM) to USD with:
 * - Multi-source failover between price oracles (CoinGecko -> Coinbase)
 * - In-memory TTL caching with Stale-While-Revalidate (SWR) policy
 * - Rate-limit (HTTP 429) backoff and cooldown tracking (with Retry-After parsing)
 * - Staleness tracking and explicit staleness markers (isStale, staleReason, staleAgeMs)
 * - Configurable provider API key support (preventing anonymous tier throttling)
 * - Request deduplication and timeout protection
 * - Documented precision/rounding rules and asset unit fallbacks
 */

export const PRICE_CACHE_TTL_MS = 60_000; // 60 seconds fresh TTL
export const PRICE_STALE_THRESHOLD_MS = 300_000; // 5 minutes staleness threshold
export const DEFAULT_PRICE_TIMEOUT_MS = 5_000; // 5 seconds
export const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 30_000; // 30 seconds default cooldown

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
  staleAgeMs?: number;
  staleReason?: string;
  rateLimited?: boolean;
  rateLimitedUntil?: number;
}

interface CacheEntry {
  price: number;
  source: "coingecko" | "coinbase";
  timestamp: number;
}

interface RateLimitState {
  coingeckoUntil: number;
  coinbaseUntil: number;
}

let priceCache: CacheEntry | null = null;
let pendingPriceFetch: Promise<PriceResult> | null = null;
let rateLimitState: RateLimitState = {
  coingeckoUntil: 0,
  coinbaseUntil: 0,
};

/**
 * Clear cached price and active pending fetch.
 */
export function clearPriceCache(): void {
  priceCache = null;
  pendingPriceFetch = null;
}

/**
 * Clear rate limit cooldown state.
 */
export function clearRateLimitState(): void {
  rateLimitState = {
    coingeckoUntil: 0,
    coinbaseUntil: 0,
  };
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
 * Parse Retry-After header value into cooldown milliseconds.
 */
export function parseRetryAfter(header: string | null | undefined): number {
  if (!header) return DEFAULT_RATE_LIMIT_COOLDOWN_MS;
  const seconds = parseInt(header, 10);
  if (!isNaN(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const dateMs = Date.parse(header);
  if (!isNaN(dateMs)) {
    const diff = dateMs - Date.now();
    return Math.max(0, diff);
  }
  return DEFAULT_RATE_LIMIT_COOLDOWN_MS;
}

/**
 * Check if a source is currently in rate-limit cooldown.
 */
export function isSourceRateLimited(source: "coingecko" | "coinbase"): boolean {
  const until = source === "coingecko" ? rateLimitState.coingeckoUntil : rateLimitState.coinbaseUntil;
  return Date.now() < until;
}

/**
 * Fetch current XLM spot price in USD with automatic multi-source fallback,
 * SWR caching, 429 backoff handling, and staleness markers.
 */
export async function fetchXlmPrice(options?: {
  forceRefresh?: boolean;
  ttlMs?: number;
  staleThresholdMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  apiKey?: string;
}): Promise<PriceResult> {
  const ttl = options?.ttlMs ?? PRICE_CACHE_TTL_MS;
  const staleThreshold = options?.staleThresholdMs ?? PRICE_STALE_THRESHOLD_MS;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_PRICE_TIMEOUT_MS;
  const now = Date.now();

  // 1. Check in-memory cache
  if (!options?.forceRefresh && priceCache) {
    const age = now - priceCache.timestamp;

    // Within fresh TTL: serve directly
    if (age < ttl) {
      return {
        price: priceCache.price,
        source: "cached",
        timestamp: priceCache.timestamp,
        isStale: false,
        staleAgeMs: age,
      };
    }

    // Between TTL and stale threshold (SWR window): serve cached immediately and revalidate in background
    if (age < staleThreshold) {
      void triggerBackgroundRevalidation(options);
      return {
        price: priceCache.price,
        source: "cached",
        timestamp: priceCache.timestamp,
        isStale: false,
        staleAgeMs: age,
      };
    }
  }

  // 2. Deduplicate concurrent requests
  if (pendingPriceFetch && !options?.forceRefresh) {
    return pendingPriceFetch;
  }

  const fetchPromise = (async (): Promise<PriceResult> => {
    const currentNow = Date.now();
    let coingeckoRateLimited = currentNow < rateLimitState.coingeckoUntil;
    let coinbaseRateLimited = currentNow < rateLimitState.coinbaseUntil;

    // Both sources currently rate-limited
    if (coingeckoRateLimited && coinbaseRateLimited) {
      if (priceCache) {
        const age = currentNow - priceCache.timestamp;
        const isStale = age >= staleThreshold;
        return {
          price: priceCache.price,
          source: "cached",
          timestamp: priceCache.timestamp,
          isStale,
          staleAgeMs: age,
          staleReason: isStale ? `Cached price exceeds staleness threshold (${Math.round(age / 1000)}s old)` : undefined,
          rateLimited: true,
          rateLimitedUntil: Math.max(rateLimitState.coingeckoUntil, rateLimitState.coinbaseUntil),
          error: "All price providers in rate-limit cooldown, using cached price",
        };
      }
      return {
        price: null,
        source: null,
        isStale: false,
        rateLimited: true,
        rateLimitedUntil: Math.max(rateLimitState.coingeckoUntil, rateLimitState.coinbaseUntil),
        error: "All price providers in rate-limit cooldown and no cached price available",
      };
    }

    // ── Primary Source: CoinGecko ────────────────────────────
    if (!coingeckoRateLimited) {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      try {
        const controller = new AbortController();
        timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        const combinedSignal = options?.signal
          ? anySignal([options.signal, controller.signal])
          : controller.signal;

        const apiKey =
          options?.apiKey ||
          process.env.NEXT_PUBLIC_PRICE_PROVIDER_API_KEY ||
          process.env.NEXT_PUBLIC_COINGECKO_API_KEY ||
          process.env.COINGECKO_API_KEY ||
          process.env.PRICE_API_KEY;

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
          const cooldownMs = parseRetryAfter(res.headers.get("retry-after"));
          rateLimitState.coingeckoUntil = Date.now() + cooldownMs;
          coingeckoRateLimited = true;
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
              staleAgeMs: 0,
            };
          }
        }
      } catch {
        // Fall through to secondary source
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      }
    }

    // ── Secondary Source: Coinbase ───────────────────────────
    if (!coinbaseRateLimited) {
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
          const cooldownMs = parseRetryAfter(res.headers.get("retry-after"));
          rateLimitState.coinbaseUntil = Date.now() + cooldownMs;
          coinbaseRateLimited = true;
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
              staleAgeMs: 0,
            };
          }
        }
      } catch {
        // All sources failed
      } finally {
        if (secondaryTimeoutId) {
          clearTimeout(secondaryTimeoutId);
        }
      }
    }

    // ── Upstream Failure / Rate-Limited Fallback ──────────────
    if (priceCache) {
      const age = Date.now() - priceCache.timestamp;
      const isStale = age >= staleThreshold;
      const wasRateLimited = coingeckoRateLimited || coinbaseRateLimited;

      return {
        price: priceCache.price,
        source: "cached",
        timestamp: priceCache.timestamp,
        isStale,
        staleAgeMs: age,
        staleReason: isStale
          ? `Price sources ${wasRateLimited ? "rate-limited" : "unreachable"}; cached price is ${Math.round(age / 1000)}s old (exceeds ${Math.round(staleThreshold / 1000)}s threshold)`
          : undefined,
        rateLimited: wasRateLimited,
        error: wasRateLimited
          ? "Price sources currently rate-limited, using last known price"
          : "Price sources currently unreachable, using last known price",
      };
    }

    return {
      price: null,
      source: null,
      isStale: false,
      rateLimited: coingeckoRateLimited || coinbaseRateLimited,
      error: coingeckoRateLimited || coinbaseRateLimited
        ? "XLM/USD price sources rate-limited and unavailable"
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
 * Trigger background revalidation for SWR cache entries.
 */
function triggerBackgroundRevalidation(options?: Parameters<typeof fetchXlmPrice>[0]): void {
  if (pendingPriceFetch) return;
  void fetchXlmPrice({
    ...options,
    forceRefresh: true,
  }).catch(() => {
    // Background revalidation failures are silent; existing cache remains untouched
  });
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
 * Format price or fall back to asset unit with a clear staleness/unavailability indication.
 *
 * Used across payments and transfer screens to satisfy acceptance criteria:
 * - Fresh price: Displays standard formatted USD.
 * - Stale price: Displays formatted USD with "(USD price stale)" notice.
 * - Unavailable price: Displays asset unit with "(USD unavailable)" notice.
 */
export function formatPriceOrAsset(
  xlmAmount: number | string,
  priceResult: PriceResult | null | undefined,
  options?: FormatFiatOptions
): {
  formatted: string;
  isFallback: boolean;
  isStale: boolean;
} {
  const numXlm = typeof xlmAmount === "string" ? parseFloat(xlmAmount) : xlmAmount;
  const xlmLabel = isNaN(numXlm) ? "0 XLM" : `${numXlm} XLM`;

  if (!priceResult || priceResult.price === null) {
    return {
      formatted: `${xlmLabel} (USD unavailable)`,
      isFallback: true,
      isStale: false,
    };
  }

  const usdAmount = convertXlmToUsd(numXlm, priceResult.price);
  const fiatStr = formatFiatAmount(usdAmount, options);

  if (priceResult.isStale) {
    return {
      formatted: `${fiatStr} (USD price stale)`,
      isFallback: false,
      isStale: true,
    };
  }

  return {
    formatted: fiatStr,
    isFallback: false,
    isStale: false,
  };
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
