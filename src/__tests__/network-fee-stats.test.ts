// SPDX-License-Identifier: MIT
//
// Fee recommendation from Horizon fee statistics — issue #825.
//
// Three properties matter here and each has burned a payments product before:
//   1. the statistics parse must reject partial payloads (a fee derived from
//      `undefined` is worse than a fallback),
//   2. an unreachable Horizon must yield a *stated* cached or configured value,
//      never a silent constant, and
//   3. the fee shown before signing must be the fee submitted.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/stellar", () => ({ HORIZON_URL: "https://horizon-testnet.stellar.org" }));

import {
  FALLBACK_BASE_FEE,
  assertQuotedFeeMatches,
  clearFeeStatsCache,
  congestionFor,
  fallbackRecommendation,
  getFeeRecommendation,
  parseFeeStats,
  recommendFromStats,
  peekCachedRecommendation,
  type FeeStats,
} from "@/lib/network-fee-stats";

const HORIZON_PAYLOAD = {
  last_ledger: 123456,
  last_ledger_base_fee: "100",
  ledger_capacity_usage: "0.4",
  fee_charged: { min: "100", max: "5000", mode: "100", p10: "100", p50: "150", p90: "900", p99: "2200" },
};

function stats(overrides: Partial<FeeStats> = {}): FeeStats {
  return {
    baseFee: 100,
    ledgerCapacityUsage: 0.4,
    charged: { min: 100, max: 5000, mode: 100, p50: 150, p90: 900, p99: 2200 },
    lastLedger: 1,
    ...overrides,
  };
}

/** Minimal fetcher double — avoids depending on a global fetch in the test env. */
function okFetcher(payload: unknown) {
  return vi.fn(async () => ({ ok: true, json: async () => payload }));
}
function failingFetcher() {
  return vi.fn(async () => {
    throw new Error("ECONNREFUSED");
  });
}
const corruptFetcher = () => vi.fn(async () => ({ ok: true, json: async () => ({ last_ledger: 5 }) }));

beforeEach(() => clearFeeStatsCache());
afterEach(() => {
  delete process.env.NEXT_PUBLIC_FEE_AGGRESSIVENESS;
  clearFeeStatsCache();
});

describe("parseFeeStats", () => {
  it("normalises a Horizon fee_stats payload", () => {
    const parsed = parseFeeStats(HORIZON_PAYLOAD);
    expect(parsed).not.toBeNull();
    expect(parsed!.baseFee).toBe(100);
    expect(parsed!.ledgerCapacityUsage).toBeCloseTo(0.4);
    expect(parsed!.charged.p90).toBe(900);
  });

  it.each([
    ["missing fee_charged", { ...HORIZON_PAYLOAD, fee_charged: undefined }],
    ["non-numeric percentile", { ...HORIZON_PAYLOAD, fee_charged: { min: "1", max: "2", mode: "1", p50: "x", p90: "3", p99: "4" } }],
    ["missing base fee", { ...HORIZON_PAYLOAD, last_ledger_base_fee: undefined }],
    ["missing capacity usage", { ...HORIZON_PAYLOAD, ledger_capacity_usage: undefined }],
  ])("rejects a partial payload: %s", (_label, payload) => {
    expect(parseFeeStats(payload)).toBeNull();
  });

  it("clamps capacity usage into 0..1", () => {
    expect(parseFeeStats({ ...HORIZON_PAYLOAD, ledger_capacity_usage: "1.7" })!.ledgerCapacityUsage).toBe(1);
    expect(parseFeeStats({ ...HORIZON_PAYLOAD, ledger_capacity_usage: "-2" })!.ledgerCapacityUsage).toBe(0);
  });
});

describe("recommendFromStats", () => {
  it("follows the policy percentile but never undercuts the base fee", () => {
    const low = recommendFromStats(stats(), { aggressiveness: "low" });
    const high = recommendFromStats(stats(), { aggressiveness: "high" });
    expect(low.baseFeeStroops).toBe(150); // p50
    expect(high.baseFeeStroops).toBe(2200); // p99
    expect(high.baseFeeStroops).toBeGreaterThan(low.baseFeeStroops);

    // Empty ledger: charged percentiles sit below the floor, the floor wins.
    const quiet = recommendFromStats(stats({ baseFee: 100, charged: { min: 100, max: 100, mode: 100, p50: 100, p90: 100, p99: 100 } }), {
      aggressiveness: "low",
    });
    expect(quiet.baseFeeStroops).toBe(100);
  });

  it("scales the total by operation count, not the per-operation fee", () => {
    const rec = recommendFromStats(stats(), { aggressiveness: "medium", operations: 12 });
    expect(rec.baseFeeStroops).toBe(900);
    expect(rec.totalStroops).toBe(900 * 12);
  });

  it("reports congestion bands", () => {
    expect(congestionFor(100)).toBe("low");
    expect(congestionFor(500)).toBe("medium");
    expect(congestionFor(5000)).toBe("high");
    expect(recommendFromStats(stats(), { aggressiveness: "high" }).congestion).toBe("high");
  });

  it("states the basis so the UI can explain a higher-than-usual fee", () => {
    const rec = recommendFromStats(stats(), { aggressiveness: "high" });
    expect(rec.basis).toContain("p99");
    expect(rec.basis).toMatch(/policy/);
    expect(rec.stale).toBe(false);
  });
});

