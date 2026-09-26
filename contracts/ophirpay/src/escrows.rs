//! Escrow lifecycle domain entrypoints.

use soroban_sdk::{contractimpl, token, Address, Env, String};

use crate::errors::PaymentError;
use crate::events::*;
use crate::helpers::*;
use crate::storage_keys::*;
use crate::types::*;
use crate::{OphirPayContract, OphirPayContractArgs, OphirPayContractClient};

#[contractimpl]
impl OphirPayContract {
    // ═══════════════════════════════════════════════════════════
    //  ESCROW — Lock funds, release on command or deadline
    // ═══════════════════════════════════════════════════════════

    /// Create an escrow. Tokens are transferred from depositor to this contract.
    /// The beneficiary can claim after `deadline`; owner can release early;
    /// optional arbiter can resolve disputes.
    pub fn create_escrow(
        env: Env,
        depositor: Address,
        beneficiary: Address,
        arbiter: Option<Address>,
        amount: i128,
        asset: Address,
        deadline: u64,
        metadata: String,
    ) -> Result<u64, PaymentError> {
        // Reentrancy guard MUST be the first check so a locked contract rejects
        // every token-moving call (even with otherwise-invalid inputs).
        let _guard = acquire_reentrancy_lock(&env)?;
        depositor.require_auth();
        require_not_paused(&env, PauseScope::Escrows)?;
        if amount <= 0 {
            return Err(PaymentError::InvalidAmount);
        }

        // Transfer tokens from depositor to this contract (reentrancy-guarded, MEDIUM-4)
        let token_client = token::Client::new(&env, &asset);
        let contract_addr = env.current_contract_address();
        token_client.transfer(&depositor, &contract_addr, &amount);

        add_locked(&env, amount);

        let mut count: u64 = env.storage().instance().get(&ESCROW_COUNT).unwrap_or(0);
        count += 1;

        let depositor_clone = depositor.clone();
        let escrow = Escrow {
            id: count,
            depositor,
            beneficiary: beneficiary.clone(),
            arbiter: arbiter.clone(),
            amount,
            asset,
            deadline,
            released: false,
            claimed: false,
            metadata,
        };

        env.storage()
            .persistent()
            .set(&(ESCROW_KEY, count), &escrow);
        env.storage()
            .persistent()
            .extend_ttl(&(ESCROW_KEY, count), BUMP_MIN_TTL, BUMP_MAX_TTL);
        env.storage().instance().set(&ESCROW_COUNT, &count);
        env.storage().instance().extend_ttl(BUMP_MIN_TTL, BUMP_MAX_TTL);

        emit_escrow_event(&env, &env.current_contract_address(), &beneficiary, &amount);

        inc_counter(&env, &STAT_ESC_CREATED);
        add_counter(&env, &STAT_AMT_ESCROWED, amount);

        record_audit(
            &env,
            "escrow_created",
            &depositor_clone,
            count,
            "Escrow created",
        );

        Ok(count)
    }

    /// Owner releases escrow to the beneficiary (anytime).
    pub fn release_escrow(env: Env, owner: Address, escrow_id: u64) -> Result<(), PaymentError> {
        let _guard = acquire_reentrancy_lock(&env)?;
        owner.require_auth();
        require_not_paused(&env, PauseScope::Escrows)?;
        let stored_owner: Address = env
            .storage()
            .instance()
            .get(&OWNER)
            .ok_or(PaymentError::NotInitialized)?;
        if owner != stored_owner {
            return Err(PaymentError::Unauthorized);
        }

        let mut escrow: Escrow = env
            .storage()
            .persistent()
            .get(&(ESCROW_KEY, escrow_id))
            .ok_or(PaymentError::EscrowNotFound)?;

        if escrow.released || escrow.claimed {
            return Err(PaymentError::EscrowAlreadyReleased);
        }

        // Transfer tokens to beneficiary (reentrancy-guarded, MEDIUM-4)
        let token_client = token::Client::new(&env, &escrow.asset);
        let contract_addr = env.current_contract_address();
        add_locked(&env, -escrow.amount);

        token_client.transfer(&contract_addr, &escrow.beneficiary, &escrow.amount);

        escrow.released = true;
        escrow.claimed = true;
        env.storage()
            .persistent()
            .set(&(ESCROW_KEY, escrow_id), &escrow);
        env.storage()
            .persistent()
            .extend_ttl(&(ESCROW_KEY, escrow_id), BUMP_MIN_TTL, BUMP_MAX_TTL);

        inc_counter(&env, &STAT_ESC_RELEASED);

        record_audit(
            &env,
            "escrow_released_owner",
            &owner,
            escrow_id,
            "Escrow released by owner",
        );

        Ok(())
    }

