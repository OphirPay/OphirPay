// SPDX-License-Identifier: MIT

import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  VestingProgressChart,
  computeVestedAmount,
} from "@/components/streams/VestingProgressChart";

describe("VestingProgressChart & Linear Vesting Math", () => {
  const total = BigInt(10_000_000); // 1 XLM in stroops
  const start = BigInt(1000);
  const end = BigInt(2000); // 1000s duration
  const cliff = BigInt(1250); // 250s cliff

  describe("computeVestedAmount calculation", () => {
    it("returns 0 before or at stream start time", () => {
      expect(computeVestedAmount(total, start, end, BigInt(999))).toBe(BigInt(0));
      expect(computeVestedAmount(total, start, end, start)).toBe(BigInt(0));
    });

    it("returns 0 if before cliff time", () => {
      expect(computeVestedAmount(total, start, end, BigInt(1100), cliff)).toBe(BigInt(0));
      expect(computeVestedAmount(total, start, end, BigInt(1249), cliff)).toBe(BigInt(0));
    });

    it("calculates accurate linear vesting at quarter intervals", () => {
      // 25% (1250s)
      expect(computeVestedAmount(total, start, end, BigInt(1250))).toBe(BigInt(2_500_000));
      // 50% (1500s)
      expect(computeVestedAmount(total, start, end, BigInt(1500))).toBe(BigInt(5_000_000));
      // 75% (1750s)
      expect(computeVestedAmount(total, start, end, BigInt(1750))).toBe(BigInt(7_500_000));
    });

    it("returns total amount at or after stream end time", () => {
      expect(computeVestedAmount(total, start, end, end)).toBe(total);
      expect(computeVestedAmount(total, start, end, BigInt(3000))).toBe(total);
    });

    it("guards against zero or negative duration safely", () => {
      expect(computeVestedAmount(total, start, start, BigInt(1500))).toBe(total);
      expect(computeVestedAmount(total, end, start, BigInt(1500))).toBe(total);
    });
  });

  describe("VestingProgressChart Component Rendering", () => {
    it("renders vesting progress chart and SVG elements", () => {
      const { container } = render(
        <VestingProgressChart
          totalAmount={total}
          claimedAmount={BigInt(0)}
          startTime={Number(start)}
          endTime={Number(end)}
        />
      );

      const svg = container.querySelector("svg");
      expect(svg).toBeDefined();
      expect(screen.getByText(/Live Claimable Balance/i)).toBeDefined();
      expect(screen.getByText(/Simulate Future Date/i)).toBeDefined();
    });

    it("renders cliff marker when cliffTime is provided", () => {
      const { container } = render(
        <VestingProgressChart
          totalAmount={total}
          claimedAmount={BigInt(0)}
          startTime={Number(start)}
          endTime={Number(end)}
          cliffTime={Number(cliff)}
        />
      );

      expect(screen.getByText("Cliff")).toBeDefined();
    });

    it("updates claimable amount when simulator slider changes", () => {
      render(
        <VestingProgressChart
          totalAmount={total}
          claimedAmount={BigInt(0)}
          startTime={Number(start)}
          endTime={Number(end)}
        />
      );

      const slider = screen.getByRole("slider");
      expect(slider).toBeDefined();

      // Simulate moving slider to halfway point (1500)
      fireEvent.change(slider, { target: { value: "1500" } });
      expect(screen.getByText(/Active Simulation/i)).toBeDefined();
    });

    it("triggers onClaim callback when claim button clicked", () => {
      const onClaim = vi.fn();
      render(
        <VestingProgressChart
          totalAmount={total}
          claimedAmount={BigInt(0)}
          startTime={100} // Past start
          endTime={200} // Past end -> 100% claimable
          onClaim={onClaim}
        />
      );

      const claimBtn = screen.getByRole("button", { name: /Claim XLM/i });
      fireEvent.click(claimBtn);
      expect(onClaim).toHaveBeenCalledTimes(1);
    });
  });
});
