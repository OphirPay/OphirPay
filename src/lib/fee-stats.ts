// SPDX-License-Identifier: MIT

/**
 * Horizon fee statistics → fee recommendation (issue #825).
 *
 * Stellar's network base fee (currently 100 stroops) is a *floor*, not the
 * price of inclusion: during congestion ledgers fill up and only transactions
 * bidding above the prevailing `fee_charged` percentiles get included. The
 * transaction builders used to hardcode `fetchBaseFee()` — a single value that
 * tracks the floor but not the market — so a payment submitted during a fee
 * spike was underbid and stalled until its timebounds expired. That is a
 * visible failure for a payments product.
 *
 * This module turns Horizon's `/fee_stats` aggregate into a recommended fee:
 *
 *   • `parseFeeStats` normalises the raw response (string fields, missing
 *     percentiles) into numbers-safe `FeeStatistics`.
 *   • `recommendFee` applies a configurable *aggressiveness* policy that picks
 *     a percentile of `fee_charged` and never dips below the network base fee.
 *   • `getRecommendedFee` fetches the statistics through Horizon, caches them
 *     for a documented TTL, and falls back to the last known good value — then
 *     to a configured constant — when Horizon is unreachable. The result
 *     always carries a human-readable `basis` and a `stale` flag so the UI can
 *     explain *why* a fee is higher than usual.
 *
 * The parsing/recommendation helpers are deliberately pure (no Horizon import)
 * so transaction builders can reuse them without a circular dependency on
 * `@/lib/stellar`, which imports this module.
 */

import { logger } from "@/lib/logger";

// ── Types ──────────────────────────────────────────────────────

/** How aggressively to bid against the recent fee distribution. */
export type FeeAggressiveness = "low" | "medium" | "high";

/** Where the recommendation came from — surfaced to the UI. */
export type FeeSource = "horizon" | "cache" | "fallback";

/** Network congestion band derived from ledger capacity usage. */
export type NetworkCongestion = "low" | "medium" | "high";

/** A single percentile bucket of Horizon's `fee_charged` / `max_fee`. */
export interface FeeDistribution {
  min: number;
  max: number;
  mode: number;
  p10: number;
  p20: number;
  p40: number;
  p50: number;
  p60: number;
  p70: number;
  p80: number;
  p90: number;
  p95: number;
  p99: number;
}

/** Normalised Horizon `/fee_stats` payload. */
export interface FeeStatistics {
  /** `last_ledger_base_fee` — the protocol minimum for the next ledger. */
  baseFee: number;
  /** `ledger_capacity_usage` as a 0–1 fraction (0.0 = empty, 1.0 = full). */
  ledgerCapacityUsage: number;
  /** Percentiles of fees actually charged in recent ledgers. */
  charged: FeeDistribution;
  /** Percentiles of the maximum bids seen in recent ledgers. */
  maxFee: FeeDistribution;
  /** Ledger sequence the statistics were sampled at. */
  lastLedger: number;
}

/** The recommendation returned to callers (and re-exported to the UI). */
export interface FeeRecommendation {
  /** Recommended fee **per operation**, in stroops. */
  recommendedFee: number;
  /** Network base fee for the same sample, in stroops. */
  baseFee: number;
  /** Percentile bucket chosen by the aggressiveness policy (e.g. "p90"). */
  percentile: string;
  /** The percentile's charged fee, in stroops. */
  percentileFee: number;
  /** Aggressiveness policy in force when the recommendation was made. */
  aggressiveness: FeeAggressiveness;
  /** Congestion band derived from ledger capacity usage. */
  congestion: NetworkCongestion;
  /** Ledger capacity usage as a 0–1 fraction. */
  ledgerCapacityUsage: number;
  /** Human-readable explanation of *why* this fee was recommended. */
  basis: string;
  /** Whether the data came from Horizon, the cache, or the fallback. */
  source: FeeSource;
  /** True when the value is cached/fallback rather than freshly fetched. */
  stale: boolean;
  /** When the underlying statistics were sampled (ISO-8601). */
  fetchedAt: string;
}

/** Minimal shape of the Horizon response we depend on. */
export interface RawFeeStats {
  last_ledger?: string | number;
  last_ledger_base_fee?: string | number;
  ledger_capacity_usage?: string | number;
  fee_charged?: Partial<Record<keyof FeeDistribution, string | number>>;
  max_fee?: Partial<Record<keyof FeeDistribution, string | number>>;
}

// ── Configuration ──────────────────────────────────────────────

/** Percentile buckets the aggressiveness policy can select. */
export const PERCENTILE_BY_AGGRESSIVENESS: Record<FeeAggressiveness, keyof FeeDistribution> = {
  low: "p50",
  medium: "p90",
  high: "p99",
};

/** Default policy when `NEXT_PUBLIC_FEE_AGGRESSIVENESS` is unset. */
export const DEFAULT_FEE_AGGRESSIVENESS: FeeAggressiveness = "medium";

