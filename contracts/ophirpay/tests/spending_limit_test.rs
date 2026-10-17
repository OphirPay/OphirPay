// SPDX-License-Identifier: MIT
#![cfg(test)]

use ophirpay_contract::{
    check_and_update_batch_spending_limit, check_and_update_spending_limit, ledger_day_window,
    refresh_spending_windows, OphirPayContract, OphirPayContractClient, PaymentError,
    SpendingLimit, DAY_SECONDS,
};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{Address, Env, Vec};

#[test]
fn test_sliding_window_resets_across_multi_day_gaps() {
    let mut limit = SpendingLimit {
        daily_limit: 1_000,
        monthly_limit: 10_000,
        current_daily_spend: 900,
        current_monthly_spend: 900,
        last_reset_day: 86_400 * 5 + 100,
        last_reset_month: 86_400 * 5 + 100,
        is_active: true,
        expires_at: 0,
    };

    // Same day window: spend is preserved
    refresh_spending_windows(&mut limit, 86_400 * 5 + 5_000);
    assert_eq!(limit.current_daily_spend, 900);

    // Multi-day inactivity gap (3 days later): daily spend resets cleanly to 0
    let three_days_later = 86_400 * 8 + 200;
    assert!(ledger_day_window(three_days_later) > ledger_day_window(limit.last_reset_day));
    refresh_spending_windows(&mut limit, three_days_later);
    assert_eq!(limit.current_daily_spend, 0);
    assert_eq!(limit.current_monthly_spend, 900);
    assert_eq!(limit.last_reset_day, three_days_later);
}

#[test]
fn test_contract_spending_limit_and_batch_atomic_precheck() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(DAY_SECONDS * 10);

    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);
    let owner = Address::generate(&env);
    let user = Address::generate(&env);

    client.init(&owner);
    client.set_spending_limit(&owner, &user, &1_000i128, &5_000i128, &0u64, &true);

    // Spend 600 on day 10
    env.as_contract(&contract_id, || {
        let updated = check_and_update_spending_limit(&env, &user, 600)
            .expect("within limit")
            .expect("limit exists");
        assert_eq!(updated.current_daily_spend, 600);
    });

    // Batch of [250, 250] = 500 exceeds remaining 400 daily capacity -> reverts atomically
    env.as_contract(&contract_id, || {
        let mut batch = Vec::new(&env);
        batch.push_back(250i128);
        batch.push_back(250i128);
        let err = check_and_update_batch_spending_limit(&env, &user, &batch);
        assert_eq!(err, Err(PaymentError::SpendCapExceeded));

        let stored = client.get_spending_limit(&user).unwrap();
        assert_eq!(stored.current_daily_spend, 600);
    });

    // Advance ledger by 2 days -> daily spend resets and batch of 500 succeeds
    env.ledger().set_timestamp(DAY_SECONDS * 12 + 50);
    env.as_contract(&contract_id, || {
        let mut batch = Vec::new(&env);
        batch.push_back(250i128);
        batch.push_back(250i128);
        let total = check_and_update_batch_spending_limit(&env, &user, &batch)
            .expect("batch within reset daily limit");
        assert_eq!(total, 500);

        let stored = client.get_spending_limit(&user).unwrap();
        assert_eq!(stored.current_daily_spend, 500);
        assert_eq!(stored.current_monthly_spend, 1_100);
    });
}
