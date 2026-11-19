// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { VestingProgressChart } from "@/components/streams/VestingProgressChart";

const START = 1_000_000;
const END = START + 1_000;
const TOTAL = BigInt(1_000_000_000); // 100 XLM
const HALFWAY_MS = (START + 500) * 1000;

function renderChart(overrides: Partial<Parameters<typeof VestingProgressChart>[0]> = {}) {
  return render(
    <VestingProgressChart
      totalAmount={TOTAL}
      claimedAmount={BigInt(0)}
      startTime={START}
      endTime={END}
      tickMs={0}
      now={() => HALFWAY_MS}
      {...overrides}
    />
  );
}

describe("VestingProgressChart (issue #1377)", () => {
  it("reports the live vested and claimable amounts", () => {
    renderChart();

    expect(
      screen.getByRole("img", { name: /50\.00 percent vested/i })
    ).toBeInTheDocument();
    expect(screen.getByTestId("live-claimable")).toHaveTextContent("50.00 XLM");
    expect(screen.getByText("50.00% vested")).toBeInTheDocument();
  });

  it("subtracts already-claimed tokens from the claimable balance", () => {
    renderChart({ claimedAmount: BigInt(100_000_000) });
    expect(screen.getByTestId("live-claimable")).toHaveTextContent("40.00 XLM");
  });

  it("simulates the claimable amount at a future date", () => {
    renderChart();

    const slider = screen.getByLabelText(/simulate future date/i);
    fireEvent.change(slider, { target: { value: String(END) } });

    expect(screen.getByTestId("simulated-claimable")).toHaveTextContent(
      "100.00 XLM"
    );
  });

  it("interpolates the simulator at an arbitrary timestamp", () => {
    renderChart();

    const slider = screen.getByLabelText(/simulate future date/i);
    fireEvent.change(slider, { target: { value: String(START + 750) } });

    expect(screen.getByTestId("simulated-claimable")).toHaveTextContent(
      "75.00 XLM"
    );
  });

  it("draws a cliff marker only when the stream has a cliff", () => {
    const { rerender } = renderChart();
    expect(screen.queryByText("cliff")).toBeNull();

    rerender(
      <VestingProgressChart
        totalAmount={TOTAL}
        claimedAmount={BigInt(0)}
        startTime={START}
        endTime={END}
        cliffTime={START + 250}
        tickMs={0}
        now={() => HALFWAY_MS}
      />
    );
    expect(screen.getByText("cliff")).toBeInTheDocument();
  });

  it("pays nothing and hides the simulator for a cancelled stream", () => {
    renderChart({ cancelled: true });

    expect(screen.getByTestId("live-claimable")).toHaveTextContent("0.00 XLM");
    expect(screen.queryByLabelText(/simulate future date/i)).toBeNull();
    expect(screen.getByText(/vesting stopped/i)).toBeInTheDocument();
  });
});
