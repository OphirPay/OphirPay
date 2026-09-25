use super::*;
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{vec, String, Vec};

// ── Batch Tests ────────────────────────────────────────

#[test]
fn test_create_batch() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let creator = Address::generate(&env);
    let p1 = Address::generate(&env);
    let p2 = Address::generate(&env);
    let p3 = Address::generate(&env);
    let sac = create_token_contract(&env, &owner);

    let _ = client.init(&owner);

    let payees = vec![&env, p1.clone(), p2.clone(), p3.clone()];
    let amounts = vec![&env, 100i128, 200i128, 300i128];

    let result = client.create_batch(
        &creator,
        &payees,
        &amounts,
        &sac,
        &String::from_str(&env, "batch_tx_hash"),
    );
    assert_eq!(result.batch_id, 1);
    assert_eq!(client.get_batch_count(), 1);
    assert_eq!(client.get_payment_count(), 3);
    assert_eq!(result.successful, 3);
    assert_eq!(result.failed, 0);

    let batch = client.get_batch(&1);
    assert_eq!(batch.total_amount, 600);
    assert_eq!(batch.total_recipients, 3);
    assert_eq!(batch.payment_ids.len(), 3);

    // Query batch payments (#742: bounded, newest-first, with a flag)
    let batch_payments = client.get_payments_by_batch(&1);
    assert_eq!(batch_payments.total, 3);
    assert!(!batch_payments.truncated);
    assert_eq!(batch_payments.items.len(), 3);
}

#[test]
#[should_panic]
fn test_empty_batch_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let creator = Address::generate(&env);
    let sac = create_token_contract(&env, &owner);

    let _ = client.init(&owner);

    let payees = Vec::<Address>::new(&env);
    let amounts = Vec::<i128>::new(&env);
    client.create_batch(
        &creator,
        &payees,
        &amounts,
        &sac,
        &String::from_str(&env, "empty"),
    );
}

