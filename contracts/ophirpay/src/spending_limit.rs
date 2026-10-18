// SPDX-License-Identifier: MIT
#![allow(unused_imports)]
#![allow(dead_code)]

use soroban_sdk::{symbol_short, Address, Env, Symbol};
use crate::errors::PaymentError;
use crate::storage::SPEND_LIMIT_KEY;
use crate::contract::{BUMP_MAX_TTL, BUMP_MIN_TTL};
use crate::types::SpendingLimit;

pub const DAY_SECONDS: u64 = 86_400;
pub const MONTH_SECONDS: u64 = 30 * DAY_SECONDS;

/// Calculate the start of the 24-hour ledger window for a given timestamp (#1313).
pub const fn ledger_day_window(timestamp: u64) -> u64 {
    (timestamp / DAY_SECONDS) * DAY_SECONDS
}

/// Calculate the start of the 30-day ledger window for a given timestamp.
pub const fn ledger_month_window(timestamp: u64) -> u64 {
    (timestamp / MONTH_SECONDS) * MONTH_SECONDS
}

pub const fn is_spending_limit_expired(expires_at: u64, now: u64) -> bool {
    expires_at != 0 && now >= expires_at
}

/// Refresh daily and monthly spending limit tracking windows based on elapsed ledger time (#1313).
/// Resets accumulated spent amounts to 0 when crossing subsequent ledger day/month boundaries.
pub fn refresh_spending_windows(limit: &mut SpendingLimit, now: u64) -> bool {
    let mut refreshed = false;
    let current_day_window = ledger_day_window(now);
    let current_month_window = ledger_month_window(now);

    // If recorded window timestamp precedes current day window, reset daily spend
    if ledger_day_window(limit.last_reset_day) < current_day_window {
        limit.current_daily_spend = 0;
        limit.last_reset_day = now;
        refreshed = true;
    }

    // If recorded window timestamp precedes current month window, reset monthly spend
    if ledger_month_window(limit.last_reset_month) < current_month_window {
        limit.current_monthly_spend = 0;
        limit.last_reset_month = now;
        refreshed = true;
    }

    refreshed
}

/// Atomically check whether the requested amount is within limits and consume the quota (#1313).
/// Emits SpendingLimitExceeded event and reverts when limit violation occurs.
pub fn check_and_update_spending_limit(
    env: &Env,
    user: &Address,
    amount: i128,
) -> Result<(), PaymentError> {
    let key = (SPEND_LIMIT_KEY, user.clone());
    let mut limit: SpendingLimit = match env.storage().persistent().get(&key) {
        Some(l) => l,
        None => return Ok(()), // No spending limit configured for user
    };

    if !limit.is_active {
        return Err(PaymentError::SpendingLimitExpired);
    }

    let now = env.ledger().timestamp();
    if is_spending_limit_expired(limit.expires_at, now) {
        limit.is_active = false;
        env.storage().persistent().set(&key, &limit);
        env.storage().persistent().extend_ttl(&key, BUMP_MIN_TTL, BUMP_MAX_TTL);
        return Err(PaymentError::SpendingLimitExpired);
    }

    refresh_spending_windows(&mut limit, now);

    let new_daily = limit.current_daily_spend.saturating_add(amount);
    let new_monthly = limit.current_monthly_spend.saturating_add(amount);

    if new_daily > limit.daily_limit || new_monthly > limit.monthly_limit {
        let available = limit.daily_limit.saturating_sub(limit.current_daily_spend);
        env.events().publish(
            (Symbol::new(env, "spending_limit"), Symbol::new(env, "exceeded")),
            (user.clone(), amount, available),
        );
        return Err(PaymentError::SpendingLimitExceeded);
    }

    limit.current_daily_spend = new_daily;
    limit.current_monthly_spend = new_monthly;

    env.storage().persistent().set(&key, &limit);
    env.storage().persistent().extend_ttl(&key, BUMP_MIN_TTL, BUMP_MAX_TTL);

    Ok(())
}
