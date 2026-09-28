// SPDX-License-Identifier: MIT

/**
 * XLM / USD Price Utility & Conversion Service.
 *
 * Provides live spot pricing for Stellar Lumens (XLM) to USD with automatic
 * failover between price oracles (CoinGecko -> Coinbase, or a single configured
 * provider), in-memory TTL caching with stale-while-revalidate, 429/error backoff,
 * request deduplication, timeout protection, a staleness marker, and documented
 * precision/rounding rules.
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
 *    - When price source is unreachable, returns null / "Unavailable" / fallback string.
 *    - A price older than the staleness threshold is never shown as a fiat value;
 *      the UI shows the XLM amount marked as stale instead.
 */

import { fetchWithTimeout, getPriceTimeoutMs, readPositiveIntEnv } from "./timeout";

/** Fresh window: lookups inside it are served from cache with no upstream call. */
export const PRICE_CACHE_TTL_MS = 60_000; // 60 seconds
/**
 * Staleness threshold. Between the TTL and this age the cached value is served
 * immediately while a background refresh runs (stale-while-revalidate); beyond
 * it the value is marked `stale` and the UI must fall back to the asset unit.
 */
export const PRICE_STALE_AFTER_MS = 300_000; // 5 minutes
/** Default when `PRICE_REQUEST_TIMEOUT_MS` is unset (see `lib/timeout.ts`). */
export const DEFAULT_PRICE_TIMEOUT_MS = 5_000; // 5 seconds

/** First backoff step after an upstream failure; doubles per consecutive failure. */
export const PRICE_BACKOFF_BASE_MS = 5_000;
/** Backoff ceiling, also the cap applied to an upstream `Retry-After`. */
export const PRICE_BACKOFF_MAX_MS = 300_000;
/** First backoff step after a 429 that carries no usable `Retry-After`. */
const RATE_LIMIT_BACKOFF_BASE_MS = 30_000;

export const ROUNDING_RULES = {
  USD_STANDARD_DECIMALS: 2,
  USD_MICRO_DECIMALS: 4,
  MICRO_THRESHOLD: 0.01,
  XLM_MIN_DECIMALS: 2,
  XLM_MAX_DECIMALS: 7,
} as const;

export type PriceProviderId = "coingecko" | "coinbase";
/** `auto` = CoinGecko with Coinbase failover; otherwise a single provider. */
export type PriceProviderSetting = "auto" | PriceProviderId;

export interface PriceResult {
  price: number | null;
  source: PriceProviderId | "cached" | null;
  error?: string;
  /** Observation time (epoch ms): when `price` was last read from upstream. */
  timestamp?: number;
  /**
   * True when the observation is older than the staleness threshold. The
   * price is still returned (last known value) so callers can decide, but the
   * UI must not present it as a current fiat value.
   */
  stale?: boolean;
  /** True when a background refresh was started to replace a served cache hit. */
  revalidating?: boolean;
}

interface CacheEntry {
  price: number;
  source: PriceProviderId;
  timestamp: number;
}

interface BackoffState {
  failures: number;
  blockedUntil: number;
  rateLimited: boolean;
}

// ── Configuration ──────────────────────────────────────────────

/** Cache TTL in ms (`PRICE_CACHE_TTL_MS`). */
export function getPriceCacheTtlMs(): number {
  return readPositiveIntEnv("PRICE_CACHE_TTL_MS", PRICE_CACHE_TTL_MS);
}

/** Staleness threshold in ms (`PRICE_STALE_AFTER_MS`), never below the TTL. */
export function getPriceStaleAfterMs(): number {
  return Math.max(
    readPositiveIntEnv("PRICE_STALE_AFTER_MS", PRICE_STALE_AFTER_MS),
    getPriceCacheTtlMs()
  );
}

/** Configured provider (`PRICE_PROVIDER`); unknown values fall back to `auto`. */
export function getPriceProvider(): PriceProviderSetting {
  const raw = (
    process.env.PRICE_PROVIDER ??
    process.env.NEXT_PUBLIC_PRICE_PROVIDER ??
    ""
  )
    .trim()
    .toLowerCase();
  return raw === "coingecko" || raw === "coinbase" ? raw : "auto";
}

