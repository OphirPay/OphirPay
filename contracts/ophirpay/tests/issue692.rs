#![cfg(test)]
use soroban_sdk::{testutils::Address as _, testutils::Ledger, Address, BytesN, Env};
use ophirpay_contract::{OphirPayContract, OphirPayContractClient};

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
