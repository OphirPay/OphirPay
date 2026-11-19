// SPDX-License-Identifier: MIT

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getFeeSnapshot, type RawFeeStats } from "@/lib/fee-stats";
import { useFeeStats } from "@/hooks/useFeeStats";

const payload: RawFeeStats = {
  last_ledger: "123",
  last_ledger_base_fee: "100",
  ledger_capacity_usage: "0.6",
  fee_charged: { p50: "150", p90: "300", p99: "500" },
  max_fee: { p90: "900" },
};

afterEach(() => {
  vi.useRealTimers();
});

describe("getFeeSnapshot (issue #1373)", () => {
  it("derives Low/Recommended/Fast from one Horizon sample", async () => {
    const fetcher = vi.fn().mockResolvedValue(payload);
    const snapshot = await getFeeSnapshot(fetcher, 1000);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(snapshot.tiers).toMatchObject({
      baseFee: 100,
      low: 150,
      recommended: 300,
      fast: 500,
      percentiles: { low: "p50", recommended: "p90", fast: "p99" },
    });
    expect(snapshot.congestion).toBe("medium");
    expect(snapshot.source).toBe("horizon");
    expect(snapshot.stale).toBe(false);
    expect(snapshot.basis).toContain("p90");
  });

  it("floors every tier at the network base fee", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      last_ledger_base_fee: "100",
      ledger_capacity_usage: "0",
      fee_charged: { p50: "10", p90: "20", p99: "30" },
    });
    const snapshot = await getFeeSnapshot(fetcher, 1000);

    expect(snapshot.tiers.low).toBe(100);
    expect(snapshot.tiers.recommended).toBe(100);
    expect(snapshot.tiers.fast).toBe(100);
  });

  it("degrades to the configured fee when Horizon is unreachable", async () => {
    process.env.FEE_FALLBACK_BASE_FEE = "100";
    const fetcher = vi.fn().mockRejectedValue(new Error("offline"));
    const snapshot = await getFeeSnapshot(fetcher, 1000);

    expect(snapshot.source).toBe("fallback");
    expect(snapshot.stale).toBe(true);
    expect(snapshot.tiers.recommended).toBe(100);
  });
});

describe("useFeeStats", () => {
  it("loads a snapshot immediately", async () => {
    const fetcher = vi.fn().mockResolvedValue(payload);
    const { result } = renderHook(() => useFeeStats({ fetcher }));

    expect(result.current.isLoading).toBe(true);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.snapshot?.tiers.recommended).toBe(300);
    expect(result.current.error).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("refreshes the recommendation every 30 seconds", async () => {
    vi.useFakeTimers();
    let p90 = "300";
    const fetcher = vi.fn().mockImplementation(async () => ({
      ...payload,
      fee_charged: { ...payload.fee_charged, p90 },
    }));

    const { result } = renderHook(() => useFeeStats({ fetcher }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.snapshot?.tiers.recommended).toBe(300);

    p90 = "900";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(fetcher.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(result.current.snapshot?.tiers.recommended).toBe(900);
  });

  it("does not fetch while disabled", async () => {
    const fetcher = vi.fn().mockResolvedValue(payload);
    const { result } = renderHook(() =>
      useFeeStats({ fetcher, enabled: false })
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(fetcher).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.snapshot).toBeNull();
  });

  it("exposes a manual refresh", async () => {
    const fetcher = vi.fn().mockResolvedValue(payload);
    const { result } = renderHook(() =>
      useFeeStats({ fetcher, enabled: false })
    );

    await act(async () => {
      await result.current.refresh();
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.current.snapshot).not.toBeNull();
  });
});
