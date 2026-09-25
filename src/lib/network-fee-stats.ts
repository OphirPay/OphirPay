// SPDX-License-Identifier: MIT
//
// Network fee recommendation derived from Horizon fee statistics — issue #825.
//
// The network base fee was treated as a constant (100 stroops). During
// congestion that underbids the transaction: it is included in a later ledger
// at best, rejected at worst, and either way the payments product looks broken.
//
// Horizon already publishes what we need on `/fee_stats`: the last ledger's
// base fee, ledger capacity usage, and charged-fee percentiles. This module
// turns those into a recommendation under a *policy* (aggressiveness), and —
// critically — never throws. An unreachable Horizon yields the last known good
// value, or the configured fallback, tagged so the UI can say why.

import { HORIZON_URL } from "@/lib/stellar";

/** Stroops. Protocol minimum; also the historical hardcoded value. */
export const FALLBACK_BASE_FEE = Number(process.env.NEXT_PUBLIC_FALLBACK_BASE_FEE ?? 100);

/** How long a recommendation is reused before Horizon is consulted again. */
export const FEE_STATS_TTL_MS = Number(process.env.NEXT_PUBLIC_FEE_STATS_TTL_MS ?? 30_000);

/** Stroops per XLM; the threshold above which we call the network congested. */
export const CONGESTION_MEDIUM_STROOPS = 200;
export const CONGESTION_HIGH_STROOPS = 1_000;

export type Aggressiveness = "low" | "medium" | "high";

/** Which percentile of recently *charged* fees the policy follows. */
const POLICY_PERCENTILE: Record<Aggressiveness, "p50" | "p90" | "p99"> = {
  low: "p50",
  medium: "p90",
  high: "p99",
};

export type Congestion = "low" | "medium" | "high";

/** Normalised view of Horizon's `/fee_stats` payload. */
export interface FeeStats {
  /** `last_ledger_base_fee` — the current protocol floor, in stroops. */
  baseFee: number;
  /** Fraction (0..1) of the last ledger's max transaction count that was used. */
  ledgerCapacityUsage: number;
  charged: { min: number; max: number; mode: number; p50: number; p90: number; p99: number };
  lastLedger: number;
}

/** Where a recommendation's number came from. Shown to the user verbatim. */
export type FeeSource = "horizon" | "cache" | "fallback";

export interface FeeRecommendation {
  /** The fee to put on the transaction, per operation, in stroops. */
  baseFeeStroops: number;
  /** Recommendation for a transaction with this many operations. */
  totalStroops: number;
  aggressiveness: Aggressiveness;
  congestion: Congestion;
  source: FeeSource;
  /** True when Horizon could not be reached and we served a stale/fallback value. */
  stale: boolean;
  /** Human-readable justification, rendered next to the fee in the UI. */
  basis: string;
  stats?: FeeStats;
  /** Epoch ms after which this recommendation should be re-fetched. */
  expiresAt: number;
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse Horizon `/fee_stats` into a `FeeStats`.
 *
 * Returns `null` — rather than a partially-filled object — when any field we
 * price against is missing or non-numeric. A half-parsed payload is how a fee
 * ends up accidentally derived from `undefined`.
 */
export function parseFeeStats(raw: unknown): FeeStats | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, any>;
  const charged = r.fee_charged ?? {};
  const baseFee = num(r.last_ledger_base_fee);
  const usage = num(r.ledger_capacity_usage);
  const p50 = num(charged.p50);
  const p90 = num(charged.p90);
  const p99 = num(charged.p99);
  if (baseFee === null || usage === null || p50 === null || p90 === null || p99 === null) return null;

  return {
    baseFee,
    // Horizon documents this as a 0..1 fraction; clamp defensively for callers
    // that sum or render it directly.
    ledgerCapacityUsage: Math.min(1, Math.max(0, usage)),
    charged: {
      min: num(charged.min) ?? baseFee,
      max: num(charged.max) ?? p99,
      mode: num(charged.mode) ?? baseFee,
      p50,
      p90,
      p99,
    },
    lastLedger: num(r.last_ledger) ?? 0,
  };
}

export function congestionFor(baseFeeStroops: number): Congestion {
  if (baseFeeStroops >= CONGESTION_HIGH_STROOPS) return "high";
  if (baseFeeStroops >= CONGESTION_MEDIUM_STROOPS) return "medium";
  return "low";
}

/**
 * Turn statistics plus a policy into a recommendation.
 *
 * The number is the *maximum* of the current base fee and the policy
 * percentile: the percentile alone can sit below the floor when a ledger is
 * empty, and a fee below the base fee is not merely low, it is invalid.
 */
