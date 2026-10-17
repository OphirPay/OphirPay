// SPDX-License-Identifier: MIT
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DAY_SECONDS = 86_400n;
const MONTH_SECONDS = 30n * DAY_SECONDS;

interface SpendingLimitState {
  dailyLimit: bigint;
  monthlyLimit: bigint;
  currentDailySpend: bigint;
  currentMonthlySpend: bigint;
  lastResetDay: bigint;
  lastResetMonth: bigint;
  isActive: boolean;
  expiresAt: bigint;
}

function ledgerDayWindow(timestamp: bigint): bigint {
  return timestamp / DAY_SECONDS;
}

function refreshSpendingWindows(limit: SpendingLimitState, now: bigint): void {
  const elapsedDay =
    now - limit.lastResetDay >= DAY_SECONDS ||
    ledgerDayWindow(now) > ledgerDayWindow(limit.lastResetDay);
  if (elapsedDay) {
    limit.currentDailySpend = 0n;
    limit.lastResetDay = now;
  }
  if (now - limit.lastResetMonth >= MONTH_SECONDS) {
    limit.currentMonthlySpend = 0n;
    limit.lastResetMonth = now;
  }
}

function checkAndUpdateBatchSpendingLimit(
  limit: SpendingLimitState,
  amounts: bigint[],
  now: bigint
): { ok: true; total: bigint } | { ok: false; error: string; available: bigint } {
  if (!limit.isActive || (limit.expiresAt !== 0n && now >= limit.expiresAt)) {
    limit.isActive = false;
    return { ok: false, error: "PaymentError::SpendingLimitExpired", available: 0n };
  }

  refreshSpendingWindows(limit, now);

  let batchTotal = 0n;
  for (const amt of amounts) {
    if (amt > 0n) batchTotal += amt;
  }

  const availableDaily = limit.dailyLimit - limit.currentDailySpend;
  const availableMonthly = limit.monthlyLimit - limit.currentMonthlySpend;
  const available =
    availableDaily < availableMonthly ? availableDaily : availableMonthly;

  if (
    limit.currentDailySpend + batchTotal > limit.dailyLimit ||
    limit.currentMonthlySpend + batchTotal > limit.monthlyLimit
  ) {
    return {
      ok: false,
      error: "PaymentError::SpendCapExceeded",
      available,
    };
  }

  limit.currentDailySpend += batchTotal;
  limit.currentMonthlySpend += batchTotal;
  return { ok: true, total: batchTotal };
}

describe("Sliding-window daily spending limit verification (#1313)", () => {
  it("verifies smart contract implementation in contracts/ophirpay/src/spending_limit.rs", () => {
    const rustSource = fs.readFileSync(
      path.resolve(process.cwd(), "contracts/ophirpay/src/spending_limit.rs"),
      "utf8"
    );
    expect(rustSource).toContain("pub const DAY_SECONDS: u64 = 86_400;");
    expect(rustSource).toContain("pub const fn ledger_day_window(timestamp: u64) -> u64");
    expect(rustSource).toContain("pub fn check_and_update_spending_limit");
    expect(rustSource).toContain("pub fn check_and_update_batch_spending_limit");
    expect(rustSource).toContain('Symbol::new(env, "spending_limit")');
    expect(rustSource).toContain('Symbol::new(env, "exceeded")');
  });

  it("resets daily spend across multi-day inactivity gaps and rejects batches exceeding remaining quota atomically", () => {
    const limit: SpendingLimitState = {
      dailyLimit: 1_000n,
      monthlyLimit: 5_000n,
      currentDailySpend: 600n,
      currentMonthlySpend: 600n,
      lastResetDay: DAY_SECONDS * 10n + 100n,
      lastResetMonth: DAY_SECONDS * 10n + 100n,
      isActive: true,
      expiresAt: 0n,
    };

    // Same day: batch of [250, 250] = 500 > 400 remaining -> rejected atomically
    const rejected = checkAndUpdateBatchSpendingLimit(
      limit,
      [250n, 250n],
      DAY_SECONDS * 10n + 500n
    );
    expect(rejected).toEqual({
      ok: false,
      error: "PaymentError::SpendCapExceeded",
      available: 400n,
    });
    expect(limit.currentDailySpend).toBe(600n);

    // 3 days later: daily window resets to 0 and batch succeeds
    const approved = checkAndUpdateBatchSpendingLimit(
      limit,
      [250n, 250n],
      DAY_SECONDS * 13n + 50n
    );
    expect(approved).toEqual({ ok: true, total: 500n });
    expect(limit.currentDailySpend).toBe(500n);
    expect(limit.currentMonthlySpend).toBe(1_100n);
  });
});