/** Default fee-statistics cache TTL, in milliseconds. */
export const DEFAULT_FEE_STATS_TTL_MS = 30_000;

/** Default fee used when Horizon is unreachable and nothing is cached. */
export const DEFAULT_FALLBACK_BASE_FEE = 100;

/** Ledger capacity usage above which the network is reported as congested. */
export const CONGESTION_MEDIUM_THRESHOLD = 0.5;
export const CONGESTION_HIGH_THRESHOLD = 0.8;

/** Normalise a user-supplied aggressiveness string. */
export function normalizeAggressiveness(value: unknown): FeeAggressiveness {
  const v = String(value ?? "").trim().toLowerCase();
  if (v === "low" || v === "medium" || v === "high") return v;
  return DEFAULT_FEE_AGGRESSIVENESS;
}

/**
 * Aggressiveness policy in force. Read from `NEXT_PUBLIC_FEE_AGGRESSIVENESS`
 * so it can be tuned per deployment/network; the UI can display the same
 * value because `NEXT_PUBLIC_*` vars are inlined into the client bundle.
 */
export function getFeeAggressiveness(): FeeAggressiveness {
  return normalizeAggressiveness(process.env.NEXT_PUBLIC_FEE_AGGRESSIVENESS);
}

/** Cache TTL in milliseconds (`FEE_STATS_TTL_MS`, positive integers only). */
export function getFeeStatsTtlMs(): number {
  const raw = process.env.FEE_STATS_TTL_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : DEFAULT_FEE_STATS_TTL_MS;
}

/**
 * Last-resort fee used when Horizon is unreachable **and** no cached value
 * exists — e.g. a cold serverless start during a Horizon outage.
 */
export function getFallbackBaseFee(): number {
  for (const name of ["FEE_FALLBACK_BASE_FEE", "NEXT_PUBLIC_FALLBACK_BASE_FEE"]) {
    const parsed = Number(process.env[name]);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  }
  return DEFAULT_FALLBACK_BASE_FEE;
}

// ── Parsing ────────────────────────────────────────────────────

function toNumber(value: string | number | undefined, fallback = 0): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

const DISTRIBUTION_KEYS: ReadonlyArray<keyof FeeDistribution> = [
  "min",
  "max",
  "mode",
  "p10",
  "p20",
  "p40",
  "p50",
  "p60",
  "p70",
  "p80",
  "p90",
  "p95",
  "p99",
];

function parseDistribution(
  raw: RawFeeStats["fee_charged"],
  fallback: number
): FeeDistribution {
  const out = {} as FeeDistribution;
  for (const key of DISTRIBUTION_KEYS) {
    out[key] = toNumber(raw?.[key], fallback);
  }
  return out;
}

/**
 * Normalise a raw Horizon `/fee_stats` response.
 *
 * Horizon returns every numeric as a string, and a malformed/partial payload
 * is possible behind a proxy — so every field is coerced with a fallback and
 * a missing percentile inherits the base fee rather than collapsing to 0
 * (recommending a fee of 0 would produce an unsubmittable transaction).
 */
export function parseFeeStats(raw: RawFeeStats): FeeStatistics {
  const baseFee = Math.max(0, toNumber(raw.last_ledger_base_fee, DEFAULT_FALLBACK_BASE_FEE));
  const capacity = toNumber(raw.ledger_capacity_usage, 0);

  return {
    baseFee,
    ledgerCapacityUsage: Math.min(1, Math.max(0, capacity)),
    charged: parseDistribution(raw.fee_charged, baseFee),
    maxFee: parseDistribution(raw.max_fee, baseFee),
    lastLedger: toNumber(raw.last_ledger, 0),
  };
}

// ── Recommendation ─────────────────────────────────────────────

/** Map ledger capacity usage to a congestion band. */
export function congestionFromCapacity(usage: number): NetworkCongestion {
  if (usage >= CONGESTION_HIGH_THRESHOLD) return "high";
  if (usage >= CONGESTION_MEDIUM_THRESHOLD) return "medium";
  return "low";
}

/**
 * Choose a recommended fee from parsed statistics.
 *
 * The selected `fee_charged` percentile is the bid the aggressiveness policy
 * asks for; it is floored at the network base fee so the recommendation is
 * always at least the protocol minimum. `recommendedFee` is per operation —
 * callers multiply by operation count.
 */
export function recommendFee(
  stats: FeeStatistics,
  aggressiveness: FeeAggressiveness = DEFAULT_FEE_AGGRESSIVENESS
): {
  recommendedFee: number;
  percentile: string;
  percentileFee: number;
  congestion: NetworkCongestion;
} {
  const percentile = PERCENTILE_BY_AGGRESSIVENESS[aggressiveness];
  const percentileFee = stats.charged[percentile];
  const recommendedFee = Math.max(stats.baseFee, Math.ceil(percentileFee));

  return {
    recommendedFee,
    percentile,
    percentileFee,
    congestion: congestionFromCapacity(stats.ledgerCapacityUsage),
  };
}

