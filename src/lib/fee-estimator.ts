// SPDX-License-Identifier: MIT

import { getHorizonServer, HORIZON_URL } from "@/lib/stellar";

/**
 * Standard default fallback base fee in stroops when Horizon is completely unreachable.
 */
export const DEFAULT_FALLBACK_BASE_FEE = "100";

/**
 * Fee statistics cache TTL in milliseconds (30 seconds, corresponding to ~5-6 Stellar ledgers).
 */
export const FEE_CACHE_TTL_MS = 30_000;

/**
 * Horizon /fee_stats response structure.
 */
export interface HorizonFeePercentiles {
  max: string;
  min: string;
  mode: string;
  p10: string;
  p20: string;
  p30: string;
  p40: string;
  p50: string;
  p60: string;
  p70: string;
  p80: string;
  p90: string;
  p95: string;
  p99: string;
}

export interface HorizonFeeStats {
  last_ledger: string;
  last_ledger_base_fee: string;
  ledger_capacity_usage: string; // e.g. "0.85" (85% full)
  fee_charged: HorizonFeePercentiles;
  max_fee: HorizonFeePercentiles;
}

export type FeePolicy = "conservative" | "standard" | "aggressive";

export type FeeBasis =
  | "base_fee"
  | "network_percentile"
  | "ledger_capacity_bump"
  | "cached"
  | "fallback";

export interface FeeRecommendation {
  baseFee: string;
  totalFee: string;
  operations: number;
  policy: FeePolicy;
  congestion: "low" | "medium" | "high";
  capacityUsage: number;
  basis: FeeBasis;
  basisDescription: string;
  isFallback: boolean;
  isCached: boolean;
  fetchedAt: number;
  details?: {
    p50: string;
    p70: string;
    p90: string;
    p95: string;
    lastLedgerBaseFee: string;
    ledgerCapacityUsage: string;
  };
}

export interface FeeEstimate {
  baseFee: string;
  estimatedFee: string;
  operations: number;
  networkCongestion: "low" | "medium" | "high";
  basis?: FeeBasis;
  basisDescription?: string;
  isFallback?: boolean;
  isCached?: boolean;
  policy?: FeePolicy;
  capacityUsage?: number;
}

// In-memory module cache for Horizon fee stats
let _cachedFeeStats: HorizonFeeStats | null = null;
let _cachedAt = 0;

/**
 * Clear the internal fee statistics cache (used in testing).
 */
export function _clearFeeStatsCache(): void {
  _cachedFeeStats = null;
  _cachedAt = 0;
}

/**
 * Fetch raw fee statistics from Horizon, utilizing a 30s cache TTL.
 */
export async function fetchHorizonFeeStats(forceRefresh = false): Promise<HorizonFeeStats> {
  const now = Date.now();
  if (!forceRefresh && _cachedFeeStats && now - _cachedAt < FEE_CACHE_TTL_MS) {
    return _cachedFeeStats;
  }

  // 1. Try server.feeStats() if available on Horizon server instance
  try {
    const server = getHorizonServer();
    if (typeof (server as unknown as { feeStats?: () => Promise<HorizonFeeStats> }).feeStats === "function") {
      const stats = await (server as unknown as { feeStats: () => Promise<HorizonFeeStats> }).feeStats();
      if (stats && stats.fee_charged) {
        _cachedFeeStats = stats;
        _cachedAt = now;
        return stats;
      }
    }
  } catch {
    // Proceed to HTTP fetch fallback
  }

  // 2. Try direct HTTP fetch to Horizon /fee_stats
  try {
    const res = await fetch(`${HORIZON_URL}/fee_stats`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const stats: HorizonFeeStats = await res.json();
      if (stats && stats.fee_charged) {
        _cachedFeeStats = stats;
        _cachedAt = now;
        return stats;
      }
    }
  } catch {
    // Proceed to base fee fallback
  }

  // 3. Fallback: try server.fetchBaseFee() to construct minimal stats
  try {
    const server = getHorizonServer();
    if (typeof server.fetchBaseFee === "function") {
      const baseFeeRes = await server.fetchBaseFee();
      const baseFeeStr = baseFeeRes.toString();
      const syntheticStats: HorizonFeeStats = {
        last_ledger: "0",
        last_ledger_base_fee: baseFeeStr,
        ledger_capacity_usage: "0.0",
        fee_charged: {
          max: baseFeeStr,
          min: baseFeeStr,
          mode: baseFeeStr,
          p10: baseFeeStr,
          p20: baseFeeStr,
          p30: baseFeeStr,
          p40: baseFeeStr,
          p50: baseFeeStr,
          p60: baseFeeStr,
          p70: baseFeeStr,
          p80: baseFeeStr,
          p90: baseFeeStr,
          p95: baseFeeStr,
          p99: baseFeeStr,
        },
        max_fee: {
          max: baseFeeStr,
          min: baseFeeStr,
          mode: baseFeeStr,
          p10: baseFeeStr,
          p20: baseFeeStr,
          p30: baseFeeStr,
          p40: baseFeeStr,
          p50: baseFeeStr,
          p60: baseFeeStr,
          p70: baseFeeStr,
          p80: baseFeeStr,
          p90: baseFeeStr,
          p95: baseFeeStr,
          p99: baseFeeStr,
        },
      };
      _cachedFeeStats = syntheticStats;
      _cachedAt = now;
      return syntheticStats;
    }
  } catch {
    // Both failed
  }

  // If stale cached stats exist, return them
  if (_cachedFeeStats) {
    return _cachedFeeStats;
  }

  throw new Error("Unable to reach Horizon fee statistics");
}

