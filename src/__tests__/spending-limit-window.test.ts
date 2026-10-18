// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { PaymentError } from "@/types/errors";
import { CONTRACT_ERROR_MAP, decodeContractError } from "@/lib/contract-errors";

const DAY_SECONDS = 86_400;
const MONTH_SECONDS = 30 * DAY_SECONDS;

function ledgerDayWindow(timestamp: number): number {
  return Math.floor(timestamp / DAY_SECONDS) * DAY_SECONDS;
}

function ledgerMonthWindow(timestamp: number): number {
  return Math.floor(timestamp / MONTH_SECONDS) * MONTH_SECONDS;
}

interface SimulatedSpendingLimit {
  dailyLimit: bigint;
  monthlyLimit: bigint;
  currentDailySpend: bigint;
  currentMonthlySpend: bigint;
  lastResetDay: number;
  lastResetMonth: number;
  isActive: boolean;
  expiresAt: number;
}

function checkAndUpdateSpendingLimit(
  limit: SimulatedSpendingLimit,
  amount: bigint,
  now: number,
): { success: boolean; error?: string } {
  if (!limit.isActive) {
    return { success: false, error: "SpendingLimitExpired" };
  }
  if (limit.expiresAt !== 0 && now >= limit.expiresAt) {
    return { success: false, error: "SpendingLimitExpired" };
  }

  // Sliding window daily reset
  if (ledgerDayWindow(limit.lastResetDay) < ledgerDayWindow(now)) {
    limit.currentDailySpend = BigInt(0);
    limit.lastResetDay = now;
  }

  // Sliding window monthly reset
  if (ledgerMonthWindow(limit.lastResetMonth) < ledgerMonthWindow(now)) {
    limit.currentMonthlySpend = BigInt(0);
    limit.lastResetMonth = now;
  }

  const newDaily = limit.currentDailySpend + amount;
  const newMonthly = limit.currentMonthlySpend + amount;

  if (newDaily > limit.dailyLimit || newMonthly > limit.monthlyLimit) {
    return { success: false, error: "SpendingLimitExceeded" };
  }

  limit.currentDailySpend = newDaily;
  limit.currentMonthlySpend = newMonthly;
  return { success: true };
}

describe("Sliding-Window Spending Limit (#1313)", () => {
  it("recognizes SpendingLimitExceeded (310) in contract error catalog", () => {
    expect(PaymentError.SpendingLimitExceeded).toBe(310);
    expect(CONTRACT_ERROR_MAP["310"]).toContain("Spending limit exceeded");
    expect(decodeContractError("Error(Contract, #310)")).toContain("Spending limit exceeded");
  });

  it("calculates discrete 86,400s ledger day windows", () => {
    const t0 = 100_000;
    const window0 = ledgerDayWindow(t0);
    expect(window0).toBe(86_400);

    const tWithinDay = 100_000 + 3600; // 1 hour later
    expect(ledgerDayWindow(tWithinDay)).toBe(86_400);

    const tNextDay = 100_000 + 86_400; // 24 hours later
    expect(ledgerDayWindow(tNextDay)).toBe(172_800);
  });

  it("resets daily cumulative spend cleanly across multi-day gaps", () => {
    const t0 = 100_000;
    const state: SimulatedSpendingLimit = {
      dailyLimit: BigInt(1000),
      monthlyLimit: BigInt(10_000),
      currentDailySpend: BigInt(0),
      currentMonthlySpend: BigInt(0),
      lastResetDay: t0,
      lastResetMonth: t0,
      isActive: true,
      expiresAt: 0,
    };

    // First spend: 600
    const res1 = checkAndUpdateSpendingLimit(state, BigInt(600), t0);
    expect(res1.success).toBe(true);
    expect(state.currentDailySpend).toBe(BigInt(600));

    // Second spend within same window exceeding daily capacity: 500
    const res2 = checkAndUpdateSpendingLimit(state, BigInt(500), t0 + 1000);
    expect(res2.success).toBe(false);
    expect(res2.error).toBe("SpendingLimitExceeded");
    expect(state.currentDailySpend).toBe(BigInt(600)); // Unmodified

    // Advance 3 days into future (+259,200 seconds)
    const tFuture = t0 + 3 * 86_400;
    const res3 = checkAndUpdateSpendingLimit(state, BigInt(500), tFuture);
    expect(res3.success).toBe(true);
    expect(state.currentDailySpend).toBe(BigInt(500)); // Reset to 0 then incremented by 500
    expect(state.currentMonthlySpend).toBe(BigInt(1100)); // 600 + 500
  });

  it("reverts batch processing upfront if total batch sum exceeds daily limit", () => {
    const t0 = 100_000;
    const state: SimulatedSpendingLimit = {
      dailyLimit: BigInt(1000),
      monthlyLimit: BigInt(5000),
      currentDailySpend: BigInt(0),
      currentMonthlySpend: BigInt(0),
      lastResetDay: t0,
      lastResetMonth: t0,
      isActive: true,
      expiresAt: 0,
    };

    const batchAmounts = [BigInt(600), BigInt(500)]; // Total: 1100 > 1000
    const totalBatchSum = batchAmounts.reduce((acc, a) => acc + a, BigInt(0));

    const res = checkAndUpdateSpendingLimit(state, totalBatchSum, t0);
    expect(res.success).toBe(false);
    expect(res.error).toBe("SpendingLimitExceeded");
    // Ensure atomicity: zero funds debited
    expect(state.currentDailySpend).toBe(BigInt(0));
  });
});