/** Build the human-readable "why is this fee what it is" explanation. */
export function buildFeeBasis(params: {
  percentile: string;
  recommendedFee: number;
  baseFee: number;
  aggressiveness: FeeAggressiveness;
  congestion: NetworkCongestion;
  ledgerCapacityUsage: number;
  source: FeeSource;
}): string {
  const capacityPct = Math.round(params.ledgerCapacityUsage * 100);
  const aboveBase = params.recommendedFee > params.baseFee;

  const parts = [
    aboveBase
      ? `${params.percentile} of recently charged fees`
      : `network base fee (${params.baseFee} stroops)`,
    `ledger ${capacityPct}% full (${params.congestion} congestion)`,
    `${params.aggressiveness} aggressiveness`,
  ];

  if (params.source === "fallback") {
    parts.push("Horizon unreachable — using the last-resort configured fee");
  } else if (params.source === "cache") {
    parts.push("cached Horizon fee statistics");
  }

  return parts.join(" · ");
}

// ── Fetch + cache ──────────────────────────────────────────────

/** Fetch the raw `/fee_stats` payload. Injectable for tests. */
export type FeeStatsFetcher = () => Promise<RawFeeStats>;

/**
 * Default fetcher — resolves `getHorizonServer()` lazily.
 *
 * The dynamic import keeps this module free of a static dependency on
 * `@/lib/stellar` (which imports the pure helpers here), avoiding a module
 * cycle while still going through the shared timeout-enforcing Horizon client.
 */
export async function defaultFeeStatsFetcher(): Promise<RawFeeStats> {
  const { getHorizonServer } = await import("@/lib/stellar");
  const server = getHorizonServer();
  return server.feeStats() as unknown as RawFeeStats;
}

interface CacheEntry {
  stats: FeeStatistics;
  at: number;
}

let cache: CacheEntry | null = null;
let lastKnownGood: FeeStatistics | null = null;

/** Clear caches between tests. */
export function resetFeeStatsCache(): void {
  cache = null;
  lastKnownGood = null;
}

/** Test hook: the currently cached statistics, if any. */
export function peekFeeStatsCache(): FeeStatistics | null {
  return cache?.stats ?? null;
}

function buildRecommendation(
  stats: FeeStatistics,
  source: FeeSource,
  at: number
): FeeRecommendation {
  const aggressiveness = getFeeAggressiveness();
  const { recommendedFee, percentile, percentileFee, congestion } = recommendFee(
    stats,
    aggressiveness
  );

  return {
    recommendedFee,
    baseFee: stats.baseFee,
    percentile,
    percentileFee,
    aggressiveness,
    congestion,
    ledgerCapacityUsage: stats.ledgerCapacityUsage,
    basis: buildFeeBasis({
      percentile,
      recommendedFee,
      baseFee: stats.baseFee,
      aggressiveness,
      congestion,
      ledgerCapacityUsage: stats.ledgerCapacityUsage,
      source,
    }),
    source,
    stale: source !== "horizon",
    fetchedAt: new Date(at).toISOString(),
  };
}

function fallbackRecommendation(): FeeRecommendation {
  const fee = getFallbackBaseFee();
  const stats: FeeStatistics = {
    baseFee: fee,
    ledgerCapacityUsage: 0,
    charged: parseDistribution(undefined, fee),
    maxFee: parseDistribution(undefined, fee),
    lastLedger: 0,
  };
  return buildRecommendation(stats, "fallback", Date.now());
}

/**
 * Recommend a per-operation fee from Horizon fee statistics.
 *
 * Returns a fresh value while the cache is younger than `FEE_STATS_TTL_MS`;
 * otherwise refetches. When Horizon is unreachable it serves the last known
 * good statistics (flagged `source: "cache"`, `stale: true`), and only when
 * no statistics have ever been fetched does it fall back to the configured
 * constant (`source: "fallback"`). It never throws, so callers can treat the
 * return value as always-present.
 *
 * @param fetcher Optional statistics fetcher (defaults to Horizon).
 * @param now Optional clock, for deterministic tests.
 */
export async function getRecommendedFee(
  fetcher: FeeStatsFetcher = defaultFeeStatsFetcher,
  now: number = Date.now()
): Promise<FeeRecommendation> {
  const ttl = getFeeStatsTtlMs();
  if (cache && now - cache.at < ttl) {
    return buildRecommendation(cache.stats, "cache", cache.at);
  }

  try {
    const raw = await fetcher();
    const stats = parseFeeStats(raw);
    cache = { stats, at: now };
    lastKnownGood = stats;
    return buildRecommendation(stats, "horizon", now);
  } catch (err) {
    logger.warn("Fee statistics unavailable — falling back", {
      error: err instanceof Error ? err.message : String(err),
    });

    const fallbackStats = lastKnownGood ?? cache?.stats;
    if (fallbackStats) {
      return buildRecommendation(fallbackStats, "cache", cache?.at ?? now);
    }
    return fallbackRecommendation();
  }
}
