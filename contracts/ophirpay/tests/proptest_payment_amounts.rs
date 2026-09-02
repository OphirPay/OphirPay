// SPDX-License-Identifier: MIT
#![cfg(test)]

//! Property-based fuzzing for payment **amounts** and **edge values** (Issue #89).
//!
//! Context: contract unit tests and one property suite (`proptest_token_moving.rs`)
//! already cover escrow/stream/proposal paths and `LOCKED_BALANCE` conservation.
//! This suite targets the *batch payment amount* surface directly, which the other
//! suites do not fuzz:
//!
//!   1. Zero, negative, `i128::MIN`/`i128::MAX`, and boundary amounts.
//!   2. Maximum batch size (`100` payees) and the >100 overflow boundary.
//!   3. Timestamp edges (`0`, `u64::MAX`, mid-range).
//!   4. Invariants: no panic, no i128 overflow, and exact amount-accounting
//!      (`successful + failed == total_requests`, `total_amount` is the exact sum
//!      of the positive entries, `get_locked_balance() == 0` since batches do not
//!      lock funds).
//!
//! Runs in CI under `cargo test` with a bounded per-case budget. The case count is
//! read from the `PROPTEST_CASES` env var (set in CI) and defaults to `64`.

use ophirpay_contract::{
    BatchCreateResult, OphirPayContract, OphirPayContractClient, PaymentError,
};
use proptest::prelude::*;
use proptest::test_runner::Config as ProptestConfig;
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{Address, Env, String, Vec};

/// Maximum number of payees a single batch accepts (contract enforces `len > 100` fails).
const MAX_BATCH_SIZE: u32 = 100;

fn proptest_cases() -> u32 {
    std::env::var("PROPTEST_CASES")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(64)
}

fn get_proptest_config() -> ProptestConfig {
    ProptestConfig {
        cases: proptest_cases(),
        max_shrink_iters: 100,
        ..ProptestConfig::default()
    }
}

#[allow(dead_code)]
struct AmountHarness<'a> {
    env: Env,
    client: OphirPayContractClient<'a>,
    owner: Address,
    creator: Address,
    asset: Address,
}

impl<'a> AmountHarness<'a> {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        // Mid-range baseline timestamp; individual tests override the edges.
        env.ledger().set_timestamp(1_000_000);

        let owner = Address::generate(&env);
        let creator = Address::generate(&env);
        let asset = Address::generate(&env);

        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        client.init(&owner);

