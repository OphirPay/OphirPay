// SPDX-License-Identifier: MIT
#![cfg(test)]

//! Contract Invariant Verification Suite for OphirPay Smart Contract.
//!
//! Addresses AUDIT HIGH-2 / Issue #802:
//! Unlike purely modeled Kani proofs that verify hand-written models disconnected
//! from the contract, this verification harness exercises the actual deployed
//! `OphirPayContract` inside Soroban's native test environment (`soroban_sdk::Env`).
//!
//! Verified Invariants:
//! 1. Fund Safety & LOCKED_BALANCE Conservation:
//!    - LOCKED_BALANCE is non-negative at all times.
//!    - emergency_withdraw can never extract locked user funds (escrows, streams, governance deposits).
//!    - Locked balance is strictly conserved across create -> resolve lifecycles.
//! 2. Refund Path Integrity:
//!    - Requesters must be authorized (payer or payee).
//!    - Refund amount cannot exceed the original payment amount.
//!    - Refund asset must strictly match payment asset.
//!    - Processed refunds cannot be double-processed.
//! 3. Escrow Single-Release:
//!    - Escrow funds are paid out at most once.
//!    - Double-release by owner, double-release by arbiter, or claim-after-release
//!      strictly fail with `EscrowAlreadyReleased`.
//! 4. Stream Bounded Vesting:
//!    - Claims before stream start fail with `StreamNotStarted`.
//!    - Partial claims are strictly bounded by linear vesting time progress.
//!    - Total amount claimed across lifetime cannot exceed `stream.total_amount`.
//!    - Stream cancellation strictly conserves `claimed + refunded == total_amount`.
//! 5. Pause Guard Isolation:
//!    - When emergency pause is active, all mutating entrypoints are rejected
//!      with `ContractPaused`. Read-only getters remain available.
//! 6. Governance Single Vote Per Address:
//!    - Double-voting on a proposal is strictly rejected with `AlreadyVoted`.

use ophirpay_contract::{
    OphirPayContract, OphirPayContractClient, PaymentError, RefundReasonCode,
};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{token, vec, Address, Env, String};

pub struct InvariantTestHarness<'a> {
    pub env: Env,
    pub contract_id: Address,
    pub client: OphirPayContractClient<'a>,
    pub owner: Address,
    pub token_admin: Address,
    pub token_id: Address,
    pub token_client: token::Client<'a>,
    pub token_admin_client: token::StellarAssetClient<'a>,
}

impl<'a> InvariantTestHarness<'a> {
    pub fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1_000_000);

        let owner = Address::generate(&env);
        let token_admin = Address::generate(&env);

        let token_id = env.register_stellar_asset_contract_v2(token_admin.clone()).address();
        let token_client = token::Client::new(&env, &token_id);
        let token_admin_client = token::StellarAssetClient::new(&env, &token_id);

        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        client.init(&owner);

        InvariantTestHarness {
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
}

