use super::*;
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{vec, String, Vec};

// ── Refund Tests ───────────────────────────────────────

#[test]
fn test_request_refund() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);
    let owner = Address::generate(&env);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);

    let _ = client.init(&owner);
    let asset = Address::generate(&env);
    let pid = client.record_payment(
        &payer,
        &payee,
        &1000i128,
        &asset,
        &String::from_str(&env, "tx_refund_test"),
        &String::from_str(&env, "test"),
    );

    let rid = client.request_refund(
        &payer,
        &pid,
        &1000i128,
        &asset,
        &String::from_str(&env, "Defective product"),
        &RefundReasonCode::ProductDefect,
    );
    assert_eq!(rid, 1);
    assert_eq!(client.get_refund_count(), 1);

    let refund = client.get_refund(&1);
    assert_eq!(refund.reason_code, RefundReasonCode::ProductDefect);
}

#[test]
fn test_approve_and_process_refund() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);
    let owner = Address::generate(&env);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);
    let sac = create_token_contract(&env, &owner);
    let sac_client = token::StellarAssetClient::new(&env, &sac);
    sac_client.mint(&owner, &10_000i128);

    let _ = client.init(&owner);
    let pid = client.record_payment(
        &payer,
        &payee,
        &500i128,
        &sac,
        &String::from_str(&env, "tx_approve"),
        &String::from_str(&env, "test"),
    );

    let rid = client.request_refund(
        &payer,
        &pid,
        &500i128,
        &sac,
        &String::from_str(&env, "Never received"),
        &RefundReasonCode::NonDelivery,
    );

    // Approve as owner
    client.approve_refund(&owner, &rid);

    let refund = client.get_refund(&rid);
    assert!(matches!(refund.status, RefundStatus::Approved));

    // Transfer tokens to contract so process_refund can send them back
    let contract_addr = contract_id.clone();
    sac_client.transfer(&owner, &contract_addr, &500i128);

    // Process refund (owner-authorized)
    client.process_refund(&owner, &rid);

    let refund = client.get_refund(&rid);
    assert!(matches!(refund.status, RefundStatus::Processed));
}

#[test]
fn test_refund_rejects_unauthorized_requester() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);
    let owner = Address::generate(&env);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);
    let stranger = Address::generate(&env);
    let asset = Address::generate(&env);

    let _ = client.init(&owner);
    let pid = client.record_payment(
        &payer,
        &payee,
        &1000i128,
        &asset,
        &String::from_str(&env, "tx_unauth_refund"),
        &String::from_str(&env, "test"),
    );

    // A stranger (neither payer nor payee) must not be able to request a refund
    let result = client.try_request_refund(
        &stranger,
        &pid,
        &1000i128,
        &asset,
        &String::from_str(&env, "hi"),
        &RefundReasonCode::CustomerRequest,
    );
    assert!(result.is_err());

    // Over-refund (amount > payment.amount) must be rejected
    let result = client.try_request_refund(
        &payer,
        &pid,
        &1001i128,
        &asset,
        &String::from_str(&env, "hi"),
        &RefundReasonCode::CustomerRequest,
    );
    assert!(result.is_err());

    // Asset mismatch must be rejected
    let result = client.try_request_refund(
        &payer,
        &pid,
        &1000i128,
        &Address::generate(&env),
        &String::from_str(&env, "hi"),
        &RefundReasonCode::CustomerRequest,
    );
    assert!(result.is_err());
}

#[test]
fn test_refund_not_found() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);
    let owner = Address::generate(&env);

    let _ = client.init(&owner);
    let result = client.try_get_refund(&999);
    assert!(result.is_err());
}

#[test]
fn test_reason_code_analytics() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);
    let owner = Address::generate(&env);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);

    let _ = client.init(&owner);
    let asset = Address::generate(&env);
    let pid = client.record_payment(
        &payer,
        &payee,
        &100i128,
        &asset,
        &String::from_str(&env, "tx_analytics"),
        &String::from_str(&env, "test"),
    );

    client.request_refund(
        &payer,
        &pid,
        &100i128,
        &asset,
        &String::from_str(&env, "r1"),
        &RefundReasonCode::DuplicateCharge,
    );

    let analytics = client.get_reason_code_analytics();
    // 6 buckets (ProductDefect..Other), one should have 1
    let mut found = false;
    for (_code, count) in analytics.iter() {
        if count >= 1 {
            found = true;
        }
    }
    assert!(found);
}


// ── Refund Tests ────────────────────────────────────────

#[test]
fn test_refund_lifecycle() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1000);
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);
    let sac = create_token_contract(&env, &owner);
    // Fund the contract so process_refund can transfer tokens back
    let sac_client = token::StellarAssetClient::new(&env, &sac);
    sac_client.mint(&contract_id, &10_000i128);

    let _ = client.init(&owner);

    // Record a payment first
    client.record_payment(
        &payer,
        &payee,
        &1000i128,
        &sac,
        &String::from_str(&env, "tx_hash"),
        &String::from_str(&env, "refundable payment"),
    );

    // Request refund
    let refund_id = client.request_refund(
        &payer,
        &1u64,
        &1000i128,
        &sac,
        &String::from_str(&env, "defective item"),
        &RefundReasonCode::ProductDefect,
    );
    assert_eq!(refund_id, 1);
    assert_eq!(client.get_refund_count(), 1);

    let refund = client.get_refund(&1);
    assert_eq!(refund.payment_id, 1);
    assert_eq!(refund.amount, 1000);
    assert_eq!(refund.status, RefundStatus::Requested);
    assert_eq!(refund.reason_code, RefundReasonCode::ProductDefect);

    // Owner approves
    client.approve_refund(&owner, &1);
    let refund2 = client.get_refund(&1);
    assert_eq!(refund2.status, RefundStatus::Approved);

    // Process refund (owner-authorized)
    client.process_refund(&owner, &1);
    let refund3 = client.get_refund(&1);
    assert_eq!(refund3.status, RefundStatus::Processed);
    assert!(refund3.resolved_at > 0);
}

#[test]
fn test_refund_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);
    let sac = create_token_contract(&env, &owner);

    let _ = client.init(&owner);

    client.record_payment(
        &payer,
        &payee,
        &500i128,
        &sac,
        &String::from_str(&env, "tx"),
        &String::from_str(&env, "test"),
    );

    client.request_refund(
        &payer,
        &1u64,
        &500i128,
        &sac,
        &String::from_str(&env, "changed mind"),
        &RefundReasonCode::CustomerRequest,
    );

    client.reject_refund(&owner, &1);
    let refund = client.get_refund(&1);
    assert_eq!(refund.status, RefundStatus::Rejected);
}

