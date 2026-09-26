//! Refund lifecycle domain entrypoints.

use soroban_sdk::{contractimpl, token, Address, Env, String, Symbol, Vec};

use crate::errors::PaymentError;
use crate::helpers::*;
use crate::storage_keys::*;
use crate::types::*;
use crate::{OphirPayContract, OphirPayContractArgs, OphirPayContractClient};

#[contractimpl]
impl OphirPayContract {
    // ═══════════════════════════════════════════════════════════
    //  REFUNDS — Structured refund lifecycle with reason codes
    // ═══════════════════════════════════════════════════════════

    /// Request a refund for a recorded payment. Stores the refund on-chain
    /// with a typed reason code for analytics.
    pub fn request_refund(
        env: Env,
        requester: Address,
        payment_id: u64,
        amount: i128,
        asset: Address,
        reason: String,
        reason_code: RefundReasonCode,
    ) -> Result<u64, PaymentError> {
        requester.require_auth();
        require_not_paused(&env, PauseScope::Refunds)?;
        if amount <= 0 {
            return Err(PaymentError::InvalidAmount);
        }

        // Verify payment exists and isn't already refunded
        let payment: Payment = env
            .storage()
            .persistent()
            .get(&(PAYMENT_KEY, payment_id))
            .ok_or(PaymentError::PaymentNotFound)?;

        if payment.cancelled {
            return Err(PaymentError::PaymentAlreadyCancelled);
        }

        // ── Fund-safety validation (HIGH-1 audit fix) ──────────────────
        // The requester must be the payer or payee of the payment, the refund
        // amount must not exceed the recorded payment amount, and the asset
        // must match the payment's asset. Without these checks an owner could
        // request a refund of the entire contract balance and drain funds
        // locked in escrows/streams, bypassing the LOCKED_BALANCE invariant.
        if requester != payment.payer && requester != payment.payee {
            return Err(PaymentError::Unauthorized);
        }
        if amount > payment.amount {
            return Err(PaymentError::InvalidAmount);
        }
        if asset != payment.asset {
            return Err(PaymentError::AssetNotSupported);
        }

        let mut count: u64 = env.storage().instance().get(&REFUND_CNT).unwrap_or(0);
        count = count.saturating_add(1);

        let refund = Refund {
            id: count,
            payment_id,
            requester: requester.clone(),
            amount,
            asset,
            reason,
            reason_code,
            status: RefundStatus::Requested,
            requested_at: env.ledger().timestamp(),
            resolved_at: 0,
        };

        env.storage()
            .persistent()
            .set(&(REFUND_KEY, count), &refund);
        env.storage()
            .persistent()
            .extend_ttl(&(REFUND_KEY, count), BUMP_MIN_TTL, BUMP_MAX_TTL);
        env.storage().instance().set(&REFUND_CNT, &count);
        env.storage().instance().extend_ttl(BUMP_MIN_TTL, BUMP_MAX_TTL);

        env.events().publish(
            (Symbol::new(&env, "refund"), Symbol::new(&env, "requested")),
            count,
        );

        record_audit(
            &env,
            "refund_requested",
            &requester,
            count,
            "Refund requested",
        );

        Ok(count)
    }

    /// Approve a refund request (owner only). Moves status to Approved.
    pub fn approve_refund(env: Env, caller: Address, refund_id: u64) -> Result<(), PaymentError> {
        caller.require_auth();
        require_owner(&env, &caller)?;
        require_not_paused(&env, PauseScope::Refunds)?;

        let mut refund: Refund = env
            .storage()
            .persistent()
            .get(&(REFUND_KEY, refund_id))
            .ok_or(PaymentError::RefundNotFound)?;

        if refund.status != RefundStatus::Requested {
            return Err(PaymentError::RefundAlreadyProcessed);
        }

        refund.status = RefundStatus::Approved;
        refund.resolved_at = env.ledger().timestamp();
        env.storage()
            .persistent()
            .set(&(REFUND_KEY, refund_id), &refund);
        env.storage()
            .persistent()
            .extend_ttl(&(REFUND_KEY, refund_id), BUMP_MIN_TTL, BUMP_MAX_TTL);

        record_audit(
            &env,
            "refund_approved",
            &caller,
            refund_id,
            "Refund approved",
        );

        Ok(())
    }

