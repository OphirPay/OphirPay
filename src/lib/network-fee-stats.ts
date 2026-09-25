// SPDX-License-Identifier: MIT

/**
 * Horizon fee-statistics based fee recommendation (issue #825).
 *
 * The network base fee used to be treated as a constant. During congestion a
 * transaction built with a constant base fee is underbid and either fails or
 * stalls, which is a visible failure for a payments product. This module reads
 * Horizon's `/fee_stats` endpoint and derives a recommendation from *current*
 * conditions:
 *
 *   - `last_ledger_base_fee`  — the base fee of the most recent ledger
 *   - `ledger_capacity_usage` — how full recent ledgers are (0..1)
 *   - `fee_charged` percentiles (p50/p95/p99/max) — what transactions actually
 *     paid, which is the only reliable signal during a fee spike
 *
 * The recommendation is intentionally explainable: every value ships with a
 * human-readable `basis` string so the UI can show *why* a fee is higher than
 * usual, as required by the acceptance criteria.
 *
 * Fallback: when Horizon is unreachable or returns an unusable payload we fall
 * back to the last known good recommendation (in-memory cache), and failing
 * that to the configured baseline (Stellar's 100 stroops). The fallback is
 * always flagged so the UI can render a visible indication, and we never
 * silently pretend a cached value is live.
 */

import { getHorizonServer } from "@/lib/stellar";

// ── Constants ──────────────────────────────────────────────────

/** Stellar's protocol minimum base fee, in stroops. */
export const BASELINE_BASE_FEE = 100;

/**
 * Documented refresh interval for live fee statistics. Callers that poll
 * should use this value so the refresh cadence is consistent across screens.
 */
export const FEE_STATS_REFRESH_INTERVAL_MS = 30_000;

/** A recommendation older than this is considered stale even with no error. */
export const FEE_STATS_MAX_AGE_MS = 120_000;

export type FeeSource = "horizon" | "cache" | "baseline" | "configured";

export type Congestion = "low" | "medium" | "high";

/** Configurable aggressiveness policy for how much we are willing to overbid. */
export type FeeAggressiveness = "economical" | "standard" | "aggressive";

export interface FeeRecommendation {
  /** Base fee per operation, in stroops, that should be signed. */
  baseFeeStroops: number;
  /** Base fee as a string, matching the previous `FeeEstimate.baseFee` shape. */
  baseFee: string;
  /** Estimated total fee for `operations` operations, in stroops. */
  estimatedFee: string;
  /** Number of operations the estimate covers. */
  operations: number;
  /** Congestion band derived from capacity usage and the percentile spread. */
  congestion: Congestion;
  /** Where the base fee came from. */
  source: FeeSource;
  /** True when Horizon was unreachable or the value is stale. */
  stale: boolean;
  /** Human-readable explanation, safe to render directly in the UI. */
  basis: string;
  /** Epoch ms the underlying statistics were observed. */
  observedAt: number;
  /** Raw parsed statistics, for debugging and tests. */
  stats?: ParsedFeeStats;
}

// ── Parsing ────────────────────────────────────────────────────