// ─────────────────────────────────────────────────────────────────────────────
// INVARIANT 1: Fund Safety & LOCKED_BALANCE Conservation
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn invariant_locked_balance_fund_safety_conservation() {
    let h = InvariantTestHarness::new();
    let meta = String::from_str(&h.env, "meta");
    let initial_locked = h.client.get_locked_balance();
    assert_eq!(initial_locked, 0, "Initial locked balance must be zero");

    // Seed contract with 5,000 stroops of unlocked operational funds from owner
    h.token_admin_client.mint(&h.owner, &5_000i128);
    h.token_client.transfer(&h.owner, &h.contract_id, &5_000i128);
    assert_eq!(h.token_client.balance(&h.contract_id), 5_000);

    // 1. Create an Escrow of 1,000 stroops
    let depositor = Address::generate(&h.env);
    let beneficiary = Address::generate(&h.env);
    h.token_admin_client.mint(&depositor, &2_000i128);
    let escrow_amount = 1_000i128;

    let escrow_id = h.client.create_escrow(
        &depositor,
        &beneficiary,
        &None::<Address>,
        &escrow_amount,
        &h.token_id,
        &(h.env.ledger().timestamp() + 5_000),
        &meta,
    );

    let locked_after_escrow = h.client.get_locked_balance();
    assert_eq!(
        locked_after_escrow, 1_000,
        "LOCKED_BALANCE must reflect escrow amount"
    );
    assert_eq!(h.token_client.balance(&h.contract_id), 6_000);

    // INVARIANT CHECK: emergency_withdraw cannot drain locked user funds.
    // Unlocked funds = 6,000 - 1,000 = 5,000.
    // Attempting to withdraw 5,001 must fail.
    let fail_withdraw = h.client.try_emergency_withdraw(&h.owner, &h.token_id, &5_001i128);
    assert_eq!(
        fail_withdraw,
        Err(Ok(PaymentError::NoTokensToWithdraw)),
        "Emergency withdraw must reject amounts exceeding unlocked funds"
    );

    // Withdrawing exactly available unlocked funds (5,000) must succeed
    h.client.emergency_withdraw(&h.owner, &h.token_id, &5_000i128);
    assert_eq!(h.token_client.balance(&h.contract_id), 1_000);
    assert_eq!(h.client.get_locked_balance(), 1_000);

    // Now unlocked funds = 1,000 - 1,000 = 0. Attempting to withdraw even 1 stroop must fail!
    let fail_drain = h.client.try_emergency_withdraw(&h.owner, &h.token_id, &1i128);
    assert_eq!(
        fail_drain,
        Err(Ok(PaymentError::NoTokensToWithdraw)),
        "Emergency withdraw must reject draining locked escrow funds"
    );

    // 2. Create a Stream of 2,000 stroops
    let creator = Address::generate(&h.env);
    let recipient = Address::generate(&h.env);
    h.token_admin_client.mint(&creator, &3_000i128);
    let stream_amount = 2_000i128;
    let now = h.env.ledger().timestamp();
    let stream_id = h.client.create_stream(
        &creator,
        &recipient,
        &stream_amount,
        &h.token_id,
        &now,
        &(now + 10_000),
        &meta,
    );

    let locked_after_stream = h.client.get_locked_balance();
    assert_eq!(
        locked_after_stream, 3_000,
        "LOCKED_BALANCE must increase by stream total"
    );
    assert_eq!(h.token_client.balance(&h.contract_id), 3_000);

    // 3. Create a Governance Proposal with 500 stroop deposit
    let proposer = Address::generate(&h.env);
    h.token_admin_client.mint(&proposer, &1_000i128);
    h.client.configure_governance(&h.owner, &500i128, &20_000u64, &51u32, &true);

    let prop_id = h.client.create_proposal(
        &proposer,
        &String::from_str(&h.env, "Invariants"),
        &String::from_str(&h.env, "Formal Verification"),
        &String::from_str(&h.env, "Action"),
        &String::from_str(&h.env, "Target"),
        &String::from_str(&h.env, "Data"),
        &h.token_id,
        &500i128,
    );

    let locked_after_gov = h.client.get_locked_balance();
    assert_eq!(
        locked_after_gov, 3_500,
        "LOCKED_BALANCE must include proposal deposit"
    );

    // 4. Release Escrow -> LOCKED_BALANCE decreases by 1,000
    h.client.release_escrow(&h.owner, &escrow_id);
    assert_eq!(h.client.get_locked_balance(), 2_500);

    // 5. Advance time by 50% (5,000s) and claim stream -> 1,000 claimed, LOCKED_BALANCE decreases
    h.env.ledger().set_timestamp(now + 5_000);
    let claimed = h.client.claim_stream(&recipient, &stream_id);
    assert_eq!(claimed, 1_000);
    assert_eq!(h.client.get_locked_balance(), 1_500);

    // 6. Creator cancels remaining stream -> unvested 1,000 refunded, LOCKED_BALANCE decreases
    let refunded = h.client.cancel_stream(&creator, &stream_id);
    assert_eq!(refunded, 1_000);
    assert_eq!(h.client.get_locked_balance(), 500);

    // 7. Execute proposal -> deposit (500) refunded to proposer, LOCKED_BALANCE decreases to 0
    h.env.ledger().set_timestamp(now + 25_000); // after voting period
    h.client.execute_proposal(&prop_id);
    assert_eq!(
        h.client.get_locked_balance(),
        0,
        "LOCKED_BALANCE must return to 0 after full lifecycle of all obligations"
    );
    assert!(h.client.get_locked_balance() >= 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// INVARIANT 2: Refund Path Integrity & Bounds
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn invariant_refund_paths_bounded_and_authorized() {
    let h = InvariantTestHarness::new();
    let payer = Address::generate(&h.env);
    let payee = Address::generate(&h.env);
    let stranger = Address::generate(&h.env);
    let payment_amount = 1_000i128;

    // Record original payment
    let payment_id = h.client.record_payment(
        &payer,
        &payee,
        &payment_amount,
        &h.token_id,
        &String::from_str(&h.env, "tx123"),
        &String::from_str(&h.env, "memo"),
    );

    // PROPERTY 2a: Requester must be authorized (payer or payee)
    let unauthorized_req = h.client.try_request_refund(
        &stranger,
        &payment_id,
        &500i128,
        &h.token_id,
        &String::from_str(&h.env, "unauthorized"),
        &RefundReasonCode::Unauthorized,
    );
    assert_eq!(
        unauthorized_req,
        Err(Ok(PaymentError::Unauthorized)),
        "Non-payer / non-payee cannot request refund"
    );

    // PROPERTY 2b: Refund amount cannot exceed payment amount
    let excess_req = h.client.try_request_refund(
        &payer,
        &payment_id,
        &(payment_amount + 1),
        &h.token_id,
        &String::from_str(&h.env, "over_claim"),
        &RefundReasonCode::CustomerRequest,
    );
    assert_eq!(
        excess_req,
        Err(Ok(PaymentError::InvalidAmount)),
        "Refund amount exceeding original payment amount must be rejected"
    );

    // PROPERTY 2c: Refund asset must strictly match payment asset
    let wrong_asset = Address::generate(&h.env);
    let asset_mismatch = h.client.try_request_refund(
        &payer,
        &payment_id,
        &500i128,
        &wrong_asset,
        &String::from_str(&h.env, "asset_swap"),
        &RefundReasonCode::CustomerRequest,
    );
    assert_eq!(
        asset_mismatch,
        Err(Ok(PaymentError::AssetNotSupported)),
        "Refund asset mismatch must be rejected"
    );

    // PROPERTY 2d: Valid request succeeds and can only be processed once
    let refund_id = h.client.request_refund(
        &payer,
        &payment_id,
        &600i128,
        &h.token_id,
        &String::from_str(&h.env, "valid request"),
        &RefundReasonCode::CustomerRequest,
    );
    assert_eq!(refund_id, 1);

    // Cannot process before approval
    let unapproved_process = h.client.try_process_refund(&h.owner, &refund_id);
    assert_eq!(
        unapproved_process,
        Err(Ok(PaymentError::RefundAlreadyProcessed)),
        "Unapproved refund cannot be processed"
    );

    // Approve refund
    h.client.approve_refund(&h.owner, &refund_id);

    // Fund contract with necessary balance to pay refund
    h.token_admin_client.mint(&h.contract_id, &600i128);

    // Process refund
    let balance_before = h.token_client.balance(&payer);
    h.client.process_refund(&h.owner, &refund_id);
    let balance_after = h.token_client.balance(&payer);
    assert_eq!(
        balance_after - balance_before,
        600,
        "Payer receives exact approved refund amount"
    );

    // PROPERTY 2e: Cannot re-process an already processed refund
    let double_process = h.client.try_process_refund(&h.owner, &refund_id);
    assert_eq!(
        double_process,
        Err(Ok(PaymentError::RefundAlreadyProcessed)),
        "Double refund processing must be impossible"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// INVARIANT 3: Escrow Single-Release
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn invariant_escrow_single_release() {
    let h = InvariantTestHarness::new();
    let depositor = Address::generate(&h.env);
    let beneficiary = Address::generate(&h.env);
    let arbiter = Address::generate(&h.env);
    let meta = String::from_str(&h.env, "escrow_meta");
    h.token_admin_client.mint(&depositor, &10_000i128);

    let deadline = h.env.ledger().timestamp() + 10_000;

    // Escrow 1: Released by Owner
    let e1 = h.client.create_escrow(
        &depositor,
        &beneficiary,
        &Some(arbiter.clone()),
        &1_000i128,
        &h.token_id,
        &deadline,
        &meta,
    );

    h.client.release_escrow(&h.owner, &e1);

    // PROPERTY 3a: Second release by owner fails
    let double_rel_owner = h.client.try_release_escrow(&h.owner, &e1);
    assert_eq!(
        double_rel_owner,
        Err(Ok(PaymentError::EscrowAlreadyReleased)),
        "Owner cannot release escrow twice"
    );

    // PROPERTY 3b: Arbiter release after owner release fails
    let arb_after_owner = h.client.try_release_by_arbiter(&arbiter, &e1, &true);
    assert_eq!(
        arb_after_owner,
        Err(Ok(PaymentError::EscrowAlreadyReleased)),
        "Arbiter cannot release already released escrow"
    );

    // PROPERTY 3c: Beneficiary claim after release fails
    h.env.ledger().set_timestamp(deadline + 1);
    let claim_after_rel = h.client.try_claim_escrow(&beneficiary, &e1);
    assert_eq!(
        claim_after_rel,
        Err(Ok(PaymentError::EscrowAlreadyReleased)),
        "Beneficiary cannot claim already released escrow"
    );

    // Escrow 2: Released by Arbiter
    let e2 = h.client.create_escrow(
        &depositor,
        &beneficiary,
        &Some(arbiter.clone()),
        &1_000i128,
        &h.token_id,
        &deadline,
        &meta,
    );

    h.client.release_by_arbiter(&arbiter, &e2, &true);

    let double_arb = h.client.try_release_by_arbiter(&arbiter, &e2, &true);
    assert_eq!(
        double_arb,
        Err(Ok(PaymentError::EscrowAlreadyReleased)),
        "Arbiter cannot release escrow twice"
    );

    let owner_after_arb = h.client.try_release_escrow(&h.owner, &e2);
    assert_eq!(
        owner_after_arb,
        Err(Ok(PaymentError::EscrowAlreadyReleased)),
        "Owner cannot release escrow after arbiter resolved it"
    );

    // Escrow 3: Claimed by Beneficiary after deadline
    let e3 = h.client.create_escrow(
        &depositor,
        &beneficiary,
        &None::<Address>,
        &1_000i128,
        &h.token_id,
        &deadline,
        &meta,
    );

    h.client.claim_escrow(&beneficiary, &e3);

    let double_claim = h.client.try_claim_escrow(&beneficiary, &e3);
    assert_eq!(
        double_claim,
        Err(Ok(PaymentError::EscrowAlreadyReleased)),
        "Beneficiary cannot claim escrow twice"
    );

    let owner_after_claim = h.client.try_release_escrow(&h.owner, &e3);
    assert_eq!(
        owner_after_claim,
        Err(Ok(PaymentError::EscrowAlreadyReleased)),
        "Owner cannot release escrow after beneficiary claimed it"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// INVARIANT 4: Stream Bounded Vesting & Conservation
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn invariant_stream_claim_bounded_by_vested_amount() {
    let h = InvariantTestHarness::new();
    let creator = Address::generate(&h.env);
    let recipient = Address::generate(&h.env);
    let meta = String::from_str(&h.env, "stream_meta");
    let total_amount = 10_000i128;
    h.token_admin_client.mint(&creator, &(total_amount * 2));

    let start_time = h.env.ledger().timestamp() + 1_000;
    let end_time = start_time + 10_000;

    let s1 = h.client.create_stream(
        &creator,
        &recipient,
        &total_amount,
        &h.token_id,
        &start_time,
        &end_time,
        &meta,
    );

    // PROPERTY 4a: Claim before start fails
    h.env.ledger().set_timestamp(start_time - 1);
    let early_claim = h.client.try_claim_stream(&recipient, &s1);
    assert_eq!(
        early_claim,
        Err(Ok(PaymentError::StreamNotStarted)),
        "Claims before start_time must be rejected"
    );

    // PROPERTY 4b: Partial claim at 25% duration
    h.env.ledger().set_timestamp(start_time + 2_500);
    let claimed_25 = h.client.claim_stream(&recipient, &s1);
    assert_eq!(claimed_25, 2_500, "Vested at 25% must equal exactly 2,500");

    // Immediate second claim at same timestamp returns StreamFullyClaimed
    let zero_claim = h.client.try_claim_stream(&recipient, &s1);
    assert_eq!(
        zero_claim,
        Err(Ok(PaymentError::StreamFullyClaimed)),
        "Immediate second claim at same timestamp must be rejected"
    );

    // PROPERTY 4c: Partial claim at 75% duration (cumulative 75% = 7,500; delta = 5,000)
    h.env.ledger().set_timestamp(start_time + 7_500);
    let claimed_75 = h.client.claim_stream(&recipient, &s1);
    assert_eq!(claimed_75, 5_000);

    // PROPERTY 4d: Claim past end_time claims remainder (2,500)
    h.env.ledger().set_timestamp(end_time + 5_000);
    let claimed_final = h.client.claim_stream(&recipient, &s1);
    assert_eq!(claimed_final, 2_500);

    // Total claimed must equal total_amount exactly
    let total_claimed = claimed_25 + claimed_75 + claimed_final;
    assert_eq!(
        total_claimed, total_amount,
        "Sum of claims must equal total stream amount"
    );

    // Further claims after 100% vesting fail
    let post_claim = h.client.try_claim_stream(&recipient, &s1);
    assert_eq!(
        post_claim,
        Err(Ok(PaymentError::StreamFullyClaimed)),
        "Claims after 100% completion must fail"
    );

    // PROPERTY 4e: Stream cancellation conservation
    let s2 = h.client.create_stream(
        &creator,
        &recipient,
        &total_amount,
        &h.token_id,
        &start_time,
        &end_time,
        &meta,
    );

    // Advance to 40% duration -> recipient claims 4,000
    h.env.ledger().set_timestamp(start_time + 4_000);
    let s2_claimed = h.client.claim_stream(&recipient, &s2);
    assert_eq!(s2_claimed, 4_000);

    // Creator cancels at 40%: unvested 6,000 refunded to creator
    let refunded = h.client.cancel_stream(&creator, &s2);
    assert_eq!(refunded, 6_000);
    assert_eq!(
        s2_claimed + refunded,
        total_amount,
        "Claimed + refunded must strictly equal total stream amount (conservation)"
    );

    // Subsequent claims after cancellation fail
    let cancelled_claim = h.client.try_claim_stream(&recipient, &s2);
    assert_eq!(
        cancelled_claim,
        Err(Ok(PaymentError::StreamAlreadyCancelled)),
        "Claims after cancellation must fail"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// INVARIANT 5: Pause Guard Isolation
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn invariant_pause_guard_blocks_all_mutating_entrypoints() {
    let h = InvariantTestHarness::new();
    let alice = Address::generate(&h.env);
    let bob = Address::generate(&h.env);
    let memo = String::from_str(&h.env, "memo");

    // Activate global emergency pause
    h.client.emergency_pause_all(&h.owner);
    assert!(h.client.is_paused(), "Contract must report paused state");

    // 1. record_payment
    let r_pay = h.client.try_record_payment(
        &alice,
        &bob,
        &100i128,
        &h.token_id,
        &String::from_str(&h.env, "tx"),
        &memo,
    );
    assert_eq!(r_pay, Err(Ok(PaymentError::ContractPaused)));

    // 2. create_escrow
    let r_esc = h.client.try_create_escrow(
        &alice,
        &bob,
        &None::<Address>,
        &100i128,
        &h.token_id,
        &(h.env.ledger().timestamp() + 100),
        &memo,
    );
    assert_eq!(r_esc, Err(Ok(PaymentError::ContractPaused)));

    // 3. release_escrow
    let r_rel_esc = h.client.try_release_escrow(&h.owner, &1u64);
    assert_eq!(r_rel_esc, Err(Ok(PaymentError::ContractPaused)));

    // 4. claim_escrow
    let r_claim_esc = h.client.try_claim_escrow(&bob, &1u64);
    assert_eq!(r_claim_esc, Err(Ok(PaymentError::ContractPaused)));

    // 5. create_stream
    let now = h.env.ledger().timestamp();
    let r_str = h.client.try_create_stream(
        &alice,
        &bob,
        &100i128,
        &h.token_id,
        &now,
        &(now + 1000),
        &memo,
    );
    assert_eq!(r_str, Err(Ok(PaymentError::ContractPaused)));

    // 6. claim_stream
    let r_claim_str = h.client.try_claim_stream(&bob, &1u64);
    assert_eq!(r_claim_str, Err(Ok(PaymentError::ContractPaused)));

    // 7. cancel_stream
    let r_canc_str = h.client.try_cancel_stream(&alice, &1u64);
    assert_eq!(r_canc_str, Err(Ok(PaymentError::ContractPaused)));

    // 8. create_batch
    let payees = vec![&h.env, bob.clone()];
    let amounts = vec![&h.env, 100i128];
    let r_batch = h.client.try_create_batch(
        &alice,
        &payees,
        &amounts,
        &h.token_id,
        &String::from_str(&h.env, "tx_batch"),
    );
    assert!(
        matches!(r_batch, Err(Ok(PaymentError::ContractPaused))),
        "create_batch must be blocked when contract is paused"
    );

    // 9. request_refund
    let r_ref_req = h.client.try_request_refund(
        &alice,
        &1u64,
        &50i128,
        &h.token_id,
        &memo,
        &RefundReasonCode::CustomerRequest,
    );
    assert_eq!(r_ref_req, Err(Ok(PaymentError::ContractPaused)));

    // 10. approve_refund
    let r_ref_app = h.client.try_approve_refund(&h.owner, &1u64);
    assert_eq!(r_ref_app, Err(Ok(PaymentError::ContractPaused)));

    // 11. reject_refund
    let r_ref_rej = h.client.try_reject_refund(&h.owner, &1u64);
    assert_eq!(r_ref_rej, Err(Ok(PaymentError::ContractPaused)));

    // 12. process_refund
    let r_ref_proc = h.client.try_process_refund(&h.owner, &1u64);
    assert_eq!(r_ref_proc, Err(Ok(PaymentError::ContractPaused)));

    // 13. atomic_spend
    let r_spend = h.client.try_atomic_spend(
        &alice,
        &bob,
        &50i128,
        &h.token_id,
        &String::from_str(&h.env, "tx_spend"),
        &memo,
    );
    assert_eq!(r_spend, Err(Ok(PaymentError::ContractPaused)));

    // 14. create_proposal
    let r_prop = h.client.try_create_proposal(
        &alice,
        &memo,
        &memo,
        &memo,
        &memo,
        &memo,
        &h.token_id,
        &0i128,
    );
    assert_eq!(r_prop, Err(Ok(PaymentError::ContractPaused)));

    // 15. vote_on_proposal
    let r_vote = h.client.try_vote_on_proposal(&alice, &1u64, &true);
    assert_eq!(r_vote, Err(Ok(PaymentError::ContractPaused)));

    // READ-ONLY GETTERS REMAIN ACCESSIBLE
    assert_eq!(h.client.get_owner(), h.owner);
    assert_eq!(h.client.get_payment_count(), 0);
    assert_eq!(h.client.get_locked_balance(), 0);
    assert!(h.client.is_paused());

    // Unpause restores mutation capability
    h.client.emergency_unpause_all(&h.owner);
    assert!(!h.client.is_paused());
    let id = h.client.record_payment(
        &alice,
        &bob,
        &100i128,
        &h.token_id,
        &String::from_str(&h.env, "tx_unpaused"),
        &memo,
    );
    assert_eq!(id, 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// INVARIANT 6: Governance One Address One Vote
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn invariant_governance_single_vote_per_address() {
    let h = InvariantTestHarness::new();
    let proposer = Address::generate(&h.env);
    let voter_alice = Address::generate(&h.env);
    let voter_bob = Address::generate(&h.env);

    h.client.configure_governance(&h.owner, &0i128, &10_000u64, &51u32, &true);

    let prop_id = h.client.create_proposal(
        &proposer,
        &String::from_str(&h.env, "Proposal 1"),
        &String::from_str(&h.env, "Description"),
        &String::from_str(&h.env, "Action"),
        &String::from_str(&h.env, "Target"),
        &String::from_str(&h.env, "Data"),
        &h.token_id,
        &0i128,
    );

    // Alice votes YES
    h.client.vote_on_proposal(&voter_alice, &prop_id, &true);

    // Alice voting a second time fails with AlreadyVoted (regardless of support direction)
    let double_vote_yes = h.client.try_vote_on_proposal(&voter_alice, &prop_id, &true);
    assert_eq!(
        double_vote_yes,
        Err(Ok(PaymentError::AlreadyVoted)),
        "Voter cannot vote twice on same proposal"
    );

    let double_vote_no = h.client.try_vote_on_proposal(&voter_alice, &prop_id, &false);
    assert_eq!(
        double_vote_no,
        Err(Ok(PaymentError::AlreadyVoted)),
        "Voter cannot change or re-cast vote on same proposal"
    );

    // Bob can vote once
    h.client.vote_on_proposal(&voter_bob, &prop_id, &false);

    let bob_double_vote = h.client.try_vote_on_proposal(&voter_bob, &prop_id, &false);
    assert_eq!(
        bob_double_vote,
        Err(Ok(PaymentError::AlreadyVoted)),
        "Second voter cannot vote twice"
    );
}
