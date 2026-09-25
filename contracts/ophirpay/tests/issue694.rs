#![cfg(test)]

use ophirpay_contract::{MAX_SIGNERS, OphirPayContract, OphirPayContractClient, PaymentError};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{vec, Address, Env, String, Vec};

#[test]
fn test_multisig_deduplication_and_approval_threshold() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let payee = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let asset = env.register_stellar_asset_contract_v2(token_admin).address();

    client.init(&owner);

    let duplicated_signers = vec![
        &env,
        signer1.clone(),
        signer2.clone(),
        signer1.clone(),
        signer2.clone(),
    ];
    let config_res = client.try_set_multisig_config(&owner, &2u32, &duplicated_signers, &true);
    assert_eq!(config_res, Ok(Ok(())));

    let stored_config = client.get_multisig_config().unwrap();
    assert_eq!(stored_config.threshold, 2);
    assert_eq!(stored_config.signers.len(), 2);
    assert_eq!(stored_config.signers.get(0), Some(signer1.clone()));
    assert_eq!(stored_config.signers.get(1), Some(signer2.clone()));

    let tx_hash = String::from_str(&env, "tx-msig-694");
    let proposal_id = client.propose_payment(&signer1, &payee, &1000i128, &asset, &tx_hash);
    assert_eq!(proposal_id, 1);

    let first_approval = client.approve_payment(&signer1, &proposal_id);
    assert_eq!(first_approval, false);

    let duplicate_approval = client.try_approve_payment(&signer1, &proposal_id);
    assert_eq!(duplicate_approval, Err(Ok(PaymentError::AlreadyApproved)));

    let early_execution = client.try_execute_approved_payment(&signer1, &proposal_id);
    assert_eq!(early_execution, Err(Ok(PaymentError::ThresholdNotMet)));

    let second_approval = client.approve_payment(&signer2, &proposal_id);
    assert_eq!(second_approval, true);

    let executed_payment_id = client.execute_approved_payment(&signer1, &proposal_id);
    assert_eq!(executed_payment_id, 1);
    assert_eq!(client.get_payment_count(), 1);
}

#[test]
fn test_multisig_threshold_validation_against_unique_signers() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);

    client.init(&owner);

    let duplicated_two_signers = vec![
        &env,
        signer1.clone(),
        signer2.clone(),
        signer1.clone(),
    ];
    let res_exceeding_threshold =
        client.try_set_multisig_config(&owner, &3u32, &duplicated_two_signers, &true);
    assert_eq!(
        res_exceeding_threshold,
        Err(Ok(PaymentError::InvalidAmount))
    );

    let res_zero_threshold =
        client.try_set_multisig_config(&owner, &0u32, &duplicated_two_signers, &true);
    assert_eq!(res_zero_threshold, Err(Ok(PaymentError::InvalidAmount)));

    let empty_signers = Vec::new(&env);
    let res_empty_signers = client.try_set_multisig_config(&owner, &1u32, &empty_signers, &true);
    assert_eq!(res_empty_signers, Err(Ok(PaymentError::InvalidAmount)));
}

#[test]
fn test_multisig_max_signers_cap_enforced() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    client.init(&owner);

    let mut excessive_signers = Vec::new(&env);
    for _ in 0..=(MAX_SIGNERS as usize) {
        excessive_signers.push_back(Address::generate(&env));
    }
    assert_eq!(excessive_signers.len(), 51);

    let res_excessive = client.try_set_multisig_config(&owner, &1u32, &excessive_signers, &true);
    assert_eq!(res_excessive, Err(Ok(PaymentError::MaxSignersExceeded)));

    let mut exactly_max_signers = Vec::new(&env);
    for _ in 0..(MAX_SIGNERS as usize) {
        exactly_max_signers.push_back(Address::generate(&env));
    }
    assert_eq!(exactly_max_signers.len(), 50);

    let mut duplicated_to_hundred = Vec::new(&env);
    for signer in exactly_max_signers.iter() {
        duplicated_to_hundred.push_back(signer.clone());
        duplicated_to_hundred.push_back(signer);
    }
    assert_eq!(duplicated_to_hundred.len(), 100);

    let res_deduped_max =
        client.try_set_multisig_config(&owner, &1u32, &duplicated_to_hundred, &true);
    assert_eq!(res_deduped_max, Ok(Ok(())));

    let config = client.get_multisig_config().unwrap();
    assert_eq!(config.signers.len(), 50);
}
