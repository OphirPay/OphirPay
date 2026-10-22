// SPDX-License-Identifier: MIT
#![cfg(test)]

//! Daily spending-limit windows and atomic batch pre-checks.
//!
//! Windows are calendar-aligned (`timestamp / 86_400`), so crossing into a new
//! ledger day resets the daily accumulator even if fewer than 24 hours have
//! elapsed since the previous transaction, and a multi-day inactivity gap is
//! handled without a separate "poke" transaction.

use ophirpay_contract::{
    OphirPayContract, OphirPayContractClient, PaymentError, SpendCheckResult,
};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{Address, Env, String, Vec};

const DAY: u64 = 86_400;

struct Fixture<'a> {
    env: Env,
    client: OphirPayContractClient<'a>,
    owner: Address,
    asset: Address,
}

impl<'a> Fixture<'a> {
    fn new(timestamp: u64) -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(timestamp);

        let owner = Address::generate(&env);
        let asset = Address::generate(&env);
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        client.init(&owner);
        client.set_timelock_enabled(&owner, &false);

        Fixture {
            env,
            client,
            owner,
            asset,
        }
    }

    fn set_limit(&self, user: &Address, daily: i128, monthly: i128) {
        // Expiry is far enough away that the window, not expiry, is under test.
        let expires_at = self.env.ledger().timestamp() + 90 * DAY;
        self.client
            .set_spending_limit(&self.owner, user, &daily, &monthly, &expires_at, &true);
    }

    fn spend(&self, payer: &Address, amount: i128, hash: &str) -> u64 {
        let payee = Address::generate(&self.env);
        self.client.atomic_spend(
            payer,
            &payee,
            &amount,
            &self.asset,
            &String::from_str(&self.env, hash),
            &String::from_str(&self.env, "spending-limit-test"),
        )
    }
}

#[test]
fn daily_window_resets_on_ledger_day_boundary_before_24h_elapses() {
    // 86_399 is the last second of UTC day 0; the next second starts day 1.
    let fix = Fixture::new(DAY - 1);
    let payer = Address::generate(&fix.env);
    fix.set_limit(&payer, 10_000_000, 100_000_000);

    assert_eq!(fix.spend(&payer, 6_000_000, "day0-a"), 1);

    // Only one second of wall-clock time has passed, but the ledger day has
    // advanced: the daily window must reset.
    fix.env.ledger().set_timestamp(DAY);

    assert_eq!(fix.spend(&payer, 9_000_000, "day1-a"), 2);

    let limit = fix.client.get_spending_limit(&payer).unwrap();
    assert_eq!(limit.current_daily_spend, 9_000_000);
}

#[test]
fn daily_window_resets_after_multi_day_inactivity_gap() {
    let fix = Fixture::new(1_000_000);
    let payer = Address::generate(&fix.env);
    fix.set_limit(&payer, 10_000_000, 500_000_000);

    assert_eq!(fix.spend(&payer, 10_000_000, "gap-a"), 1);

    // A second spend on the same day is rejected.
    let payee = Address::generate(&fix.env);
    let rejected = fix.client.try_atomic_spend(
        &payer,
        &payee,
        &1i128,
        &fix.asset,
        &String::from_str(&fix.env, "gap-b"),
        &String::from_str(&fix.env, "same-day"),
    );
    assert_eq!(rejected, Err(Ok(PaymentError::SpendingLimitExceeded)));

    // Three quiet days later the accumulated spend must be stale.
    fix.env
        .ledger()
        .set_timestamp(fix.env.ledger().timestamp() + 3 * DAY);

    assert_eq!(fix.spend(&payer, 4_000_000, "gap-c"), 2);

    let limit = fix.client.get_spending_limit(&payer).unwrap();
    assert_eq!(limit.current_daily_spend, 4_000_000);
}

