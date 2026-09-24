// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fetchHorizonFeeStats,
  calculateRecommendedFeeFromStats,
  getRecommendedFee,
  estimateTransactionFee,
  estimateBatchFee,
  _clearFeeStatsCache,
  DEFAULT_FALLBACK_BASE_FEE,
  FEE_CACHE_TTL_MS,
  type HorizonFeeStats,
} from "@/lib/fee-estimator";
import * as stellarLib from "@/lib/stellar";

const mockNormalStats: HorizonFeeStats = {
  last_ledger: "1000",
  last_ledger_base_fee: "100",
  ledger_capacity_usage: "0.25",
  fee_charged: {
    max: "500",
    min: "100",
    mode: "100",
    p10: "100",
    p20: "100",
    p30: "100",
    p40: "100",
    p50: "100",
    p60: "100",
    p70: "120",
    p80: "130",
    p90: "150",
    p95: "180",
    p99: "250",
  },
  max_fee: {
    max: "1000",
    min: "100",
    mode: "100",
    p10: "100",
    p20: "100",
    p30: "100",
    p40: "100",
    p50: "100",
    p60: "120",
    p70: "150",
    p80: "180",
    p90: "200",
    p95: "300",
    p99: "500",
  },
};

const mockCongestedStats: HorizonFeeStats = {
  last_ledger: "1001",
  last_ledger_base_fee: "100",
  ledger_capacity_usage: "0.88",
  fee_charged: {
    max: "5000",
    min: "100",
    mode: "150",
    p10: "120",
    p20: "130",
    p30: "140",
    p40: "150",
    p50: "180",
    p60: "220",
    p70: "280",
    p80: "350",
    p90: "450",
    p95: "600",
    p99: "1200",
  },
  max_fee: {
    max: "10000",
    min: "100",
    mode: "200",
    p10: "150",
    p20: "180",
    p30: "200",
    p40: "250",
    p50: "300",
    p60: "400",
    p70: "500",
    p80: "700",
    p90: "1000",
    p95: "1500",
    p99: "3000",
  },
};

