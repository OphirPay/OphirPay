// SPDX-License-Identifier: MIT

import { getHorizonServer } from "@/lib/stellar";

/**
 * Fee recommendation driven by Horizon's `/fee_stats` endpoint (issue #825).
 *
 * Stellar's transaction `fee` is a *per-operation* bid in stroops, so every
 * number below that is called `fee`/`feePerOperation` is per operation and
 * `totalFee` is `feePerOperation * operations` (what the builder puts in the
 * transaction envelope and what the user is charged at most).
 *
 * Tunables (all optional, read at call time, see docs/PERFORMANCE.md):
 *  - NEXT_PUBLIC_FEE_POLICY          low | normal | high   (default normal)
 *  - NEXT_PUBLIC_FEE_REFRESH_MS      stats refresh interval (default 30000, min 5000)
 *  - NEXT_PUBLIC_FEE_FALLBACK_STROOPS per-op fee when Horizon is unreachable and
 *                                    nothing is cached (default 100)
 *  - NEXT_PUBLIC_FEE_MAX_STROOPS     per-op ceiling protecting users from surges
 *                                    (default 10000 = 0.001 XLM)
 */

export const STROOPS_PER_XLM = 10_000_000;
export const MIN_BASE_FEE_STROOPS = 100;

export const FEE_POLICIES = ["low", "normal", "high"] as const;
export type FeePolicy = (typeof FEE_POLICIES)[number];

/** `fee_charged` percentile each policy targets. */
export const POLICY_PERCENTILE = {
  low: "mode",
  normal: "p70",
  high: "p95",
} as const satisfies Record<FeePolicy, string>;
export type FeePercentile = (typeof POLICY_PERCENTILE)[FeePolicy];

export const DEFAULT_FEE_POLICY: FeePolicy = "normal";
export const DEFAULT_REFRESH_MS = 30_000;
export const MIN_REFRESH_MS = 5_000;
export const DEFAULT_FALLBACK_FEE = MIN_BASE_FEE_STROOPS;
export const DEFAULT_MAX_FEE = 10_000;

export type NetworkCongestion = "low" | "medium" | "high" | "unknown";

/** Where the recommended fee came from. */
export type FeeSource =
  /** Fresh statistics fetched from Horizon. */
  | "horizon"
  /** Horizon unreachable — last known good statistics reused. */
  | "cache"
  /** Horizon unreachable and nothing cached — configured static value. */
  | "fallback";

export interface FeeStats {
  lastLedger: number;
  /** Base fee of the last ledger, stroops per operation. */
  baseFee: number;
  /** Fraction of the last ledger's capacity used, 0..1. */
  ledgerCapacityUsage: number;
  /** `fee_charged` distribution, stroops per operation. */
  feeCharged: Record<FeePercentile, number>;
}

export interface FeeEstimate {
  /** Network base fee (per op) as last reported by Horizon; configured value on fallback. */
  baseFee: string;
  /** Recommended per-operation fee, stroops. */
  recommendedFee: string;
  /** `recommendedFee * operations`, stroops. This is what gets signed. */
  estimatedFee: string;
  operations: number;
  networkCongestion: NetworkCongestion;
  policy: FeePolicy;
  source: FeeSource;
  /** True when the value is not from a fresh Horizon response. */
  stale: boolean;
  /** Epoch ms of the Horizon response the numbers derive from; null on fallback. */
  fetchedAt: number | null;
  /** Ledger capacity usage 0..1; null when unknown. */
  ledgerCapacityUsage: number | null;
  /** Percentile targeted by the policy; null on fallback. */
  percentile: FeePercentile | null;
  /** Percentile fee before flooring/capping; null on fallback. */
  percentileFee: string | null;
  /** True when the per-op ceiling clamped the recommendation. */
  capped: boolean;
  refreshIntervalMs: number;
}

export class FeeStatsParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeeStatsParseError";
  }
}

// ── Configuration ──────────────────────────────────────────────

function readInt(raw: string | undefined, min: number, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min ? n : fallback;
}

export function isFeePolicy(value: unknown): value is FeePolicy {
  return typeof value === "string" && (FEE_POLICIES as readonly string[]).includes(value);
}

/** Configured default aggressiveness policy; unknown values fall back to `normal`. */
export function getConfiguredFeePolicy(): FeePolicy {
  const raw = process.env.NEXT_PUBLIC_FEE_POLICY?.trim().toLowerCase();
  return isFeePolicy(raw) ? raw : DEFAULT_FEE_POLICY;
}

