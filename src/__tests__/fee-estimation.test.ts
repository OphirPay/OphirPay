// SPDX-License-Identifier: MIT
//
// Fee estimation under network surge pricing.
//
// Stellar charges the network base fee (100 stroops/op) while ledgers have
// spare capacity and switches to a per-operation surge auction once a ledger
// fills. Horizon's /fee_stats exposes both, and `fee-stats` turns them into a
// recommendation. These tests drive that logic with idle and congested
// payloads and check the result never leaves the bounds of the observed
// distribution.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { calculateFee, DEFAULT_FEE_SCHEDULE } from "@/lib/fee-calculator";
import { estimateTransactionFee } from "@/lib/fee-estimator";
import {
  type FeeAggressiveness,
  getFeeSnapshot,
  getRecommendedFee,
  parseFeeStats,
  type RawFeeStats,
  recommendFee,
  resetFeeStatsCache,
} from "@/lib/fee-stats";

const BASE_FEE = 100;

const feeStatsMock = vi.hoisted(() => ({ feeStats: vi.fn() }));
vi.mock("@/lib/stellar", () => ({
  getHorizonServer: () => feeStatsMock,
}));

function distribution(values: Partial<Record<string, number>> = {}) {
  const keys = ["min", "max", "mode", "p10", "p20", "p40", "p50", "p60", "p70", "p80", "p90", "p95", "p99"];
  return Object.fromEntries(
    keys.map((k) => [k, String(values[k] ?? BASE_FEE)])
  ) as RawFeeStats["fee_charged"];
}

/** Ledgers with spare capacity: everyone pays the base fee. */
const idlePayload = (): RawFeeStats => ({
  last_ledger: "1000",
  last_ledger_base_fee: String(BASE_FEE),
  ledger_capacity_usage: "0.1",
  fee_charged: distribution(),
  max_fee: distribution(),
});

/** Ledgers above 90% capacity: surge auction, fees climb with percentile. */
const surgePayload = (): RawFeeStats => {
  const charged = distribution({
    max: 10_000,
    p50: 200,
    p90: 1_000,
    p95: 2_500,
    p99: 5_000,
  });
  return {
    last_ledger: "1001",
    last_ledger_base_fee: String(BASE_FEE),
    ledger_capacity_usage: "0.95",
    fee_charged: charged,
    max_fee: charged,
  };
};

beforeEach(() => {
  resetFeeStatsCache();
  feeStatsMock.feeStats.mockReset();
  delete process.env.NEXT_PUBLIC_FEE_AGGRESSIVENESS;
});

afterEach(() => {
  resetFeeStatsCache();
  delete process.env.NEXT_PUBLIC_FEE_AGGRESSIVENESS;
});

describe("idle network", () => {
  it("recommends exactly the base fee", async () => {
    const rec = await getRecommendedFee(async () => idlePayload());

    expect(rec.recommendedFee).toBe(BASE_FEE);
    expect(rec.baseFee).toBe(BASE_FEE);
    expect(rec.congestion).toBe("low");
    expect(rec.source).toBe("horizon");
  });

  it("applies no surge multiplier at any aggressiveness", () => {
    const stats = parseFeeStats(idlePayload());

    for (const level of ["low", "medium", "high"] as FeeAggressiveness[]) {
      expect(recommendFee(stats, level).recommendedFee / BASE_FEE).toBe(1);
    }
  });

  it("scales the total linearly with the operation count", async () => {
    feeStatsMock.feeStats.mockResolvedValue(idlePayload());

    const estimate = await estimateTransactionFee(5);

    expect(estimate.recommendedFee).toBe("100");
    expect(estimate.totalFee).toBe("500");
    expect(estimate.networkCongestion).toBe("low");
  });
});

