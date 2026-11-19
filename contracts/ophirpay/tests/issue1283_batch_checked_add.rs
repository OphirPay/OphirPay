#![cfg(test)]
// SPDX-License-Identifier: MIT
//
// Issue #1283 — `create_batch` must accumulate its total with checked
// arithmetic.
//
// The batch total feeds the LOCKED_BALANCE / spending-limit checks, so a
// silently wrapped sum would under-report a batch and let it bypass the
// fund-safety invariants. These tests drive the summation past `i128::MAX` and
// assert the contract fails gracefully with `PaymentError::ArithmeticOverflow`
// instead of panicking (a panic aborts the host with an opaque error) or
// writing wrapped state.

use ophirpay_contract::{OphirPayContract, OphirPayContractClient, PaymentError};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{Address, Env, String, Vec};

struct Fixture<'a> {
    env: Env,
    client: OphirPayContractClient<'a>,
    owner: Address,
    asset: Address,
    tx_hash: String,
}

impl<'a> Fixture<'a> {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1_000_000);

        let owner = Address::generate(&env);
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        client.init(&owner);
        client.set_timelock_enabled(&owner, &false);

        let asset = Address::generate(&env);
        let tx_hash = String::from_str(&env, "0xbatch_overflow");

        Fixture {
            env,
            client,
            owner,
            asset,
            tx_hash,
        }
    }
}

/// `i128::MAX + 1` overflows: the call returns `ArithmeticOverflow`, writes no
/// payment, and creates no batch — the batch is atomic.
#[test]
fn batch_total_overflow_returns_arithmetic_overflow() {
    let fix = Fixture::new();

    let mut payees = Vec::new(&fix.env);
    payees.push_back(Address::generate(&fix.env));
    payees.push_back(Address::generate(&fix.env));

    let mut amounts = Vec::new(&fix.env);
    amounts.push_back(i128::MAX);
    amounts.push_back(1);

    match fix
        .client
        .try_create_batch(&fix.owner, &payees, &amounts, &fix.asset, &fix.tx_hash)
    {
        Err(Ok(err)) => assert_eq!(err, PaymentError::ArithmeticOverflow),
        _ => panic!("expected ArithmeticOverflow, got a different result"),
    }

    // No partial state: the overflow is detected in pass 1, before any write.
    assert_eq!(fix.client.get_payment_count(), 0);
    assert_eq!(fix.client.get_batch_count(), 0);
}

/// The scenario from the issue: 100 entries close to `i128::MAX`. The sum
/// overflows long before the loop ends and must surface as a typed error, not
/// a panic.
#[test]
fn hundred_near_max_entries_are_rejected_without_panic() {
    let fix = Fixture::new();

    let mut payees = Vec::new(&fix.env);
    let mut amounts = Vec::new(&fix.env);
    for _ in 0..100 {
        payees.push_back(Address::generate(&fix.env));
        amounts.push_back(i128::MAX / 2);
    }

    match fix
        .client
        .try_create_batch(&fix.owner, &payees, &amounts, &fix.asset, &fix.tx_hash)
    {
        Err(Ok(err)) => assert_eq!(err, PaymentError::ArithmeticOverflow),
        _ => panic!("100 near-max entries must overflow gracefully"),
    }
    assert_eq!(fix.client.get_payment_count(), 0);
    assert_eq!(fix.client.get_batch_count(), 0);
}

/// A total of exactly `i128::MAX` is representable and must not be rejected —
/// checked addition only fails on a genuine overflow.
#[test]
fn batch_total_at_exactly_i128_max_is_accepted() {
    let fix = Fixture::new();

    let mut payees = Vec::new(&fix.env);
    payees.push_back(Address::generate(&fix.env));
    payees.push_back(Address::generate(&fix.env));

    // A zero amount is skipped (partial-failure support), so the valid total is
    // exactly i128::MAX.
    let mut amounts = Vec::new(&fix.env);
    amounts.push_back(i128::MAX);
    amounts.push_back(0);

    let batch = fix
        .client
        .create_batch(&fix.owner, &payees, &amounts, &fix.asset, &fix.tx_hash);
    assert_eq!(batch.total_amount, i128::MAX);
    assert_eq!(batch.successful, 1);
    assert_eq!(batch.failed, 1);
    assert_eq!(fix.client.get_batch_count(), 1);
}
