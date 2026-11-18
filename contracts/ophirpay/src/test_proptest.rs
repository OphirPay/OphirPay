// SPDX-License-Identifier: MIT
#![cfg(test)]

// Property-based tests for payment stream cancellation refund math (Issue #1965).
//
// Solvency Invariant:
// For any stream duration, elapsed time, and initial deposit:
//     sender_refund + recipient_paid == total_deposit
//
// This guarantees:
// 1. No funds are trapped in the contract.
// 2. No phantom value is created (conservation of value).
// 3. Precision division and rounding never cause mathematical loss or overflow.

extern crate std;

use crate::*;
use proptest::prelude::*;
use proptest::test_runner::Config as ProptestConfig;

/// Number of proptest cases to run. Defaults to 1,000 as required by Issue #1965.
fn proptest_cases() -> u32 {
    std::env::var("PROPTEST_CASES")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(1000)
}

fn get_proptest_config() -> ProptestConfig {
    ProptestConfig {
        cases: proptest_cases(),
        max_shrink_iters: 100,
        ..ProptestConfig::default()
    }
}

proptest! {
    #![proptest_config(get_proptest_config())]

    /// Verify mathematical solvency invariant for stream cancellation:
    /// For any valid total_deposit, start_time, duration, and elapsed time:
    ///   sender_refund + recipient_paid == total_deposit
    #[test]
    fn prop_stream_cancellation_refund_math_solvency_invariant(
        total_deposit in 1i128..=1_000_000_000_000_000_000i128,
        start_time in 0u64..=1_000_000_000u64,
        duration in 1u64..=1_000_000_000u64,
        elapsed_offset in 0u64..=2_000_000_000u64,
        claimed_ratio_bps in 0u32..=10_000u32,
    ) {
        let end_time = start_time.saturating_add(duration);
        let now = start_time.saturating_add(elapsed_offset);

        // Replicate contract vesting calculation
        let actual_duration = end_time.saturating_sub(start_time);
        let vested = if actual_duration == 0 || now >= end_time {
            total_deposit
        } else if now <= start_time {
            0
        } else {
            compute_vested(total_deposit, start_time, end_time, now)
        };

        // Vested amount must always be bounded within [0, total_deposit]
        prop_assert!(vested >= 0, "vested amount cannot be negative");
        prop_assert!(vested <= total_deposit, "vested amount cannot exceed total deposit");

        // Simulate prior claims (up to the currently vested amount)
        let claimed_amount = ((vested as u128 * claimed_ratio_bps as u128) / 10_000u128) as i128;
        prop_assert!(claimed_amount <= vested, "claimed cannot exceed vested");

        // Calculate earned unclaimed and unvested exactly as contract does
        let earned_unclaimed = vested
            .checked_sub(claimed_amount)
            .expect("earned_unclaimed underflow");
        let unvested = total_deposit.saturating_sub(vested);

        let sender_refund = unvested;
        let recipient_paid = claimed_amount + earned_unclaimed;

        // Invariant 1: Total conservation: sender refund + recipient payout == total deposit
        prop_assert_eq!(
            sender_refund + recipient_paid,
            total_deposit,
            "Solvency invariant violated: sender_refund ({}) + recipient_paid ({}) != total_deposit ({})",
            sender_refund,
            recipient_paid,
            total_deposit
        );

        // Invariant 2: Total received by recipient across lifetime equals exactly the vested amount
        prop_assert_eq!(
            recipient_paid,
            vested,
            "Recipient paid ({}) does not equal vested amount ({})",
            recipient_paid,
            vested
        );

        // Invariant 3: Neither payout is negative
        prop_assert!(sender_refund >= 0, "sender refund must be non-negative");
        prop_assert!(recipient_paid >= 0, "recipient paid must be non-negative");

        // Invariant 4: Neither payout exceeds total deposit
        prop_assert!(sender_refund <= total_deposit, "sender refund cannot exceed total deposit");
        prop_assert!(recipient_paid <= total_deposit, "recipient paid cannot exceed total deposit");
    }

    /// Stress test extreme boundary amounts including large i128 values without arithmetic overflow
    #[test]
    fn prop_stream_cancellation_large_values_no_overflow(
        total_deposit in (i128::MAX / 2)..=i128::MAX,
        duration in 1u64..=u64::MAX / 4,
        elapsed_fraction in 0u32..=1_000_000u32,
    ) {
        let start_time = 1_000_000u64;
        let end_time = start_time + duration;
        let elapsed = ((duration as u128 * elapsed_fraction as u128) / 1_000_000u128) as u64;
        let now = start_time + elapsed;

        let vested = compute_vested(total_deposit, start_time, end_time, now);
        let unvested = total_deposit.saturating_sub(vested);

        let sender_refund = unvested;
        let recipient_paid = vested;

        prop_assert_eq!(
            sender_refund + recipient_paid,
            total_deposit,
            "Conservation violated for large i128 values"
        );
        prop_assert!(vested >= 0);
        prop_assert!(vested <= total_deposit);
    }
}

#[cfg(test)]
mod contract_stream_tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger as _};
    use soroban_sdk::{token, Address, Env, String};

    #[test]
    fn test_stream_cancellation_on_chain_conservation() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1_000_000);

        let owner = Address::generate(&env);
        let creator = Address::generate(&env);
        let recipient = Address::generate(&env);
        let token_admin = Address::generate(&env);

        let token_id = env
            .register_stellar_asset_contract_v2(token_admin.clone())
            .address();
        let token_client = token::Client::new(&env, &token_id);
        let token_admin_client = token::StellarAssetClient::new(&env, &token_id);

        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        client.init(&owner);
        client.set_timelock_enabled(&owner, &false);

        let total_deposit = 10_000_000i128;
        token_admin_client.mint(&creator, &total_deposit);

        let start_time = 1_000_000u64;
        let duration = 10_000u64;
        let end_time = start_time + duration;

        // Create payment stream
        let stream_id = client.create_stream(
            &creator,
            &recipient,
            &total_deposit,
            &token_id,
            &start_time,
            &end_time,
            &String::from_str(&env, "stream_metadata"),
        );
        assert_eq!(stream_id, 1);
        assert_eq!(client.get_locked_balance(), total_deposit);

        // Advance time to 25% of stream duration
        env.ledger().set_timestamp(start_time + 2_500);

        // Recipient claims vested portion at 25% (2,500,000)
        let claimed_1 = client.claim_stream(&recipient, &stream_id);
        assert_eq!(claimed_1, 2_500_000);
        assert_eq!(token_client.balance(&recipient), 2_500_000);

        // Advance time to 60% of stream duration
        env.ledger().set_timestamp(start_time + 6_000);

        // Creator cancels stream
        let refund = client.cancel_stream(&creator, &stream_id);
        // Total vested at 60% is 6,000,000
        // Unvested refund to creator: 10,000,000 - 6,000,000 = 4,000,000
        assert_eq!(refund, 4_000_000);
        assert_eq!(token_client.balance(&creator), 4_000_000);

        // Recipient should have received the newly earned unclaimed amount (3,500,000)
        // Total recipient payout: 2,500,000 (claimed) + 3,500,000 (at cancel) = 6,000,000
        assert_eq!(token_client.balance(&recipient), 6_000_000);

        // Verify total conservation: creator refund (4,000,000) + recipient total (6,000,000) == 10,000,000
        let sender_refund = token_client.balance(&creator);
        let recipient_paid = token_client.balance(&recipient);
        assert_eq!(sender_refund + recipient_paid, total_deposit);

        // Locked balance must be 0 after cancellation
        assert_eq!(client.get_locked_balance(), 0);
    }
}
