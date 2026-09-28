// SPDX-License-Identifier: MIT

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FeeRecommendation } from "@/components/FeeRecommendation";
import { BatchConfirmDialog } from "@/components/BatchConfirmDialog";
import type { FeeEstimate } from "@/lib/fee-estimator";

const estimate = (overrides: Partial<FeeEstimate> = {}): FeeEstimate => ({
  baseFee: "100",
  recommendedFee: "250",
  estimatedFee: "750",
  operations: 3,
  networkCongestion: "high",
  policy: "normal",
  source: "horizon",
  stale: false,
  fetchedAt: Date.now(),
  ledgerCapacityUsage: 0.97,
  percentile: "p70",
  percentileFee: "250",
  capped: false,
  refreshIntervalMs: 30_000,
  ...overrides,
});

describe("FeeRecommendation", () => {
  it("renders nothing without an estimate", () => {
    const { container } = render(<FeeRecommendation estimate={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the fee and why it is higher than usual", () => {
    render(<FeeRecommendation estimate={estimate()} />);
    expect(screen.getByTestId("fee-total").textContent).toBe(
      "Network fee: 0.000075 XLM (250 stroops × 3 operations)"
    );
    expect(screen.getByTestId("fee-congestion").textContent).toBe("high");
    const basis = screen.getByTestId("fee-basis").textContent ?? "";
    expect(basis).toContain("Normal policy");
    expect(basis).toContain("ledger 97% full");
    expect(basis).toContain("Higher than the 100 stroop base fee");
    expect(screen.queryByTestId("fee-stale-warning")).toBeNull();
  });

  it("does not claim a surge when the fee equals the base fee", () => {
    render(
      <FeeRecommendation
        estimate={estimate({ recommendedFee: "100", estimatedFee: "100", operations: 1, ledgerCapacityUsage: 0.1, networkCongestion: "low" })}
      />
    );
    const basis = screen.getByTestId("fee-basis").textContent ?? "";
    expect(basis).toContain("Matches the 100 stroop base fee");
    expect(basis).not.toContain("Higher than");
  });

  it("flags last-known-good data as stale with its age", () => {
    render(
      <FeeRecommendation
        estimate={estimate({ source: "cache", stale: true, fetchedAt: Date.now() - 125_000 })}
      />
    );
    const warning = screen.getByTestId("fee-stale-warning");
    expect(warning.textContent).toContain("Horizon is unreachable");
    expect(warning.textContent).toContain("last known fee from 2m ago");
  });

  it("flags the configured fallback with a visible indication", () => {
    render(
      <FeeRecommendation
        estimate={estimate({
          source: "fallback",
          stale: true,
          fetchedAt: null,
          percentile: null,
          percentileFee: null,
          ledgerCapacityUsage: null,
          networkCongestion: "unknown",
          operations: 1,
          estimatedFee: "250",
        })}
      />
    );
    expect(screen.getByTestId("fee-stale-warning").textContent).toContain("configured fallback fee");
    expect(screen.getByTestId("fee-basis").textContent).toContain("statistics are unavailable");
    expect(screen.getByTestId("fee-congestion").textContent).toBe("unknown");
  });

  it("lets the user change the aggressiveness policy", () => {
    const onPolicyChange = vi.fn();
    render(<FeeRecommendation estimate={estimate()} onPolicyChange={onPolicyChange} />);
    fireEvent.change(screen.getByTestId("fee-policy-select"), { target: { value: "high" } });
    expect(onPolicyChange).toHaveBeenCalledWith("high");
  });
});

describe("BatchConfirmDialog fee basis", () => {
  const base = {
    open: true,
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    totalAmount: 30,
    estimatedFee: "300",
    recipients: [
      { address: "G" + "A".repeat(55), amount: "10" },
      { address: "G" + "B".repeat(55), amount: "10" },
      { address: "G" + "C".repeat(55), amount: "10" },
    ],
  };

  it("shows the Horizon recommendation, its total and its basis", () => {
    render(<BatchConfirmDialog {...base} feeEstimate={estimate()} />);
    // 750 stroops = 0.000075 XLM — the estimate wins over the static prop.
    expect(screen.getByText("0.000075 XLM")).toBeDefined();
    expect(screen.getByTestId("fee-basis").textContent).toContain("Higher than the 100 stroop base fee");
  });

  it("shows the stale warning when Horizon was unreachable", () => {
    render(
      <BatchConfirmDialog
        {...base}
        feeEstimate={estimate({ source: "fallback", stale: true, fetchedAt: null, percentile: null })}
      />
    );
    expect(screen.getByTestId("fee-stale-warning")).toBeDefined();
  });

  it("still works with only the static fee (no basis shown)", () => {
    render(<BatchConfirmDialog {...base} />);
    expect(screen.queryByTestId("fee-recommendation")).toBeNull();
  });
});
