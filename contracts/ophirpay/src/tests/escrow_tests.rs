use super::*;
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{vec, String, Vec};

// ── Escrow Tests ────────────────────────────────────────

#[test]
fn test_create_and_release_escrow() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let depositor = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    let sac = create_token_contract(&env, &owner);
    let sac_client = token::StellarAssetClient::new(&env, &sac);
    sac_client.mint(&depositor, &10_000i128);

    let _ = client.init(&owner);

    let escrow_id = client.create_escrow(
        &depositor,
        &beneficiary,
        &Option::<Address>::None,
        &1000i128,
        &sac,
        &(env.ledger().timestamp() + 86400),
        &String::from_str(&env, "escrow test"),
    );
    assert_eq!(escrow_id, 1);
    assert_eq!(client.get_escrow_count(), 1);

    let escrow = client.get_escrow(&1);
    assert_eq!(escrow.depositor, depositor);
    assert_eq!(escrow.beneficiary, beneficiary);
    assert_eq!(escrow.amount, 1000);
    assert!(!escrow.released);

    client.release_escrow(&owner, &1);
    let escrow2 = client.get_escrow(&1);
    assert!(escrow2.released);
    assert!(escrow2.claimed);
}

#[test]
fn test_claim_escrow_after_deadline() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let depositor = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    let sac = create_token_contract(&env, &owner);
    let sac_client = token::StellarAssetClient::new(&env, &sac);
    sac_client.mint(&depositor, &10_000i128);

    let now = env.ledger().timestamp();
    let _ = client.init(&owner);
    let _ = client.create_escrow(
        &depositor,
        &beneficiary,
        &None::<Address>,
        &500i128,
        &sac,
        &(now + 100),
        &String::from_str(&env, "deadline test"),
    );

    env.ledger().set_timestamp(now + 200);

    client.claim_escrow(&beneficiary, &1);
    let escrow = client.get_escrow(&1);
    assert!(escrow.claimed);
}

#[test]
fn test_reentrancy_lock_released_after_guarded_ops() {
    // MEDIUM-4 regression: every token-moving operation must release the
    // REENTRANCY_LOCK after the cross-contract transfer completes, so
    // subsequent operations in the same transaction are not blocked.
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let depositor = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    let sac = create_token_contract(&env, &owner);
    let sac_client = token::StellarAssetClient::new(&env, &sac);
    sac_client.mint(&depositor, &10_000i128);

    let now = env.ledger().timestamp();
    let _ = client.init(&owner);
    let _ = client.create_escrow(
        &depositor,
        &beneficiary,
        &None::<Address>,
        &500i128,
        &sac,
        &(now + 100),
        &String::from_str(&env, "reentrancy test"),
    );

    env.ledger().set_timestamp(now + 200);

    // Claim — the guarded operation. Must release the lock on success.
    client.claim_escrow(&beneficiary, &1);

    // A second token-moving operation in the same env must NOT hit
    // ReentrantCall — proving the lock was released.
    let _ = client.create_escrow(
        &depositor,
        &beneficiary,
        &None::<Address>,
        &300i128,
        &sac,
        &(now + 200),
        &String::from_str(&env, "second escrow"),
    );
    env.ledger().set_timestamp(now + 300);
    client.claim_escrow(&beneficiary, &2);

    // Lock must be false after all guarded operations.
    let locked: bool = env.as_contract(&contract_id, || {
        env.storage()
            .instance()
            .get(&REENTRANCY_LOCK)
            .unwrap_or(false)
    });
    assert!(!locked);
}

#[test]
#[should_panic]
fn test_claim_escrow_before_deadline_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let depositor = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    let sac = create_token_contract(&env, &owner);
    let sac_client = token::StellarAssetClient::new(&env, &sac);
    sac_client.mint(&depositor, &10_000i128);

    let now = env.ledger().timestamp();
    let _ = client.init(&owner);
    let _ = client.create_escrow(
        &depositor,
        &beneficiary,
        &None::<Address>,
        &500i128,
        &sac,
        &(now + 10000),
        &String::from_str(&env, "future"),
    );

    client.claim_escrow(&beneficiary, &1); // should panic before deadline
}