/** True when `timestamp` is older than `staleAfterMs` at `now`. */
export function isPriceStale(
  timestamp: number,
  staleAfterMs: number = getPriceStaleAfterMs(),
  now: number = Date.now()
): boolean {
  return now - timestamp > staleAfterMs;
}

// ── Providers ──────────────────────────────────────────────────

interface ProviderSpec {
  id: PriceProviderId;
  url: string;
  headers: (apiKey: string | undefined) => Record<string, string>;
  parse: (data: unknown) => number;
}

const PROVIDERS: Record<PriceProviderId, ProviderSpec> = {
  coingecko: {
    id: "coingecko",
    url: "https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd",
    // `PRICE_API_KEY` is a CoinGecko Demo key; the public endpoint works without one.
    headers: (apiKey): Record<string, string> =>
      apiKey ? { "x-cg-demo-api-key": apiKey } : {},
    parse: (data) => (data as { stellar?: { usd?: unknown } })?.stellar?.usd as number,
  },
  coinbase: {
    id: "coinbase",
    url: "https://api.coinbase.com/v2/prices/XLM-USD/spot",
    headers: () => ({}), // public endpoint, no key
    parse: (data) => {
      const amount = (data as { data?: { amount?: unknown } })?.data?.amount;
      return typeof amount === "string" ? parseFloat(amount) : Number(amount);
    },
  },
};

function getProviderChain(): ProviderSpec[] {
  const setting = getPriceProvider();
  return setting === "auto"
    ? [PROVIDERS.coingecko, PROVIDERS.coinbase]
    : [PROVIDERS[setting]];
}

type ProviderOutcome =
  | { ok: true; price: number }
  | { ok: false; status?: number; retryAfterMs?: number };

/** Parse `Retry-After` (delta-seconds or HTTP date) into ms, or undefined. */
function parseRetryAfterMs(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

/** Never throws: every failure mode becomes `{ ok: false }`. */
async function fetchFromProvider(
  provider: ProviderSpec,
  options: { timeoutMs: number; signal?: AbortSignal }
): Promise<ProviderOutcome> {
  try {
    const res = await fetchWithTimeout(
      provider.url,
      {
        headers: {
          Accept: "application/json",
          ...provider.headers(process.env.PRICE_API_KEY || undefined),
        },
      },
      { timeoutMs: options.timeoutMs, signal: options.signal, label: `${provider.id} price` }
    );
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        retryAfterMs: parseRetryAfterMs(res.headers?.get?.("Retry-After")),
      };
    }
    const price = provider.parse(await res.json());
    return typeof price === "number" && Number.isFinite(price) && price > 0
      ? { ok: true, price }
      : { ok: false };
  } catch {
    return { ok: false };
  }
}

// ── Cache, backoff and in-flight dedupe ────────────────────────

let priceCache: CacheEntry | null = null;
let pendingPriceFetch: Promise<PriceResult> | null = null;
const backoff = new Map<PriceProviderId, BackoffState>();

/**
 * Clear cached price and backoff state. Primarily for testing or manual cache busting.
 */
export function clearPriceCache(): void {
  priceCache = null;
  pendingPriceFetch = null;
  backoff.clear();
}

/**
 * Set a manual cache entry (useful for testing or SSR bootstrapping).
 * `timestamp` is the observation time and defaults to now.
 */
export function setCachedPrice(
  price: number,
  source: PriceProviderId = "coingecko",
  timestamp: number = Date.now()
): void {
  priceCache = { price, source, timestamp };
}

function recordFailure(id: PriceProviderId, outcome: { status?: number; retryAfterMs?: number }): void {
  const failures = (backoff.get(id)?.failures ?? 0) + 1;
  const rateLimited = outcome.status === 429;
  const base = rateLimited ? RATE_LIMIT_BACKOFF_BASE_MS : PRICE_BACKOFF_BASE_MS;
  const exponential = Math.min(base * 2 ** (failures - 1), PRICE_BACKOFF_MAX_MS);
  const delay =
    rateLimited && outcome.retryAfterMs !== undefined
      ? Math.min(outcome.retryAfterMs, PRICE_BACKOFF_MAX_MS)
      : exponential;
  backoff.set(id, { failures, blockedUntil: Date.now() + delay, rateLimited });
}

