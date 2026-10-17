// SPDX-License-Identifier: MIT
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  buildFeeStatsSnapshot,
  stroopsToXlm,
  MIN_NETWORK_FEE_STROOPS,
} from "@/hooks/useFeeStats";
import {
  FeeSelector,
  validateCustomFeeStroops,
} from "@/components/ui/FeeSelector";
import { PaymentForm } from "@/components/forms/payment-form";

const VALID_DEST = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

describe("Live Network Transaction Fee Estimator Widget (#1373)", () => {
  it("converts stroops to 7-decimal XLM and normalizes Horizon /fee_stats into Low, Recommended, and Fast tiers", () => {
    expect(stroopsToXlm(100)).toBe("0.0000100");
    expect(stroopsToXlm(250)).toBe("0.0000250");
    expect(stroopsToXlm(1200)).toBe("0.0001200");

    const snapshot = buildFeeStatsSnapshot({
      last_ledger: "1000",
      last_ledger_base_fee: "100",
      ledger_capacity_usage: "0.65",
      fee_charged: {
        p50: "150",
        p90: "320",
        p99: "900",
      },
    });

    expect(snapshot.baseFee).toBe(100);
    expect(snapshot.low).toEqual({ stroops: 150, xlm: "0.0000150" });
    expect(snapshot.recommended).toEqual({ stroops: 320, xlm: "0.0000320" });
    expect(snapshot.fast).toEqual({ stroops: 900, xlm: "0.0000900" });
    expect(snapshot.congestion).toBe("medium");
    expect(snapshot.stale).toBe(false);
  });

  it("validates custom fee overrides against the 100-stroop network minimum", () => {
    expect(validateCustomFeeStroops("99")).toEqual({
      valid: false,
      error: expect.stringMatching(/at least 100 stroops/i),
    });
    expect(validateCustomFeeStroops("100")).toEqual({
      valid: true,
      stroops: 100,
    });
    expect(validateCustomFeeStroops("450")).toEqual({
      valid: true,
      stroops: 450,
    });
  });

  it("renders Low, Recommended, and Fast tiers in XLM and stroops and enforces custom fee validation", () => {
    const onFeeChange = vi.fn();
    const stats = buildFeeStatsSnapshot({
      last_ledger_base_fee: "100",
      ledger_capacity_usage: "0.2",
      fee_charged: { p50: "120", p90: "250", p99: "600" },
    });

    render(<FeeSelector stats={stats} onFeeChange={onFeeChange} />);

    expect(screen.getByTestId("fee-tier-low")).toHaveTextContent("120 stroops");
    expect(screen.getByTestId("fee-tier-low")).toHaveTextContent("0.0000120 XLM");
    expect(screen.getByTestId("fee-tier-recommended")).toHaveTextContent(
      "250 stroops"
    );
    expect(screen.getByTestId("fee-tier-fast")).toHaveTextContent("600 stroops");

    fireEvent.click(screen.getByTestId("fee-tier-fast"));
    expect(onFeeChange).toHaveBeenLastCalledWith(600, "fast");

    fireEvent.click(screen.getByTestId("fee-tier-custom-toggle"));
    const customInput = screen.getByTestId("custom-fee-input");
    fireEvent.change(customInput, { target: { value: "50" } });
    expect(screen.getByTestId("custom-fee-error")).toHaveTextContent(
      /at least 100 stroops/i
    );

    fireEvent.change(customInput, { target: { value: "750" } });
    expect(screen.queryByTestId("custom-fee-error")).toBeNull();
    expect(onFeeChange).toHaveBeenLastCalledWith(750, "custom");
  });

  it("integrates FeeSelector into PaymentForm and passes the selected fee to the submission payload", async () => {
    const onSubmit = vi.fn();
    const mockFetcher = vi.fn().mockResolvedValue({
      last_ledger_base_fee: String(MIN_NETWORK_FEE_STROOPS),
      ledger_capacity_usage: "0.3",
      fee_charged: { p50: "110", p90: "220", p99: "550" },
    });

    render(
      <PaymentForm
        onSubmit={onSubmit}
        feeStatsOptions={{ fetcher: mockFetcher, pollIntervalMs: 30_000 }}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("fee-tier-fast")).toHaveTextContent(
        "550 stroops"
      );
    });

    fireEvent.change(screen.getByTestId("payment-form-destination"), {
      target: { value: VALID_DEST },
    });
    fireEvent.change(screen.getByTestId("payment-form-amount"), {
      target: { value: "42.5" },
    });
    fireEvent.click(screen.getByTestId("fee-tier-fast"));
    fireEvent.submit(screen.getByTestId("payment-submission-form"));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        destination: VALID_DEST,
        amount: "42.5",
        assetCode: "XLM",
        memo: undefined,
        feeStroops: 550,
        feeTier: "fast",
      });
    });
  });
});
