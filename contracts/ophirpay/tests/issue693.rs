#![cfg(test)]

use ophirpay_contract::{OphirPayContract, OphirPayContractClient, PaymentError};
use soroban_sdk::{testutils::Address as _, Address, Env};

#[test]
fn test_missing_hook_error() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);
    
    let owner = Address::generate(&env);
    client.init(&owner);

    let caller = Address::generate(&env);
    let res = client.try_unregister_hook(&caller, &999);
    assert_eq!(res, Err(Ok(PaymentError::HookNotFound)));
}

#[test]
fn test_no_pending_owner_error() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);
    
    let owner = Address::generate(&env);
    client.init(&owner);

    let caller = Address::generate(&env);
    let res = client.try_accept_ownership(&caller);
    assert_eq!(res, Err(Ok(PaymentError::NoPendingOwner)));
}
