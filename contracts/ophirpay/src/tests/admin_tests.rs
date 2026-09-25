use super::*;
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{vec, String, Vec};

// ── Admin Tests ─────────────────────────────────────────

#[test]
fn test_init_and_owner() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);
    let owner = Address::generate(&env);

    let version = client.init(&owner);
    assert_eq!(version, CONTRACT_VERSION);
    assert_eq!(client.get_owner(), owner);
    assert_eq!(client.get_payment_count(), 0);
}

#[test]
fn test_init_twice_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);
    let owner = Address::generate(&env);

    let _ = client.init(&owner);
    // v27 client try_ variant surfaces the exact contract error
    assert_eq!(
        client.try_init(&owner),
        Err(Ok(PaymentError::AlreadyInitialized))
    );
}

#[test]
fn test_transfer_ownership() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);
    let owner = Address::generate(&env);
    let new_owner = Address::generate(&env);

    let now = env.ledger().timestamp();
    let _ = client.init(&owner);

    // transfer_ownership is now a two-step proposal: the owner does not
    // change until the proposed new owner accepts after the timelock.
    client.transfer_ownership(&owner, &new_owner);
    assert_eq!(client.get_owner(), owner);

    env.ledger().set_timestamp(now + 86401);
    client.accept_ownership(&new_owner);
    assert_eq!(client.get_owner(), new_owner);
}

#[test]
#[should_panic]
fn test_unauthorized_transfer_ownership_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);
    let owner = Address::generate(&env);
    let rando = Address::generate(&env);

    let _ = client.init(&owner);
    client.transfer_ownership(&rando, &rando); // should panic
}

