//! Recurring payments domain entrypoints.

use soroban_sdk::{contractimpl, Address, Env, String};

use crate::errors::PaymentError;
use crate::events::*;
use crate::helpers::*;
use crate::storage_keys::*;
use crate::types::*;
use crate::{OphirPayContract, OphirPayContractArgs, OphirPayContractClient};

#[contractimpl]
impl OphirPayContract {
    // ═══════════════════════════════════════════════════════════
    //  RECURRING PAYMENTS — Cron-like scheduled auto-payments
    // ═══════════════════════════════════════════════════════════

    /// Create a recurring payment schedule. Anyone can trigger execution
    /// after the next_execution timestamp passes.
    pub fn create_recurring(
        env: Env,
        creator: Address,
        payee: Address,
        amount: i128,
        asset: Address,
        schedule: ScheduleType,
        remaining: u32,
        metadata: String,
    ) -> Result<u64, PaymentError> {
        creator.require_auth();
        require_not_paused(&env, PauseScope::Recurring)?;
        if amount <= 0 {
            return Err(PaymentError::InvalidAmount);
        }

        let now = env.ledger().timestamp();
        let interval: u64 = match schedule {
            ScheduleType::Daily => 86400,
            ScheduleType::Weekly => 604800,
            ScheduleType::Monthly => 2592000,
        };

        let next_execution = now.saturating_add(interval);

        let mut count: u64 = env.storage().instance().get(&RECUR_CNT).unwrap_or(0);
        count = count.saturating_add(1);

        let recurring = RecurringPayment {
            id: count,
            creator: creator.clone(),
            payee,
            amount,
            asset,
            schedule,
            next_execution,
            remaining,
            times_executed: 0,
            active: true,
            metadata,
        };

        env.storage()
            .persistent()
            .set(&(RECURRING_KEY, count), &recurring);
        env.storage()
            .persistent()
            .extend_ttl(&(RECURRING_KEY, count), BUMP_MIN_TTL, BUMP_MAX_TTL);
        env.storage().instance().set(&RECUR_CNT, &count);
        env.storage().instance().extend_ttl(BUMP_MIN_TTL, BUMP_MAX_TTL);

        record_audit(
            &env,
            "recurring_created",
            &creator,
            count,
            "Recurring payment created",
        );

        Ok(count)
    }

    /// Execute a recurring payment if it's due. Anyone can call this —
    /// it's permissionless execution. Tokens must be transferred separately
    /// (this function records the payment on-chain).
    pub fn execute_recurring(
        env: Env,
        caller: Address,
        recurring_id: u64,
    ) -> Result<u64, PaymentError> {
        caller.require_auth();
        require_not_paused(&env, PauseScope::Recurring)?;

        let mut recurring: RecurringPayment = env
            .storage()
            .persistent()
            .get(&(RECURRING_KEY, recurring_id))
            .ok_or(PaymentError::RecurringNotFound)?;

        if !recurring.active {
            return Err(PaymentError::RecurringAlreadyCancelled);
        }

        let now = env.ledger().timestamp();
        if now < recurring.next_execution {
            return Err(PaymentError::RecurringNotDue);
        }

        // Record the payment
        let mut pay_count: u64 = env.storage().instance().get(&PAYMENT_COUNT).unwrap_or(0);
        pay_count = pay_count.saturating_add(1);

        let payment = Payment {
            id: pay_count,
            payer: recurring.creator.clone(),
            payee: recurring.payee.clone(),
            amount: recurring.amount,
            asset: recurring.asset.clone(),
            tx_hash: String::from_str(&env, "recurring"),
            timestamp: now,
            metadata: String::from_str(&env, "recurring"),
            cancelled: false,
        };

        env.storage()
            .persistent()
            .set(&(PAYMENT_KEY, pay_count), &payment);
        env.storage()
            .persistent()
            .extend_ttl(&(PAYMENT_KEY, pay_count), BUMP_MIN_TTL, BUMP_MAX_TTL);
        env.storage().instance().set(&PAYMENT_COUNT, &pay_count);
        env.storage().instance().extend_ttl(BUMP_MIN_TTL, BUMP_MAX_TTL);

        emit_payment_event(
            &env,
            &recurring.creator,
            &recurring.payee,
            &recurring.amount,
        );

        // Update recurring state
        let interval: u64 = match recurring.schedule {
            ScheduleType::Daily => 86400,
            ScheduleType::Weekly => 604800,
            ScheduleType::Monthly => 2592000,
        };

        recurring.next_execution = now.saturating_add(interval);
        recurring.times_executed = recurring.times_executed.saturating_add(1);

        if recurring.remaining > 0 {
            recurring.remaining = recurring.remaining.saturating_sub(1);
            if recurring.remaining == 0 {
                recurring.active = false;
            }
        }

        env.storage()
            .persistent()
            .set(&(RECURRING_KEY, recurring_id), &recurring);
        env.storage()
            .persistent()
            .extend_ttl(&(RECURRING_KEY, recurring_id), BUMP_MIN_TTL, BUMP_MAX_TTL);

        inc_counter(&env, &STAT_PAYMENTS);

        record_audit(
            &env,
            "recurring_executed",
            &caller,
            recurring_id,
            "Recurring payment executed",
        );

        Ok(pay_count)
    }

    /// Cancel a recurring payment schedule (creator or owner only).
    pub fn cancel_recurring(
        env: Env,
        caller: Address,
        recurring_id: u64,
    ) -> Result<(), PaymentError> {
        caller.require_auth();

        let mut recurring: RecurringPayment = env
            .storage()
            .persistent()
            .get(&(RECURRING_KEY, recurring_id))
            .ok_or(PaymentError::RecurringNotFound)?;

        if !recurring.active {
            return Err(PaymentError::RecurringAlreadyCancelled);
        }

        // Check auth: creator or owner can cancel
        let owner: Address = env
            .storage()
            .instance()
            .get(&OWNER)
            .ok_or(PaymentError::NotInitialized)?;
        if caller != recurring.creator && caller != owner {
            return Err(PaymentError::Unauthorized);
        }

        recurring.active = false;
        recurring.remaining = 0;
        env.storage()
            .persistent()
            .set(&(RECURRING_KEY, recurring_id), &recurring);
        env.storage()
            .persistent()
            .extend_ttl(&(RECURRING_KEY, recurring_id), BUMP_MIN_TTL, BUMP_MAX_TTL);

        record_audit(
            &env,
            "recurring_cancelled",
            &caller,
            recurring_id,
            "Recurring payment cancelled",
        );

        Ok(())
    }

    /// Get a recurring payment schedule by ID.
    pub fn get_recurring(env: Env, recurring_id: u64) -> Result<RecurringPayment, PaymentError> {
        env.storage()
            .persistent()
            .get(&(RECURRING_KEY, recurring_id))
            .ok_or(PaymentError::RecurringNotFound)
    }

    /// Get total recurring payment count.
    pub fn get_recurring_count(env: Env) -> u64 {
        env.storage().instance().get(&RECUR_CNT).unwrap_or(0)
    }

}
