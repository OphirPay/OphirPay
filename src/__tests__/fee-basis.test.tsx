// SPDX-License-Identifier: MIT
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import FeeBasis from "@/components/FeeBasis";

describe("FeeBasis (issue #825)", () => {
  it("surfaces the fee that will be signed", () => {
    render(<FeeBasis baseFee="150" congestion="medium" basis="p70 of recent fees" />);
    expect(screen.getByTestId("fee-basis")).toHaveAttribute("data-fee-base", "150");
    expect(screen.getByText(/150 stroops/)).toBeInTheDocument();
  });

  it("explains why the fee was chosen", () => {
    render(<FeeBasis baseFee="900" congestion="high" basis="congestion high: p90 of recent fees" />);
    expect(screen.getByTestId("fee-basis-reason")).toHaveTextContent("p90 of recent fees");
    expect(screen.getByTestId("fee-congestion")).toHaveTextContent("high");
  });

  it("marks an unreachable Horizon with a visible indication", () => {
    render(<FeeBasis baseFee="100" source="fallback" stale />);
    const root = screen.getByTestId("fee-basis");
    expect(root).toHaveAttribute("data-fee-stale", "true");
    expect(screen.getByTestId("fee-stale-badge")).toHaveTextContent("fallback");
    expect(screen.getByTestId("fee-stale-note")).toBeInTheDocument();
  });

  it("marks a cached value without claiming it is live", () => {
    render(<FeeBasis baseFee="120" source="cache" stale />);
    expect(screen.getByTestId("fee-basis")).toHaveAttribute("data-fee-source", "cache");
    expect(screen.getByTestId("fee-stale-badge")).toHaveTextContent("cached");
  });

  it("does not show a degraded badge when Horizon answered live", () => {
    render(<FeeBasis baseFee="100" source="horizon" />);
    expect(screen.queryByTestId("fee-stale-badge")).not.toBeInTheDocument();
  });
});
