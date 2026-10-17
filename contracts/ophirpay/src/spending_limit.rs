// SPDX-License-Identifier: MIT
use soroban_sdk::{Address, Env, Symbol, Vec};
use crate::errors::PaymentError;
use crate::contract::{BUMP_MAX_TTL, BUMP_MIN_TTL};
use crate::storage::SPEND_LIMIT_KEY;
use crate::types::SpendingLimit;

pub const DAY_SECONDS: u64 = 86_400;
pub const MONTH_SECONDS: u64 = 30 * 86_400;

pub const fn is_spending_limit_expired(expires_at: u64, now: u64) -> bool {
    expires_at != 0 && now >= expires_at
}

/// Compute the integer day bucket (`timestamp / 86_400`) for ledger window comparisons.
pub const fn ledger_day_window(timestamp: u64) -> u64 {
    timestamp / DAY_SECONDS
}

/// Pure sliding/daily window transition evaluator.
/// Resets `current_daily_spend` when crossing a 24h boundary or ledger day bucket,
/// and resets `current_monthly_spend` when 30 days have elapsed.
pub fn refresh_spending_windows(limit: &mut SpendingLimit, now: u64) {
    let day_elapsed = now.saturating_sub(limit.last_reset_day) >= DAY_SECONDS
        || ledger_day_window(now) > ledger_day_window(limit.last_reset_day);
    if day_elapsed {
        limit.current_daily_spend = 0;
        limit.last_reset_day = now;
    }

    if now.saturating_sub(limit.last_reset_month) >= MONTH_SECONDS {
        limit.current_monthly_spend = 0;
        limit.last_reset_month = now;
    }
}

/// Check and atomically update a user's daily/monthly spending limit in contract storage.
/// Emits a `("spending_limit", "exceeded")` event with `(requested, available)` when a
/// limit violation occurs and returns `PaymentError::SpendCapExceeded`.
pub fn check_and_update_spending_limit(
    env: &Env,
    user: &Address,
    amount: i128,
) -> Result<Option<SpendingLimit>, PaymentError> {
    if amount <= 0 {
        return Err(PaymentError::InvalidAmount);
    }

    let key = (SPEND_LIMIT_KEY, user.clone());
    let Some(mut limit) = env.storage().persistent().get::<_, SpendingLimit>(&key) else {
        return Ok(None);
    };

    let now = env.ledger().timestamp();
    if !limit.is_active || is_spending_limit_expired(limit.expires_at, now) {
        limit.is_active = false;
        env.storage().persistent().set(&key, &limit);
        env.storage()
            .persistent()
            .extend_ttl(&key, BUMP_MIN_TTL, BUMP_MAX_TTL);
        return Err(PaymentError::SpendingLimitExpired);
    }

    refresh_spending_windows(&mut limit, now);

    let available_daily = limit.daily_limit.saturating_sub(limit.current_daily_spend);
    let available_monthly = limit
        .monthly_limit
        .saturating_sub(limit.current_monthly_spend);
    let available = core::cmp::min(available_daily, available_monthly);

    let next_daily = limit
        .current_daily_spend
        .checked_add(amount)
        .ok_or(PaymentError::MathOverflow)?;
    let next_monthly = limit
        .current_monthly_spend
        .checked_add(amount)
        .ok_or(PaymentError::MathOverflow)?;

    if next_daily > limit.daily_limit || next_monthly > limit.monthly_limit {
        env.events().publish(
            (
                Symbol::new(env, "spending_limit"),
                Symbol::new(env, "exceeded"),
            ),
            (user.clone(), amount, available),
        );
        return Err(PaymentError::SpendCapExceeded);
    }

    limit.current_daily_spend = next_daily;
    limit.current_monthly_spend = next_monthly;
    env.storage().persistent().set(&key, &limit);
    env.storage()
        .persistent()
        .extend_ttl(&key, BUMP_MIN_TTL, BUMP_MAX_TTL);

    Ok(Some(limit))
}

/// Pre-calculate the total valid batch sum and verify against the creator's
/// remaining daily/monthly spending limit before executing individual transfers.
pub fn check_and_update_batch_spending_limit(
    env: &Env,
    creator: &Address,
    amounts: &Vec<i128>,
) -> Result<i128, PaymentError> {
    let mut batch_total: i128 = 0;
    for i in 0..amounts.len() {
        let amt = amounts.get(i).unwrap_or(0);
        if amt > 0 {
            batch_total = batch_total
                .checked_add(amt)
                .ok_or(PaymentError::MathOverflow)?;
        }
    }
    if batch_total <= 0 {
        return Err(PaymentError::BatchEmpty);
    }

    check_and_update_spending_limit(env, creator, batch_total)?;
    Ok(batch_total)
}
