use super::*;
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{vec, String, Vec};

// ── Pause Tests ────────────────────────────────────────

#[test]
fn test_pause_blocks_record_payment() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);
    let owner = Address::generate(&env);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);
    let sac = create_token_contract(&env, &owner);

    let _ = client.init(&owner);
    assert!(!client.is_paused());

    client.emergency_pause_all(&owner);
    assert!(client.is_paused());

    // record_payment should fail when paused
    let result = client.try_record_payment(
        &payer,
        &payee,
        &100i128,
        &sac,
        &String::from_str(&env, "tx"),
        &String::from_str(&env, ""),
    );
    assert!(result.is_err());

    client.emergency_unpause_all(&owner);
    assert!(!client.is_paused());

    // Should work after unpause
    let id = client.record_payment(
        &payer,
        &payee,
        &100i128,
        &sac,
        &String::from_str(&env, "tx2"),
        &String::from_str(&env, ""),
    );
    assert_eq!(id, 1);
}

#[test]
#[should_panic]
fn test_pause_blocks_create_escrow() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);
    let owner = Address::generate(&env);
    let depositor = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    let sac = create_token_contract(&env, &owner);
    let sac_client = token::StellarAssetClient::new(&env, &sac);
    sac_client.mint(&depositor, &1000i128);

    let _ = client.init(&owner);
    client.emergency_pause_all(&owner);

    client.create_escrow(
        &depositor,
        &beneficiary,
        &None::<Address>,
        &100i128,
        &sac,
        &(env.ledger().timestamp() + 100),
        &String::from_str(&env, "paused"),
    );
}

#[test]
#[should_panic]
fn test_pause_blocks_create_stream() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);
    let owner = Address::generate(&env);
    let creator = Address::generate(&env);
    let recipient = Address::generate(&env);
    let sac = create_token_contract(&env, &owner);
    let sac_client = token::StellarAssetClient::new(&env, &sac);
    sac_client.mint(&creator, &1000i128);

    let now = env.ledger().timestamp();
    let _ = client.init(&owner);
    client.emergency_pause_all(&owner);

    client.create_stream(
        &creator,
        &recipient,
        &500i128,
        &sac,
        &now,
        &(now + 1000),
        &String::from_str(&env, "paused"),
    );
}

// ── Re-cancellation test ───────────────────────────────

#[test]
#[should_panic]
fn test_cancel_already_cancelled_fails() {
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
        &100i128,
        &sac,
        &String::from_str(&env, "tx"),
        &String::from_str(&env, ""),
    );

    client.cancel_payment(&owner, &1);
    assert!(client.get_payment(&1).cancelled);

    // Second cancel should panic with PaymentAlreadyCancelled
    client.cancel_payment(&owner, &1);
}

