#![cfg(test)]

use ophirpay_contract::{OphirPayContract, OphirPayContractClient, PaymentError};
use soroban_sdk::{testutils::Address as _, Address, Env, String, Vec};

#[test]
fn test_batch_math_overflow() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);
    
    let owner = Address::generate(&env);
    client.init(&owner);

    let mut payees = Vec::new(&env);
    let mut amounts = Vec::new(&env);
    
    for _ in 0..100 {
        payees.push_back(Address::generate(&env));
        amounts.push_back(i128::MAX / 2);
    }
    
    let asset = Address::generate(&env);
    let tx_hash = String::from_str(&env, "0xhash");
    
    let res = client.try_create_batch(&owner, &payees, &amounts, &asset, &tx_hash);
    match res {
        Err(Ok(err)) => assert_eq!(err, PaymentError::MathOverflow),
        _ => panic!("Expected MathOverflow error"),
    }
}
