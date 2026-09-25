// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach } from "vitest";
import {
  BASELINE_BASE_FEE,
  congestionFrom,
  describeBasis,
  fallbackRecommendation,
  getFeeRecommendation,
  parseFeeStats,
  recommendBaseFee,
  __resetFeeStatsCache,
  type ParsedFeeStats,
} from "../network-fee-stats";

/** Realistic Horizon `/fee_stats` payload. */
function horizonPayload(overrides: Record<string, unknown> = {}) {
  return {
    last_ledger: "12345",
    last_ledger_base_fee: "100",
    ledger_capacity_usage: "0.25",
    fee_charged: {
      min: "100",
      max: "1000",
      mode: "100",
      p10: "100",
      p20: "100",
      p30: "100",
      p40: "100",
      p50: "100",
      p60: "150",
      p70: "200",
      p80: "300",
      p90: "500",
      p95: "700",
      p99: "1000",
    },
    max_fee: {
      min: "100",
      max: "2000",
      p50: "100",
      p95: "1500",
      p99: "2000",
    },
    ...overrides,
  };
}

const busyStats: ParsedFeeStats = {
  lastLedgerBaseFee: 100,
  ledgerCapacityUsage: 0.85,
  min: 100,
  p50: 400,
  p95: 900,
  p99: 1500,
  max: 2000,
};

beforeEach(() => {
  __resetFeeStatsCache();
});

describe("parseFeeStats", () => {
  it("parses a live Horizon payload", () => {
    const stats = parseFeeStats(horizonPayload());
    expect(stats).not.toBeNull();
    expect(stats!.lastLedgerBaseFee).toBe(100);
    expect(stats!.ledgerCapacityUsage).toBeCloseTo(0.25);
    expect(stats!.p50).toBe(100);
    expect(stats!.p95).toBe(700);
    expect(stats!.p99).toBe(1000);
    expect(stats!.max).toBe(1000);
  });

  it("accepts numeric (non-string) fields", () => {
    const stats = parseFeeStats(
      horizonPayload({ last_ledger_base_fee: 200, ledger_capacity_usage: 0.4 })
    );
    expect(stats!.lastLedgerBaseFee).toBe(200);
    expect(stats!.ledgerCapacityUsage).toBeCloseTo(0.4);
  });

  it("accepts a flat payload without the fee_charged wrapper", () => {
    const stats = parseFeeStats({
      last_ledger_base_fee: "100",
      ledger_capacity_usage: "0.1",
      p50: "120",
      p95: "300",
      p99: "600",
      max: "800",
    });
    expect(stats).not.toBeNull();
    expect(stats!.p95).toBe(300);
  });

  it("rejects payloads with a nonsensical base fee", () => {
    expect(parseFeeStats(horizonPayload({ last_ledger_base_fee: "0" }))).toBeNull();
    expect(parseFeeStats(horizonPayload({ last_ledger_base_fee: "abc" }))).toBeNull();
  });

  it("rejects an out-of-range capacity usage", () => {
    expect(parseFeeStats(horizonPayload({ ledger_capacity_usage: "1.5" }))).toBeNull();
    expect(parseFeeStats(horizonPayload({ ledger_capacity_usage: "-0.1" }))).toBeNull();
  });

  it("rejects non-object payloads", () => {
    expect(parseFeeStats(null)).toBeNull();
    expect(parseFeeStats("nope")).toBeNull();
    expect(parseFeeStats(undefined)).toBeNull();
  });
});

describe("congestionFrom", () => {
  it("is low on a quiet network", () => {
    expect(congestionFrom(parseFeeStats(horizonPayload())!)).toBe("low");
  });

  it("is medium when ledgers are half full", () => {
    const stats = parseFeeStats(horizonPayload({ ledger_capacity_usage: "0.6" }))!;
    expect(congestionFrom(stats)).toBe("medium");
  });

  it("is high when ledgers are nearly full", () => {
    expect(congestionFrom(busyStats)).toBe("high");
  });

  it("is high when fees are far above the base fee even if capacity reads low", () => {
    const spiky: ParsedFeeStats = { ...busyStats, ledgerCapacityUsage: 0.1 };
    expect(congestionFrom(spiky)).toBe("high");
  });
});

