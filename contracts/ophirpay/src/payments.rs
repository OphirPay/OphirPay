//! Payment records domain entrypoints.

use soroban_sdk::{contractimpl, Address, Env, String, Vec};

use crate::errors::PaymentError;
use crate::events::*;
use crate::helpers::*;
use crate::storage_keys::*;
use crate::types::*;
use crate::{OphirPayContract, OphirPayContractArgs, OphirPayContractClient};

#[contractimpl]
impl OphirPayContract {
    // ═══════════════════════════════════════════════════════════
    //  PAYMENT RECORDS (for Horizon-based XLM payments)
    // ═══════════════════════════════════════════════════════════

    /// Record an off-chain payment on the Soroban ledger.
    /// Anyone can call — this just stores a record, no tokens move.
    pub fn record_payment(
        env: Env,
        payer: Address,
        payee: Address,
        amount: i128,
        asset: Address,
        tx_hash: String,
        metadata: String,
    ) -> Result<u64, PaymentError> {
        payer.require_auth();
        require_not_paused(&env, PauseScope::Payments)?;
        if amount <= 0 {
            return Err(PaymentError::InvalidAmount);
        }

        // Collect protocol fee before recording.  If fee transfer fails
        // (insufficient balance, missing trustline), the entire payment
        // reverts — no partial state.
        let _fee = collect_fee(&env, &payer, &asset, amount)?;

        let mut count: u64 = env.storage().instance().get(&PAYMENT_COUNT).unwrap_or(0);
        count += 1;

        let payment = Payment {
            id: count,
            payer: payer.clone(),
            payee: payee.clone(),
            amount,
            asset,
            tx_hash: tx_hash.clone(),
            timestamp: env.ledger().timestamp(),
            metadata,
            cancelled: false,
        };

        env.storage()
            .persistent()
            .set(&(PAYMENT_KEY, count), &payment);
        env.storage()
            .persistent()
            .extend_ttl(&(PAYMENT_KEY, count), BUMP_MIN_TTL, BUMP_MAX_TTL);
        env.storage().instance().set(&PAYMENT_COUNT, &count);
        env.storage().instance().extend_ttl(BUMP_MIN_TTL, BUMP_MAX_TTL);

        // Native event
        emit_payment_event(&env, &payer, &payee, &amount);

        inc_counter(&env, &STAT_PAYMENTS);

        record_audit(&env, "payment_recorded", &payer, count, "Payment recorded");

        Ok(count)
    }

    /// Get a payment by ID
    pub fn get_payment(env: Env, payment_id: u64) -> Result<Payment, PaymentError> {
        env.storage()
            .persistent()
            .get(&(PAYMENT_KEY, payment_id))
            .ok_or(PaymentError::PaymentNotFound)
    }

    /// Get total payment count
    pub fn get_payment_count(env: Env) -> u64 {
        env.storage().instance().get(&PAYMENT_COUNT).unwrap_or(0)
    }

    /// Get range of payments
    pub fn get_payments_range(env: Env, start_id: u64, end_id: u64) -> Vec<Payment> {
        // Bounded enumeration (MEDIUM-2 audit fix): iterate the most recent
        // tail first and cap at 100 entries, matching get_audit_log_range.
        let mut payments = Vec::new(&env);
        for id in (start_id..=end_id).rev() {
            if payments.len() >= 100 {
                break;
            }
            if let Some(p) = env
                .storage()
                .persistent()
                .get::<_, Payment>(&(PAYMENT_KEY, id))
            {
                payments.push_back(p);
            }
        }
        payments
    }

    /// Cancel a payment record (owner only). Idempotent — re-cancelling is an error.
    pub fn cancel_payment(env: Env, caller: Address, payment_id: u64) -> Result<(), PaymentError> {
        caller.require_auth();
        require_owner(&env, &caller)?;

        let mut payment: Payment = env
            .storage()
            .persistent()
            .get(&(PAYMENT_KEY, payment_id))
            .ok_or(PaymentError::PaymentNotFound)?;

        if payment.cancelled {
            return Err(PaymentError::PaymentAlreadyCancelled);
        }

        payment.cancelled = true;
        env.storage()
            .persistent()
            .set(&(PAYMENT_KEY, payment_id), &payment);
        env.storage()
            .persistent()
            .extend_ttl(&(PAYMENT_KEY, payment_id), BUMP_MIN_TTL, BUMP_MAX_TTL);

        record_audit(
            &env,
            "payment_cancelled",
            &caller,
            payment_id,
            "Payment cancelled",
        );

        Ok(())
    }

}
