use super::*;
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{vec, String, Vec};

// ── Invariant Tests (SPEC.md) ───────────────────────────

/// INV-3: emergency_withdraw cannot drain locked escrow funds
#[test]
fn test_emergency_withdraw_locked_funds_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let depositor = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    let sac = create_token_contract(&env, &owner);
    let sac_client = token::StellarAssetClient::new(&env, &sac);
    // Fund depositor
    sac_client.mint(&depositor, &10_000i128);
    // Also fund the contract directly (simulates accidentally-sent tokens)
    sac_client.mint(&contract_id, &5_000i128);

    let _ = client.init(&owner);

    // Create an escrow — this locks 1000 tokens
    client.create_escrow(
        &depositor,
        &beneficiary,
        &Option::<Address>::None,
        &1000i128,
        &sac,
        &(env.ledger().timestamp() + 86400),
        &String::from_str(&env, "locked"),
    );

    // The contract has 6000 tokens (5000 direct + 1000 escrowed).
    // Locked = 1000. Unlocked = 5000.
    // Owner tries to withdraw 5500 — should fail (only 5000 unlocked)
    let result = client.try_emergency_withdraw(&owner, &sac, &5_500i128);
    assert!(result.is_err());

    // Owner withdraws 5000 — should succeed (all unlocked)
    let result2 = client.try_emergency_withdraw(&owner, &sac, &5_000i128);
    assert!(result2.is_ok());
}

/// INV-4: Escrow cannot be released twice
#[test]
fn test_double_release_escrow_fails() {
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

    client.create_escrow(
        &depositor,
        &beneficiary,
        &Option::<Address>::None,
        &1000i128,
        &sac,
        &(env.ledger().timestamp() + 86400),
        &String::from_str(&env, "test"),
    );

    client.release_escrow(&owner, &1);
    let escrow = client.get_escrow(&1);
    assert!(escrow.released);

    // Second release should fail
    let result = client.try_release_escrow(&owner, &1);
    assert!(result.is_err());
}

/// INV-4: Escrow cannot be claimed twice after deadline
#[test]
fn test_double_claim_escrow_fails() {
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

    let deadline = env.ledger().timestamp() + 100;
    client.create_escrow(
        &depositor,
        &beneficiary,
        &Option::<Address>::None,
        &1000i128,
        &sac,
        &deadline,
        &String::from_str(&env, "test"),
    );

    // Advance past deadline
    env.ledger().set_timestamp(deadline + 1);

    // First claim succeeds
    client.claim_escrow(&beneficiary, &1);
    let escrow = client.get_escrow(&1);
    assert!(escrow.claimed);

    // Second claim should fail
    let result = client.try_claim_escrow(&beneficiary, &1);
    assert!(result.is_err());
}



/// REENT-1: Reentrancy lock rejects nested token operations
#[test]
fn test_reentrancy_lock_rejects_nested_calls() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);
    let owner = Address::generate(&env);
    let user = Address::generate(&env);
    let payee = Address::generate(&env);
    let sac = create_token_contract(&env, &owner);

    let _ = client.init(&owner);

    assert_eq!(client.is_reentrancy_locked(), false);
    assert_eq!(client.get_locked_balance(), 0);

    // Simulate active reentrancy lock
    env.as_contract(&contract_id, || {
        env.storage().instance().set(&REENTRANCY_LOCK, &true);
    });

    assert_eq!(client.is_reentrancy_locked(), true);

    // Every token-moving operation must return ReentrantCall
    let memo = String::from_str(&env, "memo");
    assert_eq!(
        client.try_create_escrow(
            &user,
            &payee,
            &None::<Address>,
            &1000i128,
            &sac,
            &100_000u64,
            &memo
        ),
        Err(Ok(PaymentError::ReentrantCall))
    );

    assert_eq!(
        client.try_release_escrow(&owner, &1u64),
        Err(Ok(PaymentError::ReentrantCall))
    );

    assert_eq!(
        client.try_release_by_arbiter(&owner, &1u64, &true),
        Err(Ok(PaymentError::ReentrantCall))
    );

    assert_eq!(
        client.try_claim_escrow(&payee, &1u64),
        Err(Ok(PaymentError::ReentrantCall))
    );

    assert_eq!(
        client.try_create_stream(&user, &payee, &1000i128, &sac, &1000u64, &2000u64, &memo),
        Err(Ok(PaymentError::ReentrantCall))
    );

    assert_eq!(
        client.try_claim_stream(&payee, &1u64),
        Err(Ok(PaymentError::ReentrantCall))
    );

    assert_eq!(
        client.try_cancel_stream(&user, &1u64),
        Err(Ok(PaymentError::ReentrantCall))
    );

    assert_eq!(
        client.try_process_refund(&owner, &1u64),
        Err(Ok(PaymentError::ReentrantCall))
    );

    assert_eq!(
        client.try_emergency_withdraw(&owner, &sac, &1000i128),
        Err(Ok(PaymentError::ReentrantCall))
    );
}

/// LOCK-1: Multi-operation escrow and stream lifecycle strictly conserves LOCKED_BALANCE
#[test]
fn test_locked_balance_conservation_lifecycle() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000_000);
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);
    let owner = Address::generate(&env);
    let user = Address::generate(&env);
    let payee1 = Address::generate(&env);
    let payee2 = Address::generate(&env);

    let sac = create_token_contract(&env, &owner);
    let sac_client = token::StellarAssetClient::new(&env, &sac);
    sac_client.mint(&user, &10_000_000i128);

    let _ = client.init(&owner);
    assert_eq!(client.get_locked_balance(), 0);

    // 1. Create Escrow 1 (1_000_000)
    let memo = String::from_str(&env, "e1");
    let e1 = client.create_escrow(
        &user,
        &payee1,
        &None::<Address>,
        &1_000_000i128,
        &sac,
        &1_050_000u64,
        &memo,
    );
    assert_eq!(e1, 1);
    assert_eq!(client.get_locked_balance(), 1_000_000);

    // 2. Create Escrow 2 (2_000_000)
    let e2 = client.create_escrow(
        &user,
        &payee2,
        &None::<Address>,
        &2_000_000i128,
        &sac,
        &1_050_000u64,
        &memo,
    );
    assert_eq!(e2, 2);
    assert_eq!(client.get_locked_balance(), 3_000_000);

    // 3. Create Stream (3_000_000 over 1000s)
    let s1 = client.create_stream(
        &user,
        &payee1,
        &3_000_000i128,
        &sac,
        &1_000_000u64,
        &1_001_000u64,
        &memo,
    );
    assert_eq!(s1, 1);
    assert_eq!(client.get_locked_balance(), 6_000_000);

    // 4. Release Escrow 1
    client.release_escrow(&owner, &e1);
    assert_eq!(client.get_locked_balance(), 5_000_000);

    // 5. Partial Stream Claim at 50% (500s elapsed -> 1_500_000 claimed)
    env.ledger().set_timestamp(1_000_500);
    let claimed = client.claim_stream(&payee1, &s1);
    assert_eq!(claimed, 1_500_000);
    assert_eq!(client.get_locked_balance(), 3_500_000);

    // 6. Cancel remaining Stream (1_500_000 unvested refunded to creator)
    let refunded = client.cancel_stream(&user, &s1);
    assert_eq!(refunded, 1_500_000);
    assert_eq!(client.get_locked_balance(), 2_000_000);

    // 7. Claim Escrow 2 after deadline
    env.ledger().set_timestamp(1_060_000);
    client.claim_escrow(&payee2, &e2);
    assert_eq!(client.get_locked_balance(), 0);
}