    /// Arbiter releases escrow to either party (dispute resolution).
    /// Only the escrow's designated arbiter can call this.
    pub fn release_by_arbiter(
        env: Env,
        arbiter: Address,
        escrow_id: u64,
        release_to_beneficiary: bool,
    ) -> Result<(), PaymentError> {
        let _guard = acquire_reentrancy_lock(&env)?;
        arbiter.require_auth();
        require_not_paused(&env, PauseScope::Escrows)?;

        let mut escrow: Escrow = env
            .storage()
            .persistent()
            .get(&(ESCROW_KEY, escrow_id))
            .ok_or(PaymentError::EscrowNotFound)?;

        // Verify caller is the designated arbiter
        match &escrow.arbiter {
            Some(a) if *a == arbiter => {}
            _ => return Err(PaymentError::Unauthorized),
        }

        if escrow.released || escrow.claimed {
            return Err(PaymentError::EscrowAlreadyReleased);
        }

        let recipient = if release_to_beneficiary {
            escrow.beneficiary.clone()
        } else {
            escrow.depositor.clone()
        };

        let token_client = token::Client::new(&env, &escrow.asset);
        let contract_addr = env.current_contract_address();
        add_locked(&env, -escrow.amount);

        token_client.transfer(&contract_addr, &recipient, &escrow.amount);

        escrow.released = true;
        escrow.claimed = true;
        env.storage()
            .persistent()
            .set(&(ESCROW_KEY, escrow_id), &escrow);
        env.storage()
            .persistent()
            .extend_ttl(&(ESCROW_KEY, escrow_id), BUMP_MIN_TTL, BUMP_MAX_TTL);

        inc_counter(&env, &STAT_ESC_RELEASED);

        record_audit(
            &env,
            "escrow_released_arbiter",
            &arbiter,
            escrow_id,
            "Escrow released by arbiter",
        );

        Ok(())
    }

    /// Beneficiary claims escrow after deadline.
    pub fn claim_escrow(
        env: Env,
        beneficiary: Address,
        escrow_id: u64,
    ) -> Result<(), PaymentError> {
        let _guard = acquire_reentrancy_lock(&env)?;
        beneficiary.require_auth();
        require_not_paused(&env, PauseScope::Escrows)?;

        let mut escrow: Escrow = env
            .storage()
            .persistent()
            .get(&(ESCROW_KEY, escrow_id))
            .ok_or(PaymentError::EscrowNotFound)?;

        if beneficiary != escrow.beneficiary {
            return Err(PaymentError::Unauthorized);
        }
        if escrow.released || escrow.claimed {
            return Err(PaymentError::EscrowAlreadyReleased);
        }
        if env.ledger().timestamp() < escrow.deadline {
            return Err(PaymentError::EscrowNotDue);
        }

        // Transfer tokens to beneficiary (reentrancy-guarded, MEDIUM-4)
        let token_client = token::Client::new(&env, &escrow.asset);
        let contract_addr = env.current_contract_address();
        add_locked(&env, -escrow.amount);

        token_client.transfer(&contract_addr, &beneficiary, &escrow.amount);

        escrow.claimed = true;
        env.storage()
            .persistent()
            .set(&(ESCROW_KEY, escrow_id), &escrow);
        env.storage()
            .persistent()
            .extend_ttl(&(ESCROW_KEY, escrow_id), BUMP_MIN_TTL, BUMP_MAX_TTL);

        inc_counter(&env, &STAT_ESC_CLAIMED);

        record_audit(
            &env,
            "escrow_claimed",
            &beneficiary,
            escrow_id,
            "Escrow claimed by beneficiary",
        );

        Ok(())
    }

    /// Get escrow by ID
    pub fn get_escrow(env: Env, escrow_id: u64) -> Result<Escrow, PaymentError> {
        env.storage()
            .persistent()
            .get(&(ESCROW_KEY, escrow_id))
            .ok_or(PaymentError::EscrowNotFound)
    }

    /// Get escrow count
    pub fn get_escrow_count(env: Env) -> u64 {
        env.storage().instance().get(&ESCROW_COUNT).unwrap_or(0)
    }

}