/**
 * Derive recommended fee from Horizon fee statistics according to the chosen policy.
 */
export function calculateRecommendedFeeFromStats(
  stats: HorizonFeeStats,
  policy: FeePolicy = "standard",
  numOperations = 1
): Omit<FeeRecommendation, "isFallback" | "isCached" | "fetchedAt"> {
  const lastLedgerBase = parseInt(stats.last_ledger_base_fee || DEFAULT_FALLBACK_BASE_FEE, 10);
  const capacityUsage = parseFloat(stats.ledger_capacity_usage || "0.0");

  const p50 = parseInt(stats.fee_charged?.p50 || stats.fee_charged?.mode || stats.last_ledger_base_fee || "100", 10);
  const p70 = parseInt(stats.fee_charged?.p70 || stats.fee_charged?.p50 || "100", 10);
  const p90 = parseInt(stats.fee_charged?.p90 || stats.fee_charged?.p70 || "100", 10);
  const p95 = parseInt(stats.fee_charged?.p95 || stats.fee_charged?.p90 || "150", 10);
  const p99 = parseInt(stats.fee_charged?.p99 || stats.fee_charged?.p95 || "200", 10);

  // Network congestion determination
  let congestion: "low" | "medium" | "high" = "low";
  if (capacityUsage >= 0.85 || p90 > 200 || lastLedgerBase > 200) {
    congestion = "high";
  } else if (capacityUsage >= 0.60 || p70 > 100 || lastLedgerBase > 100) {
    congestion = "medium";
  }

  let targetFee: number;
  let basis: FeeBasis = "network_percentile";
  let basisDescription = "";

  if (policy === "conservative") {
    targetFee = p50;
    if (capacityUsage > 0.85) {
      targetFee = p70;
      basis = "ledger_capacity_bump";
      basisDescription = `Elevated to p70 (${targetFee} stroops) due to high ledger capacity (${Math.round(capacityUsage * 100)}%)`;
    } else {
      basisDescription = `Derived from Horizon fee statistics (p50 median fee: ${targetFee} stroops)`;
    }
  } else if (policy === "aggressive") {
    targetFee = p95;
    if (capacityUsage > 0.80) {
      targetFee = p99;
      basis = "ledger_capacity_bump";
      basisDescription = `Elevated to p99 (${targetFee} stroops) due to severe network congestion (${Math.round(capacityUsage * 100)}% capacity)`;
    } else {
      basisDescription = `Derived from Horizon fee statistics (p95 priority fee: ${targetFee} stroops)`;
    }
  } else {
    // standard (default)
    targetFee = p70;
    if (capacityUsage > 0.90) {
      targetFee = p95;
      basis = "ledger_capacity_bump";
      basisDescription = `Elevated to p95 (${targetFee} stroops) due to peak ledger capacity (${Math.round(capacityUsage * 100)}%)`;
    } else if (capacityUsage > 0.75) {
      targetFee = p90;
      basis = "ledger_capacity_bump";
      basisDescription = `Elevated to p90 (${targetFee} stroops) due to elevated ledger capacity (${Math.round(capacityUsage * 100)}%)`;
    } else {
      basisDescription = `Derived from Horizon fee statistics (p70 standard fee: ${targetFee} stroops)`;
    }
  }

  const baseFeeNumber = Math.max(lastLedgerBase, targetFee, 100);

  if (targetFee <= lastLedgerBase && basis !== "ledger_capacity_bump") {
    basis = "base_fee";
    basisDescription = `Standard base fee (${baseFeeNumber} stroops) under normal network conditions`;
  }

  const totalFeeNumber = baseFeeNumber * Math.max(1, numOperations);

  return {
    baseFee: baseFeeNumber.toString(),
    totalFee: totalFeeNumber.toString(),
    operations: numOperations,
    policy,
    congestion,
    capacityUsage,
    basis,
    basisDescription,
    details: {
      p50: p50.toString(),
      p70: p70.toString(),
      p90: p90.toString(),
      p95: p95.toString(),
      lastLedgerBaseFee: lastLedgerBase.toString(),
      ledgerCapacityUsage: capacityUsage.toString(),
    },
  };
}

