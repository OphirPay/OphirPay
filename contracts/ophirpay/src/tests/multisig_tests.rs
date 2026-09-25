use super::*;
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{vec, String, Vec};

// ── Multisig Tests ─────────────────────────────────────

#[test]
fn test_multisig_configure_and_propose() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);
    let owner = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let signer3 = Address::generate(&env);
    let payee = Address::generate(&env);
    let sac = create_token_contract(&env, &owner);

    let _ = client.init(&owner);

    let signers = vec![&env, signer1.clone(), signer2.clone(), signer3.clone()];
    client.set_multisig_config(&owner, &2u32, &signers, &true);

    let config = client.get_multisig_config();
    assert!(config.is_some());
    let cfg = config.unwrap();
    assert_eq!(cfg.threshold, 2);
    assert!(cfg.enabled);

    let proposal_id = client.propose_payment(
        &signer1,
        &payee,
        &1000i128,
        &sac,
        &String::from_str(&env, "tx1"),
    );
    assert_eq!(proposal_id, 1);

    let req = client.get_approval_request(&1);
    assert!(req.is_some());
    assert!(!req.unwrap().executed);
}

#[test]
fn test_multisig_approve_and_execute() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);
    let owner = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let signer3 = Address::generate(&env);
    let payee = Address::generate(&env);
    let sac = create_token_contract(&env, &owner);

    let _ = client.init(&owner);

    let signers = vec![&env, signer1.clone(), signer2.clone(), signer3.clone()];
    client.set_multisig_config(&owner, &2u32, &signers, &true);

    let _ = client.propose_payment(
        &signer1,
        &payee,
        &1000i128,
        &sac,
        &String::from_str(&env, "tx1"),
    );

    let threshold_met = client.approve_payment(&signer2, &1);
    assert!(!threshold_met);

    let threshold_met = client.approve_payment(&signer3, &1);
    assert!(threshold_met);

    let pay_id = client.execute_approved_payment(&signer1, &1);
    assert_eq!(pay_id, 1);
    assert_eq!(client.get_payment_count(), 1);
}


// ── Multisig Tests ────────────────────────────────────────

#[test]
fn test_multisig_threshold_enforcement() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let signer3 = Address::generate(&env);
    let payee = Address::generate(&env);
    let sac = create_token_contract(&env, &owner);

    let _ = client.init(&owner);

    // Configure 2-of-3 multisig
    let signers = vec![&env, signer1.clone(), signer2.clone(), signer3.clone()];
    client.set_multisig_config(&owner, &2u32, &signers, &true);

    let config = client.get_multisig_config();
    assert!(config.is_some());
    let cfg = config.unwrap();
    assert_eq!(cfg.threshold, 2);
    assert!(cfg.enabled);

    // Propose payment
    let proposal_id = client.propose_payment(
        &signer1,
        &payee,
        &1000i128,
        &sac,
        &String::from_str(&env, "tx_proposal_1"),
    );
    assert_eq!(proposal_id, 1);

    // One approval — not enough yet
    let met = client.approve_payment(&signer1, &1);
    assert!(!met);

    // Second approval — threshold met
    let met2 = client.approve_payment(&signer2, &1);
    assert!(met2);

    // Execute
    let pay_id = client.execute_approved_payment(&signer1, &1);
    assert_eq!(pay_id, 1);
    assert_eq!(client.get_payment_count(), 1);
}

#[test]
fn test_multisig_duplicate_approval_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let payee = Address::generate(&env);
    let sac = create_token_contract(&env, &owner);

    let _ = client.init(&owner);

    let signers = vec![&env, signer1.clone(), signer2.clone()];
    client.set_multisig_config(&owner, &2u32, &signers, &true);

    client.propose_payment(
        &signer1,
        &payee,
        &500i128,
        &sac,
        &String::from_str(&env, "tx"),
    );

    // First approval
    client.approve_payment(&signer1, &1);

    // Duplicate approval should fail
    let result = client.try_approve_payment(&signer1, &1);
    assert!(result.is_err());
}

