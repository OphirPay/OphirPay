// SPDX-License-Identifier: MIT
#![cfg(test)]

//! Property-based testing & reentrancy test suite for OphirPay token-moving functions.
//!
//! Acceptance Criteria:
//! 1. Property tests over escrow release/claim, stream claim/cancel, refund processing
//!    asserting LOCKED_BALANCE conservation.
//! 2. Include reentrancy-shaped call sequences asserting ReentrantCall rejection.
//! 3. Runs in CI with bounded iterations (ProptestConfig::with_cases(64)).

use ophirpay_contract::{OphirPayContract, OphirPayContractClient, PaymentError};
use proptest::prelude::*;
use proptest::test_runner::Config as ProptestConfig;
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{token, Address, Env, String, Symbol};

const PROPTEST_CASES: u32 = 64;

fn get_proptest_config() -> ProptestConfig {
    ProptestConfig {
        cases: PROPTEST_CASES,
        max_shrink_iters: 100,
        ..ProptestConfig::default()
    }
}

#[allow(dead_code)]
struct PropHarness<'a> {
    env: Env,
    contract_id: Address,
    client: OphirPayContractClient<'a>,
    owner: Address,
    token_admin: Address,
    token_id: Address,
    token_client: token::Client<'a>,
    token_admin_client: token::StellarAssetClient<'a>,
}

