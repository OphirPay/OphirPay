// SPDX-License-Identifier: MIT
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  VestingProgressChart,
  calculateVestingAtTimestamp,
  type VestingStreamConfig,
} from "@/components/streams/VestingProgressChart";
import StreamDetailPage from "@/app/streams/[id]/page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "42" }),
}));

const SAMPLE_STREAM: VestingStreamConfig = {
  id: "42",
  totalAmount: 1000,
  claimedAmount: 100,
  assetCode: "XLM",
  startTime: 1000,
  cliffTime: 1200,
  endTime: 2000,
};

describe("Interactive Vesting Timeline & Claim Simulator (#1377)", () => {
  it("calculates exact vested, claimable, and locked balances across start, cliff, linear, and end timestamps", () => {
    // Before cliff (timestamp = 1100 < cliff 1200) -> 0 vested
    const beforeCliff = calculateVestingAtTimestamp(SAMPLE_STREAM, 1100);
    expect(beforeCliff.vestedAmount).toBe(0);
    expect(beforeCliff.claimableAmount).toBe(0);
    expect(beforeCliff.beforeCliff).toBe(true);

    // At 50% duration (timestamp = 1500) -> 500 vested, 400 claimable (500 - 100 claimed)
    const halfway = calculateVestingAtTimestamp(SAMPLE_STREAM, 1500);
    expect(halfway.vestedAmount).toBe(500);
    expect(halfway.claimableAmount).toBe(400);
    expect(halfway.lockedAmount).toBe(500);
    expect(halfway.vestedPercent).toBe(50);

    // At/after endTime (timestamp = 2000) -> 1000 vested, 900 claimable
    const completed = calculateVestingAtTimestamp(SAMPLE_STREAM, 2000);
    expect(completed.vestedAmount).toBe(1000);
    expect(completed.claimableAmount).toBe(900);
    expect(completed.fullyVested).toBe(true);
  });

  it("renders SVG vesting timeline markers (start, cliff, current, end) and updates simulated claimable balance via slider", () => {
    render(
      <VestingProgressChart stream={SAMPLE_STREAM} initialNowSec={1500} />
    );

    expect(screen.getByTestId("vesting-progress-svg")).toBeInTheDocument();
    expect(screen.getByTestId("marker-start")).toBeInTheDocument();
    expect(screen.getByTestId("marker-cliff")).toBeInTheDocument();
    expect(screen.getByTestId("marker-current")).toBeInTheDocument();
    expect(screen.getByTestId("marker-end")).toBeInTheDocument();

    // Live claimable balance at t=1500 is 400.00 XLM
    expect(screen.getByTestId("live-claimable-balance")).toHaveTextContent(
      "400.00 XLM"
    );

    // Move "Simulate Future Date" slider to 75% (t=1750 -> 750 vested - 100 claimed = 650 XLM)
    const slider = screen.getByTestId("simulate-date-slider");
    fireEvent.change(slider, { target: { value: "1750" } });

    expect(screen.getByTestId("simulated-vested-balance")).toHaveTextContent(
      "750.00 XLM"
    );
    expect(screen.getByTestId("simulated-claimable-balance")).toHaveTextContent(
      "650.00 XLM"
    );
    expect(screen.getByTestId("simulated-locked-balance")).toHaveTextContent(
      "250.00 XLM"
    );
  });

  it("integrates VestingProgressChart into src/app/streams/[id]/page.tsx", () => {
    render(
      <StreamDetailPage streamOverride={SAMPLE_STREAM} initialNowSec={1600} />
    );
    expect(screen.getByTestId("stream-detail-page")).toBeInTheDocument();
    expect(screen.getByText(/Payment Stream #42/i)).toBeInTheDocument();
    expect(screen.getByTestId("live-claimable-balance")).toHaveTextContent(
      "500.00 XLM"
    );
  });
});