describe("surge pricing (ledger capacity > 90%)", () => {
  it("reports high congestion", async () => {
    const rec = await getRecommendedFee(async () => surgePayload());

    expect(rec.ledgerCapacityUsage).toBeGreaterThan(0.9);
    expect(rec.congestion).toBe("high");
  });

  it("bids the p90 charged fee by default — a 10x multiplier over base", async () => {
    const rec = await getRecommendedFee(async () => surgePayload());

    expect(rec.percentile).toBe("p90");
    expect(rec.recommendedFee).toBe(1_000);
    expect(rec.recommendedFee / rec.baseFee).toBe(10);
  });

  it("multiplier grows with aggressiveness (p50 < p90 < p99)", () => {
    const stats = parseFeeStats(surgePayload());

    const low = recommendFee(stats, "low").recommendedFee;
    const medium = recommendFee(stats, "medium").recommendedFee;
    const high = recommendFee(stats, "high").recommendedFee;

    expect([low, medium, high]).toEqual([200, 1_000, 5_000]);
    expect(low).toBeLessThan(medium);
    expect(medium).toBeLessThan(high);
  });

  it("honours NEXT_PUBLIC_FEE_AGGRESSIVENESS", async () => {
    process.env.NEXT_PUBLIC_FEE_AGGRESSIVENESS = "high";

    const rec = await getRecommendedFee(async () => surgePayload());

    expect(rec.recommendedFee).toBe(5_000);
  });

  it("multiplies the surge fee by the operation count", async () => {
    feeStatsMock.feeStats.mockResolvedValue(surgePayload());

    const estimate = await estimateTransactionFee(3);

    expect(estimate.recommendedFee).toBe("1000");
    expect(estimate.totalFee).toBe("3000");
    expect(estimate.networkCongestion).toBe("high");
  });

  it("explains the surge in the basis string", async () => {
    const rec = await getRecommendedFee(async () => surgePayload());

    expect(rec.basis).toContain("p90 of recently charged fees");
    expect(rec.basis).toContain("95% full");
  });

  it("orders the Low / Recommended / Fast tiers", async () => {
    const { tiers } = await getFeeSnapshot(async () => surgePayload());

    expect(tiers.baseFee).toBe(BASE_FEE);
    expect(tiers.low).toBeLessThan(tiers.recommended);
    expect(tiers.recommended).toBeLessThan(tiers.fast);
  });
});

describe("fee floor and cap", () => {
  it("never recommends below the base fee, even if a percentile is lower", () => {
    const stats = parseFeeStats({
      ...idlePayload(),
      fee_charged: distribution({ p50: 10, p90: 50, p99: 90 }),
    });

    for (const level of ["low", "medium", "high"] as FeeAggressiveness[]) {
      expect(recommendFee(stats, level).recommendedFee).toBeGreaterThanOrEqual(BASE_FEE);
    }
  });

  it("never exceeds the highest fee charged in the sampled ledgers", () => {
    for (const payload of [idlePayload(), surgePayload()]) {
      const stats = parseFeeStats(payload);
      for (const level of ["low", "medium", "high"] as FeeAggressiveness[]) {
        expect(recommendFee(stats, level).recommendedFee).toBeLessThanOrEqual(
          stats.charged.max
        );
      }
    }
  });

  it("keeps every snapshot tier within the observed maximum", async () => {
    const { tiers } = await getFeeSnapshot(async () => surgePayload());

    for (const tier of [tiers.low, tiers.recommended, tiers.fast]) {
      expect(tier).toBeLessThanOrEqual(10_000);
    }
  });

  it("clamps the platform fee to the configured maximum", () => {
    const hugePayment = BigInt(10) ** BigInt(18);

    const breakdown = calculateFee({ amountStroops: hugePayment });

    expect(breakdown.capApplied).toBe(true);
    expect(breakdown.feeStroops).toBe(DEFAULT_FEE_SCHEDULE.maxFeeStroops);
  });

  it("returns whole-number stroops from the estimator", async () => {
    feeStatsMock.feeStats.mockResolvedValue(surgePayload());

    const estimate = await estimateTransactionFee(2.9);

    expect(estimate.operations).toBe(2);
    expect(estimate.totalFee).toMatch(/^\d+$/);
  });
});

describe("Horizon failure", () => {
  it("falls back to the base fee when no statistics are available", async () => {
    const rec = await getRecommendedFee(async () => {
      throw new Error("Horizon down");
    });

    expect(rec.source).toBe("fallback");
    expect(rec.stale).toBe(true);
    expect(rec.recommendedFee).toBe(BASE_FEE);
  });
});
