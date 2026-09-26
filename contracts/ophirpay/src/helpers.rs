//! Shared internal helper functions, counter mutators, and guards.

use soroban_sdk::{token, Address, Env, String, Symbol};

use crate::errors::PaymentError;
use crate::storage_keys::*;
use crate::types::*;

/// Increment a u64 counter key by 1. Gas-optimized: single-key read+write
/// instead of deserializing/serializing an 11-field ContractStats struct.
/// Note: does NOT extend TTL — callers should batch TTL extensions at the end
/// of each function to avoid redundant metadata writes.
pub fn inc_counter(env: &Env, key: &Symbol) {
    let val: u64 = env.storage().instance().get(key).unwrap_or(0);
    env.storage().instance().set(key, &val.saturating_add(1));
}

/// Add delta to a u64 counter key. Same single-key optimization.
pub fn add_u64_counter(env: &Env, key: &Symbol, delta: u64) {
    let val: u64 = env.storage().instance().get(key).unwrap_or(0);
    env.storage()
        .instance()
        .set(key, &val.saturating_add(delta));
}

/// Add delta to an i128 counter key. Same single-key optimization.
/// Same TTL note as inc_counter.
pub fn add_counter(env: &Env, key: &Symbol, delta: i128) {
    let val: i128 = env.storage().instance().get(key).unwrap_or(0);
    env.storage()
        .instance()
        .set(key, &val.saturating_add(delta));
}

/// Track funds locked in active escrows/streams. Pass the actual amount being
/// deposited (positive) or withdrawn (negative). Used by emergency_withdraw
/// to prevent the owner from withdrawing user-deposited funds.
pub fn add_locked(env: &Env, delta: i128) {
    let val: i128 = env.storage().instance().get(&LOCKED_BALANCE).unwrap_or(0);
    let new_val = val.saturating_add(delta);
    // Clamp at 0 — locked balance must never go negative
    let clamped = if new_val < 0 { 0 } else { new_val };
    env.storage().instance().set(&LOCKED_BALANCE, &clamped);
}

/// Compute the protocol fee for an amount at the given fee basis points.
/// Shared by the public `calculate_fee` contract method and the internal
/// `collect_fee` helper so fee math stays in one place.
pub fn compute_fee(amount: i128, fee_bps: u32) -> i128 {
    if fee_bps == 0 || amount <= 0 {
        return 0;
    }
    amount.saturating_mul(fee_bps as i128) / 10000
}

/// Collect protocol fees from the payer and transfer to the fee collector.
/// Returns the fee amount collected (0 if fees are disabled or no collector
/// is set).  Returns an error if the fee transfer fails — which reverts
/// the entire payment, ensuring fee collection is atomic.
pub fn collect_fee(
    env: &Env,
    payer: &Address,
    asset: &Address,
    payment_amount: i128,
) -> Result<i128, PaymentError> {
    // Read fee config; if disabled or no collector, skip fee collection.
    let config: Option<FeeConfig> = env.storage().instance().get(&FEE_KEY);
    let config = match config {
        Some(c) if c.enabled => c,
        _ => return Ok(0),
    };
    let collector: Address = match env.storage().instance().get(&FEE_COLL) {
        Some(c) => c,
        None => return Ok(0),
    };

    let fee = compute_fee(payment_amount, config.payment_fee_bps);
    if fee <= 0 {
        return Ok(0);
    }

    // Transfer fee from payer to collector.  If this fails (insufficient
    // balance, missing trustline, etc.), the entire payment reverts.
    let token_client = token::Client::new(env, asset);
    token_client.transfer(payer, &collector, &fee);

    Ok(fee)
}

/// Get the current locked balance (funds held in active escrows + streams).
pub fn record_audit(env: &Env, action: &str, actor: &Address, target_id: u64, details: &str) {
    let mut count: u64 = env.storage().instance().get(&AUDIT_CNT).unwrap_or(0);
    count = count.saturating_add(1);
    let entry = AuditEntry {
        id: count,
        timestamp: env.ledger().timestamp(),
        action: String::from_str(env, action),
        actor: actor.clone(),
        target_id,
        details: String::from_str(env, details),
    };
    env.storage()
        .persistent()
        .set(&(AUDIT_LOG_KEY, count), &entry);
    env.storage()
        .persistent()
        .extend_ttl(&(AUDIT_LOG_KEY, count), BUMP_MIN_TTL, BUMP_MAX_TTL);
    env.storage().instance().set(&AUDIT_CNT, &count);
    env.storage().instance().extend_ttl(BUMP_MIN_TTL, BUMP_MAX_TTL);
    env.events().publish(
        (Symbol::new(env, "audit"), Symbol::new(env, action)),
        (actor.clone(), target_id),
    );
}

