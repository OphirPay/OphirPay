use super::*;
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{vec, String, Vec};

// ── Recurring Payment Tests ─────────────────────────────

#[test]
fn test_create_recurring_payment() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);
    let owner = Address::generate(&env);
    let creator = Address::generate(&env);
    let payee = Address::generate(&env);
    let sac = create_token_contract(&env, &owner);

    let _ = client.init(&owner);

    let id = client.create_recurring(
        &creator,
        &payee,
        &100i128,
        &sac,
        &ScheduleType::Daily,
        &10u32,
        &String::from_str(&env, "subscription"),
    );
    assert_eq!(id, 1);
    assert_eq!(client.get_recurring_count(), 1);

    let rec = client.get_recurring(&1);
    assert!(rec.active);
}

#[test]
fn test_execute_recurring_payment() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);
    let owner = Address::generate(&env);
    let creator = Address::generate(&env);
    let payee = Address::generate(&env);
    let sac = create_token_contract(&env, &owner);

    let now = env.ledger().timestamp();
    let _ = client.init(&owner);

    let id = client.create_recurring(
        &creator,
        &payee,
        &100i128,
        &sac,
        &ScheduleType::Daily,
        &5u32,
        &String::from_str(&env, "sub"),
    );

    env.ledger().set_timestamp(now + 86400 + 1);
    let pay_id = client.execute_recurring(&creator, &id);
    assert_eq!(pay_id, 1);
    assert_eq!(client.get_payment_count(), 1);
}

#[test]
fn test_cancel_recurring_payment() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);
    let owner = Address::generate(&env);
    let creator = Address::generate(&env);
    let payee = Address::generate(&env);
    let sac = create_token_contract(&env, &owner);

    let _ = client.init(&owner);
    let id = client.create_recurring(
        &creator,
        &payee,
        &100i128,
        &sac,
        &ScheduleType::Daily,
        &10u32,
        &String::from_str(&env, "sub"),
    );

    client.cancel_recurring(&creator, &id);
    let rec = client.get_recurring(&id);
    assert!(!rec.active);
}

