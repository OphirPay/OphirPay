//! Batch payments domain entrypoints.

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
    //  BATCH PAYMENTS — Record multiple payments atomically
    // ═══════════════════════════════════════════════════════════

    /// Record a batch of payments with partial failure support.
    /// Valid entries are processed; invalid (zero amount, out-of-range index)
    /// entries are skipped and counted as failures. The batch succeeds as
    /// long as at least one payment was recorded.
    pub fn create_batch(
        env: Env,
        creator: Address,
        payees: Vec<Address>,
        amounts: Vec<i128>,
        asset: Address,
        tx_hash: String,
    ) -> Result<BatchCreateResult, PaymentError> {
        creator.require_auth();
        require_not_paused(&env, PauseScope::Batches)?;

        let len = payees.len();
        if len == 0 {
            return Err(PaymentError::BatchEmpty);
        }
        if len > 100 {
            return Err(PaymentError::BatchTooLarge);
        }

        let mut total_amount: i128 = 0;
        let mut pay_count: u64 = env.storage().instance().get(&PAYMENT_COUNT).unwrap_or(0);
        let mut payment_ids: Vec<u64> = Vec::new(&env);
        let mut actual_recipients: u32 = 0;

        // Two-pass: collect valid entries, then execute
        for i in 0..len {
            let amount = if i < amounts.len() {
                amounts.get(i).unwrap_or(0)
            } else {
                0 // out-of-range → skip
            };
            let payee = payees.get(i);

            // Skip invalid entries (zero/negative amount or missing payee)
            if amount <= 0 {
                continue;
            }
            total_amount = total_amount.checked_add(amount).ok_or(PaymentError::MathOverflow)?;
            pay_count += 1;
            actual_recipients += 1;
            payment_ids.push_back(pay_count);

            let payee_addr = payee.clone().ok_or(PaymentError::InvalidAmount)?;
            let payment = Payment {
                id: pay_count,
                payer: creator.clone(),
                payee: payee_addr.clone(),
                amount,
                asset: asset.clone(),
                tx_hash: tx_hash.clone(),
                timestamp: env.ledger().timestamp(),
                metadata: String::from_str(&env, "batch"),
                cancelled: false,
            };

            env.storage()
                .persistent()
                .set(&(PAYMENT_KEY, pay_count), &payment);
            env.storage()
                .persistent()
                .extend_ttl(&(PAYMENT_KEY, pay_count), BUMP_MIN_TTL, BUMP_MAX_TTL);

            emit_payment_event(&env, &creator, &payee_addr, &amount);
        }

        let successful = actual_recipients;
        let failed = len - successful;

        // Fail only if zero payments were recorded
        if successful == 0 {
            return Err(PaymentError::BatchEmpty);
        }

        env.storage().instance().set(&PAYMENT_COUNT, &pay_count);
        env.storage().instance().extend_ttl(BUMP_MIN_TTL, BUMP_MAX_TTL);

        let mut batch_count: u64 = env.storage().instance().get(&BATCH_COUNT).unwrap_or(0);
        batch_count += 1;

        let creator_clone = creator.clone();
        let batch = BatchPayment {
            id: batch_count,
            creator,
            total_recipients: actual_recipients,
            total_amount,
            asset,
            timestamp: env.ledger().timestamp(),
            tx_hash,
            payment_ids,
        };

        env.storage()
            .persistent()
            .set(&(BATCH_KEY, batch_count), &batch);
        env.storage()
            .persistent()
            .extend_ttl(&(BATCH_KEY, batch_count), BUMP_MIN_TTL, BUMP_MAX_TTL);
        env.storage().instance().set(&BATCH_COUNT, &batch_count);
        env.storage().instance().extend_ttl(BUMP_MIN_TTL, BUMP_MAX_TTL);

        inc_counter(&env, &STAT_BATCHES);
        add_counter(&env, &STAT_AMT_BATCHED, total_amount);
        add_u64_counter(&env, &STAT_PAYMENTS, successful as u64);

        record_audit(
            &env,
            "batch_created",
            &creator_clone,
            batch_count,
            "Batch payment created",
        );

        Ok(BatchCreateResult {
            batch_id: batch_count,
            total_requests: len,
            successful,
            failed,
            total_amount,
        })
    }

    /// Get a batch by ID
    pub fn get_batch(env: Env, batch_id: u64) -> Result<BatchPayment, PaymentError> {
        env.storage()
            .persistent()
            .get(&(BATCH_KEY, batch_id))
            .ok_or(PaymentError::PaymentNotFound)
    }

    /// Get batch count
    pub fn get_batch_count(env: Env) -> u64 {
        env.storage().instance().get(&BATCH_COUNT).unwrap_or(0)
    }

    /// Get the payments belonging to a batch, most recent first.
    ///
    /// Bounded enumeration (#742): the batch's id vector is only as small as
    /// the writer made it — batches created before the `BatchTooLarge` guard
    /// can hold more than `create_batch` accepts today — so the read is capped
    /// at [`MAX_READER_ENTRIES`] and reports truncation instead of walking the
    /// whole vector inside a single invocation.
    pub fn get_payments_by_batch(env: Env, batch_id: u64) -> PaymentList {
        let batch: Option<BatchPayment> = env.storage().persistent().get(&(BATCH_KEY, batch_id));
        let mut items = Vec::new(&env);
        let mut total: u32 = 0;
        let mut scanned: u32 = 0;

        if let Some(b) = batch {
            total = b.payment_ids.len();
            for index in 0..total {
                if items.len() >= MAX_READER_ENTRIES {
                    break;
                }
                scanned += 1;
                // Newest first: `create_batch` appends ids in creation order.
                if let Some(pid) = b.payment_ids.get(total - 1 - index) {
                    if let Some(p) = env.storage().persistent().get(&(PAYMENT_KEY, pid)) {
                        items.push_back(p);
                    }
                }
            }
        }

        PaymentList {
            items,
            total,
            // Exact: true only when the id vector was not fully walked.
            truncated: scanned < total,
        }
    }
}