describe("recommendBaseFee", () => {
  it("uses the current base fee on a quiet network", () => {
    const stats = parseFeeStats(horizonPayload())!;
    expect(recommendBaseFee(stats, "standard")).toBe(100);
  });

  it("never recommends below the protocol baseline", () => {
    const cheap: ParsedFeeStats = {
      lastLedgerBaseFee: 10,
      ledgerCapacityUsage: 0.01,
      min: 1,
      p50: 10,
      p95: 20,
      p99: 30,
      max: 40,
    };
    expect(recommendBaseFee(cheap, "standard")).toBeGreaterThanOrEqual(
      BASELINE_BASE_FEE
    );
  });

  it("escalates to the p95 on a busy network", () => {
    expect(recommendBaseFee(busyStats, "standard")).toBe(900);
  });

  it("escalates above the p99 when aggressive", () => {
    expect(recommendBaseFee(busyStats, "aggressive")).toBe(2000);
  });

  it("stays economical when asked", () => {
    expect(recommendBaseFee(busyStats, "economical")).toBe(200);
  });
});

describe("describeBasis", () => {
  it("explains a quiet network without alarming the user", () => {
    const stats = parseFeeStats(horizonPayload())!;
    const basis = describeBasis(stats, 100, "standard");
    expect(basis).toMatch(/quiet/i);
    expect(basis).toContain("100");
  });

  it("names the percentile it escalated to", () => {
    const basis = describeBasis(busyStats, 900, "standard");
    expect(basis).toMatch(/95th percentile/i);
    expect(basis).toMatch(/high congestion/i);
  });

  it("explains the aggressive maximum-based choice", () => {
    const basis = describeBasis(busyStats, 2000, "aggressive");
    expect(basis).toMatch(/maximum recently charged fee/i);
  });
});

describe("getFeeRecommendation", () => {
  it("returns a live recommendation from Horizon", async () => {
    const rec = await getFeeRecommendation({
      operations: 2,
      fetcher: async () => horizonPayload(),
    });
    expect(rec.source).toBe("horizon");
    expect(rec.stale).toBe(false);
    expect(rec.congestion).toBe("low");
    expect(rec.baseFee).toBe("100");
    expect(rec.estimatedFee).toBe("200");
    expect(rec.basis).toBeTruthy();
    expect(rec.stats).toBeDefined();
  });

  it("escalates the fee when Horizon reports congestion", async () => {
    const rec = await getFeeRecommendation({
      fetcher: async () =>
        horizonPayload({ ledger_capacity_usage: "0.9" }),
      forceRefresh: true,
    });
    expect(rec.congestion).toBe("high");
    expect(Number(rec.baseFee)).toBeGreaterThan(BASELINE_BASE_FEE);
  });

  it("falls back to the baseline when Horizon is unreachable and never throws", async () => {
    const rec = await getFeeRecommendation({
      operations: 3,
      fetcher: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    expect(rec.source).toBe("baseline");
    expect(rec.stale).toBe(true);
    expect(rec.baseFee).toBe(String(BASELINE_BASE_FEE));
    expect(rec.estimatedFee).toBe(String(BASELINE_BASE_FEE * 3));
    expect(rec.basis).toMatch(/ECONNREFUSED|unavailable|unreachable/i);
  });

  it("uses the configured base fee when Horizon is unreachable", async () => {
    const rec = await getFeeRecommendation({
      fetcher: async () => {
        throw new Error("timeout");
      },
      configuredBaseFee: 250,
    });
    expect(rec.source).toBe("configured");
    expect(rec.stale).toBe(true);
    expect(rec.baseFee).toBe("250");
  });

  it("serves the last known good value from cache when Horizon then fails", async () => {
    await getFeeRecommendation({ fetcher: async () => horizonPayload() });
    const rec = await getFeeRecommendation({
      fetcher: async () => {
        throw new Error("offline");
      },
      forceRefresh: true,
    });
    expect(rec.source).toBe("cache");
    expect(rec.stale).toBe(true);
    expect(rec.baseFee).toBe("100");
    expect(rec.basis).toMatch(/last known good/i);
  });

  it("treats an unusable payload as unreachable rather than guessing", async () => {
    const rec = await getFeeRecommendation({
      fetcher: async () => ({ unexpected: true }),
    });
    expect(rec.source).toBe("baseline");
    expect(rec.stale).toBe(true);
  });

  it("always fills every field the UI renders", async () => {
    const rec = await getFeeRecommendation({
      fetcher: async () => {
        throw new Error("nope");
      },
    });
    for (const key of [
      "baseFee",
      "estimatedFee",
      "operations",
      "congestion",
      "source",
      "basis",
    ] as const) {
      expect(rec[key]).toBeDefined();
    }
    expect(typeof rec.stale).toBe("boolean");
    expect(rec.observedAt).toBeGreaterThan(0);
  });
});

describe("fallbackRecommendation", () => {
  it("flags itself as stale with an explanatory basis", () => {
    const rec = fallbackRecommendation(1, "Horizon was unreachable");
    expect(rec.stale).toBe(true);
    expect(rec.basis).toContain("Horizon was unreachable");
    expect(rec.basis).toContain(String(BASELINE_BASE_FEE));
  });
});