export function getFeeRefreshIntervalMs(): number {
  return readInt(process.env.NEXT_PUBLIC_FEE_REFRESH_MS, MIN_REFRESH_MS, DEFAULT_REFRESH_MS);
}

export function getMaxFeePerOperation(): number {
  return readInt(process.env.NEXT_PUBLIC_FEE_MAX_STROOPS, MIN_BASE_FEE_STROOPS, DEFAULT_MAX_FEE);
}

export function getFallbackFeePerOperation(): number {
  const fallback = readInt(
    process.env.NEXT_PUBLIC_FEE_FALLBACK_STROOPS,
    MIN_BASE_FEE_STROOPS,
    DEFAULT_FALLBACK_FEE
  );
  return Math.min(fallback, getMaxFeePerOperation());
}

// ── Statistics parsing ─────────────────────────────────────────

function num(value: unknown, field: string): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (value === "" || !Number.isFinite(n) || n < 0) {
    throw new FeeStatsParseError(`Invalid fee stats field "${field}": ${String(value)}`);
  }
  return n;
}

/**
 * Parse a Horizon `/fee_stats` payload (all values arrive as strings).
 * Throws {@link FeeStatsParseError} for anything malformed so the caller can
 * treat a bad response exactly like an unreachable Horizon.
 */
export function parseFeeStats(raw: unknown): FeeStats {
  if (!raw || typeof raw !== "object") {
    throw new FeeStatsParseError("Fee stats response is not an object");
  }
  const r = raw as Record<string, unknown>;
  const charged = r.fee_charged;
  if (!charged || typeof charged !== "object") {
    throw new FeeStatsParseError('Fee stats response is missing "fee_charged"');
  }
  const c = charged as Record<string, unknown>;

  return {
    lastLedger: r.last_ledger === undefined ? 0 : num(r.last_ledger, "last_ledger"),
    baseFee: num(r.last_ledger_base_fee, "last_ledger_base_fee"),
    ledgerCapacityUsage: Math.min(1, num(r.ledger_capacity_usage, "ledger_capacity_usage")),
    feeCharged: {
      mode: num(c.mode, "fee_charged.mode"),
      p70: num(c.p70, "fee_charged.p70"),
      p95: num(c.p95, "fee_charged.p95"),
    },
  };
}

export function congestionFromCapacity(usage: number): NetworkCongestion {
  if (usage >= 0.8) return "high";
  if (usage >= 0.5) return "medium";
  return "low";
}

/**
 * Pure policy step: turn statistics into a per-operation fee.
 * The result is never below the ledger base fee (nor the 100 stroop network
 * minimum) and never above the configured ceiling.
 */
export function recommendFeePerOperation(
  stats: FeeStats,
  policy: FeePolicy,
  maxFee = getMaxFeePerOperation()
): { fee: number; percentile: FeePercentile; percentileFee: number; capped: boolean } {
  const percentile = POLICY_PERCENTILE[policy];
  const percentileFee = Math.ceil(stats.feeCharged[percentile]);
  const floor = Math.max(Math.ceil(stats.baseFee), MIN_BASE_FEE_STROOPS);
  const wanted = Math.max(percentileFee, floor);
  const capped = wanted > maxFee;
  return { fee: Math.min(wanted, maxFee), percentile, percentileFee, capped };
}

// ── Cache / fetch ──────────────────────────────────────────────

interface CachedStats {
  stats: FeeStats;
  fetchedAt: number;
}

let lastKnownGood: CachedStats | null = null;
let inFlight: Promise<CachedStats | null> | null = null;

/** Test hook: forget the cached statistics. */
export function resetFeeCache(): void {
  lastKnownGood = null;
  inFlight = null;
}

async function refreshStats(): Promise<CachedStats | null> {
  try {
    const raw = await getHorizonServer().feeStats();
    const stats = parseFeeStats(raw);
    lastKnownGood = { stats, fetchedAt: Date.now() };
    return lastKnownGood;
  } catch {
    return null;
  }
}

export interface EstimateOptions {
  policy?: FeePolicy;
  /** Bypass the refresh interval and hit Horizon now. */
  forceRefresh?: boolean;
}

