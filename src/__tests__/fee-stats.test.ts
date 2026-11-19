// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseFeeStats,
  recommendFee,
  congestionFromCapacity,
  normalizeAggressiveness,
  buildFeeBasis,
  getRecommendedFee,
  getFeeAggressiveness,
  getFeeStatsTtlMs,
  getFallbackBaseFee,
  resetFeeStatsCache,
  peekFeeStatsCache,
  type RawFeeStats,
} from "@/lib/fee-stats";

/** A representative Horizon `/fee_stats` payload (strings, as emitted). */
function feeStatsPayload(overrides: Partial<RawFeeStats> = {}): RawFeeStats {
  const distribution = {
    min: "100",
    max: "1000",
    mode: "100",
    p10: "100",
    p20: "100",
    p40: "110",
    p50: "120",
    p60: "140",
    p70: "160",
    p80: "200",
    p90: "300",
    p95: "500",
    p99: "900",
  };
  return {
    last_ledger: "1000",
    last_ledger_base_fee: "100",
    ledger_capacity_usage: "0.9",
    fee_charged: distribution,
    max_fee: distribution,
    ...overrides,
  };
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  resetFeeStatsCache();
  delete process.env.NEXT_PUBLIC_FEE_AGGRESSIVENESS;
  delete process.env.FEE_STATS_TTL_MS;
  delete process.env.FEE_FALLBACK_BASE_FEE;
  delete process.env.NEXT_PUBLIC_FALLBACK_BASE_FEE;
});

