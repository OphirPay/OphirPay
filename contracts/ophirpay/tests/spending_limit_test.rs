// SPDX-License-Identifier: MIT
#![cfg(test)]

use ophirpay_contract::{
    OphirPayContract, OphirPayContractClient, PaymentError, SpendCheckResult,
};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{token, Address, Env, String, Vec};

struct SpendingTestFixture<'a> {
    env: Env,
    client: OphirPayContractClient<'a>,
    owner: Address,
    token_id: Address,
    token_admin_client: token::StellarAssetClient<'a>,
}

impl<'a> SpendingTestFixture<'a> {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1_000_000);

        let owner = Address::generate(&env);
        let token_admin = Address::generate(&env);

        let token_id = env.register_stellar_asset_contract(token_admin.clone());
        let token_admin_client = token::StellarAssetClient::new(&env, &token_id);

        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        client.init(&owner);

        SpendingTestFixture {
            env,
            client,
            owner,
            token_id,
            token_admin_client,
        }
    }

    fn mint(&self, to: &Address, amount: i128) {
        self.token_admin_client.mint(to, &amount);
    }
}

#[test]
fn test_sliding_window_spending_limit_reset_and_bounds() {
    let fix = SpendingTestFixture::new();
    let payer = Address::generate(&fix.env);
    let payee = Address::generate(&fix.env);
    fix.mint(&payer, 10_000_000);

    let daily_limit = 1_000i128;
    let monthly_limit = 10_000i128;

    // 1. Configure spending limit: 1000 daily, 10000 monthly
    fix.client.set_spending_limit(
        &fix.owner,
        &payer,
        &daily_limit,
        &monthly_limit,
        &0u64, // no expiry
        &true, // active
    );

    // Initial check is approved
    assert!(matches!(
        fix.client.check_spending(&payer, &500i128),
        SpendCheckResult::Approved
    ));

    // First atomic spend of 600
    let tx1 = String::from_str(&fix.env, "0xtx1");
    let meta = String::from_str(&fix.env, "spend");
    let id1 = fix.client.atomic_spend(
        &payer,
        &payee,
        &600i128,
        &fix.token_id,
        &tx1,
        &meta,
    );
    assert_eq!(id1, 1);

    // State verification: 600 spent today
    let state = fix.client.get_spending_limit(&payer).unwrap();
    assert_eq!(state.current_daily_spend, 600);

    // Spending additional 500 would exceed daily limit (600 + 500 = 1100 > 1000)
    let tx2 = String::from_str(&fix.env, "0xtx2");
    let exceed_res = fix.client.try_atomic_spend(
        &payer,
        &payee,
        &500i128,
        &fix.token_id,
        &tx2,
        &meta,
    );
    assert_eq!(
        exceed_res,
        Err(Ok(PaymentError::SpendingLimitExceeded))
    );

    // Check spending also reports Rejected
    assert!(matches!(
        fix.client.check_spending(&payer, &500i128),
        SpendCheckResult::Rejected
    ));

    // 2. Advance time past 24 hours into next ledger day window (+86,400 seconds)
    fix.env.ledger().set_timestamp(fix.env.ledger().timestamp() + 86_400);

    // Sliding window check: daily spend cleanly resets to 0, so 500 is now approved!
    assert!(matches!(
        fix.client.check_spending(&payer, &500i128),
        SpendCheckResult::Approved
    ));

    let tx3 = String::from_str(&fix.env, "0xtx3");
    let id2 = fix.client.atomic_spend(
        &payer,
        &payee,
        &500i128,
        &fix.token_id,
        &tx3,
        &meta,
    );
    assert_eq!(id2, 2);

    let state2 = fix.client.get_spending_limit(&payer).unwrap();
    assert_eq!(state2.current_daily_spend, 500);
    // Cumulative monthly spend is 600 + 500 = 1100
    assert_eq!(state2.current_monthly_spend, 1100);
}

#[test]
fn test_batch_spending_limit_upfront_revert_and_atomicity() {
    let fix = SpendingTestFixture::new();
    let creator = Address::generate(&fix.env);
    let payee1 = Address::generate(&fix.env);
    let payee2 = Address::generate(&fix.env);
    fix.mint(&creator, 10_000_000);

    let daily_limit = 1_000i128;
    let monthly_limit = 5_000i128;

    // Configure spending limit: 1000 daily
    fix.client.set_spending_limit(
        &fix.owner,
        &creator,
        &daily_limit,
        &monthly_limit,
        &0u64,
        &true,
    );

    // Initial batch sum = 600 + 500 = 1100 > 1000
    let mut payees = Vec::new(&fix.env);
    payees.push_back(payee1.clone());
    payees.push_back(payee2.clone());

    let mut amounts = Vec::new(&fix.env);
    amounts.push_back(600i128);
    amounts.push_back(500i128);

    let tx = String::from_str(&fix.env, "0xbatch_tx");
    let exceed_batch = fix.client.try_create_batch(
        &creator,
        &payees,
        &amounts,
        &fix.token_id,
        &tx,
    );
    // Must revert atomically upfront with SpendingLimitExceeded
    assert!(matches!(
        exceed_batch,
        Err(Ok(PaymentError::SpendingLimitExceeded))
    ));

    // Zero payments recorded
    assert_eq!(fix.client.get_payment_count(), 0);

    // Valid batch within limit: 400 + 500 = 900 <= 1000
    let mut valid_amounts = Vec::new(&fix.env);
    valid_amounts.push_back(400i128);
    valid_amounts.push_back(500i128);

    let batch_res = fix.client.create_batch(
        &creator,
        &payees,
        &valid_amounts,
        &fix.token_id,
        &tx,
    );
    assert_eq!(batch_res.successful, 2);
    assert_eq!(fix.client.get_payment_count(), 2);

    let state = fix.client.get_spending_limit(&creator).unwrap();
    assert_eq!(state.current_daily_spend, 900);
}