/**
 * Recommend a fee for a transaction with `numOperations` operations.
 *
 * Statistics are cached for the refresh interval, so callers can poll freely.
 * When Horizon fails or returns garbage the last known good statistics are
 * reused (`source: "cache"`), and with none available the configured fallback
 * fee is returned (`source: "fallback"`) — both flagged `stale` so the UI can
 * say so.
 */
export async function estimateTransactionFee(
  numOperations = 1,
  options: EstimateOptions = {}
): Promise<FeeEstimate> {
  const policy = options.policy ?? getConfiguredFeePolicy();
  const refreshIntervalMs = getFeeRefreshIntervalMs();
  const operations = Math.max(1, Math.floor(numOperations));

  let cached = lastKnownGood;
  const fresh = cached !== null && Date.now() - cached.fetchedAt < refreshIntervalMs;

  let source: FeeSource = "horizon";
  if (options.forceRefresh || !fresh) {
    inFlight ??= refreshStats().finally(() => {
      inFlight = null;
    });
    const refreshed = await inFlight;
    if (refreshed) {
      cached = refreshed;
    } else {
      source = cached ? "cache" : "fallback";
    }
  }

  if (!cached) {
    const fee = getFallbackFeePerOperation();
    return {
      baseFee: String(MIN_BASE_FEE_STROOPS),
      recommendedFee: String(fee),
      estimatedFee: String(fee * operations),
      operations,
      networkCongestion: "unknown",
      policy,
      source: "fallback",
      stale: true,
      fetchedAt: null,
      ledgerCapacityUsage: null,
      percentile: null,
      percentileFee: null,
      capped: false,
      refreshIntervalMs,
    };
  }

  const rec = recommendFeePerOperation(cached.stats, policy);
  return {
    baseFee: String(cached.stats.baseFee),
    recommendedFee: String(rec.fee),
    estimatedFee: String(rec.fee * operations),
    operations,
    networkCongestion: congestionFromCapacity(cached.stats.ledgerCapacityUsage),
    policy,
    source,
    stale: source !== "horizon",
    fetchedAt: cached.fetchedAt,
    ledgerCapacityUsage: cached.stats.ledgerCapacityUsage,
    percentile: rec.percentile,
    percentileFee: String(rec.percentileFee),
    capped: rec.capped,
    refreshIntervalMs,
  };
}

/**
 * Calculate the estimated total fee for a batch payment with N recipients.
 * Each recipient = 1 payment operation.
 */
export function estimateBatchFee(recipientCount: number, baseFee = 100): string {
  return (baseFee * recipientCount).toString();
}

/**
 * Guard used right before signing: the fee baked into the built transaction
 * must equal the total the user was shown.
 */
export function assertFeeMatchesEstimate(builtFee: string | undefined, estimate: FeeEstimate): void {
  if (builtFee !== estimate.estimatedFee) {
    throw new Error(
      `Transaction fee (${builtFee ?? "unknown"} stroops) does not match the fee shown (${estimate.estimatedFee} stroops). Please review and try again.`
    );
  }
}

// ── Presentation helpers ───────────────────────────────────────

export function stroopsToXlm(stroops: string | number): string {
  const xlm = Number(stroops) / STROOPS_PER_XLM;
  return xlm.toFixed(7).replace(/0+$/, "").replace(/\.$/, "");
}

export const POLICY_LABELS: Record<FeePolicy, string> = {
  low: "Low",
  normal: "Normal",
  high: "Priority",
};

/** Human-readable explanation of where the recommended fee comes from. */
export function describeFeeBasis(estimate: FeeEstimate): string {
  const label = POLICY_LABELS[estimate.policy];
  if (estimate.percentile === null) {
    return `Horizon fee statistics are unavailable; using the configured fallback of ${estimate.recommendedFee} stroops per operation.`;
  }
  const pct = estimate.percentile === "mode" ? "most common" : estimate.percentile;
  const busy =
    estimate.ledgerCapacityUsage === null
      ? ""
      : `, ledger ${Math.round(estimate.ledgerCapacityUsage * 100)}% full`;
  const higher = Number(estimate.recommendedFee) > Number(estimate.baseFee);
  const why = higher
    ? `Higher than the ${estimate.baseFee} stroop base fee because recent ledgers charged more`
    : `Matches the ${estimate.baseFee} stroop base fee`;
  const cap = estimate.capped ? ` (capped at the ${getMaxFeePerOperation()} stroop ceiling)` : "";
  return `${label} policy: ${pct} fee charged over recent ledgers${busy}. ${why}${cap}.`;
}
