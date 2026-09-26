//! Multisig approval domain entrypoints.

use soroban_sdk::{contractimpl, Address, Env, String, Symbol, Vec};

use crate::errors::PaymentError;
use crate::helpers::*;
use crate::storage_keys::*;
use crate::types::*;
use crate::{OphirPayContract, OphirPayContractArgs, OphirPayContractClient};

#[contractimpl]
impl OphirPayContract {
    // ═══════════════════════════════════════════════════════════
    //  MULTISIG APPROVALS — N-of-M signers for large payments
    // ═══════════════════════════════════════════════════════════

    /// Configure multisig (owner only). Set threshold and signer list.
    pub fn set_multisig_config(
        env: Env,
        caller: Address,
        threshold: u32,
        signers: Vec<Address>,
        enabled: bool,
    ) -> Result<(), PaymentError> {
        caller.require_auth();
        require_owner(&env, &caller)?;

        let mut unique_signers = Vec::new(&env);
        for signer in signers.into_iter() {
            if !unique_signers.contains(signer.clone()) {
                unique_signers.push_back(signer);
            }
        }

        if unique_signers.len() > 50 {
            return Err(PaymentError::MaxSignersExceeded);
        }

        if threshold == 0 || threshold > unique_signers.len() {
            return Err(PaymentError::InvalidAmount);
        }

        let config = MultisigConfig {
            threshold,
            signers: unique_signers,
            enabled,
        };

        // Archive previous version before overwriting
        let mut ver_count: u32 = env.storage().instance().get(&MSIG_VER_CNT).unwrap_or(0);
        ver_count = ver_count.saturating_add(1);
        let version_entry = MultisigVersion {
            version: ver_count,
            config: config.clone(),
            changed_at: env.ledger().timestamp(),
            changed_by: caller.clone(),
        };
        env.storage()
            .persistent()
            .set(&(MSIG_VER_CNT, ver_count), &version_entry);
        env.storage()
            .persistent()
            .extend_ttl(&(MSIG_VER_CNT, ver_count), BUMP_MIN_TTL, BUMP_MAX_TTL);
        env.storage().instance().set(&MSIG_VER_CNT, &ver_count);

        env.storage().instance().set(&MULTISIG_CONFIG, &config);
        env.storage().instance().extend_ttl(BUMP_MIN_TTL, BUMP_MAX_TTL);

        record_audit(
            &env,
            "multisig_configured",
            &caller,
            threshold as u64,
            "Multisig configured",
        );

        Ok(())
    }

    /// Get current multisig config.
    pub fn get_multisig_config(env: Env) -> Option<MultisigConfig> {
        let config: Option<MultisigConfig> = env.storage().instance().get(&MULTISIG_CONFIG);
        config
    }

    /// Get multisig configuration version history (most recent first, capped at 100).
    /// Returns the latest 100 versions to prevent unbounded storage reads.
    pub fn get_multisig_config_history(env: Env) -> Vec<MultisigVersion> {
        let total: u32 = env.storage().instance().get(&MSIG_VER_CNT).unwrap_or(0);
        let mut history = Vec::new(&env);
        let start = if total > 100 { total - 99 } else { 1 };
        for v in (start..=total).rev() {
            if let Some(entry) = env.storage().persistent().get(&(MSIG_VER_CNT, v)) {
                history.push_back(entry);
            }
        }
        history
    }

    /// Propose a payment that requires multisig approval.
    pub fn propose_payment(
        env: Env,
        proposer: Address,
        payee: Address,
        amount: i128,
        asset: Address,
        tx_hash: String,
    ) -> Result<u64, PaymentError> {
        proposer.require_auth();
        require_not_paused(&env, PauseScope::Payments)?;

        let config: MultisigConfig = env
            .storage()
            .instance()
            .get(&MULTISIG_CONFIG)
            .ok_or(PaymentError::MultisigNotConfigured)?;
        if !config.enabled {
            return Err(PaymentError::MultisigNotConfigured);
        }

        let mut count: u64 = env.storage().instance().get(&APPROVAL_COUNT).unwrap_or(0);
        count += 1;

        let approvals: Vec<Address> = Vec::new(&env);
        let proposer_clone = proposer.clone();
        let request = ApprovalRequest {
            id: count,
            proposer,
            payee,
            amount,
            asset,
            tx_hash,
            approvals,
            executed: false,
            created_at: env.ledger().timestamp(),
        };

        env.storage()
            .persistent()
            .set(&(APPROVAL_KEY, count), &request);
        env.storage()
            .persistent()
            .extend_ttl(&(APPROVAL_KEY, count), BUMP_MIN_TTL, BUMP_MAX_TTL);
        env.storage().instance().set(&APPROVAL_COUNT, &count);
        env.storage().instance().extend_ttl(BUMP_MIN_TTL, BUMP_MAX_TTL);

        env.events().publish(
            (Symbol::new(&env, "approval"), Symbol::new(&env, "proposed")),
            count,
        );

        record_audit(
            &env,
            "multisig_proposed",
            &proposer_clone,
            count,
            "Multisig payment proposed",
        );

        Ok(count)
    }

