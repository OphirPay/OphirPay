use super::*;
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{vec, String, Vec};

// ── Policy Versioning Tests ────────────────────────────

#[test]
fn test_fee_config_versioning() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);
    let owner = Address::generate(&env);

    let _ = client.init(&owner);

    // Set config twice
    client.set_fee_config(&owner, &100u32, &200u32, &300u32, &10i128, &1i128, &true);
    client.set_fee_config(&owner, &150u32, &250u32, &350u32, &20i128, &2i128, &true);

    // Check current config reflects latest
    let current = client.get_fee_config().unwrap();
    assert_eq!(current.payment_fee_bps, 150);

    // Check version history
    let history = client.get_fee_config_history();
    assert_eq!(history.len(), 2);

    // Check specific version
    let v1 = client.get_fee_config_at_version(&1);
    assert_eq!(v1.unwrap().config.payment_fee_bps, 100);
}

#[test]
fn test_multisig_config_versioning() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);
    let owner = Address::generate(&env);
    let s1 = Address::generate(&env);
    let s2 = Address::generate(&env);
    let s3 = Address::generate(&env);

    let _ = client.init(&owner);

    let signers_v1 = vec![&env, s1.clone(), s2.clone()];
    client.set_multisig_config(&owner, &2u32, &signers_v1, &true);

    let signers_v2 = vec![&env, s1.clone(), s2.clone(), s3.clone()];
    client.set_multisig_config(&owner, &3u32, &signers_v2, &true);

    let history = client.get_multisig_config_history();
    assert_eq!(history.len(), 2);
}

// ── Two-Step Ownership Tests ───────────────────────────

#[test]
fn test_two_step_ownership_transfer() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);
    let owner = Address::generate(&env);
    let new_owner = Address::generate(&env);

    let now = env.ledger().timestamp();
    let _ = client.init(&owner);

    // Propose transfer
    client.transfer_ownership(&owner, &new_owner);

    // Check pending owner
    let pending = client.get_pending_owner();
    assert!(pending.is_some());

    // Cannot accept before timelock
    // (skip — this panics, test separately)

    // Advance past 24h
    env.ledger().set_timestamp(now + 86401);

    // Accept
    client.accept_ownership(&new_owner);

    // Verify
    assert_eq!(client.get_owner(), new_owner);
    assert!(client.get_pending_owner().is_none());
}

#[test]
#[should_panic]
fn test_accept_ownership_before_timelock_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);
    let owner = Address::generate(&env);
    let new_owner = Address::generate(&env);

    let _ = client.init(&owner);
    client.transfer_ownership(&owner, &new_owner);
    // Should panic — timelock hasn't elapsed
    client.accept_ownership(&new_owner);
}

#[test]
fn test_cancel_ownership_transfer() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);
    let owner = Address::generate(&env);
    let new_owner = Address::generate(&env);

    let _ = client.init(&owner);
    client.transfer_ownership(&owner, &new_owner);
    assert!(client.get_pending_owner().is_some());

    client.cancel_ownership_transfer(&owner);
    assert!(client.get_pending_owner().is_none());
}


/// INV-10: Fee config version history is capped at 100 entries
#[test]
fn test_fee_version_history_capped() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let _ = client.init(&owner);

    // Create 150 fee config changes
    for i in 0u32..150u32 {
        client.set_fee_config(&owner, &(100 + i), &200, &300, &1000i128, &100i128, &true);
    }

    let history = client.get_fee_config_history();
    // Should return at most 100 entries
    assert!(history.len() <= 100);
    // The most recent should have version 150
    assert!(history.len() > 0);
    let latest = history.get(0).unwrap();
    assert_eq!(latest.version, 150);

    // Single-version lookup should still work for older versions
    let old_version = client.get_fee_config_at_version(&10);
    assert!(old_version.is_some());
    assert_eq!(old_version.unwrap().version, 10);
}