function cachedResult(
  entry: CacheEntry,
  staleAfterMs: number,
  extra: Partial<PriceResult> = {}
): PriceResult {
  return {
    price: entry.price,
    source: "cached",
    timestamp: entry.timestamp,
    stale: isPriceStale(entry.timestamp, staleAfterMs),
    ...extra,
  };
}

/** Query the provider chain, honouring backoff. Never rejects. */
async function refreshPrice(options: {
  timeoutMs: number;
  staleAfterMs: number;
  signal?: AbortSignal;
}): Promise<PriceResult> {
  let rateLimited = false;

  for (const provider of getProviderChain()) {
    const state = backoff.get(provider.id);
    if (state && state.blockedUntil > Date.now()) {
      rateLimited ||= state.rateLimited;
      continue; // still cooling down: do not hit a struggling upstream
    }

    const outcome = await fetchFromProvider(provider, options);
    if (outcome.ok) {
      backoff.delete(provider.id);
      priceCache = { price: outcome.price, source: provider.id, timestamp: Date.now() };
      return {
        price: outcome.price,
        source: provider.id,
        timestamp: priceCache.timestamp,
        stale: false,
      };
    }
    if (options.signal?.aborted) break; // caller cancelled: not the provider's fault
    recordFailure(provider.id, outcome);
    rateLimited ||= outcome.status === 429;
  }

  // Defined, non-throwing failure result. A last known price is returned with
  // its observation time and staleness marker rather than being dropped.
  if (priceCache) {
    return cachedResult(priceCache, options.staleAfterMs, {
      error: rateLimited
        ? "Price source rate limited, using last known price"
        : "Price sources currently unreachable, using last known price",
    });
  }
  return {
    price: null,
    source: null,
    error: rateLimited
      ? "XLM/USD price unavailable: upstream rate limited"
      : "XLM/USD price sources unavailable",
  };
}

/** Start a refresh, or join the in-flight one unless `force` is set. */
function startRefresh(
  options: { timeoutMs: number; staleAfterMs: number; signal?: AbortSignal },
  force = false
): Promise<PriceResult> {
  if (pendingPriceFetch && !force) return pendingPriceFetch;
  const promise: Promise<PriceResult> = refreshPrice(options).finally(() => {
    if (pendingPriceFetch === promise) pendingPriceFetch = null;
  });
  pendingPriceFetch = promise;
  return promise;
}

/**
 * Fetch current XLM spot price in USD. Never throws.
 *
 * Cache policy (all ages measured from the observation timestamp):
 * - age < TTL: served from cache, no upstream call.
 * - TTL <= age < stale threshold: served from cache immediately while one
 *   deduplicated background refresh runs (`revalidating: true`).
 * - age >= stale threshold: refresh is awaited; if it fails the last known
 *   price is returned with `stale: true` and an `error`.
 *
 * Provider selection is `PRICE_PROVIDER` (default: CoinGecko, then Coinbase).
 * A provider that fails or answers 429 is skipped for an exponentially growing
 * cooldown (or its `Retry-After`); `forceRefresh` bypasses the cache but not
 * the cooldown.
 */
export async function fetchXlmPrice(options?: {
  forceRefresh?: boolean;
  ttlMs?: number;
  staleAfterMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<PriceResult> {
  const ttl = options?.ttlMs ?? getPriceCacheTtlMs();
  const staleAfterMs = Math.max(options?.staleAfterMs ?? getPriceStaleAfterMs(), ttl);
  // Configurable per environment (`PRICE_REQUEST_TIMEOUT_MS`), issue #747.
  const timeoutMs = options?.timeoutMs ?? getPriceTimeoutMs();
  const forceRefresh = options?.forceRefresh ?? false;

  if (!forceRefresh && priceCache) {
    const age = Date.now() - priceCache.timestamp;
    if (age < ttl) return cachedResult(priceCache, staleAfterMs);
    if (age < staleAfterMs) {
      // Stale-while-revalidate: the shared refresh outlives this caller, so it
      // deliberately ignores the caller's abort signal.
      void startRefresh({ timeoutMs, staleAfterMs });
      return cachedResult(priceCache, staleAfterMs, { revalidating: true });
    }
  }

  return startRefresh({ timeoutMs, staleAfterMs, signal: options?.signal }, forceRefresh);
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
