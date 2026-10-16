// SPDX-License-Identifier: MIT
// Tests for issue #1377: VestingProgressChart component
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { VestingProgressChart } from "@/components/streams/VestingProgressChart";

// Mock the stellar-amount module
vi.mock("@/lib/stellar-amount", () => ({
  formatXlmStroops: (n: bigint) => `${Number(n) / 1e7} XLM`,
}));

describe("VestingProgressChart", () => {
  const now = Math.floor(Date.now() / 1000);
  const startTime = BigInt(now - 3600); // 1 hour ago
  const endTime = BigInt(now + 3600); // 1 hour from now
  const totalAmount = BigInt(10_000_000); // 1 XLM
  const claimedAmount = BigInt(2_000_000); // 0.2 XLM

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now * 1000));
  });

  it("renders the vesting chart with all metric cards", () => {
    render(
      <VestingProgressChart
        streamId={1}
        totalAmount={totalAmount}
        startTime={startTime}
        endTime={endTime}
        claimedAmount={claimedAmount}
        cancelled={false}
      />,
    );

    // Should show total, vested, claimable, and claimed amounts
    expect(screen.getByText("1 XLM")).toBeInTheDocument();
    expect(screen.getByText("0.5 XLM")).toBeInTheDocument(); // vested at 50% (midpoint)
    expect(screen.getByText("0.3 XLM")).toBeInTheDocument(); // claimable = vested - claimed
  });

  it("renders SVG chart with proper accessibility", () => {
    const { container } = render(
      <VestingProgressChart
        streamId={1}
        totalAmount={totalAmount}
        startTime={startTime}
        endTime={endTime}
        claimedAmount={claimedAmount}
        cancelled={false}
      />,
    );

    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute("role", "img");
    expect(svg).toHaveAttribute("aria-label");
  });

  it("shows Active status for in-progress stream", () => {
    render(
      <VestingProgressChart
        streamId={1}
        totalAmount={totalAmount}
        startTime={startTime}
        endTime={endTime}
        claimedAmount={claimedAmount}
        cancelled={false}
      />,
    );

    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("shows Cancelled status for cancelled stream", () => {
    render(
      <VestingProgressChart
        streamId={1}
        totalAmount={totalAmount}
        startTime={startTime}
        endTime={endTime}
        claimedAmount={claimedAmount}
        cancelled={true}
      />,
    );

    expect(screen.getAllByText("Cancelled").length).toBeGreaterThan(0);
  });

  it("shows Fully Vested status when progress is 100%", () => {
    render(
      <VestingProgressChart
        streamId={1}
        totalAmount={totalAmount}
        startTime={BigInt(now - 7200)}
        endTime={BigInt(now - 3600)}
        claimedAmount={BigInt(0)}
        cancelled={false}
      />,
    );

    expect(screen.getByText("Fully Vested")).toBeInTheDocument();
  });

  it("shows Not Started status when start is in the future", () => {
    render(
      <VestingProgressChart
        streamId={1}
        totalAmount={totalAmount}
        startTime={BigInt(now + 3600)}
        endTime={BigInt(now + 7200)}
        claimedAmount={BigInt(0)}
        cancelled={false}
      />,
    );

    expect(screen.getByText("Not Started")).toBeInTheDocument();
  });

  it("renders the future date simulator input", () => {
    render(
      <VestingProgressChart
        streamId={1}
        totalAmount={totalAmount}
        startTime={startTime}
        endTime={endTime}
        claimedAmount={claimedAmount}
        cancelled={false}
      />,
    );

    expect(screen.getByText("Simulate Future Date")).toBeInTheDocument();
    expect(screen.getByTestId("simulated-date-input")).toBeInTheDocument();
  });
});
