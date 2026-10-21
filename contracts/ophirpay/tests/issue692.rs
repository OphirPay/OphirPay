#![cfg(test)]
use soroban_sdk::{testutils::Address as _, testutils::Ledger, Address, BytesN, Env};
use ophirpay_contract::{OphirPayContract, OphirPayContractClient, Role};

#[test]
fn test_propose_upgrade_timestamp_saturation() {
    let env = Env::default();
    env.mock_all_auths();
    
    let contract_id = env.register_contract(None, OphirPayContract);
    let client = OphirPayContractClient::new(&env, &contract_id);
    
    let admin = Address::generate(&env);
    client.init(&admin);
    
    let new_wasm_hash = BytesN::from_array(&env, &[0; 32]);
    
    env.ledger().with_mut(|li| {
        li.timestamp = u64::MAX - 100;
    });
    
    // This should not panic (saturating_add instead of +)
    client.propose_upgrade(&admin, &new_wasm_hash);
}

#[test]
fn test_propose_timelocked_action_timestamp_saturation() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, OphirPayContract);
    let client = OphirPayContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    client.init(&admin);

    env.ledger().with_mut(|li| {
        li.timestamp = u64::MAX - 100;
    });

    let action = soroban_sdk::String::from_str(&env, "set_fee_config");
    let target = soroban_sdk::String::from_str(&env, "target");
    let data = soroban_sdk::String::from_str(&env, "data");

    // This should not panic on saturating_add(TMLOCK_DELAY) (issue #1284)
    let id = client.propose_timelocked_action(&admin, &action, &target, &data);
    let timelocked = client.get_timelocked_action(&id);
    assert_eq!(timelocked.unlocks_at, u64::MAX);
}

#[test]
fn test_propose_revoke_role_timestamp_saturation() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, OphirPayContract);
    let client = OphirPayContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    client.init(&admin);

    let target = Address::generate(&env);
    client.grant_role(&admin, &target, &Role::Admin);

    env.ledger().with_mut(|li| {
        li.timestamp = u64::MAX - 100;
    });

    // This should not panic on saturating_add(TMLOCK_DELAY) (issue #1284)
    let unlocks_at = client.propose_revoke_role(&admin, &target);
    assert_eq!(unlocks_at, u64::MAX);
}

use ophirpay_emitter::{PaymentEventEmitter, PaymentEventEmitterClient};

#[test]
fn test_emitter_propose_upgrade_timestamp_saturation() {
    let env = Env::default();
    env.mock_all_auths();
    
    let contract_id = env.register_contract(None, PaymentEventEmitter);
    let client = PaymentEventEmitterClient::new(&env, &contract_id);
    
    let admin = Address::generate(&env);
    client.init(&admin);
    
    let new_wasm_hash = BytesN::from_array(&env, &[0; 32]);
    
    env.ledger().with_mut(|li| {
        li.timestamp = u64::MAX - 100;
    });
    
    // This should not panic
    client.propose_upgrade(&admin, &new_wasm_hash);
}
