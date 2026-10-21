// SPDX-License-Identifier: MIT
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, act, waitFor } from "@testing-library/react";
import { FeeEstimatorWidget } from "@/components/forms/FeeEstimatorWidget";
import { estimateTransactionFee } from "@/lib/fee-estimator";
import type { FeeEstimate } from "@/lib/fee-estimator";

// Mock the fee-estimator module
vi.mock("@/lib/fee-estimator", () => ({
  estimateTransactionFee: vi.fn(),
}));

const mockedEstimate = vi.mocked(estimateTransactionFee);

/** Build a mock FeeEstimate. */
function mockEstimate(overrides: Partial<FeeEstimate> = {}): FeeEstimate {
  return {
    baseFee: "100",
    recommendedFee: "300",
    estimatedFee: "300",
    totalFee: "300",
    operations: 1,
    networkCongestion: "low",
    percentile: "p90",
    aggressiveness: "medium",
    source: "horizon",
    stale: false,
    basis: "p90 of recently charged fees · ledger 20% full (low congestion) · medium aggressiveness",
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────

describe("FeeEstimatorWidget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock: successful estimate
    mockedEstimate.mockResolvedValue(mockEstimate());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders loading state initially", () => {
    mockedEstimate.mockReturnValue(new Promise(() => {})); // never resolves
    render(<FeeEstimatorWidget />);
    expect(screen.getByTestId("fee-estimator-loading")).toBeInTheDocument();
    expect(screen.getByText(/Fetching live network fee/i)).toBeInTheDocument();
  });

  it("renders recommended fee after successful fetch", async () => {
    mockedEstimate.mockResolvedValue(mockEstimate({ recommendedFee: "50000" }));
    render(<FeeEstimatorWidget />);

    await waitFor(() => {
      expect(screen.getByTestId("fee-estimator")).toBeInTheDocument();
    });
    // 50000 stroops = 0.005 XLM (>= 0.001 threshold)
    expect(screen.getByTestId("fee-estimator-recommended")).toHaveTextContent("0.005 XLM");
    expect(screen.getByTestId("fee-estimator-congestion")).toBeInTheDocument();
  });

  it("displays the congestion badge with correct text", async () => {
    mockedEstimate.mockResolvedValue(
      mockEstimate({ networkCongestion: "high", recommendedFee: "900" })
    );
    render(<FeeEstimatorWidget />);

    await waitFor(() => {
      expect(screen.getByTestId("fee-estimator-congestion")).toBeInTheDocument();
    });
    expect(screen.getByTestId("fee-estimator-congestion").textContent).toContain("high");
  });

  it("displays the source badge", async () => {
    render(<FeeEstimatorWidget />);

    await waitFor(() => {
      expect(screen.getByTestId("fee-estimator-source")).toBeInTheDocument();
    });
    expect(screen.getByTestId("fee-estimator-source").textContent).toContain("horizon");
  });

  it("shows stale warning when estimate is stale", async () => {
    mockedEstimate.mockResolvedValue(
      mockEstimate({ stale: true, source: "cache" })
    );
    render(<FeeEstimatorWidget />);

    await waitFor(() => {
      expect(screen.getByTestId("fee-estimator-stale-badge")).toBeInTheDocument();
    });
  });

  it("hides stale warning when showStaleWarning is false", async () => {
    mockedEstimate.mockResolvedValue(
      mockEstimate({ stale: true, source: "cache" })
    );
    render(<FeeEstimatorWidget showStaleWarning={false} />);

    await waitFor(() => {
      expect(screen.getByTestId("fee-estimator")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("fee-estimator-stale-badge")).not.toBeInTheDocument();
  });

  it("hides basis text when showBasis is false", async () => {
    render(<FeeEstimatorWidget showBasis={false} />);

    await waitFor(() => {
      expect(screen.getByTestId("fee-estimator")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("fee-estimator-basis")).not.toBeInTheDocument();
  });

  it("calls onEstimateChange callback with the estimate", async () => {
    const onEstimateChange = vi.fn();
    render(<FeeEstimatorWidget onEstimateChange={onEstimateChange} />);

    await waitFor(() => {
      expect(onEstimateChange).toHaveBeenCalledTimes(1);
    });
    expect(onEstimateChange).toHaveBeenCalledWith(
      expect.objectContaining({ recommendedFee: "300" })
    );
  });

  it("passes operations count to estimateTransactionFee", async () => {
    render(<FeeEstimatorWidget operations={3} />);

    await waitFor(() => {
      expect(mockedEstimate).toHaveBeenCalledWith(3);
    });
  });

  it("shows total fee when operations > 1", async () => {
    mockedEstimate.mockResolvedValue(
      mockEstimate({ operations: 3, totalFee: "900", recommendedFee: "300" })
    );
    render(<FeeEstimatorWidget operations={3} />);

    await waitFor(() => {
      expect(screen.getByTestId("fee-estimator")).toBeInTheDocument();
    });
    expect(screen.getByText(/Total:/)).toBeInTheDocument();
  });

  it("formats fees below 0.001 XLM as stroops", async () => {
    mockedEstimate.mockResolvedValue(
      mockEstimate({ recommendedFee: "50" })
    );
    render(<FeeEstimatorWidget />);

    await waitFor(() => {
      expect(screen.getByTestId("fee-estimator-recommended")).toHaveTextContent("50 stroops");
    });
  });

  it("shows retry button on error when no estimate yet", async () => {
    mockedEstimate.mockRejectedValue(new Error("Network error"));
    render(<FeeEstimatorWidget />);

    await waitFor(() => {
      expect(screen.getByTestId("fee-estimator-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("fee-estimator-retry")).toBeInTheDocument();
  });

  it("retry button re-fetches fee on click", async () => {
    mockedEstimate
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce(mockEstimate());

    render(<FeeEstimatorWidget />);

    await waitFor(() => {
      expect(screen.getByTestId("fee-estimator-retry")).toBeInTheDocument();
    });

    await act(async () => {
      screen.getByTestId("fee-estimator-retry").click();
    });

    await waitFor(() => {
      expect(screen.getByTestId("fee-estimator")).toBeInTheDocument();
    });
    expect(mockedEstimate).toHaveBeenCalledTimes(2);
  });

  it("auto-refreshes at the configured interval", async () => {
    vi.useFakeTimers();
    const onEstimateChange = vi.fn();
    render(
      <FeeEstimatorWidget
        refreshIntervalMs={5000}
        onEstimateChange={onEstimateChange}
      />
    );

    // Initial fetch
    await act(async () => {
      vi.advanceTimersByTime(0);
    });
    expect(mockedEstimate).toHaveBeenCalledTimes(1);

    // After one interval
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(mockedEstimate).toHaveBeenCalledTimes(2);

    // After two intervals
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(mockedEstimate).toHaveBeenCalledTimes(3);
  });

  it("does not auto-refresh when refreshIntervalMs is 0", async () => {
    vi.useFakeTimers();
    render(<FeeEstimatorWidget refreshIntervalMs={0} />);

    await act(async () => {
      vi.advanceTimersByTime(0);
    });
    expect(mockedEstimate).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    // Still only 1 call — no interval was set
    expect(mockedEstimate).toHaveBeenCalledTimes(1);
  });

  it("manual refresh button triggers a new fetch", async () => {
    render(<FeeEstimatorWidget />);

    await waitFor(() => {
      expect(screen.getByTestId("fee-estimator")).toBeInTheDocument();
    });

    await act(async () => {
      screen.getByTestId("fee-estimator-refresh").click();
    });

    await waitFor(() => {
      expect(mockedEstimate).toHaveBeenCalledTimes(2);
    });
  });

  it("displays basis text when available", async () => {
    render(<FeeEstimatorWidget />);

    await waitFor(() => {
      expect(screen.getByTestId("fee-estimator-basis")).toBeInTheDocument();
    });
    expect(screen.getByTestId("fee-estimator-basis").textContent).toContain("Based on");
  });

  it("hides refresh button when showRefresh is false", async () => {
    render(<FeeEstimatorWidget showRefresh={false} />);

    await waitFor(() => {
      expect(screen.getByTestId("fee-estimator")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("fee-estimator-refresh")).not.toBeInTheDocument();
  });

  it("applies custom test ID prefix", async () => {
    render(<FeeEstimatorWidget testIdPrefix="custom-fee" />);

    await waitFor(() => {
      expect(screen.getByTestId("custom-fee")).toBeInTheDocument();
    });
    expect(screen.getByTestId("custom-fee-recommended")).toBeInTheDocument();
  });

  it("displays fallback source badge correctly", async () => {
    mockedEstimate.mockResolvedValue(
      mockEstimate({ source: "fallback", stale: true })
    );
    render(<FeeEstimatorWidget />);

    await waitFor(() => {
      expect(screen.getByTestId("fee-estimator-source")).toBeInTheDocument();
    });
    expect(screen.getByTestId("fee-estimator-source").textContent).toContain("fallback");
  });

  it("shows last updated timestamp", async () => {
    render(<FeeEstimatorWidget />);

    expect(await screen.findByTestId("fee-estimator")).toBeInTheDocument();
    expect(screen.getByText(/Updated/i)).toBeInTheDocument();
  });
});
