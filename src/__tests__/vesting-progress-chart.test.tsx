// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, renderHook, act } from "@testing-library/react";
import React from "react";
import {
  calculateVestedStroops,
  useVestingTicker,
} from "@/hooks/useCountdown";
import { VestingProgressChart } from "@/components/streams/VestingProgressChart";
import StreamDetailPage from "@/app/streams/[id]/page";

// Mock wallet
vi.mock("@/hooks/useMultiWallet", () => ({
  useWallet: () => ({
    wallet: {
      connected: true,
      publicKey: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    },
  }),
}));

describe("Vesting Contract Math Formula (calculateVestedStroops)", () => {
  const total = BigInt(10_000_000_000); // 1,000 XLM in stroops
  const start = BigInt(1000);
  const end = BigInt(2000);

  it("returns 0 before start time", () => {
    expect(calculateVestedStroops(total, start, end, BigInt(999))).toBe(BigInt(0));
    expect(calculateVestedStroops(total, start, end, BigInt(500))).toBe(BigInt(0));
  });

  it("returns 0 before cliff time when cliff is specified", () => {
    const cliff = BigInt(1250); // 25% cliff
    expect(calculateVestedStroops(total, start, end, BigInt(1100), cliff)).toBe(BigInt(0));
    expect(calculateVestedStroops(total, start, end, BigInt(1249), cliff)).toBe(BigInt(0));
    expect(calculateVestedStroops(total, start, end, BigInt(1250), cliff)).toBe(BigInt(2_500_000_000));
  });

  it("calculates exact proportional fraction during active linear vesting", () => {
    // 50% elapsed
    const mid = BigInt(1500);
    expect(calculateVestedStroops(total, start, end, mid)).toBe(BigInt(5_000_000_000));

    // 75% elapsed
    const q3 = BigInt(1750);
    expect(calculateVestedStroops(total, start, end, q3)).toBe(BigInt(7_500_000_000));
  });

  it("caps at total amount at or after end time", () => {
    expect(calculateVestedStroops(total, start, end, BigInt(2000))).toBe(total);
    expect(calculateVestedStroops(total, start, end, BigInt(9999))).toBe(total);
  });
});

describe("useVestingTicker Hook", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("calculates live vested, claimable and progress percentage", () => {
    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    const total = BigInt(10_000_000);
    const start = nowSec - BigInt(500);
    const end = nowSec + BigInt(500); // now is 50%
    const claimed = BigInt(2_000_000);

    const { result } = renderHook(() =>
      useVestingTicker({
        start,
        end,
        total,
        claimed,
      })
    );

    expect(result.current.hasStarted).toBe(true);
    expect(result.current.isComplete).toBe(false);
    expect(result.current.percent).toBeCloseTo(50, 0);
    expect(result.current.vested).toBeGreaterThanOrEqual(BigInt(4_900_000));
    expect(result.current.claimable).toBeGreaterThanOrEqual(BigInt(2_900_000));
  });

  it("ticks forward on interval", () => {
    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    const total = BigInt(10_000_000);
    const start = nowSec;
    const end = nowSec + BigInt(100);

    const { result } = renderHook(() =>
      useVestingTicker({
        start,
        end,
        total,
        intervalMs: 1000,
      })
    );

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.currentTime).toBeDefined();
  });
});

describe("VestingProgressChart Component (Issue #1377)", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const defaultProps = {
    streamId: 42,
    totalAmount: BigInt(10_000_000_000), // 1,000 XLM
    claimedAmount: BigInt(2_000_000_000), // 200 XLM
    startTime: nowSec - BigInt(3600), // 1 hr ago
    endTime: nowSec + BigInt(3600), // 1 hr in future (50% elapsed)
    cliffTime: nowSec - BigInt(1800), // 30 min ago
  };

  it("renders stream details, allocation metrics, and SVG timeline markers", () => {
    render(<VestingProgressChart {...defaultProps} />);

    expect(screen.getByText("Vesting Timeline & Claim Simulator")).toBeInTheDocument();
    expect(screen.getByText("#42")).toBeInTheDocument();
    expect(screen.getByText(/Total Allocation/i)).toBeInTheDocument();
    expect(screen.getByText(/Claimable Balance/i)).toBeInTheDocument();

    // Verify SVG graph accessibility
    const svg = screen.getByLabelText("Vesting Progress Graph");
    expect(svg).toBeInTheDocument();
  });

  it("updates claimable calculation dynamically when simulating future dates", async () => {
    render(<VestingProgressChart {...defaultProps} />);

    const slider = screen.getByLabelText("Vesting Simulation Date Slider");
    expect(slider).toBeInTheDocument();

    // Initial state: not simulating
    expect(screen.queryByText("Reset to Live")).not.toBeInTheDocument();

    // Simulate to 100% maturity
    fireEvent.change(slider, { target: { value: "100" } });

    // Should indicate simulation mode
    expect(screen.getByText("Simulating future maturity")).toBeInTheDocument();
    expect(screen.getByText("Reset to Live")).toBeInTheDocument();

    // At 100%, vested is 1,000 XLM, claimed is 200 XLM, claimable should be 800 XLM
    const claimableEl = screen.getByTestId("claimable-balance");
    expect(claimableEl.textContent).toContain("800");

    // Click Reset to Live
    const resetBtn = screen.getByText("Reset to Live");
    fireEvent.click(resetBtn);

    expect(screen.queryByText("Reset to Live")).not.toBeInTheDocument();
    expect(screen.getByText("Live real-time linear vesting")).toBeInTheDocument();
  });
});

import { ToastProvider } from "@/components/ui/Toast";

describe("StreamDetailPage (/streams/[id]) Integration", () => {
  it("renders stream detail page with VestingProgressChart", async () => {
    const params = Promise.resolve({ id: "101" });
    render(
      <ToastProvider>
        <StreamDetailPage params={params} />
      </ToastProvider>
    );

    expect(await screen.findByText("Payment Stream #101")).toBeInTheDocument();
    expect(screen.getByText(/← Back to Streams/i)).toBeInTheDocument();
    expect(screen.getByText("Contract Details")).toBeInTheDocument();
    expect(screen.getByLabelText("Vesting Progress Graph")).toBeInTheDocument();
  });
});
