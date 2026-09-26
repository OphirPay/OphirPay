use super::*;
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{vec, String, Vec};

// ── Fee Config Tests ───────────────────────────────────

#[test]
fn test_set_and_get_fee_config() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);
    let owner = Address::generate(&env);

    let _ = client.init(&owner);
    client.set_fee_config(&owner, &50u32, &100u32, &200u32, &10i128, &1i128, &true);

    let config = client.get_fee_config();
    assert!(config.is_some());
    let cfg = config.unwrap();
    assert_eq!(cfg.payment_fee_bps, 50);
    assert!(cfg.enabled);
}

#[test]
fn test_calculate_fee() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);

    let fee = client.calculate_fee(&1000i128, &100u32);
    assert_eq!(fee, 10);

    let fee = client.calculate_fee(&0i128, &100u32);
    assert_eq!(fee, 0);
}

// ── Timelocked Action Tests ────────────────────────────

#[test]
fn test_timelocked_action_propose_and_execute() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);
    let owner = Address::generate(&env);

    let now = env.ledger().timestamp();
    let _ = client.init(&owner);

    let id = client.propose_timelocked_action(
        &owner,
        &String::from_str(&env, "set_fee_config"),
        &String::from_str(&env, "set_fee_config"),
        &String::from_str(&env, "params"),
    );
    assert_eq!(id, 1);
    assert_eq!(client.get_timelock_count(), 1);

    let action = client.get_timelocked_action(&1);
    assert!(!action.executed);

    env.ledger().set_timestamp(now + TMLOCK_DELAY + 1);
    client.execute_timelocked_action(&1);

    let action = client.get_timelocked_action(&1);
    assert!(action.executed);
}

#[test]
fn test_timelocked_action_cancel() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);
    let owner = Address::generate(&env);

    let _ = client.init(&owner);
    let id = client.propose_timelocked_action(
        &owner,
        &String::from_str(&env, "pause"),
        &String::from_str(&env, "pause"),
        &String::from_str(&env, ""),
    );

    client.cancel_timelocked_action(&owner, &id);
    let action = client.get_timelocked_action(&id);
    assert!(action.executed);
}

// ── Governance Tests ───────────────────────────────────

#[test]
fn test_governance_proposal_vote_execute() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);
    let owner = Address::generate(&env);
    let proposer = Address::generate(&env);
    let voter = Address::generate(&env);

    let now = env.ledger().timestamp();
    let _ = client.init(&owner);

    client.configure_governance(&owner, &0i128, &1000u64, &51u32, &true);

    // min_proposal_deposit = 0, so any deposit_asset/amount works
    let deposit_asset = Address::generate(&env);
    let pid = client.create_proposal(
        &proposer,
        &String::from_str(&env, "Test Proposal"),
        &String::from_str(&env, "A test description"),
        &String::from_str(&env, "upgrade"),
        &String::from_str(&env, "execute_upgrade"),
        &String::from_str(&env, "hash"),
        &deposit_asset,
        &0i128,
    );
    assert_eq!(pid, 1);
    assert_eq!(client.get_proposal_count(), 1);

    // Each voter contributes exactly 1 vote (no self-reported weight)
    client.vote_on_proposal(&voter, &1, &true);

    let prop = client.get_proposal(&1);
    assert_eq!(prop.yes_votes, 1);
    assert_eq!(prop.no_votes, 0);

    env.ledger().set_timestamp(now + 2000);
    let passed = client.execute_proposal(&1);
    assert!(passed);
}

// ── New Error Path Tests (governance + reentrancy) ──

/// GOV-1: Double-voting is rejected with AlreadyVoted error
#[test]
fn test_double_vote_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);
    let owner = Address::generate(&env);
    let proposer = Address::generate(&env);
    let voter = Address::generate(&env);

    let _ = client.init(&owner);
    client.configure_governance(&owner, &0i128, &1000u64, &51u32, &true);

    let deposit_asset = Address::generate(&env);
    let _ = client.create_proposal(
        &proposer,
        &String::from_str(&env, "P"),
        &String::from_str(&env, "D"),
        &String::from_str(&env, "upgrade"),
        &String::from_str(&env, "t"),
        &String::from_str(&env, "d"),
        &deposit_asset,
        &0i128,
    );

    // First vote succeeds
    client.vote_on_proposal(&voter, &1, &true);

    // Second vote from same voter should fail with AlreadyVoted
    let result = client.try_vote_on_proposal(&voter, &1, &false);
    assert!(result.is_err());
}

/// GOV-2: Proposal creation fails when deposit is below minimum
#[test]
fn test_deposit_too_low_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);
    let owner = Address::generate(&env);
    let proposer = Address::generate(&env);

    let _ = client.init(&owner);
    // Set min_proposal_deposit to 100
    client.configure_governance(&owner, &100i128, &1000u64, &51u32, &true);

    let deposit_asset = Address::generate(&env);
    // Try with deposit_amount = 50 (below 100 minimum)
    let result = client.try_create_proposal(
        &proposer,
        &String::from_str(&env, "P"),
        &String::from_str(&env, "D"),
        &String::from_str(&env, "upgrade"),
        &String::from_str(&env, "t"),
        &String::from_str(&env, "d"),
        &deposit_asset,
        &50i128,
    );
    assert!(result.is_err());
}