    /// Reject a refund request (owner only).
    pub fn reject_refund(env: Env, caller: Address, refund_id: u64) -> Result<(), PaymentError> {
        caller.require_auth();
        require_owner(&env, &caller)?;
        require_not_paused(&env, PauseScope::Refunds)?;

        let mut refund: Refund = env
            .storage()
            .persistent()
            .get(&(REFUND_KEY, refund_id))
            .ok_or(PaymentError::RefundNotFound)?;

        if refund.status != RefundStatus::Requested {
            return Err(PaymentError::RefundAlreadyProcessed);
        }

        refund.status = RefundStatus::Rejected;
        refund.resolved_at = env.ledger().timestamp();
        env.storage()
            .persistent()
            .set(&(REFUND_KEY, refund_id), &refund);
        env.storage()
            .persistent()
            .extend_ttl(&(REFUND_KEY, refund_id), BUMP_MIN_TTL, BUMP_MAX_TTL);

        record_audit(
            &env,
            "refund_rejected",
            &caller,
            refund_id,
            "Refund rejected",
        );

        Ok(())
    }

    /// Process an approved refund — transfers tokens back to requester.
    pub fn process_refund(env: Env, caller: Address, refund_id: u64) -> Result<(), PaymentError> {
        let _guard = acquire_reentrancy_lock(&env)?;
        caller.require_auth();
        require_owner(&env, &caller)?;
        require_not_paused(&env, PauseScope::Refunds)?;

        let mut refund: Refund = env
            .storage()
            .persistent()
            .get(&(REFUND_KEY, refund_id))
            .ok_or(PaymentError::RefundNotFound)?;

        if refund.status != RefundStatus::Approved {
            return Err(PaymentError::RefundAlreadyProcessed);
        }

        // Reentrancy-guarded transfer (MEDIUM-4)
        let token_client = token::Client::new(&env, &refund.asset);
        let contract_addr = env.current_contract_address();
        token_client.transfer(&contract_addr, &refund.requester, &refund.amount);

        refund.status = RefundStatus::Processed;
        refund.resolved_at = env.ledger().timestamp();
        env.storage()
            .persistent()
            .set(&(REFUND_KEY, refund_id), &refund);
        env.storage()
            .persistent()
            .extend_ttl(&(REFUND_KEY, refund_id), BUMP_MIN_TTL, BUMP_MAX_TTL);

        env.events().publish(
            (Symbol::new(&env, "refund"), Symbol::new(&env, "processed")),
            refund_id,
        );

        record_audit(
            &env,
            "refund_processed",
            &env.current_contract_address(),
            refund_id,
            "Refund processed",
        );

        Ok(())
    }

    /// Get a refund by ID.
    pub fn get_refund(env: Env, refund_id: u64) -> Result<Refund, PaymentError> {
        env.storage()
            .persistent()
            .get(&(REFUND_KEY, refund_id))
            .ok_or(PaymentError::RefundNotFound)
    }

    /// Get total refund count.
    pub fn get_refund_count(env: Env) -> u64 {
        env.storage().instance().get(&REFUND_CNT).unwrap_or(0)
    }

    /// Analytics: count refunds grouped by reason code.
    /// Returns a sorted list of (reason_code, count) pairs.
    pub fn get_reason_code_analytics(env: Env) -> Vec<(u32, u64)> {
        let total: u64 = env.storage().instance().get(&REFUND_CNT).unwrap_or(0);
        let mut counts: Vec<(u32, u64)> = Vec::new(&env);

        // Initialize buckets for each reason code
        let codes = [0u32, 1, 2, 3, 4, 5]; // ProductDefect=0 .. Other=5
        for code in codes.iter() {
            counts.push_back((*code, 0));
        }

        // Bounded enumeration (MEDIUM-2 audit fix): cap the scan at the most
        // recent 100 refunds so analytics never iterates the full catalog.
        let start = total.saturating_sub(99); // last 100 (1-based ids)
        for id in start..=total {
            if let Some(refund) = env
                .storage()
                .persistent()
                .get::<_, Refund>(&(REFUND_KEY, id))
            {
                let code_idx = match refund.reason_code {
                    RefundReasonCode::ProductDefect => 0,
                    RefundReasonCode::NonDelivery => 1,
                    RefundReasonCode::DuplicateCharge => 2,
                    RefundReasonCode::Unauthorized => 3,
                    RefundReasonCode::CustomerRequest => 4,
                    RefundReasonCode::Other => 5,
                };
                let idx = code_idx as u32;
                if idx < counts.len() {
                    let old_entry = counts.get(idx).unwrap();
                    counts.set(idx, (old_entry.0, old_entry.1.saturating_add(1)));
                }
            }
        }

        counts
    }

}