afterEach(() => {
  resetFeeStatsCache();
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("parseFeeStats", () => {
  it("coerces Horizon's string numbers into numbers", () => {
    const stats = parseFeeStats(feeStatsPayload());
    expect(stats.baseFee).toBe(100);
    expect(stats.ledgerCapacityUsage).toBe(0.9);
    expect(stats.charged.p90).toBe(300);
    expect(stats.lastLedger).toBe(1000);
  });

  it("clamps ledger capacity usage into 0–1", () => {
    expect(parseFeeStats(feeStatsPayload({ ledger_capacity_usage: "1.4" })).ledgerCapacityUsage).toBe(1);
    expect(parseFeeStats(feeStatsPayload({ ledger_capacity_usage: "-0.2" })).ledgerCapacityUsage).toBe(0);
  });

  it("fills a missing percentile with the base fee instead of 0", () => {
    // A fee of 0 would build an unsubmittable transaction.
    const stats = parseFeeStats(
      feeStatsPayload({ fee_charged: { p50: "100" }, last_ledger_base_fee: "100" })
    );
    expect(stats.charged.p90).toBe(100);
    expect(stats.charged.max).toBe(100);
  });

  it("falls back to the configured base fee when the payload is malformed", () => {
    const stats = parseFeeStats({ fee_charged: {}, max_fee: {} });
    expect(stats.baseFee).toBe(100);
    expect(stats.charged.p50).toBe(100);
  });
});

describe("congestionFromCapacity", () => {
  it("bands capacity usage", () => {
    expect(congestionFromCapacity(0)).toBe("low");
    expect(congestionFromCapacity(0.49)).toBe("low");
    expect(congestionFromCapacity(0.5)).toBe("medium");
    expect(congestionFromCapacity(0.79)).toBe("medium");
    expect(congestionFromCapacity(0.8)).toBe("high");
    expect(congestionFromCapacity(1)).toBe("high");
  });
});

describe("normalizeAggressiveness", () => {
  it("accepts the three documented policies", () => {
    expect(normalizeAggressiveness("low")).toBe("low");
    expect(normalizeAggressiveness("HIGH")).toBe("high");
    expect(normalizeAggressiveness(" Medium ")).toBe("medium");
  });

  it("defaults unknown values to medium", () => {
    expect(normalizeAggressiveness(undefined)).toBe("medium");
    expect(normalizeAggressiveness("turbo")).toBe("medium");
    expect(normalizeAggressiveness("")).toBe("medium");
  });
});

describe("getFeeAggressiveness", () => {
  it("reads NEXT_PUBLIC_FEE_AGGRESSIVENESS", () => {
    process.env.NEXT_PUBLIC_FEE_AGGRESSIVENESS = "high";
    expect(getFeeAggressiveness()).toBe("high");
  });

  it("defaults to medium", () => {
    expect(getFeeAggressiveness()).toBe("medium");
  });
});

describe("config readers", () => {
  it("reads a positive FEE_STATS_TTL_MS or falls back", () => {
    process.env.FEE_STATS_TTL_MS = "1000";
    expect(getFeeStatsTtlMs()).toBe(1000);
    process.env.FEE_STATS_TTL_MS = "-5";
    expect(getFeeStatsTtlMs()).toBe(30_000);
    delete process.env.FEE_STATS_TTL_MS;
    expect(getFeeStatsTtlMs()).toBe(30_000);
  });

  it("reads a positive fallback base fee or defaults to 100", () => {
    process.env.FEE_FALLBACK_BASE_FEE = "250";
    expect(getFallbackBaseFee()).toBe(250);
    delete process.env.FEE_FALLBACK_BASE_FEE;
    expect(getFallbackBaseFee()).toBe(100);
  });
});

describe("recommendFee", () => {
  const stats = parseFeeStats(feeStatsPayload());

  it("selects p90 at the default medium aggressiveness", () => {
    const rec = recommendFee(stats, "medium");
    expect(rec.percentile).toBe("p90");
    expect(rec.recommendedFee).toBe(300);
    expect(rec.congestion).toBe("high");
  });

  it("selects p50 for low and p99 for high aggressiveness", () => {
    expect(recommendFee(stats, "low").recommendedFee).toBe(120);
    expect(recommendFee(stats, "high").recommendedFee).toBe(900);
  });

  it("never recommends below the network base fee", () => {
    const quiet = parseFeeStats(
      feeStatsPayload({
        last_ledger_base_fee: "100",
        fee_charged: { p90: "10" },
      })
    );
    const rec = recommendFee(quiet, "medium");
    expect(rec.percentileFee).toBe(10);
    expect(rec.recommendedFee).toBe(100);
  });
});

describe("buildFeeBasis", () => {
  it("explains a percentile-driven fee", () => {
    const basis = buildFeeBasis({
      percentile: "p90",
      recommendedFee: 300,
      baseFee: 100,
      aggressiveness: "medium",
      congestion: "high",
      ledgerCapacityUsage: 0.9,
      source: "horizon",
    });
    expect(basis).toContain("p90 of recently charged fees");
    expect(basis).toContain("ledger 90% full (high congestion)");
    expect(basis).toContain("medium aggressiveness");
  });

  it("explains a base-fee-driven recommendation and fallback source", () => {
    const basis = buildFeeBasis({
      percentile: "p90",
      recommendedFee: 100,
      baseFee: 100,
      aggressiveness: "low",
      congestion: "low",
      ledgerCapacityUsage: 0.1,
      source: "fallback",
    });
    expect(basis).toContain("network base fee (100 stroops)");
    expect(basis).toContain("Horizon unreachable");
  });
});

describe("getRecommendedFee", () => {
  it("fetches from Horizon and reports source 'horizon'", async () => {
    const fetcher = vi.fn().mockResolvedValue(feeStatsPayload());
    const rec = await getRecommendedFee(fetcher, 1000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(rec.source).toBe("horizon");
    expect(rec.stale).toBe(false);
    expect(rec.recommendedFee).toBe(300);
    expect(rec.basis).toContain("p90");
  });

  it("serves a cache hit within the TTL without refetching", async () => {
    const fetcher = vi.fn().mockResolvedValue(feeStatsPayload());
    await getRecommendedFee(fetcher, 1000);
    const second = await getRecommendedFee(fetcher, 2000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(second.source).toBe("cache");
    expect(second.stale).toBe(true);
    expect(second.recommendedFee).toBe(300);
  });

  it("refetches once the TTL elapses", async () => {
    process.env.FEE_STATS_TTL_MS = "1000";
    const fetcher = vi.fn().mockResolvedValue(feeStatsPayload());
    await getRecommendedFee(fetcher, 1000);
    await getRecommendedFee(fetcher, 5000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("serves the last known good value when Horizon later fails", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(feeStatsPayload())
      .mockRejectedValueOnce(new Error("Horizon down"));

    await getRecommendedFee(fetcher, 1000);
    const fallback = await getRecommendedFee(fetcher, 100_000);
    expect(fallback.source).toBe("cache");
    expect(fallback.stale).toBe(true);
    expect(fallback.recommendedFee).toBe(300);
  });

  it("uses the configured fallback when nothing was ever fetched", async () => {
    process.env.FEE_FALLBACK_BASE_FEE = "100";
    const fetcher = vi.fn().mockRejectedValue(new Error("no network"));
    const rec = await getRecommendedFee(fetcher, 1000);
    expect(rec.source).toBe("fallback");
    expect(rec.stale).toBe(true);
    expect(rec.recommendedFee).toBe(100);
    expect(rec.basis).toContain("Horizon unreachable");
  });

  it("never throws and populates the cache on success", async () => {
    const fetcher = vi.fn().mockResolvedValue(feeStatsPayload());
    await getRecommendedFee(fetcher, 1234);
    expect(peekFeeStatsCache()).not.toBeNull();
    expect(peekFeeStatsCache()?.baseFee).toBe(100);
  });
});
