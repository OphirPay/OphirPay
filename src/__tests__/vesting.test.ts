// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import {
  computeClaimable,
  computeVested,
  simulateAt,
  vestingPercent,
} from "@/lib/vesting";

const START = BigInt(1_000_000);
const END = BigInt(1_001_000);
const TOTAL = BigInt(1_000_000_000); // 100 XLM in stroops

describe("computeVested", () => {
  it("vests nothing at or before the start", () => {
    expect(computeVested(TOTAL, START, END, START)).toBe(BigInt(0));
    expect(computeVested(TOTAL, START, END, START - BigInt(1))).toBe(BigInt(0));
  });

  it("vests everything at or after the end", () => {
    expect(computeVested(TOTAL, START, END, END)).toBe(TOTAL);
    expect(computeVested(TOTAL, START, END, END + BigInt(500))).toBe(TOTAL);
  });

  it("vests linearly at the midpoint", () => {
    expect(
      computeVested(TOTAL, START, END, START + BigInt(500))
    ).toBe(TOTAL / BigInt(2));
  });

  it("truncates like integer division (the contract's floor)", () => {
    // 100 * 1 / 3 = 33.33… → 33 in both Rust i128 and BigInt.
    expect(computeVested(BigInt(100), BigInt(0), BigInt(3), BigInt(1))).toBe(
      BigInt(33)
    );
  });

  it("matches floor(a*b/d) for amounts beyond 2^53", () => {
    const total = BigInt(2) ** BigInt(100);
    const now = START + BigInt(333);
    expect(computeVested(total, START, END, now)).toBe(
      (total * BigInt(333)) / BigInt(1000)
    );
  });

  it("returns zero for a non-positive total or a zero-length window", () => {
    expect(computeVested(BigInt(0), START, END, START + BigInt(500))).toBe(
      BigInt(0)
    );
    expect(
      computeVested(TOTAL, START, START, START + BigInt(500))
    ).toBe(TOTAL);
  });
});

describe("computeClaimable", () => {
  const base = {
    total: TOTAL,
    claimed: BigInt(0),
    start: START,
    end: END,
    now: START + BigInt(500),
  };

  it("subtracts what was already claimed", () => {
    expect(
      computeClaimable({ ...base, claimed: BigInt(10_000_000) })
    ).toBe(BigInt(490_000_000));
  });

  it("never reports a negative claimable balance", () => {
    expect(computeClaimable({ ...base, claimed: TOTAL })).toBe(BigInt(0));
  });

  it("pays nothing once a stream is cancelled", () => {
    expect(computeClaimable({ ...base, cancelled: true })).toBe(BigInt(0));
  });
});

describe("vestingPercent", () => {
  it("returns 0–100 with two decimals", () => {
    expect(vestingPercent(BigInt(50), BigInt(200))).toBe(25);
    expect(vestingPercent(BigInt(1), BigInt(3))).toBe(33.33);
  });

  it("clamps out-of-range values and guards a zero total", () => {
    expect(vestingPercent(BigInt(200), BigInt(100))).toBe(100);
    expect(vestingPercent(BigInt(-5), BigInt(100))).toBe(0);
    expect(vestingPercent(BigInt(1), BigInt(0))).toBe(0);
  });
});

describe("simulateAt", () => {
  it("moves the clock forward without changing claimed amounts", () => {
    const state = {
      total: TOTAL,
      claimed: BigInt(5),
      start: START,
      end: END,
      now: START,
    };
    const future = simulateAt(state, END);
    expect(future.now).toBe(END);
    expect(future.claimed).toBe(BigInt(5));
  });

  it("never simulates into the past or onto a cancelled stream", () => {
    const state = {
      total: TOTAL,
      claimed: BigInt(0),
      start: START,
      end: END,
      now: START + BigInt(500),
      cancelled: true,
    };
    const simulated = simulateAt(state, START);
    expect(simulated.now).toBe(state.now);
    expect(simulated.cancelled).toBe(false);
  });
});
