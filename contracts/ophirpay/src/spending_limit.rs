// SPDX-License-Identifier: MIT

//! Daily/monthly spending-limit windows.
//!
//! Windows are calendar-aligned: the ledger timestamp is divided by the window
//! length, so a spend in a later 24-hour window resets the accumulator even if
//! the process (or the account) was inactive for several days. The previous
//! implementation compared elapsed time since the last write, which meant a
//! stale `current_daily_spend` survived any gap shorter than 24 hours of
//! wall-clock time *after* the last transaction — and a multi-day inactivity
//! gap was only observed when a transaction finally evaluated it. Deriving the
//! window from `timestamp / 86_400` makes the reset deterministic and
//! idempotent.

use crate::errors::PaymentError;
use crate::types::SpendingLimit;

/// Length of a daily spending window (seconds).
pub const DAY_SECONDS: u64 = 86_400;
/// Length of a monthly spending window (30 days, seconds).
pub const MONTH_SECONDS: u64 = 30 * DAY_SECONDS;

pub const fn is_spending_limit_expired(expires_at: u64, now: u64) -> bool {
    expires_at != 0 && now >= expires_at
}

/// UTC day index for a ledger timestamp (`timestamp / 86_400`).
pub const fn ledger_day(timestamp: u64) -> u64 {
    timestamp / DAY_SECONDS
}

/// Month index for a ledger timestamp (30-day windows).
pub const fn ledger_month(timestamp: u64) -> u64 {
    timestamp / MONTH_SECONDS
}

/// Clear any accumulator whose window precedes the window containing `now`.
///
/// Mutates the in-memory record only; callers decide whether to persist it.
/// `last_reset_day`/`last_reset_month` are advanced to `now` so the next check
/// starts from the current window.
pub fn reset_spending_windows(limit: &mut SpendingLimit, now: u64) {
    let current_day = ledger_day(now);
    if ledger_day(limit.last_reset_day) < current_day {
        limit.current_daily_spend = 0;
        limit.last_reset_day = now;
    }

    let current_month = ledger_month(now);
    if ledger_month(limit.last_reset_month) < current_month {
        limit.current_monthly_spend = 0;
        limit.last_reset_month = now;
    }
}

/// Daily quota left at `now`, after applying any window reset. Never negative.
pub fn remaining_daily_capacity(limit: &SpendingLimit, now: u64) -> i128 {
    let mut projected = limit.clone();
    reset_spending_windows(&mut projected, now);
    projected
        .daily_limit
        .saturating_sub(projected.current_daily_spend)
        .max(0)
}

/// Monthly quota left at `now`, after applying any window reset. Never negative.
pub fn remaining_monthly_capacity(limit: &SpendingLimit, now: u64) -> i128 {
    let mut projected = limit.clone();
    reset_spending_windows(&mut projected, now);
    projected
        .monthly_limit
        .saturating_sub(projected.current_monthly_spend)
        .max(0)
}

/// Check `amount` against the remaining daily and monthly capacity, then debit
/// both accumulators. Returns `PaymentError::SpendingLimitExceeded` without
/// modifying the record when either limit would be breached, so callers can
/// persist only on success and batch pre-checks stay atomic.
///
/// A zero/negative amount is rejected as `InvalidAmount` — the same guard the
/// payment paths already apply.
pub fn check_and_update_spending_limit(
    limit: &mut SpendingLimit,
    amount: i128,
    now: u64,
) -> Result<(), PaymentError> {
    if amount <= 0 {
        return Err(PaymentError::InvalidAmount);
    }

    reset_spending_windows(limit, now);

    let daily_after = limit.current_daily_spend.saturating_add(amount);
    if daily_after > limit.daily_limit {
        return Err(PaymentError::SpendingLimitExceeded);
    }

    let monthly_after = limit.current_monthly_spend.saturating_add(amount);
    if monthly_after > limit.monthly_limit {
        return Err(PaymentError::SpendingLimitExceeded);
    }

    limit.current_daily_spend = daily_after;
    limit.current_monthly_spend = monthly_after;
    Ok(())
}
