// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as stellarLib from "@/lib/stellar";
import {
  FeeStatsParseError,
  assertFeeMatchesEstimate,
  congestionFromCapacity,
  describeFeeBasis,
  estimateTransactionFee,
  getConfiguredFeePolicy,
  getFallbackFeePerOperation,
  getFeeRefreshIntervalMs,
  parseFeeStats,
  recommendFeePerOperation,
  resetFeeCache,
  stroopsToXlm,
} from "@/lib/fee-estimator";

/** A real-shaped Horizon `/fee_stats` payload (every value is a string). */
function horizonPayload(overrides: Record<string, unknown> = {}) {
  return {
    last_ledger: "48123456",
    last_ledger_base_fee: "100",
    ledger_capacity_usage: "0.97",
    fee_charged: {
      max: "5000",
      min: "100",
      mode: "100",
      p10: "100",
      p20: "100",
      p30: "100",
      p40: "100",
      p50: "100",
      p60: "150",
      p70: "250",
      p80: "400",
      p90: "800",
      p95: "1200",
      p99: "3000",
    },
    max_fee: { max: "9000", min: "100", mode: "100", p70: "300", p95: "2000" },
    ...overrides,
  };
}

function mockFeeStats(impl: () => Promise<unknown>) {
  const feeStats = vi.fn(impl);
  vi.spyOn(stellarLib, "getHorizonServer").mockReturnValue({ feeStats } as never);
  return feeStats;
}

describe("parseFeeStats", () => {
  it("parses Horizon's string payload into numbers", () => {
    const stats = parseFeeStats(horizonPayload());
    expect(stats).toEqual({
      lastLedger: 48123456,
      baseFee: 100,
      ledgerCapacityUsage: 0.97,
      feeCharged: { mode: 100, p70: 250, p95: 1200 },
    });
  });

  it.each([
    ["null", null],
    ["a string", "nope"],
    ["missing fee_charged", horizonPayload({ fee_charged: undefined })],
    ["non-numeric base fee", horizonPayload({ last_ledger_base_fee: "abc" })],
    ["empty capacity", horizonPayload({ ledger_capacity_usage: "" })],
    ["negative capacity", horizonPayload({ ledger_capacity_usage: "-1" })],
    ["missing p95", horizonPayload({ fee_charged: { mode: "100", p70: "100" } })],
  ])("rejects %s", (_name, payload) => {
    expect(() => parseFeeStats(payload)).toThrow(FeeStatsParseError);
  });

  it("clamps capacity usage above 1", () => {
    expect(parseFeeStats(horizonPayload({ ledger_capacity_usage: "1.4" })).ledgerCapacityUsage).toBe(1);
  });
});

describe("congestionFromCapacity", () => {
  it.each([
    [0, "low"],
    [0.49, "low"],
    [0.5, "medium"],
    [0.79, "medium"],
    [0.8, "high"],
    [1, "high"],
  ])("%s → %s", (usage, expected) => {
    expect(congestionFromCapacity(usage)).toBe(expected);
  });
});

describe("recommendFeePerOperation (aggressiveness policy)", () => {
  const stats = parseFeeStats(horizonPayload());

  it("low targets the most common fee, normal p70, high p95", () => {
    expect(recommendFeePerOperation(stats, "low").fee).toBe(100);
    expect(recommendFeePerOperation(stats, "normal").fee).toBe(250);
    expect(recommendFeePerOperation(stats, "high").fee).toBe(1200);
  });

  it("never recommends below the ledger base fee", () => {
    const surge = parseFeeStats(horizonPayload({ last_ledger_base_fee: "500" }));
    expect(recommendFeePerOperation(surge, "low")).toMatchObject({ fee: 500, percentileFee: 100 });
  });

  it("never recommends below the 100 stroop network minimum", () => {
    const odd = parseFeeStats(
      horizonPayload({ last_ledger_base_fee: "0", fee_charged: { mode: "0", p70: "0", p95: "0" } })
    );
    expect(recommendFeePerOperation(odd, "high").fee).toBe(100);
  });

  it("caps the fee at the configured ceiling and says so", () => {
    expect(recommendFeePerOperation(stats, "high", 1000)).toMatchObject({ fee: 1000, capped: true });
    expect(recommendFeePerOperation(stats, "normal", 1000).capped).toBe(false);
  });
});

describe("configuration", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("defaults", () => {
    expect(getConfiguredFeePolicy()).toBe("normal");
    expect(getFeeRefreshIntervalMs()).toBe(30_000);
    expect(getFallbackFeePerOperation()).toBe(100);
  });

  it("reads overrides and rejects invalid values", () => {
    vi.stubEnv("NEXT_PUBLIC_FEE_POLICY", "HIGH");
    vi.stubEnv("NEXT_PUBLIC_FEE_REFRESH_MS", "60000");
    vi.stubEnv("NEXT_PUBLIC_FEE_FALLBACK_STROOPS", "250");
    expect(getConfiguredFeePolicy()).toBe("high");
    expect(getFeeRefreshIntervalMs()).toBe(60_000);
    expect(getFallbackFeePerOperation()).toBe(250);

    vi.stubEnv("NEXT_PUBLIC_FEE_POLICY", "yolo");
    vi.stubEnv("NEXT_PUBLIC_FEE_REFRESH_MS", "10"); // below the 5s floor
    vi.stubEnv("NEXT_PUBLIC_FEE_FALLBACK_STROOPS", "5"); // below network minimum
    expect(getConfiguredFeePolicy()).toBe("normal");
    expect(getFeeRefreshIntervalMs()).toBe(30_000);
    expect(getFallbackFeePerOperation()).toBe(100);
  });
});