#[test]
fn batch_exceeding_remaining_capacity_reverts_atomically() {
    let fix = Fixture::new(2_000_000);
    let creator = Address::generate(&fix.env);
    fix.set_limit(&creator, 10_000_000, 100_000_000);

    let mut payees = Vec::new(&fix.env);
    payees.push_back(Address::generate(&fix.env));
    payees.push_back(Address::generate(&fix.env));

    let mut amounts = Vec::new(&fix.env);
    amounts.push_back(6_000_000i128);
    amounts.push_back(6_000_000i128);

    let result = fix.client.try_create_batch(
        &creator,
        &payees,
        &amounts,
        &fix.asset,
        &String::from_str(&fix.env, "batch-too-large"),
    );
    match result {
        Err(Ok(err)) => assert_eq!(err, PaymentError::SpendingLimitExceeded),
        _ => panic!("batch exceeding the limit must revert with SpendingLimitExceeded"),
    }

    // Nothing was written: no batch, no payments, no debited quota.
    assert_eq!(fix.client.get_batch_count(), 0);
    assert_eq!(fix.client.get_payment_count(), 0);
    let limit = fix.client.get_spending_limit(&creator).unwrap();
    assert_eq!(limit.current_daily_spend, 0);
}

#[test]
fn batch_checks_total_against_remaining_capacity_before_debiting() {
    let fix = Fixture::new(2_500_000);
    let creator = Address::generate(&fix.env);
    fix.set_limit(&creator, 10_000_000, 100_000_000);

    // Consume 6M of the 10M daily allowance.
    assert_eq!(fix.spend(&creator, 6_000_000, "before-batch"), 1);

    let mut payees = Vec::new(&fix.env);
    payees.push_back(Address::generate(&fix.env));
    let mut amounts = Vec::new(&fix.env);
    amounts.push_back(5_000_000i128); // 5M > 4M remaining

    let rejected = fix.client.try_create_batch(
        &creator,
        &payees,
        &amounts,
        &fix.asset,
        &String::from_str(&fix.env, "batch-over-remaining"),
    );
    match rejected {
        Err(Ok(err)) => assert_eq!(err, PaymentError::SpendingLimitExceeded),
        _ => panic!("batch over remaining capacity must revert"),
    }
    assert_eq!(fix.client.get_batch_count(), 0);

    // A batch that fits exactly consumes the rest of the allowance atomically.
    let mut fits = Vec::new(&fix.env);
    fits.push_back(4_000_000i128);
    let result = fix.client.create_batch(
        &creator,
        &payees,
        &fits,
        &fix.asset,
        &String::from_str(&fix.env, "batch-fits"),
    );

    assert_eq!(result.successful, 1);
    assert_eq!(result.total_amount, 4_000_000);
    assert_eq!(fix.client.get_batch_count(), 1);

    let limit = fix.client.get_spending_limit(&creator).unwrap();
    assert_eq!(limit.current_daily_spend, 10_000_000);
}

#[test]
fn batch_next_day_starts_from_fresh_daily_capacity() {
    let fix = Fixture::new(DAY * 5);
    let creator = Address::generate(&fix.env);
    fix.set_limit(&creator, 10_000_000, 100_000_000);

    assert_eq!(fix.spend(&creator, 10_000_000, "day5-full"), 1);

    // Same day: any batch is over the limit.
    let mut payees = Vec::new(&fix.env);
    payees.push_back(Address::generate(&fix.env));
    let mut amounts = Vec::new(&fix.env);
    amounts.push_back(1_000_000i128);

    let same_day = fix.client.try_create_batch(
        &creator,
        &payees,
        &amounts,
        &fix.asset,
        &String::from_str(&fix.env, "day5-batch"),
    );
    match same_day {
        Err(Ok(err)) => assert_eq!(err, PaymentError::SpendingLimitExceeded),
        _ => panic!("same-day batch must be rejected"),
    }

    // Next ledger day: the full daily allowance is available again.
    fix.env
        .ledger()
        .set_timestamp(fix.env.ledger().timestamp() + DAY);
    let next_day = fix.client.create_batch(
        &creator,
        &payees,
        &amounts,
        &fix.asset,
        &String::from_str(&fix.env, "day6-batch"),
    );

    assert_eq!(next_day.successful, 1);
    assert_eq!(fix.client.get_batch_count(), 1);
}