/**
 * Get the full fee recommendation for a transaction based on current Horizon stats,
 * with automatic caching, fallback, and visible basis indicators.
 */
export async function getRecommendedFee(options?: {
  numOperations?: number;
  policy?: FeePolicy;
  forceRefresh?: boolean;
}): Promise<FeeRecommendation> {
  const numOperations = options?.numOperations ?? 1;
  const policy = options?.policy ?? "standard";
  const forceRefresh = options?.forceRefresh ?? false;

  const wasCached = !forceRefresh && _cachedFeeStats !== null && Date.now() - _cachedAt < FEE_CACHE_TTL_MS;

  try {
    const stats = await fetchHorizonFeeStats(forceRefresh);
    const calculated = calculateRecommendedFeeFromStats(stats, policy, numOperations);

    return {
      ...calculated,
      isFallback: false,
      isCached: wasCached,
      fetchedAt: _cachedAt || Date.now(),
    };
  } catch {
    // Horizon is unreachable. Check if we have any stale cached stats.
    if (_cachedFeeStats) {
      const calculated = calculateRecommendedFeeFromStats(_cachedFeeStats, policy, numOperations);
      return {
        ...calculated,
        basis: "cached",
        basisDescription: `Using cached Horizon fee stats (${calculated.baseFee} stroops) — live network check timed out`,
        isFallback: false,
        isCached: true,
        fetchedAt: _cachedAt,
      };
    }

    // Completely unreachable and no cache exists: use configured default fallback
    const fallbackBase = parseInt(DEFAULT_FALLBACK_BASE_FEE, 10);
    const totalFee = (fallbackBase * Math.max(1, numOperations)).toString();

    return {
      baseFee: DEFAULT_FALLBACK_BASE_FEE,
      totalFee,
      operations: numOperations,
      policy,
      congestion: "low",
      capacityUsage: 0,
      basis: "fallback",
      basisDescription: `Horizon unreachable — using fallback base fee (${DEFAULT_FALLBACK_BASE_FEE} stroops)`,
      isFallback: true,
      isCached: false,
      fetchedAt: Date.now(),
    };
  }
}

/**
 * Estimate the fee for a Stellar transaction based on Horizon fee statistics
 * or fallback, returning backward-compatible FeeEstimate augmented with recommendation basis.
 */
export async function estimateTransactionFee(
  numOperations = 1,
  policy: FeePolicy = "standard"
): Promise<FeeEstimate> {
  const recommendation = await getRecommendedFee({ numOperations, policy });

  return {
    baseFee: recommendation.baseFee,
    estimatedFee: recommendation.totalFee,
    operations: numOperations,
    networkCongestion: recommendation.congestion,
    basis: recommendation.basis,
    basisDescription: recommendation.basisDescription,
    isFallback: recommendation.isFallback,
    isCached: recommendation.isCached,
    capacityUsage: recommendation.capacityUsage,
    policy: recommendation.policy,
  };
}

/**
 * Calculate the estimated total fee for a batch payment with N recipients.
 * Each recipient = 1 payment operation.
 */
export function estimateBatchFee(
  recipientCount: number,
  baseFee: number | string = 100
): string {
  const feeNum = typeof baseFee === "string" ? parseInt(baseFee, 10) : baseFee;
  return ((isNaN(feeNum) ? 100 : feeNum) * Math.max(1, recipientCount)).toString();
}
