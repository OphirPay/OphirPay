use super::*;
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{vec, String, Vec};

// ── RBAC Tests ──────────────────────────────────────────

#[test]
fn test_grant_and_revoke_role() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);
    let owner = Address::generate(&env);
    let operator = Address::generate(&env);

    let _ = client.init(&owner);
    client.grant_role(&owner, &operator, &Role::Operator);

    let role = client.get_role(&operator);
    assert!(role.is_some());

    client.revoke_role(&owner, &operator);
    let role = client.get_role(&operator);
    assert!(role.is_none());
}

// ── Audit Log Test ─────────────────────────────────────

#[test]
fn test_audit_log_after_payment() {
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
        &String::from_str(&env, "audit"),
    );

    let count = client.get_audit_log_count();
    assert!(count >= 1);

    let entry = client.get_audit_entry(&1);
    assert!(entry.id >= 1);
}

