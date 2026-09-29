#![allow(unused_imports)]
#![allow(dead_code)]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token, Address, Env, String,
    Symbol, Vec,
};
use crate::storage::*;
use crate::types::*;
use crate::errors::*;
use crate::helpers::*;
use crate::contract::{BUMP_MAX_TTL, BUMP_MIN_TTL};
// ── Native Events ──────────────────────────────────────────────

pub fn emit_payment_event(env: &Env, payer: &Address, payee: &Address, amount: &i128) {
    env.events().publish(
        (Symbol::new(env, "payment"), payer.clone(), payee.clone()),
        *amount,
    );
}

pub fn emit_escrow_event(env: &Env, depositor: &Address, beneficiary: &Address, amount: &i128) {
    env.events().publish(
        (
            Symbol::new(env, "escrow"),
            depositor.clone(),
            beneficiary.clone(),
        ),
        *amount,
    );
}

pub fn emit_stream_event(env: &Env, creator: &Address, recipient: &Address, amount: &i128) {
    env.events().publish(
        (
            Symbol::new(env, "stream"),
            creator.clone(),
            recipient.clone(),
        ),
        *amount,
    );
}

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

/// Feature domains that can be paused individually. The global emergency pause
/// (`emergency_pause_all`) still overrides every scope, so a scope flag can
/// never re-enable a write while the whole contract is paused.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PauseScope {
    Payments,
    Escrows,
    Streams,
    Recurring,
    Refunds,
    Governance,
    Hooks,
    Batches,
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