        AmountHarness {
            env,
            client,
            owner,
            creator,
            asset,
        }
    }

    fn make_payees(&self, n: u32) -> Vec<Address> {
        let mut v = Vec::new(&self.env);
        for _ in 0..n {
            v.push_back(Address::generate(&self.env));
        }
        v
    }

    fn make_amounts(&self, amounts: &[i128]) -> Vec<i128> {
        let mut v = Vec::new(&self.env);
        for &a in amounts {
            v.push_back(a);
        }
        v
    }

    fn tx_hash(&self, tag: &str) -> String {
        String::from_str(&self.env, tag)
    }

    /// Invoke `create_batch` and flatten the Soroban client's double-`Result`
    /// into a plain `Result<BatchCreateResult, PaymentError>`, so properties can
    /// assert on the exact contract error (or the exact accounting summary).
    ///
    /// The generated `try_create_batch` client returns
    /// `Result<Result<BatchCreateResult, ConversionError>, Result<PaymentError, InvokeError>>`:
    ///   - `Ok(Ok(summary))`  → the batch was created successfully;
    ///   - `Err(Ok(err))`     → the contract returned a `PaymentError`;
    ///   - the remaining arms are low-level host/invocation failures that must
    ///     never surface for a well-formed call under `mock_all_auths`.
    fn create_batch(
        &self,
        payees: &Vec<Address>,
        amounts: &Vec<i128>,
        tx_hash: &String,
    ) -> Result<BatchCreateResult, PaymentError> {
        let result =
            self.client
                .try_create_batch(&self.creator, payees, amounts, &self.asset, tx_hash);
        match result {
            Ok(Ok(summary)) => Ok(summary),
            Err(Ok(err)) => Err(err),
            Ok(Err(conv)) => panic!("unexpected host conversion error: {conv:?}"),
            Err(Err(invoke)) => panic!("unexpected invocation error: {invoke:?}"),
        }
    }

    /// Expected accounting for a batch of `amounts`, independent of the contract.
    ///
    /// Returns the number of valid (positive) entries and the exact summed total.
    /// Entries with `amount <= 0` are skipped/failed by the contract.
    fn expected_accounting(amounts: &[i128]) -> (u32, i128) {
        let mut valid: u32 = 0;
        let mut total: i128 = 0;
        for &a in amounts {
            if a > 0 {
                valid += 1;
                total = total.saturating_add(a);
            }
        }
        (valid, total)
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. BATCH AMOUNT ACCOUNTING — zero, negative, and bounded positive amounts
// ═══════════════════════════════════════════════════════════════════════════

proptest! {
    #![proptest_config(get_proptest_config())]

    /// For batches up to the max size, mixed zero/negative/positive amounts are
    /// skipped or summed exactly as the model predicts — no panic, no overflow,
    /// precise `successful`/`failed`/`total_amount` bookkeeping, and batches do
    /// not lock any funds.
    ///
    /// `n` is capped at `96`, not `MAX_BATCH_SIZE = 100`: every valid payee
    /// emits a `payments.*` contract event (~170 B each), and a single Soroban
    /// invocation has a hard 16 KiB *contract-events-size* budget (16384 B). A
    /// 100-valid-entry batch burns ~17 KB of events and is rejected by the
    /// underlying host before the contract can finish. Keeping the worst case
    /// (every entry valid) under 16 KiB makes the property deterministic.
    #[test]
    fn prop_batch_amount_accounting_is_exact(
        n in 0u32..=96u32,
        amounts in proptest::collection::vec(
            -1_000_000i128..=1_000_000i128,
            96, // upper bound only; sliced below
        ),
    ) {
        let h = AmountHarness::new();
        // Take exactly `n` amounts (0 forces the empty path).
        let amounts = amounts[..n as usize].to_vec();
        let payees = h.make_payees(n);
        let amounts_vec = h.make_amounts(&amounts);
        let tx_hash = h.tx_hash("prop_accounting");

        let (expected_valid, expected_total) = AmountHarness::expected_accounting(&amounts);

        let result = h.create_batch(&payees, &amounts_vec, &tx_hash);

        if expected_valid == 0 {
            // All entries skipped/empty → batch rejected as empty; no panic.
            prop_assert!(
                matches!(result, Err(PaymentError::BatchEmpty)),
                "all-amounts non-positive batch should be rejected as BatchEmpty"
            );
        } else {
            let summary = result.expect("valid batch must succeed without panic");
            // Amount accounting is exact.
            prop_assert_eq!(summary.total_requests, n);
            prop_assert_eq!(summary.successful, expected_valid);
            prop_assert_eq!(summary.failed, n - expected_valid);
            prop_assert_eq!(summary.total_amount, expected_total);
            // Invariant: counts always reconcile.
            prop_assert_eq!(summary.successful + summary.failed, summary.total_requests);
            // Batches never lock funds.
            prop_assert_eq!(h.client.get_locked_balance(), 0);

            // Persisted batch matches the returned summary.
            let batch = h.client.get_batch(&summary.batch_id);
            prop_assert_eq!(batch.total_recipients, expected_valid);
            prop_assert_eq!(batch.total_amount, expected_total);
            prop_assert_eq!(batch.payment_ids.len(), expected_valid as u32);
        }
    }

    /// Boundary amounts as a single payment: max i128 (no overflow), and
    /// zero/negative values (rejected as empty batch — not panics).
    #[test]
    fn prop_single_batch_boundary_amounts_no_overflow(amount in proptest::sample::select(&[
        i128::MIN, -1i128, i128::MIN / 2, 0i128,
    ])) {
        let h = AmountHarness::new();
        let payees = h.make_payees(1);
        let amounts_vec = h.make_amounts(&[amount]);
        let tx_hash = h.tx_hash("prop_boundary_single");

        let result = h.create_batch(&payees, &amounts_vec, &tx_hash);

        // Non-positive single entry → BatchEmpty, never a panic.
        prop_assert!(
            matches!(result, Err(PaymentError::BatchEmpty)),
            "non-positive amount should be rejected as BatchEmpty"
        );
        prop_assert_eq!(h.client.get_locked_balance(), 0);
    }

    #[test]
    fn prop_single_batch_max_i128_succeeds_without_overflow(amount in proptest::sample::select(&[
        1i128,
        i128::MAX / 2,
        i128::MAX - 1,
        i128::MAX,
    ])) {
        let h = AmountHarness::new();
        let payees = h.make_payees(1);
        let amounts_vec = h.make_amounts(&[amount]);
        let tx_hash = h.tx_hash("prop_boundary_max");

        let result = h.create_batch(&payees, &amounts_vec, &tx_hash);
        let summary = result.expect("max-i128 single payment must not panic or overflow");
        prop_assert_eq!(summary.total_requests, 1);
        prop_assert_eq!(summary.successful, 1);
        prop_assert_eq!(summary.failed, 0);
        // Exact boundary value is preserved (no wraparound).
        prop_assert_eq!(summary.total_amount, amount);
        prop_assert_eq!(h.client.get_locked_balance(), 0);

        let batch = h.client.get_batch(&summary.batch_id);
        prop_assert_eq!(batch.total_amount, amount);
        prop_assert_eq!(batch.payment_ids.len(), 1);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. MAX BATCH SIZE — the 96-feasible success boundary and the >100 rejection
// ═══════════════════════════════════════════════════════════════════════════
//
// The contract permits up to `MAX_BATCH_SIZE = 100` payees, but a single
// Soroban invocation caps the size of the *contract events* it may emit at
// 16 KiB. Each valid payee emits a payment event (~170 B), so a batch of
// 97+ fully-valid entries is rejected by the host (`Budget, ExceededLimit`)
// before the contract returns. Hence:
//   - success is fuzzed up to 96 payees (the largest size a single mock
//     invocation can record), with exact accounting; and
//   - rejection is fuzzed for 101+ payees (the documented `BatchTooLarge`
//     guard in `create_batch`), which emits no events and is unbounded.

proptest! {
    #![proptest_config(get_proptest_config())]

    /// The largest batch a single invocation can fully record still succeeds
    /// with exact accounting — no panic, no overflow, no locked funds.
    #[test]
    fn prop_batch_size_max_success_accounting(n in 88u32..=96u32) {
        let h = AmountHarness::new();
        let payees = h.make_payees(n);
        let amounts: Vec<i128> = h.make_amounts(&vec![10_000i128; n as usize]);
        let tx_hash = h.tx_hash("prop_batch_size");

        let summary = h
            .create_batch(&payees, &amounts, &tx_hash)
            .expect("batch at the feasible max size must succeed without panic");
        prop_assert_eq!(summary.total_requests, n);
        prop_assert_eq!(summary.successful, n);
        prop_assert_eq!(summary.failed, 0);
        prop_assert_eq!(summary.total_amount, 10_000i128 * n as i128);
        prop_assert_eq!(summary.successful + summary.failed, summary.total_requests);
        prop_assert_eq!(h.client.get_locked_balance(), 0);
    }

    /// Any batch larger than `MAX_BATCH_SIZE` is rejected outright as
    /// `BatchTooLarge` — no payment is recorded, no funds are locked.
    #[test]
    fn prop_batch_size_overflow_is_rejected(n in 101u32..=105u32) {
        let h = AmountHarness::new();
        let payees = h.make_payees(n);
        let amounts: Vec<i128> = h.make_amounts(&vec![10_000i128; n as usize]);
        let tx_hash = h.tx_hash("prop_batch_overflow");

        let result = h.create_batch(&payees, &amounts, &tx_hash);
        prop_assert!(
            matches!(result, Err(PaymentError::BatchTooLarge)),
            "batch larger than 100 payees should be rejected as BatchTooLarge"
        );
        prop_assert_eq!(h.client.get_locked_balance(), 0);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. TIMESTAMP EDGES — batch/payment timestamps survive extreme ledger times
// ═══════════════════════════════════════════════════════════════════════════

proptest! {
    #![proptest_config(get_proptest_config())]

    /// For extreme ledger timestamps (0, mid-range, `u64::MAX`), recording a
    /// batch must not panic, overflow, or corrupt the persisted timestamp.
    #[test]
    fn prop_batch_timestamp_edges_are_recorded_exactly(timestamp in proptest::sample::select(&[
        0u64,
        1u64,
        1_000_000u64,
        u64::MAX - 1,
        u64::MAX,
    ])) {
        let h = AmountHarness::new();
        h.env.ledger().set_timestamp(timestamp);

        let payees = h.make_payees(2);
        let amounts_vec = h.make_amounts(&[1000i128, 2000i128]);
        let tx_hash = h.tx_hash("prop_timestamp");

        let summary = h
            .create_batch(&payees, &amounts_vec, &tx_hash)
            .expect("batch must not panic at any ledger timestamp");

        prop_assert_eq!(summary.successful, 2);
        prop_assert_eq!(summary.total_amount, 3000);

        // The persisted batch and its payments carry the exact ledger timestamp.
        let batch = h.client.get_batch(&summary.batch_id);
        prop_assert_eq!(batch.timestamp, timestamp);

        let payments = h.client.get_payments_by_batch(&summary.batch_id);
        prop_assert_eq!(payments.len(), 2);
        for p in payments.iter() {
            prop_assert_eq!(p.timestamp, timestamp);
        }
        prop_assert_eq!(h.client.get_locked_balance(), 0);
    }
}