describe("estimateTransactionFee", () => {
  beforeEach(() => {
    resetFeeCache();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("tracks Horizon statistics for the chosen policy and scales by operations", async () => {
    mockFeeStats(async () => horizonPayload());

    const normal = await estimateTransactionFee(3, { policy: "normal" });
    expect(normal).toMatchObject({
      source: "horizon",
      stale: false,
      baseFee: "100",
      recommendedFee: "250",
      estimatedFee: "750",
      operations: 3,
      networkCongestion: "high",
      ledgerCapacityUsage: 0.97,
      percentile: "p70",
      capped: false,
    });

    const high = await estimateTransactionFee(1, { policy: "high" });
    expect(high.recommendedFee).toBe("1200");
    const low = await estimateTransactionFee(1, { policy: "low" });
    expect(low.recommendedFee).toBe("100");
  });

  it("uses the configured default policy when none is passed", async () => {
    vi.stubEnv("NEXT_PUBLIC_FEE_POLICY", "high");
    mockFeeStats(async () => horizonPayload());
    expect((await estimateTransactionFee(1)).policy).toBe("high");
  });

  it("serves from cache within the refresh interval and refreshes after it", async () => {
    const feeStats = mockFeeStats(async () => horizonPayload());

    await estimateTransactionFee(1);
    await estimateTransactionFee(1);
    await estimateTransactionFee(2, { policy: "high" });
    expect(feeStats).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(getFeeRefreshIntervalMs() + 1);
    await estimateTransactionFee(1);
    expect(feeStats).toHaveBeenCalledTimes(2);

    await estimateTransactionFee(1, { forceRefresh: true });
    expect(feeStats).toHaveBeenCalledTimes(3);
  });

  it("de-duplicates concurrent refreshes", async () => {
    const feeStats = mockFeeStats(async () => horizonPayload());
    await Promise.all([estimateTransactionFee(1), estimateTransactionFee(1), estimateTransactionFee(1)]);
    expect(feeStats).toHaveBeenCalledTimes(1);
  });

  describe("when Horizon is unreachable", () => {
    it("falls back to the configured value, flagged stale, when nothing is cached", async () => {
      vi.stubEnv("NEXT_PUBLIC_FEE_FALLBACK_STROOPS", "200");
      mockFeeStats(async () => {
        throw new Error("ECONNREFUSED");
      });

      const est = await estimateTransactionFee(2);
      expect(est).toMatchObject({
        source: "fallback",
        stale: true,
        recommendedFee: "200",
        estimatedFee: "400",
        fetchedAt: null,
        networkCongestion: "unknown",
        percentile: null,
      });
    });

    it("reuses the last known good statistics, flagged stale", async () => {
      let fail = false;
      mockFeeStats(async () => {
        if (fail) throw new Error("timeout");
        return horizonPayload();
      });

      const good = await estimateTransactionFee(1, { policy: "high" });
      fail = true;
      vi.advanceTimersByTime(getFeeRefreshIntervalMs() + 1);

      const est = await estimateTransactionFee(1, { policy: "high" });
      expect(est).toMatchObject({
        source: "cache",
        stale: true,
        recommendedFee: "1200",
        fetchedAt: good.fetchedAt,
      });
    });

    it("treats a malformed response like an outage", async () => {
      mockFeeStats(async () => ({ fee_charged: {} }));
      const est = await estimateTransactionFee(1);
      expect(est.source).toBe("fallback");
    });

    it("recovers on the next successful refresh", async () => {
      let fail = true;
      mockFeeStats(async () => {
        if (fail) throw new Error("down");
        return horizonPayload();
      });
      expect((await estimateTransactionFee(1)).source).toBe("fallback");
      fail = false;
      expect(await estimateTransactionFee(1)).toMatchObject({ source: "horizon", stale: false });
    });
  });
});

describe("assertFeeMatchesEstimate", () => {
  it("passes when the built fee equals the displayed total and throws otherwise", async () => {
    resetFeeCache();
    mockFeeStats(async () => horizonPayload());
    const est = await estimateTransactionFee(2, { policy: "normal" });
    expect(() => assertFeeMatchesEstimate("500", est)).not.toThrow();
    expect(() => assertFeeMatchesEstimate("200", est)).toThrow(/does not match the fee shown/);
    expect(() => assertFeeMatchesEstimate(undefined, est)).toThrow();
    vi.restoreAllMocks();
  });
});

describe("presentation helpers", () => {
  beforeEach(() => resetFeeCache());
  afterEach(() => vi.restoreAllMocks());

  it("stroopsToXlm", () => {
    expect(stroopsToXlm("100")).toBe("0.00001");
    expect(stroopsToXlm(250)).toBe("0.000025");
    expect(stroopsToXlm("10000000")).toBe("1");
  });

  it("describeFeeBasis explains a fee above the base fee", async () => {
    mockFeeStats(async () => horizonPayload());
    const text = describeFeeBasis(await estimateTransactionFee(1, { policy: "normal" }));
    expect(text).toContain("Normal policy");
    expect(text).toContain("p70");
    expect(text).toContain("ledger 97% full");
    expect(text).toContain("Higher than the 100 stroop base fee");
  });

  it("describeFeeBasis mentions the ceiling when capped", async () => {
    vi.stubEnv("NEXT_PUBLIC_FEE_MAX_STROOPS", "500");
    mockFeeStats(async () => horizonPayload());
    const text = describeFeeBasis(await estimateTransactionFee(1, { policy: "high" }));
    expect(text).toContain("capped at the 500 stroop ceiling");
    vi.unstubAllEnvs();
  });

  it("describeFeeBasis for the fallback", async () => {
    mockFeeStats(async () => {
      throw new Error("x");
    });
    expect(describeFeeBasis(await estimateTransactionFee(1))).toContain("statistics are unavailable");
  });
});