impl<'a> PropHarness<'a> {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1_000_000);

        let owner = Address::generate(&env);
        let token_admin = Address::generate(&env);

        let token_id = env
            .register_stellar_asset_contract_v2(token_admin.clone())
            .address();
        let token_client = token::Client::new(&env, &token_id);
        let token_admin_client = token::StellarAssetClient::new(&env, &token_id);

        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        client.init(&owner);

        PropHarness {
            env,
            contract_id,
            client,
            owner,
            token_admin,
            token_id,
            token_client,
            token_admin_client,
        }
    }

    fn mint(&self, to: &Address, amount: i128) {
        self.token_admin_client.mint(to, &amount);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. PROPERTY TESTS: LOCKED_BALANCE Conservation over Escrows
// ═══════════════════════════════════════════════════════════════════════════

proptest! {
    #![proptest_config(get_proptest_config())]

    #[test]
    fn prop_escrow_release_conserves_locked_balance(
        deposit_amount in 1i128..=100_000_000i128,
        deadline_offset in 100u64..=100_000u64,
    ) {
        let h = PropHarness::new();
        let depositor = Address::generate(&h.env);
        let beneficiary = Address::generate(&h.env);

        h.mint(&depositor, deposit_amount);

        let now = h.env.ledger().timestamp();
        let deadline = now + deadline_offset;
        let memo = String::from_str(&h.env, "prop_escrow_release");

        // Initial invariant: locked = 0
        prop_assert_eq!(h.client.get_locked_balance(), 0);

        // 1. Create escrow
        let escrow_id = h.client.create_escrow(
            &depositor,
            &beneficiary,
            &None::<Address>,
            &deposit_amount,
            &h.token_id,
            &deadline,
            &memo,
        );
        prop_assert_eq!(escrow_id, 1);

        // Invariant: locked increased by exact deposit_amount
        prop_assert_eq!(h.client.get_locked_balance(), deposit_amount);
        prop_assert_eq!(h.token_client.balance(&h.contract_id), deposit_amount);
        prop_assert_eq!(h.token_client.balance(&depositor), 0);

        // 2. Owner releases escrow to beneficiary
        h.client.release_escrow(&h.owner, &escrow_id);

        // Invariant: locked returns to 0, tokens moved to beneficiary
        prop_assert_eq!(h.client.get_locked_balance(), 0);
        prop_assert_eq!(h.token_client.balance(&h.contract_id), 0);
        prop_assert_eq!(h.token_client.balance(&beneficiary), deposit_amount);

        // Escrow marked released and claimed
        let esc = h.client.get_escrow(&escrow_id);
        prop_assert!(esc.released);
        prop_assert!(esc.claimed);
    }

    #[test]
    fn prop_escrow_claim_after_deadline_conserves_locked_balance(
        deposit_amount in 1i128..=100_000_000i128,
        deadline_offset in 50u64..=50_000u64,
    ) {
        let h = PropHarness::new();
        let depositor = Address::generate(&h.env);
        let beneficiary = Address::generate(&h.env);

        h.mint(&depositor, deposit_amount);

        let now = h.env.ledger().timestamp();
        let deadline = now + deadline_offset;
        let memo = String::from_str(&h.env, "prop_escrow_claim");

        let escrow_id = h.client.create_escrow(
            &depositor,
            &beneficiary,
            &None::<Address>,
            &deposit_amount,
            &h.token_id,
            &deadline,
            &memo,
        );

        prop_assert_eq!(h.client.get_locked_balance(), deposit_amount);

        // Fast-forward ledger past deadline
        h.env.ledger().set_timestamp(deadline + 1);

        // Beneficiary claims escrow
        h.client.claim_escrow(&beneficiary, &escrow_id);

        // Invariant: locked balance conserved back to 0
        prop_assert_eq!(h.client.get_locked_balance(), 0);
        prop_assert_eq!(h.token_client.balance(&h.contract_id), 0);
        prop_assert_eq!(h.token_client.balance(&beneficiary), deposit_amount);
    }

    #[test]
    fn prop_escrow_arbiter_resolution_conserves_locked_balance(
        deposit_amount in 1i128..=100_000_000i128,
        release_to_beneficiary in proptest::bool::ANY,
    ) {
        let h = PropHarness::new();
        let depositor = Address::generate(&h.env);
        let beneficiary = Address::generate(&h.env);
        let arbiter = Address::generate(&h.env);

        h.mint(&depositor, deposit_amount);

        let now = h.env.ledger().timestamp();
        let deadline = now + 1000;
        let memo = String::from_str(&h.env, "arbiter_prop");

        let escrow_id = h.client.create_escrow(
            &depositor,
            &beneficiary,
            &Some(arbiter.clone()),
            &deposit_amount,
            &h.token_id,
            &deadline,
            &memo,
        );

        prop_assert_eq!(h.client.get_locked_balance(), deposit_amount);

        // Arbiter resolves dispute
        h.client.release_by_arbiter(&arbiter, &escrow_id, &release_to_beneficiary);

        // Invariant: locked balance restored to 0 regardless of recipient
        prop_assert_eq!(h.client.get_locked_balance(), 0);
        prop_assert_eq!(h.token_client.balance(&h.contract_id), 0);

        if release_to_beneficiary {
            prop_assert_eq!(h.token_client.balance(&beneficiary), deposit_amount);
            prop_assert_eq!(h.token_client.balance(&depositor), 0);
        } else {
            prop_assert_eq!(h.token_client.balance(&depositor), deposit_amount);
            prop_assert_eq!(h.token_client.balance(&beneficiary), 0);
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. PROPERTY TESTS: LOCKED_BALANCE Conservation over Streams
// ═══════════════════════════════════════════════════════════════════════════

proptest! {
    #![proptest_config(get_proptest_config())]

    #[test]
    fn prop_stream_claim_and_cancel_conservation(
        total_amount in 10_000i128..=1_000_000_000i128,
        duration in 100u64..=10_000u64,
        pct_elapsed in 1u64..=99u64,
    ) {
        let h = PropHarness::new();
        let creator = Address::generate(&h.env);
        let recipient = Address::generate(&h.env);

        h.mint(&creator, total_amount);

        let start_time = h.env.ledger().timestamp();
        let end_time = start_time + duration;
        let memo = String::from_str(&h.env, "prop_stream");

        // 1. Create stream
        let stream_id = h.client.create_stream(
            &creator,
            &recipient,
            &total_amount,
            &h.token_id,
            &start_time,
            &end_time,
            &memo,
        );

        prop_assert_eq!(h.client.get_locked_balance(), total_amount);
        prop_assert_eq!(h.token_client.balance(&h.contract_id), total_amount);

        // 2. Advance time partially
        let elapsed = (duration * pct_elapsed) / 100;
        let claim_time = start_time + elapsed;
        h.env.ledger().set_timestamp(claim_time);

        // 3. Claim vested tokens
        let claimed = h.client.claim_stream(&recipient, &stream_id);
        let expected_vested = (total_amount * (elapsed as i128)) / (duration as i128);

        prop_assert_eq!(claimed, expected_vested);
        prop_assert_eq!(h.token_client.balance(&recipient), claimed);

        // Invariant: locked balance decreased by exactly claimed
        let expected_remaining = total_amount - claimed;
        prop_assert_eq!(h.client.get_locked_balance(), expected_remaining);
        prop_assert_eq!(h.token_client.balance(&h.contract_id), expected_remaining);

        // 4. Creator cancels remaining stream
        let unvested_refunded = h.client.cancel_stream(&creator, &stream_id);
        prop_assert_eq!(unvested_refunded, expected_remaining);

        // Invariant: locked balance returned to 0
        prop_assert_eq!(h.client.get_locked_balance(), 0);
        prop_assert_eq!(h.token_client.balance(&h.contract_id), 0);

        // Total tokens accounted for perfectly
        prop_assert_eq!(claimed + unvested_refunded, total_amount);
        prop_assert_eq!(h.token_client.balance(&creator), unvested_refunded);
    }

    #[test]
    fn prop_stream_full_vesting_conservation(
        total_amount in 1_000i128..=500_000_000i128,
        duration in 50u64..=5_000u64,
    ) {
        let h = PropHarness::new();
        let creator = Address::generate(&h.env);
        let recipient = Address::generate(&h.env);

        h.mint(&creator, total_amount);

        let start_time = h.env.ledger().timestamp();
        let end_time = start_time + duration;
        let memo = String::from_str(&h.env, "prop_full_stream");

        let stream_id = h.client.create_stream(
            &creator,
            &recipient,
            &total_amount,
            &h.token_id,
            &start_time,
            &end_time,
            &memo,
        );

        // Fast-forward past completion
        h.env.ledger().set_timestamp(end_time + 100);

        let claimed = h.client.claim_stream(&recipient, &stream_id);
        prop_assert_eq!(claimed, total_amount);

        // Invariant: locked balance returns to 0
        prop_assert_eq!(h.client.get_locked_balance(), 0);
        prop_assert_eq!(h.token_client.balance(&h.contract_id), 0);
        prop_assert_eq!(h.token_client.balance(&recipient), total_amount);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. PROPERTY TESTS: Concurrent Operations & Composite Invariants
// ═══════════════════════════════════════════════════════════════════════════

proptest! {
    #![proptest_config(get_proptest_config())]

    #[test]
    fn prop_concurrent_escrows_streams_and_proposals_conservation(
        escrow_amounts in proptest::collection::vec(1_000i128..=10_000_000i128, 1..=4),
        stream_amounts in proptest::collection::vec(5_000i128..=10_000_000i128, 1..=4),
        proposal_deposit in 10_000i128..=5_000_000i128,
    ) {
        let h = PropHarness::new();
        let user = Address::generate(&h.env);

        let total_escrow: i128 = escrow_amounts.iter().sum();
        let total_stream: i128 = stream_amounts.iter().sum();
        let total_needed = total_escrow + total_stream + proposal_deposit;
        h.mint(&user, total_needed);

        let mut expected_locked = 0i128;
        let mut escrow_ids = std::vec::Vec::new();
        let mut stream_ids = std::vec::Vec::new();

        // 1. Create all escrows
        for &amt in &escrow_amounts {
            let ben = Address::generate(&h.env);
            let id = h.client.create_escrow(
                &user,
                &ben,
                &None::<Address>,
                &amt,
                &h.token_id,
                &(h.env.ledger().timestamp() + 5000),
                &String::from_str(&h.env, "esc"),
            );
            escrow_ids.push((id, amt));
            expected_locked += amt;
            prop_assert_eq!(h.client.get_locked_balance(), expected_locked);
        }

        // 2. Create all streams
        let start = h.env.ledger().timestamp();
        for &amt in &stream_amounts {
            let rec = Address::generate(&h.env);
            let id = h.client.create_stream(
                &user,
                &rec,
                &amt,
                &h.token_id,
                &start,
                &(start + 1000),
                &String::from_str(&h.env, "str"),
            );
            stream_ids.push((id, amt));
            expected_locked += amt;
            prop_assert_eq!(h.client.get_locked_balance(), expected_locked);
        }

        // 3. Create governance proposal with deposit
        h.client.configure_governance(
            &h.owner,
            &proposal_deposit,
            &3600u64,
            &5000u32,
            &true,
        );

        let prop_id = h.client.create_proposal(
            &user,
            &String::from_str(&h.env, "Prop"),
            &String::from_str(&h.env, "Desc"),
            &String::from_str(&h.env, "action"),
            &String::from_str(&h.env, "target"),
            &String::from_str(&h.env, "data"),
            &h.token_id,
            &proposal_deposit,
        );
        expected_locked += proposal_deposit;
        prop_assert_eq!(h.client.get_locked_balance(), expected_locked);

        // 4. Release all escrows
        for &(id, amt) in &escrow_ids {
            h.client.release_escrow(&h.owner, &id);
            expected_locked -= amt;
            prop_assert_eq!(h.client.get_locked_balance(), expected_locked);
        }

        // 5. Cancel all streams (time = start, 0 claimed, 100% refunded)
        for &(id, amt) in &stream_ids {
            let refunded = h.client.cancel_stream(&user, &id);
            prop_assert_eq!(refunded, amt);
            expected_locked -= amt;
            prop_assert_eq!(h.client.get_locked_balance(), expected_locked);
        }

        // 6. Execute proposal past voting deadline (deposit refunded)
        h.env.ledger().set_timestamp(h.env.ledger().timestamp() + 3601);
        let _ = h.client.execute_proposal(&prop_id);
        expected_locked -= proposal_deposit;

        // Final invariant: all locked funds fully cleared
        prop_assert_eq!(expected_locked, 0);
        prop_assert_eq!(h.client.get_locked_balance(), 0);
        prop_assert_eq!(h.token_client.balance(&h.contract_id), 0);
    }

    #[test]
    fn prop_emergency_withdraw_respects_locked_funds_boundary(
        locked_amount in 10_000i128..=50_000_000i128,
        unlocked_surplus in 5_000i128..=50_000_000i128,
    ) {
        let h = PropHarness::new();
        let user = Address::generate(&h.env);
        let beneficiary = Address::generate(&h.env);

        h.mint(&user, locked_amount);
        h.mint(&h.contract_id, unlocked_surplus); // Accidental direct send to contract

        // Lock funds in escrow
        let _ = h.client.create_escrow(
            &user,
            &beneficiary,
            &None::<Address>,
            &locked_amount,
            &h.token_id,
            &(h.env.ledger().timestamp() + 1000),
            &String::from_str(&h.env, "surplus_test"),
        );

        prop_assert_eq!(h.client.get_locked_balance(), locked_amount);
        prop_assert_eq!(
            h.token_client.balance(&h.contract_id),
            locked_amount + unlocked_surplus
        );

        // Attempting to withdraw more than unlocked surplus fails
        let greedy_attempt = unlocked_surplus + 1;
        let fail_res = h.client.try_emergency_withdraw(&h.owner, &h.token_id, &greedy_attempt);
        prop_assert_eq!(fail_res, Err(Ok(PaymentError::NoTokensToWithdraw)));

        // Locked balance is completely unaffected by failed attempt
        prop_assert_eq!(h.client.get_locked_balance(), locked_amount);

        // Withdrawing exactly the unlocked surplus succeeds
        let succ_res = h.client.try_emergency_withdraw(&h.owner, &h.token_id, &unlocked_surplus);
        prop_assert!(succ_res.is_ok());

        // Locked balance remains fully intact
        prop_assert_eq!(h.client.get_locked_balance(), locked_amount);
        prop_assert_eq!(h.token_client.balance(&h.contract_id), locked_amount);
        prop_assert_eq!(h.token_client.balance(&h.owner), unlocked_surplus);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. REENTRANCY TESTS: Reentrancy Lock Sequences and State Invariants
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_reentrancy_lock_active_state_blocks_all_token_paths() {
    let h = PropHarness::new();
    let user = Address::generate(&h.env);
    let payee = Address::generate(&h.env);

    h.mint(&user, 1_000_000);
    h.mint(&h.contract_id, 1_000_000);

    // Initial state: not reentrancy locked
    assert_eq!(h.client.is_reentrancy_locked(), false);

    // Artificially simulate an active reentrancy lock (as in cross-contract callback)
    h.env.as_contract(&h.contract_id, || {
        let lock_sym = Symbol::new(&h.env, "RE_LOCK");
        h.env.storage().instance().set(&lock_sym, &true);
    });

    assert_eq!(h.client.is_reentrancy_locked(), true);

    let memo = String::from_str(&h.env, "reentrant_attempt");

    // 1. create_escrow fails with ReentrantCall
    assert_eq!(
        h.client.try_create_escrow(
            &user,
            &payee,
            &None::<Address>,
            &1000i128,
            &h.token_id,
            &2_000_000u64,
            &memo,
        ),
        Err(Ok(PaymentError::ReentrantCall))
    );

    // 2. release_escrow fails with ReentrantCall
    assert_eq!(
        h.client.try_release_escrow(&h.owner, &1u64),
        Err(Ok(PaymentError::ReentrantCall))
    );

    // 3. release_by_arbiter fails with ReentrantCall
    assert_eq!(
        h.client.try_release_by_arbiter(&h.owner, &1u64, &true),
        Err(Ok(PaymentError::ReentrantCall))
    );

    // 4. claim_escrow fails with ReentrantCall
    assert_eq!(
        h.client.try_claim_escrow(&payee, &1u64),
        Err(Ok(PaymentError::ReentrantCall))
    );

    // 5. create_stream fails with ReentrantCall
    assert_eq!(
        h.client.try_create_stream(
            &user,
            &payee,
            &1000i128,
            &h.token_id,
            &1_000_000u64,
            &2_000_000u64,
            &memo,
        ),
        Err(Ok(PaymentError::ReentrantCall))
    );

    // 6. claim_stream fails with ReentrantCall
    assert_eq!(
        h.client.try_claim_stream(&payee, &1u64),
        Err(Ok(PaymentError::ReentrantCall))
    );

    // 7. cancel_stream fails with ReentrantCall
    assert_eq!(
        h.client.try_cancel_stream(&user, &1u64),
        Err(Ok(PaymentError::ReentrantCall))
    );

    // 8. create_proposal fails with ReentrantCall
    assert_eq!(
        h.client.try_create_proposal(
            &user,
            &String::from_str(&h.env, "title"),
            &String::from_str(&h.env, "desc"),
            &String::from_str(&h.env, "act"),
            &String::from_str(&h.env, "tgt"),
            &String::from_str(&h.env, "data"),
            &h.token_id,
            &1000i128,
        ),
        Err(Ok(PaymentError::ReentrantCall))
    );

    // 9. execute_proposal fails with ReentrantCall
    assert_eq!(
        h.client.try_execute_proposal(&1u64),
        Err(Ok(PaymentError::ReentrantCall))
    );

    // 10. process_refund fails with ReentrantCall
    assert_eq!(
        h.client.try_process_refund(&h.owner, &1u64),
        Err(Ok(PaymentError::ReentrantCall))
    );

    // 11. emergency_withdraw fails with ReentrantCall
    assert_eq!(
        h.client
            .try_emergency_withdraw(&h.owner, &h.token_id, &1000i128),
        Err(Ok(PaymentError::ReentrantCall))
    );

    // 12. emergency_pause_all fails with ReentrantCall
    assert_eq!(
        h.client.try_emergency_pause_all(&h.owner),
        Err(Ok(PaymentError::ReentrantCall))
    );

    // 13. emergency_unpause_all fails with ReentrantCall
    assert_eq!(
        h.client.try_emergency_unpause_all(&h.owner),
        Err(Ok(PaymentError::ReentrantCall))
    );

    // Invariant: locked balance remained 0 throughout all rejected calls
    assert_eq!(h.client.get_locked_balance(), 0);
}

#[test]
fn test_reentrancy_lock_lifecycle_and_clean_release() {
    let h = PropHarness::new();
    let user = Address::generate(&h.env);
    let payee = Address::generate(&h.env);

    h.mint(&user, 5_000_000);

    // Initial check
    assert_eq!(h.client.is_reentrancy_locked(), false);

    // Normal operation acquires and automatically releases lock
    let eid = h.client.create_escrow(
        &user,
        &payee,
        &None::<Address>,
        &1_000_000i128,
        &h.token_id,
        &(h.env.ledger().timestamp() + 500),
        &String::from_str(&h.env, "test"),
    );

    assert_eq!(eid, 1);
    assert_eq!(h.client.is_reentrancy_locked(), false);
    assert_eq!(h.client.get_locked_balance(), 1_000_000);

    // Subsequent operation executes cleanly without deadlock
    h.client.release_escrow(&h.owner, &eid);

    assert_eq!(h.client.is_reentrancy_locked(), false);
    assert_eq!(h.client.get_locked_balance(), 0);
}