export interface ParsedFeeStats {
  lastLedgerBaseFee: number;
  ledgerCapacityUsage: number;
  min: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

type AnyRecord = Record<string, unknown>;

function asRecord(value: unknown): AnyRecord | null {
  return value && typeof value === "object" ? (value as AnyRecord) : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/**
 * Parse a Horizon `/fee_stats` payload into a flat, validated shape.
 *
 * Returns `null` when required fields are missing or nonsensical rather than
 * guessing, so callers can take the documented fallback path.
 */
export function parseFeeStats(payload: unknown): ParsedFeeStats | null {
  const root = asRecord(payload);
  if (!root) return null;

  const baseFee =
    num(root.last_ledger_base_fee) ?? num(root.base_fee) ?? null;

  // Horizon historically nested these under `fee_charged`; accept either shape.
  const charged = asRecord(root.fee_charged) ?? root;
  const p50 = num(charged.p50) ?? baseFee;
  const p95 = num(charged.p95);
  const p99 = num(charged.p99);
  const max = num(charged.max);
  const min = num(charged.min);

  const capacity = num(root.ledger_capacity_usage);

  if (baseFee === null || baseFee <= 0) return null;
  if (p50 === null || p50 <= 0) return null;
  if (capacity === null || capacity < 0 || capacity > 1) return null;

  return {
    lastLedgerBaseFee: Math.ceil(baseFee),
    ledgerCapacityUsage: capacity,
    min: min !== null && min > 0 ? Math.ceil(min) : BASELINE_BASE_FEE,
    p50: Math.ceil(p50),
    p95: Math.ceil(p95 ?? p50),
    p99: Math.ceil(p99 ?? p95 ?? p50),
    max: Math.ceil(max ?? p99 ?? p95 ?? p50),
  };
}

// ── Policy ─────────────────────────────────────────────────────

export function congestionFrom(stats: ParsedFeeStats): Congestion {
  const { ledgerCapacityUsage, p95, lastLedgerBaseFee } = stats;
  const overbidRatio = lastLedgerBaseFee > 0 ? p95 / lastLedgerBaseFee : 1;

  if (ledgerCapacityUsage >= 0.8 || overbidRatio >= 5) return "high";
  if (ledgerCapacityUsage >= 0.5 || overbidRatio >= 2) return "medium";
  return "low";
}

/**
 * Choose the recommended base fee for the given aggressiveness.
 *
 * `last_ledger_base_fee` is the protocol floor for the next ledger, but under
 * load it is not what actually gets included — so we also consider the
 * percentiles of what transactions paid. `standard` walks up through p50/p95
 * as capacity rises; `aggressive` goes straight to p99+ to strongly prefer
 * inclusion in the next ledger.
 */
export function recommendBaseFee(
  stats: ParsedFeeStats,
  aggressiveness: FeeAggressiveness = "standard"
): number {
  const { lastLedgerBaseFee, ledgerCapacityUsage, p50, p95, p99, max } = stats;

  const floor = Math.max(BASELINE_BASE_FEE, lastLedgerBaseFee);

  if (aggressiveness === "economical") {
    return Math.max(floor, Math.min(p50, floor * 2));
  }

  if (aggressiveness === "aggressive") {
    const target = ledgerCapacityUsage >= 0.8 ? max : p99;
    return Math.max(floor, target);
  }

  // standard
  let target: number;
  if (ledgerCapacityUsage >= 0.8) target = p95;
  else if (ledgerCapacityUsage >= 0.5) target = p50;
  else target = floor;

  return Math.max(floor, target);
}

/** Human-readable justification shown next to the fee in the UI. */
export function describeBasis(
  stats: ParsedFeeStats,
  chosen: number,
  aggressiveness: FeeAggressiveness = "standard"
): string {
  const pct = Math.round(stats.ledgerCapacityUsage * 100);
  const congestion = congestionFrom(stats);

  if (congestion === "low" && chosen <= stats.lastLedgerBaseFee) {
    return `Network is quiet (${pct}% ledger capacity); using the current base fee of ${chosen} stroops.`;
  }

  const source =
    chosen >= stats.max
      ? "the maximum recently charged fee"
      : chosen >= stats.p99
        ? "the 99th percentile of recently charged fees"
        : chosen >= stats.p95
          ? "the 95th percentile of recently charged fees"
          : chosen >= stats.p50
            ? "the median recently charged fee"
            : `the current base fee of ${stats.lastLedgerBaseFee} stroops`;

  return `Ledgers are ${pct}% full (${congestion} congestion); recommending ${chosen} stroops, based on ${source}, policy "${aggressiveness}".`;
}

// ── Cache ──────────────────────────────────────────────────────

let lastGood: { recommendation: FeeRecommendation; at: number } | null = null;

/** Test seam — clears the last-known-good cache. */
export function __resetFeeStatsCache(): void {
  lastGood = null;
}

// ── Fallback ───────────────────────────────────────────────────

export function fallbackRecommendation(
  operations = 1,
  reason = "Horizon was unreachable",
  configuredBaseFee?: number
): FeeRecommendation {
  const baseFee =
    configuredBaseFee && configuredBaseFee > 0
      ? Math.ceil(configuredBaseFee)
      : BASELINE_BASE_FEE;
  const source: FeeSource =
    configuredBaseFee && configuredBaseFee > 0 ? "configured" : "baseline";

  return {
    baseFeeStroops: baseFee,
    baseFee: String(baseFee),
    estimatedFee: String(baseFee * operations),
    operations,
    congestion: "low",
    source,
    stale: true,
    basis: `${reason}; falling back to ${baseFee} stroops per operation (${source}). The fee may be underbid if the network is congested.`,
    observedAt: Date.now(),
  };
}

// ── Public API ─────────────────────────────────────────────────

export interface FetchFeeStats {
  (): Promise<unknown>;
}

export interface GetFeeRecommendationOptions {
  operations?: number;
  aggressiveness?: FeeAggressiveness;
  /** Last-known-good cache lifetime before we treat the value as stale. */
  maxAgeMs?: number;
  /** Configured override used when Horizon cannot be reached. */
  configuredBaseFee?: number;
  /** Injectable fetcher, for tests. Defaults to Horizon `/fee_stats`. */
  fetcher?: FetchFeeStats;
  /** Force bypassing the cache, e.g. an explicit refresh. */
  forceRefresh?: boolean;
}

async function defaultFetcher(): Promise<unknown> {
  const server = getHorizonServer();
  const anyServer = server as unknown as { feeStats?: () => Promise<unknown> };
  if (typeof anyServer.feeStats === "function") return anyServer.feeStats();
  const response = await fetch(`${server.serverURL}fee_stats`);
  if (!response.ok) throw new Error(`Horizon fee_stats: ${response.status}`);
  return response.json();
}

/**
 * Recommend a fee from live Horizon statistics.
 *
 * Never throws: an unreachable Horizon yields a flagged fallback so callers can
 * always build a transaction, and the UI can always show an honest basis.
 */
export async function getFeeRecommendation(
  options: GetFeeRecommendationOptions = {}
): Promise<FeeRecommendation> {
  const {
    operations = 1,
    aggressiveness = "standard",
    maxAgeMs = FEE_STATS_MAX_AGE_MS,
    configuredBaseFee,
    fetcher = defaultFetcher,
    forceRefresh = false,
  } = options;

  const now = Date.now();
  if (!forceRefresh && lastGood && now - lastGood.at < maxAgeMs) {
    return { ...lastGood.recommendation, operations, estimatedFee: String(lastGood.recommendation.baseFeeStroops * operations) };
  }

  try {
    const stats = parseFeeStats(await fetcher());
    if (!stats) throw new Error("unusable fee statistics payload");

    const chosen = recommendBaseFee(stats, aggressiveness);
    const recommendation: FeeRecommendation = {
      baseFeeStroops: chosen,
      baseFee: String(chosen),
      estimatedFee: String(chosen * operations),
      operations,
      congestion: congestionFrom(stats),
      source: "horizon",
      stale: false,
      basis: describeBasis(stats, chosen, aggressiveness),
      observedAt: now,
      stats,
    };

    lastGood = { recommendation, at: now };
    return recommendation;
  } catch (error) {
    const reason =
      error instanceof Error && error.message
        ? `Horizon fee statistics unavailable (${error.message})`
        : "Horizon was unreachable";

    if (lastGood) {
      const age = now - lastGood.at;
      const cached = lastGood.recommendation;
      return {
        ...cached,
        operations,
        estimatedFee: String(cached.baseFeeStroops * operations),
        source: "cache",
        stale: true,
        basis: `${reason}; using the last known good fee of ${cached.baseFeeStroops} stroops, observed ${Math.round(age / 1000)}s ago.`,
      };
    }

    return fallbackRecommendation(operations, reason, configuredBaseFee);
  }
}

/** Backwards-compatible helper retained from the previous estimator. */
export async function estimateTransactionFee(
  numOperations = 1
): Promise<Pick<FeeRecommendation, "baseFee" | "estimatedFee" | "operations" | "congestion">> {
  const rec = await getFeeRecommendation({ operations: numOperations });
  return {
    baseFee: rec.baseFee,
    estimatedFee: rec.estimatedFee,
    operations: rec.operations,
    congestion: rec.congestion,
  };
}

/** Calculate the estimated total fee for a batch payment with N recipients. */
export function estimateBatchFee(recipientCount: number, baseFee = BASELINE_BASE_FEE): string {
  return (baseFee * recipientCount).toString();
}
