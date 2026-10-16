// SPDX-License-Identifier: MIT
import { describe, it, expect } from "vitest";
import { calculateVestedAmount } from "@/components/streams/VestingProgressChart";

describe("calculateVestedAmount linear formula", () => {
  const total = 1000;
  const start = 1000;
  const end = 2000; // duration 1000s

  it("returns 0 before or at stream start time", () => {
    expect(calculateVestedAmount(total, start, end, 500)).toBe(0);
    expect(calculateVestedAmount(total, start, end, 1000)).toBe(0);
  });

  it("returns exact 50% at midpoint", () => {
    expect(calculateVestedAmount(total, start, end, 1500)).toBe(500);
  });

  it("returns exact 25% and 75% at quarter intervals", () => {
    expect(calculateVestedAmount(total, start, end, 1250)).toBe(250);
    expect(calculateVestedAmount(total, start, end, 1750)).toBe(750);
  });

  it("caps at total amount at or after stream end time", () => {
    expect(calculateVestedAmount(total, start, end, 2000)).toBe(1000);
    expect(calculateVestedAmount(total, start, end, 3000)).toBe(1000);
  });
});
