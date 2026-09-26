//! Payment streaming domain entrypoints.

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
    //  PAYMENT STREAMING — Vest tokens linearly over time
    // ═══════════════════════════════════════════════════════════

    /// Create a payment stream. Tokens are locked and vest linearly.
    pub fn create_stream(
        env: Env,
        creator: Address,
        recipient: Address,
        total_amount: i128,
        asset: Address,
        start_time: u64,
        end_time: u64,
        metadata: String,
    ) -> Result<u64, PaymentError> {
        let _guard = acquire_reentrancy_lock(&env)?;
        creator.require_auth();
        require_not_paused(&env, PauseScope::Streams)?;
        if total_amount <= 0 {
            return Err(PaymentError::InvalidAmount);
        }
        if end_time <= start_time {
            return Err(PaymentError::InvalidAmount);
        }

        // Transfer total amount from creator to contract (reentrancy-guarded, MEDIUM-4)
        let token_client = token::Client::new(&env, &asset);
        let contract_addr = env.current_contract_address();
        token_client.transfer(&creator, &contract_addr, &total_amount);

        add_locked(&env, total_amount);

        let mut count: u64 = env.storage().instance().get(&STREAM_COUNT).unwrap_or(0);
        count += 1;

        let creator_clone = creator.clone();
        let stream = Stream {
            id: count,
            creator,
            recipient: recipient.clone(),
            total_amount,
            claimed_amount: 0,
            asset,
            start_time,
            end_time,
            cancelled: false,
            metadata,
        };

        env.storage()
            .persistent()
            .set(&(STREAM_KEY, count), &stream);
        env.storage()
            .persistent()
            .extend_ttl(&(STREAM_KEY, count), BUMP_MIN_TTL, BUMP_MAX_TTL);
        env.storage().instance().set(&STREAM_COUNT, &count);
        env.storage().instance().extend_ttl(BUMP_MIN_TTL, BUMP_MAX_TTL);

        emit_stream_event(
            &env,
            &env.current_contract_address(),
            &recipient,
            &total_amount,
        );

        inc_counter(&env, &STAT_STR_CREATED);
        add_counter(&env, &STAT_AMT_STREAMED, total_amount);

        record_audit(
            &env,
            "stream_created",
            &creator_clone,
            count,
            "Stream created",
        );

        Ok(count)
    }

    /// Claim vested tokens from a stream. Can be called any time.
    pub fn claim_stream(
        env: Env,
        recipient: Address,
        stream_id: u64,
    ) -> Result<i128, PaymentError> {
        let _guard = acquire_reentrancy_lock(&env)?;
        recipient.require_auth();
        require_not_paused(&env, PauseScope::Streams)?;

        let mut stream: Stream = env
            .storage()
            .persistent()
            .get(&(STREAM_KEY, stream_id))
            .ok_or(PaymentError::StreamNotFound)?;

        if recipient != stream.recipient {
            return Err(PaymentError::Unauthorized);
        }
        if stream.cancelled {
            return Err(PaymentError::StreamAlreadyCancelled);
        }

        let now = env.ledger().timestamp();
        if now < stream.start_time {
            return Err(PaymentError::StreamNotStarted);
        }

        // Calculate vested amount linearly with overflow protection
        let vested = compute_vested(stream.total_amount, stream.start_time, stream.end_time, now);

        // INV-5: `vested` is monotonically non-decreasing over time and is the
        // only value ever written to `claimed_amount`, so this subtraction must
        // be non-negative. Check rather than wrap: an impossible negative (or
        // wrapped) claimable would pay the recipient a nonsensical amount.
        let claimable = vested
            .checked_sub(stream.claimed_amount)
            .ok_or(PaymentError::StreamInvariantViolated)?;
        if claimable <= 0 {
            return Err(PaymentError::StreamFullyClaimed);
        }

        // Transfer claimable amount to recipient (reentrancy-guarded, MEDIUM-4)
        let token_client = token::Client::new(&env, &stream.asset);
        let contract_addr = env.current_contract_address();
        add_locked(&env, -claimable);

        token_client.transfer(&contract_addr, &recipient, &claimable);

        stream.claimed_amount += claimable;
        env.storage()
            .persistent()
            .set(&(STREAM_KEY, stream_id), &stream);
        env.storage()
            .persistent()
            .extend_ttl(&(STREAM_KEY, stream_id), BUMP_MIN_TTL, BUMP_MAX_TTL);

        inc_counter(&env, &STAT_STR_CLAIMED);

        record_audit(
            &env,
            "stream_claimed",
            &recipient,
            stream_id,
            "Stream claimed",
        );

        Ok(claimable)
    }

    /// Creator cancels a stream. All tokens not yet claimed are returned to creator.
    pub fn cancel_stream(env: Env, creator: Address, stream_id: u64) -> Result<i128, PaymentError> {
        let _guard = acquire_reentrancy_lock(&env)?;
        creator.require_auth();
        require_not_paused(&env, PauseScope::Streams)?;

        let mut stream: Stream = env
            .storage()
            .persistent()
            .get(&(STREAM_KEY, stream_id))
            .ok_or(PaymentError::StreamNotFound)?;

        if creator != stream.creator {
            return Err(PaymentError::Unauthorized);
        }
        if stream.cancelled {
            return Err(PaymentError::StreamAlreadyCancelled);
        }

        let now = env.ledger().timestamp();
        let vested = compute_vested(stream.total_amount, stream.start_time, stream.end_time, now);

        let unvested = stream.total_amount.saturating_sub(vested);

        stream.cancelled = true;
        env.storage()
            .persistent()
            .set(&(STREAM_KEY, stream_id), &stream);
        env.storage()
            .persistent()
            .extend_ttl(&(STREAM_KEY, stream_id), BUMP_MIN_TTL, BUMP_MAX_TTL);

        if unvested > 0 {
            // Reentrancy-guarded transfer (MEDIUM-4)
            let token_client = token::Client::new(&env, &stream.asset);
            let contract_addr = env.current_contract_address();
            token_client.transfer(&contract_addr, &creator, &unvested);
            add_locked(&env, -unvested);
        }

        inc_counter(&env, &STAT_STR_CANCELLED);

        record_audit(
            &env,
            "stream_cancelled",
            &creator,
            stream_id,
            "Stream cancelled",
        );

        Ok(unvested)
    }

    /// Get a stream by ID
    pub fn get_stream(env: Env, stream_id: u64) -> Result<Stream, PaymentError> {
        env.storage()
            .persistent()
            .get(&(STREAM_KEY, stream_id))
            .ok_or(PaymentError::StreamNotFound)
    }

    /// Get stream count
    pub fn get_stream_count(env: Env) -> u64 {
        env.storage().instance().get(&STREAM_COUNT).unwrap_or(0)
    }

}
