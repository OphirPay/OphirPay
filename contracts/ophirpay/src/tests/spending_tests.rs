use super::*;
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{vec, String, Vec};

// ── Spending Limit Tests ───────────────────────────────

#[test]
fn test_spending_limit_approved() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);
    let owner = Address::generate(&env);
    let user = Address::generate(&env);

    let _ = client.init(&owner);
    client.set_spending_limit(
        &owner,
        &user,
        &1000i128,
        &5000i128,
        &(env.ledger().timestamp() + 86400),
        &true,
    );

    let result = client.check_spending(&user, &500i128);
    assert!(matches!(result, SpendCheckResult::Approved));
}

#[test]
fn test_spending_limit_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);
    let owner = Address::generate(&env);
    let user = Address::generate(&env);

    let _ = client.init(&owner);
    client.set_spending_limit(&owner, &user, &100i128, &1000i128, &0u64, &true);

    let result = client.check_spending(&user, &500i128);
    assert!(matches!(result, SpendCheckResult::Rejected));
}

#[test]
fn test_escalation_rules() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);
    let owner = Address::generate(&env);
    let user = Address::generate(&env);

    let _ = client.init(&owner);
    client.configure_escalation(&owner, &100i128, &1000i128, &true);

    let result = client.check_spending(&user, &2000i128);
    assert!(matches!(result, SpendCheckResult::Escalated));
}


// ── Spending Limit Tests ──────────────────────────────────

#[test]
fn test_spending_limit_expiry_rejects_spend() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);
    let sac = create_token_contract(&env, &owner);

    let now = env.ledger().timestamp();
    let _ = client.init(&owner);

    // Set spending limit that expires in 100 seconds
    client.set_spending_limit(&owner, &payer, &10000i128, &50000i128, &(now + 100), &true);

    let limit = client.get_spending_limit(&payer);
    assert!(limit.is_some());
    assert!(limit.unwrap().is_active);

    // Spend within expiry — should succeed
    let id = client.atomic_spend(
        &payer,
        &payee,
        &500i128,
        &sac,
        &String::from_str(&env, "tx1"),
        &String::from_str(&env, "valid"),
    );
    assert_eq!(id, 1);

    // Advance past expiry
    env.ledger().set_timestamp(now + 200);

    // Spend after expiry — should fail
    let result = client.try_atomic_spend(
        &payer,
        &payee,
        &500i128,
        &sac,
        &String::from_str(&env, "tx2"),
        &String::from_str(&env, "expired"),
    );
    assert!(result.is_err());
}

#[test]
fn test_atomic_spend_updates_spend_counters() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);
    let sac = create_token_contract(&env, &owner);

    let _ = client.init(&owner);

    client.set_spending_limit(&owner, &payer, &5000i128, &10000i128, &0, &true);

    // Spend 2000
    client.atomic_spend(
        &payer,
        &payee,
        &2000i128,
        &sac,
        &String::from_str(&env, "tx_a"),
        &String::from_str(&env, "spend 1"),
    );

    let limit = client.get_spending_limit(&payer);
    assert_eq!(limit.unwrap().current_daily_spend, 2000);

    // Spend another 3000 = total 5000 (at limit)
    client.atomic_spend(
        &payer,
        &payee,
        &3000i128,
        &sac,
        &String::from_str(&env, "tx_b"),
        &String::from_str(&env, "spend 2"),
    );

    // Next spend exceeds daily limit — should fail
    let result = client.try_atomic_spend(
        &payer,
        &payee,
        &1i128,
        &sac,
        &String::from_str(&env, "tx_c"),
        &String::from_str(&env, "over limit"),
    );
    assert!(result.is_err());
}