#[test]
fn check_spending_stays_read_only_and_window_aware() {
    let fix = Fixture::new(DAY * 7);
    let payer = Address::generate(&fix.env);
    let payee = Address::generate(&fix.env);
    fix.set_limit(&payer, 10_000_000, 100_000_000);

    assert_eq!(fix.spend(&payer, 10_000_000, "day7-full"), 1);

    // Same day: rejected, and the stored counter is untouched.
    assert!(matches!(
        fix.client.check_spending(&payer, &1i128),
        SpendCheckResult::Rejected
    ));
    let limit = fix.client.get_spending_limit(&payer).unwrap();
    assert_eq!(limit.current_daily_spend, 10_000_000);

    // Next day: the read-only check sees a fresh window but must not write it.
    fix.env
        .ledger()
        .set_timestamp(fix.env.ledger().timestamp() + DAY);
    assert!(matches!(
        fix.client.check_spending(&payer, &10_000_000i128),
        SpendCheckResult::Approved
    ));

    let untouched = fix.client.get_spending_limit(&payer).unwrap();
    assert_eq!(untouched.current_daily_spend, 10_000_000);

    // The authorized write path (atomic_spend) then resets and debits.
    let _ = payee;
    assert_eq!(fix.spend(&payer, 3_000_000, "day8-a"), 2);
    let after = fix.client.get_spending_limit(&payer).unwrap();
    assert_eq!(after.current_daily_spend, 3_000_000);
}

#[test]
fn record_payment_enforces_daily_spending_limit_and_reverts_atomically() {
    let fix = Fixture::new(3_000_000);
    let payer = Address::generate(&fix.env);
    let payee = Address::generate(&fix.env);
    fix.set_limit(&payer, 10_000_000, 100_000_000);

    // Record payment 6M of 10M daily allowance
    let id1 = fix.client.record_payment(
        &payer,
        &payee,
        &6_000_000i128,
        &fix.asset,
        &String::from_str(&fix.env, "rec-a"),
        &String::from_str(&fix.env, "payment 1"),
    );
    assert_eq!(id1, 1);

    let limit = fix.client.get_spending_limit(&payer).unwrap();
    assert_eq!(limit.current_daily_spend, 6_000_000);

    // Record payment 5M > 4M remaining capacity -> must revert with SpendingLimitExceeded (#1865)
    let rejected = fix.client.try_record_payment(
        &payer,
        &payee,
        &5_000_000i128,
        &fix.asset,
        &String::from_str(&fix.env, "rec-b"),
        &String::from_str(&fix.env, "over limit"),
    );
    match rejected {
        Err(Ok(err)) => assert_eq!(err, PaymentError::SpendingLimitExceeded),
        _ => panic!("record_payment exceeding remaining capacity must revert"),
    }

    // Ensure state was not mutated on failure
    assert_eq!(fix.client.get_payment_count(), 1);
    let limit = fix.client.get_spending_limit(&payer).unwrap();
    assert_eq!(limit.current_daily_spend, 6_000_000);

    // Payment fitting remaining capacity succeeds
    let id2 = fix.client.record_payment(
        &payer,
        &payee,
        &4_000_000i128,
        &fix.asset,
        &String::from_str(&fix.env, "rec-c"),
        &String::from_str(&fix.env, "payment 2"),
    );
    assert_eq!(id2, 2);
    let limit = fix.client.get_spending_limit(&payer).unwrap();
    assert_eq!(limit.current_daily_spend, 10_000_000);

    // Next ledger day: resets and fresh capacity is available
    fix.env
        .ledger()
        .set_timestamp(fix.env.ledger().timestamp() + DAY);
    let id3 = fix.client.record_payment(
        &payer,
        &payee,
        &2_000_000i128,
        &fix.asset,
        &String::from_str(&fix.env, "rec-d"),
        &String::from_str(&fix.env, "next day payment"),
    );
    assert_eq!(id3, 3);
    let limit = fix.client.get_spending_limit(&payer).unwrap();
    assert_eq!(limit.current_daily_spend, 2_000_000);
}