    /// Signer approves a pending payment proposal.
    pub fn approve_payment(
        env: Env,
        signer: Address,
        request_id: u64,
    ) -> Result<bool, PaymentError> {
        signer.require_auth();
        require_not_paused(&env, PauseScope::Payments)?;

        let config: MultisigConfig = env
            .storage()
            .instance()
            .get(&MULTISIG_CONFIG)
            .ok_or(PaymentError::MultisigNotConfigured)?;

        // Verify signer is in the list
        let is_signer = config.signers.iter().any(|s| s == signer);
        if !is_signer {
            return Err(PaymentError::NotASigner);
        }

        let mut request: ApprovalRequest = env
            .storage()
            .persistent()
            .get(&(APPROVAL_KEY, request_id))
            .ok_or(PaymentError::PaymentNotFound)?;

        if request.executed {
            return Err(PaymentError::AlreadyExecuted);
        }

        // Check for duplicate approval
        if request.approvals.iter().any(|a| a == signer) {
            return Err(PaymentError::AlreadyApproved);
        }

        request.approvals.push_back(signer.clone());
        env.storage()
            .persistent()
            .set(&(APPROVAL_KEY, request_id), &request);
        env.storage()
            .persistent()
            .extend_ttl(&(APPROVAL_KEY, request_id), BUMP_MIN_TTL, BUMP_MAX_TTL);

        let threshold_met = request.approvals.len() >= config.threshold;

        env.events().publish(
            (Symbol::new(&env, "approval"), Symbol::new(&env, "approved")),
            (request_id, signer),
        );

        Ok(threshold_met)
    }

    /// Execute a fully-approved payment (any signer can trigger).
    pub fn execute_approved_payment(
        env: Env,
        caller: Address,
        request_id: u64,
    ) -> Result<u64, PaymentError> {
        caller.require_auth();
        require_not_paused(&env, PauseScope::Payments)?;

        let config: MultisigConfig = env
            .storage()
            .instance()
            .get(&MULTISIG_CONFIG)
            .ok_or(PaymentError::MultisigNotConfigured)?;

        let mut request: ApprovalRequest = env
            .storage()
            .persistent()
            .get(&(APPROVAL_KEY, request_id))
            .ok_or(PaymentError::PaymentNotFound)?;

        if request.executed {
            return Err(PaymentError::AlreadyExecuted);
        }
        if request.approvals.len() < config.threshold {
            return Err(PaymentError::ThresholdNotMet);
        }

        // Record the payment
        let mut pay_count: u64 = env.storage().instance().get(&PAYMENT_COUNT).unwrap_or(0);
        pay_count += 1;

        let payment = Payment {
            id: pay_count,
            payer: request.proposer.clone(),
            payee: request.payee.clone(),
            amount: request.amount,
            asset: request.asset.clone(),
            tx_hash: request.tx_hash.clone(),
            timestamp: env.ledger().timestamp(),
            metadata: String::from_str(&env, "multisig"),
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

        request.executed = true;
        env.storage()
            .persistent()
            .set(&(APPROVAL_KEY, request_id), &request);
        env.storage()
            .persistent()
            .extend_ttl(&(APPROVAL_KEY, request_id), BUMP_MIN_TTL, BUMP_MAX_TTL);

        inc_counter(&env, &STAT_PAYMENTS);

        env.events().publish(
            (Symbol::new(&env, "approval"), Symbol::new(&env, "executed")),
            (request_id, pay_count),
        );

        record_audit(
            &env,
            "multisig_executed",
            &caller,
            request_id,
            "Multisig payment executed",
        );

        Ok(pay_count)
    }

    /// Get an approval request by ID.
    pub fn get_approval_request(env: Env, request_id: u64) -> Option<ApprovalRequest> {
        env.storage().persistent().get(&(APPROVAL_KEY, request_id))
    }

}