export function recommendFromStats(
  stats: FeeStats,
  opts: { aggressiveness?: Aggressiveness; operations?: number; source?: FeeSource; stale?: boolean; now?: number } = {},
): FeeRecommendation {
  const aggressiveness = opts.aggressiveness ?? defaultAggressiveness();
  const operations = Math.max(1, opts.operations ?? 1);
  const percentile = POLICY_PERCENTILE[aggressiveness];
  const charged = stats.charged[percentile];
  const baseFeeStroops = Math.max(stats.baseFee, charged);
  const source = opts.source ?? "horizon";
  const congestion = congestionFor(baseFeeStroops);

  const basis =
    source === "horizon"
      ? `${percentile} of recently charged fees (${charged} stroops), base fee ${stats.baseFee}; ledger ${Math.round(
          stats.ledgerCapacityUsage * 100,
        )}% full — ${aggressiveness} policy`
      : `last known good value (${baseFeeStroops} stroops) — ${percentile} of charged fees at the time Horizon was last reachable`;

  return {
    baseFeeStroops,
    totalStroops: baseFeeStroops * operations,
    aggressiveness,
    congestion,
    source,
    stale: opts.stale ?? false,
    basis,
    stats,
    expiresAt: (opts.now ?? Date.now()) + FEE_STATS_TTL_MS,
  };
}

/** The recommendation served when Horizon has never been reachable. */
export function fallbackRecommendation(opts: { operations?: number; now?: number } = {}): FeeRecommendation {
  const operations = Math.max(1, opts.operations ?? 1);
  return {
    baseFeeStroops: FALLBACK_BASE_FEE,
    totalStroops: FALLBACK_BASE_FEE * operations,
    aggressiveness: defaultAggressiveness(),
    congestion: congestionFor(FALLBACK_BASE_FEE),
    source: "fallback",
    stale: true,
    basis: `configured fallback (${FALLBACK_BASE_FEE} stroops) — Horizon could not be reached, so the fee may be too low under congestion`,
    expiresAt: (opts.now ?? Date.now()) + FEE_STATS_TTL_MS,
  };
}

function defaultAggressiveness(): Aggressiveness {
  const raw = (process.env.NEXT_PUBLIC_FEE_AGGRESSIVENESS ?? "medium").toLowerCase();
  return raw === "low" || raw === "high" ? raw : "medium";
}

// ---------------------------------------------------------------------------
// Cache + transport
//
// Module-level so the proxy, the route handlers and the send screen share one
// fetch per TTL window instead of each hammering Horizon.
// ---------------------------------------------------------------------------

interface CacheEntry {
  recommendation: FeeRecommendation;
  fetchedAt: number;
}
let cache: CacheEntry | null = null;

export function clearFeeStatsCache(): void {
  cache = null;
}

export function peekCachedRecommendation(now = Date.now()): FeeRecommendation | null {
  if (!cache) return null;
  return { ...cache.recommendation, source: "cache", stale: now > cache.recommendation.expiresAt };
}

type Fetcher = (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

/**
 * Recommend a network fee.
 *
 * Never throws and never returns `undefined` — every caller gets a usable fee
 * plus a `source`/`basis` it can display. `operations` scales the total, not
 * the per-operation fee.
 */
export async function getFeeRecommendation(
  opts: { operations?: number; aggressiveness?: Aggressiveness; now?: number; fetcher?: Fetcher; url?: string } = {},
): Promise<FeeRecommendation> {
  const now = opts.now ?? Date.now();
  const operations = Math.max(1, opts.operations ?? 1);
  const aggressiveness = opts.aggressiveness ?? defaultAggressiveness();

  if (cache && now - cache.fetchedAt < FEE_STATS_TTL_MS) {
    return { ...cache.recommendation, source: "cache", stale: false, totalStroops: cache.recommendation.baseFeeStroops * operations };
  }

  const fetcher: Fetcher = opts.fetcher ?? ((url: string) => fetch(url) as unknown as ReturnType<Fetcher>);
  const url = opts.url ?? `${HORIZON_URL.replace(/\/+$/, "")}/fee_stats`;

  try {
    const res = await fetcher(url);
    if (!res.ok) throw new Error(`Horizon responded ${(res as any).status ?? "non-ok"}`);
    const stats = parseFeeStats(await res.json());
    if (!stats) throw new Error("unparseable fee_stats payload");

    const rec = recommendFromStats(stats, { aggressiveness, operations, source: "horizon", now });
    cache = { recommendation: { ...rec, totalStroops: rec.baseFeeStroops }, fetchedAt: now };
    return rec;
  } catch {
    // Horizon unreachable or talking nonsense: prefer the last known good value
    // over a config constant, and say so.
    if (cache) {
      const stale = recommendFromStats(cache.recommendation.stats as FeeStats, {
        aggressiveness,
        operations,
        source: "cache",
        stale: true,
        now,
      });
      return stale;
    }
    return fallbackRecommendation({ operations, now });
  }
}

/**
 * Guard for the "fee shown before signing matches the fee submitted" criterion.
 *
 * Called immediately before signing, with the stroop value the confirmation
 * screen displayed. Returns the discrepancy instead of throwing so the caller
 * can re-prompt the user rather than silently signing a different number.
 */
export function assertQuotedFeeMatches(
  quoted: FeeRecommendation,
  submittedStroops: number,
): { matches: boolean; expected: number; actual: number } {
  return {
    matches: quoted.totalStroops === submittedStroops,
    expected: quoted.totalStroops,
    actual: submittedStroops,
  };
}
