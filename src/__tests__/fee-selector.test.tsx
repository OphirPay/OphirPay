// SPDX-License-Identifier: MIT
import { describe, it, expect } from "vitest";
import { stroopsToXlm } from "@/hooks/useFeeStats";

describe("Fee estimation calculations", () => {
  it("converts stroops to XLM with proper decimal precision", () => {
    expect(stroopsToXlm(100)).toBe("0.00001");
    expect(stroopsToXlm(250)).toBe("0.000025");
    expect(stroopsToXlm(10_000_000)).toBe("1");
    expect(stroopsToXlm(15_000_000)).toBe("1.5");
  });

  it("handles fractional stroop ratios without rounding errors", () => {
    expect(stroopsToXlm(500)).toBe("0.00005");
    expect(stroopsToXlm(1_000)).toBe("0.0001");
  });
});
