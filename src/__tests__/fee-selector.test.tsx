// SPDX-License-Identifier: MIT

import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  FeeSelector,
  type FeeSelection,
} from "@/components/ui/FeeSelector";
import type { FeeSnapshot } from "@/lib/fee-stats";

const snapshot: FeeSnapshot = {
  tiers: {
    baseFee: 100,
    low: 150,
    recommended: 300,
    fast: 500,
    percentiles: { low: "p50", recommended: "p90", fast: "p99" },
  },
  congestion: "medium",
  ledgerCapacityUsage: 0.6,
  source: "horizon",
  stale: false,
  fetchedAt: "2026-10-17T00:00:00.000Z",
  basis: "p90 of recently charged fees · ledger 60% full (medium congestion)",
};

function renderSelector(
  selection: FeeSelection = { tier: "recommended", fee: 300 }
) {
  const onChange = vi.fn();
  render(
    <FeeSelector
      snapshot={snapshot}
      selection={selection}
      onChange={onChange}
      operations={1}
    />
  );
  return { onChange };
}

describe("FeeSelector (issue #1373)", () => {
  it("shows each tier in stroops and XLM", () => {
    renderSelector();

    expect(screen.getByText(/150 stroops/)).toBeInTheDocument();
    expect(screen.getByText("0.000015 XLM")).toBeInTheDocument();
    expect(screen.getByText(/300 stroops/)).toBeInTheDocument();
    expect(screen.getByText("0.00003 XLM")).toBeInTheDocument();
    expect(screen.getByText(/500 stroops/)).toBeInTheDocument();
    expect(screen.getByText("0.00005 XLM")).toBeInTheDocument();
    expect(screen.getByTestId("fee-selector-basis")).toHaveTextContent(
      /p90 of recently charged fees/
    );
  });

  it("selects the Fast tier with its live fee", () => {
    const { onChange } = renderSelector();
    fireEvent.click(screen.getByRole("radio", { name: /fast/i }));

    expect(onChange).toHaveBeenCalledWith({ tier: "fast", fee: 500 });
  });

  it("rejects a custom fee below the network base fee", () => {
    const { onChange } = renderSelector({ tier: "custom", fee: null });
    const input = screen.getByLabelText(/custom fee in stroops/i);

    fireEvent.change(input, { target: { value: "50" } });

    expect(onChange).toHaveBeenLastCalledWith({ tier: "custom", fee: null });
    expect(screen.getByRole("alert")).toHaveTextContent(/at least the network base fee/i);
  });

  it("accepts a valid custom fee", () => {
    const { onChange } = renderSelector({ tier: "custom", fee: null });
    const input = screen.getByLabelText(/custom fee in stroops/i);

    fireEvent.change(input, { target: { value: "250" } });

    expect(onChange).toHaveBeenLastCalledWith({ tier: "custom", fee: 250 });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("seeds the custom field from the base fee when custom is selected", () => {
    function StatefulSelector() {
      const [selection, setSelection] = useState<FeeSelection>({
        tier: "recommended",
        fee: 300,
      });
      return (
        <FeeSelector
          snapshot={snapshot}
          selection={selection}
          onChange={setSelection}
        />
      );
    }

    render(<StatefulSelector />);
    fireEvent.click(screen.getByRole("radio", { name: /custom fee/i }));

    expect(screen.getByLabelText(/custom fee in stroops/i)).toHaveValue(100);
  });

  it("shows a loading placeholder before the first sample", () => {
    render(
      <FeeSelector
        snapshot={null}
        selection={{ tier: "recommended", fee: null }}
        onChange={vi.fn()}
        loading
      />
    );

    expect(
      screen.getByRole("status", { name: /loading network fee estimates/i })
    ).toBeInTheDocument();
  });
});
