#![allow(unused_imports)]
#![allow(dead_code)]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token, Address, Env, String,
    Symbol, Vec,
};
use crate::storage::*;
use crate::types::*;
use crate::errors::*;
use crate::events::*;
/// Release the reentrancy lock after cross-contract calls complete.
/// Prefer using the [`ReentrancyGuard`] returned by [`acquire_reentrancy_lock`],
/// which releases automatically on drop. This is only used internally by the guard.
pub fn release_reentrancy_lock(env: &Env) {
    env.storage().instance().set(&REENTRANCY_LOCK, &false);
}

/// Calculate the linearly vested amount without ever losing precision.
///
/// `total_amount * elapsed` can exceed `i128::MAX` for very large streams
/// (AUDIT LOW-1). Returning `0` on overflow silently under-vests the recipient
/// — the stream stops paying out exactly when the amount is large enough to
/// matter. Capping at `total_amount` instead is just as wrong in the other
/// direction: it would treat a barely-started stream as fully vested and let
/// the recipient drain the contract (INV-5).
///
/// The multiply is therefore performed at 256-bit precision so the result is
/// always the exact linear vesting value and can never exceed `total_amount`.
pub fn compute_vested(total_amount: i128, start_time: u64, end_time: u64, now: u64) -> i128 {
    if now >= end_time {
        return total_amount;
    }
    if now <= start_time {
        return 0;
    }
    let elapsed = (now - start_time) as i128;
    let total_duration = (end_time - start_time) as i128;
    if total_duration == 0 {
        return total_amount;
    }

    if let Some(product) = total_amount.checked_mul(elapsed) {
        return product / total_duration;
    }

    // The 128-bit product overflowed. `create_stream` rejects non-positive
    // amounts, so `total_amount > 0`, and `now < end_time` guarantees
    // `0 < elapsed < total_duration`. The exact result is therefore
    //
    //     floor(a * b / d) == (a / d) * b + floor((a % d) * b / d)
    //
    // with `a = total_amount`, `b = elapsed`, `d = total_duration`. Both `b`
    // and `d` originate from u64 timestamps, so `(a % d) * b` fits in u128 and
    // the sum is bounded by `total_amount` — no precision is lost and the
    // INV-5 ceiling holds.
    if total_amount <= 0 {
        // Unreachable for streams; keeps the u128 casts below value-preserving.
        return total_amount;
    }
    let amount = total_amount as u128;
    let divisor = total_duration as u128;
    let multiplier = elapsed as u128;
    let whole = (amount / divisor) * multiplier;
    let fractional = ((amount % divisor) * multiplier) / divisor;
    (whole + fractional) as i128
}

/// Ten raised to the power of `exp` as an `i128`.
pub fn pow10(exp: u32) -> Result<i128, PaymentError> {
    if exp > MAX_TOKEN_DECIMALS {
        return Err(PaymentError::InvalidDecimalPrecision);
    }
    let mut val: i128 = 1;
    for _ in 0..exp {
        val = val.checked_mul(10).ok_or(PaymentError::ArithmeticOverflow)?;
    }
    Ok(val)
}

/// Convert a token amount between different decimal precisions.
///
/// Supports precisions from 0 up to `MAX_TOKEN_DECIMALS` (18).
/// - When `to_decimals > from_decimals`, scales up by 10^(to_decimals - from_decimals).
/// - When `to_decimals < from_decimals`, scales down by 10^(from_decimals - to_decimals) using integer truncation.
/// - When `to_decimals == from_decimals`, returns `amount` unchanged.
pub fn convert_token_decimals(
    amount: i128,
    from_decimals: u32,
    to_decimals: u32,
) -> Result<i128, PaymentError> {
    if from_decimals > MAX_TOKEN_DECIMALS || to_decimals > MAX_TOKEN_DECIMALS {
        return Err(PaymentError::InvalidDecimalPrecision);
    }
    if amount == 0 || from_decimals == to_decimals {
        return Ok(amount);
    }
    if to_decimals > from_decimals {
        let factor = pow10(to_decimals - from_decimals)?;
        amount.checked_mul(factor).ok_or(PaymentError::ArithmeticOverflow)
    } else {
        let divisor = pow10(from_decimals - to_decimals)?;
        Ok(amount / divisor)
    }
}