describe("getFeeRecommendation", () => {
  it("fetches Horizon and returns a sourced recommendation", async () => {
    const fetcher = okFetcher(HORIZON_PAYLOAD);
    const rec = await getFeeRecommendation({ operations: 2, fetcher });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe("https://horizon-testnet.stellar.org/fee_stats");
    expect(rec.source).toBe("horizon");
    expect(rec.stale).toBe(false);
    expect(rec.baseFeeStroops).toBe(900); // default medium => p90
    expect(rec.totalStroops).toBe(1800);
  });

  it("serves the cache within the TTL instead of re-fetching", async () => {
    const t0 = 1_000_000;
    const fetcher = okFetcher(HORIZON_PAYLOAD);
    await getFeeRecommendation({ fetcher, now: t0 });
    const second = await getFeeRecommendation({ operations: 3, fetcher, now: t0 + 5_000 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(second.source).toBe("cache");
    expect(second.totalStroops).toBe(second.baseFeeStroops * 3);
  });

  it("refreshes after the TTL elapses", async () => {
    const t0 = 2_000_000;
    const fetcher = okFetcher(HORIZON_PAYLOAD);
    await getFeeRecommendation({ fetcher, now: t0 });
    await getFeeRecommendation({ fetcher, now: t0 + 60_000 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("falls back to the last known good value when Horizon is unreachable", async () => {
    const t0 = 3_000_000;
    await getFeeRecommendation({ fetcher: okFetcher(HORIZON_PAYLOAD), now: t0 });
    const rec = await getFeeRecommendation({ fetcher: failingFetcher(), now: t0 + 60_000 });
    expect(rec.stale).toBe(true);
    expect(["cache", "fallback"]).toContain(rec.source);
    expect(rec.baseFeeStroops).toBeGreaterThan(0);
    expect(rec.basis).toMatch(/last known good|fallback/i);
  });

  it("falls back to the configured value when Horizon was never reachable", async () => {
    const rec = await getFeeRecommendation({ operations: 4, fetcher: failingFetcher() });
    expect(rec.source).toBe("fallback");
    expect(rec.stale).toBe(true);
    expect(rec.baseFeeStroops).toBe(FALLBACK_BASE_FEE);
    expect(rec.totalStroops).toBe(FALLBACK_BASE_FEE * 4);
    // The indication the criterion asks for must be present, not implied.
    expect(rec.basis).toMatch(/Horizon could not be reached/i);
  });

  it("never throws on a corrupt payload", async () => {
    const rec = await getFeeRecommendation({ fetcher: corruptFetcher() });
    expect(rec.source).toBe("fallback");
    expect(rec.stale).toBe(true);
  });

  it("always returns a recommendation, so no caller can render an undefined fee", async () => {
    for (const fetcher of [okFetcher(HORIZON_PAYLOAD), failingFetcher(), corruptFetcher(), okFetcher({})]) {
      clearFeeStatsCache();
      const rec = await getFeeRecommendation({ fetcher });
      expect(typeof rec.baseFeeStroops).toBe("number");
      expect(Number.isFinite(rec.baseFeeStroops)).toBe(true);
      expect(rec.baseFeeStroops).toBeGreaterThan(0);
      expect(rec.basis.length).toBeGreaterThan(0);
    }
  });

  it("exposes the cached value for synchronous render paths", async () => {
    expect(peekCachedRecommendation()).toBeNull();
    await getFeeRecommendation({ fetcher: okFetcher(HORIZON_PAYLOAD) });
    expect(peekCachedRecommendation()).not.toBeNull();
  });
});

describe("assertQuotedFeeMatches", () => {
  it("accepts an identical fee and reports a mismatch instead of throwing", () => {
    const rec = recommendFromStats(stats(), { operations: 3 });
    expect(assertQuotedFeeMatches(rec, rec.totalStroops).matches).toBe(true);

    const drift = assertQuotedFeeMatches(rec, rec.totalStroops - 1);
    expect(drift.matches).toBe(false);
    expect(drift.expected).toBe(rec.totalStroops);
    expect(drift.actual).toBe(rec.totalStroops - 1);
  });
});

describe("fallbackRecommendation", () => {
  it("is always usable and always flagged", () => {
    const rec = fallbackRecommendation({ operations: 5 });
    expect(rec.source).toBe("fallback");
    expect(rec.stale).toBe(true);
    expect(rec.totalStroops).toBe(FALLBACK_BASE_FEE * 5);
  });
});