/// Guard: caller must be the contract owner. Deduplicates the 15+ identical
/// owner-check blocks, reducing Wasm code size and deployment gas.
pub fn require_owner(env: &Env, caller: &Address) -> Result<(), PaymentError> {
    let owner: Address = env
        .storage()
        .instance()
        .get(&OWNER)
        .ok_or(PaymentError::NotInitialized)?;
    if caller != &owner {
        return Err(PaymentError::Unauthorized);
    }
    Ok(())
}



/// Map an incoming numeric scope identifier to a `PauseScope`. Unknown ids are
/// rejected with `InvalidPauseScope` so the failure is explicit instead of a
/// silent no-op.
pub fn parse_pause_scope(scope: u32) -> Result<PauseScope, PaymentError> {
    match scope {
        0 => Ok(PauseScope::Payments),
        1 => Ok(PauseScope::Escrows),
        2 => Ok(PauseScope::Streams),
        3 => Ok(PauseScope::Recurring),
        4 => Ok(PauseScope::Refunds),
        5 => Ok(PauseScope::Governance),
        6 => Ok(PauseScope::Hooks),
        7 => Ok(PauseScope::Batches),
        _ => Err(PaymentError::InvalidPauseScope),
    }
}

/// Instance-storage key holding a single scope's pause flag.
pub fn pause_scope_key(env: &Env, scope: PauseScope) -> Symbol {
    let name = match scope {
        PauseScope::Payments => "SCOPE_PAYMENTS",
        PauseScope::Escrows => "SCOPE_ESCROWS",
        PauseScope::Streams => "SCOPE_STREAMS",
        PauseScope::Recurring => "SCOPE_RECURRING",
        PauseScope::Refunds => "SCOPE_REFUNDS",
        PauseScope::Governance => "SCOPE_GOVERNANCE",
        PauseScope::Hooks => "SCOPE_HOOKS",
        PauseScope::Batches => "SCOPE_BATCHES",
    };
    Symbol::new(env, name)
}

/// Whether a single scope is paused, ignoring the global flag.
pub fn is_scope_flag_set(env: &Env, scope: PauseScope) -> bool {
    env.storage()
        .instance()
        .get(&pause_scope_key(env, scope))
        .unwrap_or(false)
}

/// Guard: reject all write operations while the contract is globally paused OR
/// the scope that owns the operation is paused. The global pause is checked
/// first so it always overrides the per-scope flags.
pub fn require_not_paused(env: &Env, scope: PauseScope) -> Result<(), PaymentError> {
    let globally_paused: bool = env.storage().instance().get(&PAUSED).unwrap_or(false);
    if globally_paused || is_scope_flag_set(env, scope) {
        return Err(PaymentError::ContractPaused);
    }
    Ok(())
}

/// Reentrancy guard: set lock before cross-contract calls.
/// Soroban contracts are single-threaded per invocation, but reentrancy
/// can occur when a cross-contract call loops back to this contract.
///
/// The returned guard automatically releases the lock when dropped, so it is
/// safe to `?`-return from the guarded function without leaking the lock.
/// Because the check must reject reentrant calls even for otherwise-invalid
/// inputs, this must be the FIRST operation in any token-moving function.
pub struct ReentrancyGuard<'a> {
    env: &'a Env,
}

impl Drop for ReentrancyGuard<'_> {
    fn drop(&mut self) {
        release_reentrancy_lock(self.env);
    }
}

pub fn acquire_reentrancy_lock<'a>(env: &'a Env) -> Result<ReentrancyGuard<'a>, PaymentError> {
    let locked: bool = env
        .storage()
        .instance()
        .get(&REENTRANCY_LOCK)
        .unwrap_or(false);
    if locked {
        return Err(PaymentError::ReentrantCall);
    }
    env.storage().instance().set(&REENTRANCY_LOCK, &true);
    Ok(ReentrancyGuard { env })
}

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

