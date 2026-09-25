use super::*;
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{vec, String, Vec};

// ── Payment Record Tests ────────────────────────────────

#[test]
fn test_record_payment() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1000);
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);
    let owner = Address::generate(&env);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);
    let sac = create_token_contract(&env, &owner);

    let _ = client.init(&owner);

    let id = client.record_payment(
        &payer,
        &payee,
        &1000i128,
        &sac,
        &String::from_str(&env, "tx_hash_abc"),
        &String::from_str(&env, "test payment"),
    );
    assert_eq!(id, 1);
    assert_eq!(client.get_payment_count(), 1);

    let payment = client.get_payment(&1);
    assert_eq!(payment.payer, payer);
    assert_eq!(payment.payee, payee);
    assert_eq!(payment.amount, 1000);
    assert_eq!(payment.tx_hash, String::from_str(&env, "tx_hash_abc"));
    assert!(payment.timestamp > 0);
}

#[test]
fn test_record_payment_zero_amount_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);
    let owner = Address::generate(&env);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);
    let sac = create_token_contract(&env, &owner);

    let _ = client.init(&owner);
    assert_eq!(
        client.try_record_payment(
            &payer,
            &payee,
            &0i128,
            &sac,
            &String::from_str(&env, "tx"),
            &String::from_str(&env, ""),
        ),
        Err(Ok(PaymentError::InvalidAmount))
    );
}

#[test]
fn test_cancel_payment_by_owner() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);
    let owner = Address::generate(&env);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);
    let sac = create_token_contract(&env, &owner);

    let _ = client.init(&owner);
    let _ = client.record_payment(
        &payer,
        &payee,
        &500i128,
        &sac,
        &String::from_str(&env, "tx"),
        &String::from_str(&env, ""),
    );

    client.cancel_payment(&owner, &1);
    let payment = client.get_payment(&1);
    assert!(payment.cancelled);
    assert_eq!(payment.amount, 500); // amount is preserved, not zeroed
}