describe("Dynamic Horizon Fee Recommendation Engine", () => {
  beforeEach(() => {
    _clearFeeStatsCache();
    vi.restoreAllMocks();
  });

  describe("calculateRecommendedFeeFromStats", () => {
    it("parses normal Horizon statistics under standard policy", () => {
      const rec = calculateRecommendedFeeFromStats(mockNormalStats, "standard", 1);
      expect(rec.baseFee).toBe("120"); // p70 from fee_charged
      expect(rec.totalFee).toBe("120");
      expect(rec.congestion).toBe("low");
      expect(rec.basis).toBe("network_percentile");
      expect(rec.basisDescription).toContain("p70 standard fee");
      expect(rec.details?.p70).toBe("120");
    });

    it("evaluates conservative policy targeting p50", () => {
      const rec = calculateRecommendedFeeFromStats(mockNormalStats, "conservative", 1);
      expect(rec.baseFee).toBe("100"); // p50
      expect(rec.basis).toBe("base_fee");
    });

    it("evaluates aggressive policy targeting p95", () => {
      const rec = calculateRecommendedFeeFromStats(mockNormalStats, "aggressive", 1);
      expect(rec.baseFee).toBe("180"); // p95
      expect(rec.basis).toBe("network_percentile");
      expect(rec.basisDescription).toContain("p95 priority fee");
    });

    it("elevates fee during high network congestion (capacity > 0.75)", () => {
      const rec = calculateRecommendedFeeFromStats(mockCongestedStats, "standard", 1);
      expect(rec.congestion).toBe("high");
      expect(rec.capacityUsage).toBe(0.88);
      // Elevated to p90 due to capacity > 0.75
      expect(rec.baseFee).toBe("450");
      expect(rec.basis).toBe("ledger_capacity_bump");
      expect(rec.basisDescription).toContain("Elevated to p90 (450 stroops) due to elevated ledger capacity");
    });

    it("elevates aggressive policy to p99 during severe congestion (>0.80)", () => {
      const rec = calculateRecommendedFeeFromStats(mockCongestedStats, "aggressive", 1);
      expect(rec.baseFee).toBe("1200"); // p99
      expect(rec.basis).toBe("ledger_capacity_bump");
      expect(rec.basisDescription).toContain("Elevated to p99");
    });

    it("calculates multi-operation batch total fees accurately", () => {
      const rec = calculateRecommendedFeeFromStats(mockNormalStats, "standard", 5);
      expect(rec.operations).toBe(5);
      expect(rec.baseFee).toBe("120");
      expect(rec.totalFee).toBe("600"); // 120 * 5
    });
  });

  describe("Caching and Refresh Interval", () => {
    it("caches fee stats for FEE_CACHE_TTL_MS and avoids redundant Horizon calls", async () => {
      const mockFeeStats = vi.fn().mockResolvedValue(mockNormalStats);
      vi.spyOn(stellarLib, "getHorizonServer").mockReturnValue({
        feeStats: mockFeeStats,
      } as never);

      const first = await getRecommendedFee({ numOperations: 1 });
      expect(first.isCached).toBe(false);
      expect(mockFeeStats).toHaveBeenCalledTimes(1);

      // Second call immediately after should return cached
      const second = await getRecommendedFee({ numOperations: 1 });
      expect(second.isCached).toBe(true);
      expect(mockFeeStats).toHaveBeenCalledTimes(1);

      // Force refresh should bypass cache
      const third = await getRecommendedFee({ numOperations: 1, forceRefresh: true });
      expect(third.isCached).toBe(false);
      expect(mockFeeStats).toHaveBeenCalledTimes(2);
    });

    it("respects FEE_CACHE_TTL_MS value of 30,000 ms", () => {
      expect(FEE_CACHE_TTL_MS).toBe(30_000);
    });
  });

  describe("Fallback Behavior When Horizon is Unreachable", () => {
    it("falls back to stale cache when fresh Horizon request fails", async () => {
      const mockFeeStats = vi.fn().mockResolvedValueOnce(mockNormalStats);
      vi.spyOn(stellarLib, "getHorizonServer").mockReturnValue({
        feeStats: mockFeeStats,
      } as never);

      // Prime the cache
      await getRecommendedFee();

      // Simulate network failure on subsequent fetch
      mockFeeStats.mockRejectedValueOnce(new Error("Horizon network offline"));
      const fallbackResult = await getRecommendedFee({ forceRefresh: true });

      expect(fallbackResult.basis).toBe("cached");
      expect(fallbackResult.isCached).toBe(true);
      expect(fallbackResult.isFallback).toBe(false);
      expect(fallbackResult.baseFee).toBe("120");
      expect(fallbackResult.basisDescription).toContain("Using cached Horizon fee stats");
    });

    it("falls back to default fallback fee when no cache exists and Horizon is dead", async () => {
      vi.spyOn(stellarLib, "getHorizonServer").mockReturnValue({
        feeStats: vi.fn().mockRejectedValue(new Error("DNS resolution failed")),
        fetchBaseFee: vi.fn().mockRejectedValue(new Error("Timeout")),
      } as never);

      // Ensure fetch also fails
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Fetch failed")));

      const fallbackResult = await getRecommendedFee({ numOperations: 3 });

      expect(fallbackResult.baseFee).toBe(DEFAULT_FALLBACK_BASE_FEE);
      expect(fallbackResult.baseFee).toBe("100");
      expect(fallbackResult.totalFee).toBe("300");
      expect(fallbackResult.isFallback).toBe(true);
      expect(fallbackResult.basis).toBe("fallback");
      expect(fallbackResult.basisDescription).toContain("Horizon unreachable — using fallback base fee");
    });
  });

  describe("estimateTransactionFee and estimateBatchFee", () => {
    it("maintains backward compatibility with FeeEstimate fields", async () => {
      vi.spyOn(stellarLib, "getHorizonServer").mockReturnValue({
        feeStats: vi.fn().mockResolvedValue(mockNormalStats),
      } as never);

      const estimate = await estimateTransactionFee(2, "standard");
      expect(estimate.baseFee).toBe("120");
      expect(estimate.estimatedFee).toBe("240");
      expect(estimate.operations).toBe(2);
      expect(estimate.networkCongestion).toBe("low");
      expect(estimate.basis).toBe("network_percentile");
      expect(estimate.isFallback).toBe(false);
    });

    it("estimateBatchFee computes accurate total fee string", () => {
      expect(estimateBatchFee(5, 120)).toBe("600");
      expect(estimateBatchFee(10, "150")).toBe("1500");
      expect(estimateBatchFee(1)).toBe("100");
    });
  });

  describe("Signing Fee Fidelity", () => {
    it("buildPaymentTx uses explicit baseFee when supplied", async () => {
      const mockLoadAccount = vi.fn().mockResolvedValue({
        sequenceNumber: () => "1",
        account: () => "G...",
      });
      const mockFetchBaseFee = vi.fn().mockResolvedValue("100");

      vi.spyOn(stellarLib, "getHorizonServer").mockReturnValue({
        loadAccount: mockLoadAccount,
        fetchBaseFee: mockFetchBaseFee,
      } as never);

      // Verify that passing an explicit baseFee (e.g. "175") is accepted
      const res = await stellarLib.buildPaymentTx({
        sourcePublicKey: "GBQMIN7KLT4R473IGGFBGUYM2UNPGKZRTX2LZ4M2KQIY2ASYJL6ACBMZ",
        destination: "GBQMIN7KLT4R473IGGFBGUYM2UNPGKZRTX2LZ4M2KQIY2ASYJL6ACBMZ",
        amount: "10",
        baseFee: "175",
      });

      expect(res.xdr).toBeDefined();
      // Since explicit baseFee was provided, fetchBaseFee should not need to be called
      expect(mockFetchBaseFee).not.toHaveBeenCalled();
    });

    it("buildBatchPaymentTx uses explicit baseFee when supplied", async () => {
      const mockLoadAccount = vi.fn().mockResolvedValue({
        sequenceNumber: () => "1",
        account: () => "G...",
      });
      const mockFetchBaseFee = vi.fn().mockResolvedValue("100");

      vi.spyOn(stellarLib, "getHorizonServer").mockReturnValue({
        loadAccount: mockLoadAccount,
        fetchBaseFee: mockFetchBaseFee,
      } as never);

      const res = await stellarLib.buildBatchPaymentTx({
        sourcePublicKey: "GBQMIN7KLT4R473IGGFBGUYM2UNPGKZRTX2LZ4M2KQIY2ASYJL6ACBMZ",
        recipients: [
          { address: "GBQMIN7KLT4R473IGGFBGUYM2UNPGKZRTX2LZ4M2KQIY2ASYJL6ACBMZ", amount: "5" },
        ],
        baseFee: "220",
      });

      expect(res.xdr).toBeDefined();
      expect(mockFetchBaseFee).not.toHaveBeenCalled();
    });
  });
});
