#![cfg(test)]
// Issue #1284 — Standardize timestamp arithmetic to use saturating_add across both contracts
use ophirpay_contract::{
    OphirPayContract, OphirPayContractClient, Role, ScheduleType,
};
use ophirpay_emitter::{PaymentEventEmitter, PaymentEventEmitterClient};
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::{Address, BytesN, Env, String};

#[test]
fn test_propose_upgrade_timestamp_saturation() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    client.init(&admin);

    let new_wasm_hash = BytesN::from_array(&env, &[0; 32]);

    env.ledger().with_mut(|li| {
        li.timestamp = u64::MAX - 100;
    });

    // Proposing upgrade at near-overflow timestamp should not panic
    client.propose_upgrade(&admin, &new_wasm_hash);
}

#[test]
fn test_emitter_propose_upgrade_timestamp_saturation() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PaymentEventEmitter, ());
    let client = PaymentEventEmitterClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    client.init(&admin);

    let new_wasm_hash = BytesN::from_array(&env, &[0; 32]);

    env.ledger().with_mut(|li| {
        li.timestamp = u64::MAX - 100;
    });

    // Proposing upgrade in emitter at near-overflow timestamp should not panic
    client.propose_upgrade(&admin, &new_wasm_hash);
}

#[test]
fn test_timelocked_action_timestamp_saturation() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    client.init(&owner);

    env.ledger().with_mut(|li| {
        li.timestamp = u64::MAX - 50;
    });

    // Proposing a timelocked action near timestamp max should saturate and not overflow
    let action_id = client.propose_timelocked_action(
        &owner,
        &String::from_str(&env, "set_owner"),
        &String::from_str(&env, "target"),
        &String::from_str(&env, "data"),
    );
    assert_eq!(action_id, 1);
}

#[test]
fn test_role_revocation_timestamp_saturation() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    client.init(&owner);

    let target = Address::generate(&env);
    client.grant_role(&owner, &target, &Role::Admin);

    env.ledger().with_mut(|li| {
        li.timestamp = u64::MAX - 50;
    });

    // Proposing revocation near timestamp max should saturate unlocks_at to u64::MAX
    let unlocks_at = client.propose_revoke_role(&owner, &target);
    assert_eq!(unlocks_at, u64::MAX);
}

#[test]
fn test_recurring_payment_timestamp_saturation() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    client.init(&owner);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin).address();
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);

    env.ledger().with_mut(|li| {
        li.timestamp = u64::MAX - 100;
    });

    let rec_id = client.create_recurring(
        &payer,
        &payee,
        &1000i128,
        &token_id,
        &ScheduleType::Monthly,
        &12u32,
        &String::from_str(&env, "sub"),
    );
    assert_eq!(rec_id, 1);

    let rec = client.get_recurring(&1);
    assert_eq!(rec.next_execution, u64::MAX);
}
