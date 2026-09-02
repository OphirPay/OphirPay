// SPDX-License-Identifier: MIT
#![cfg(test)]

use ophirpay_contract::{
    BatchCreateResult, OphirPayContract, OphirPayContractClient, Payment, PaymentError,
    RefundReasonCode, RefundStatus,
};
use ophirpay_emitter::{EmitterError, PaymentEventEmitter, PaymentEventEmitterClient};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{token, Address, Env, String, Vec};

// ── Test Fixture ─────────────────────────────────────────────────────────────

#[allow(dead_code)]
pub struct TestFixture<'a> {
    pub env: Env,
    pub contract_id: Address,
    pub client: OphirPayContractClient<'a>,
    pub owner: Address,
    pub token_admin: Address,
    pub token_id: Address,
    pub token_client: token::Client<'a>,
    pub token_admin_client: token::StellarAssetClient<'a>,
}

impl<'a> TestFixture<'a> {
    pub fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1_000_000);

        let owner = Address::generate(&env);
        let token_admin = Address::generate(&env);

        let token_id = env.register_stellar_asset_contract(token_admin.clone());
        let token_client = token::Client::new(&env, &token_id);
        let token_admin_client = token::StellarAssetClient::new(&env, &token_id);

        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        client.init(&owner);

        TestFixture {
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

    pub fn setup_emitter(&self) -> (Address, PaymentEventEmitterClient<'_>) {
        let emitter_id = self.env.register(PaymentEventEmitter, ());
        let emitter_client = PaymentEventEmitterClient::new(&self.env, &emitter_id);
        emitter_client.init(&self.owner);
        (emitter_id, emitter_client)
    }

    pub fn mint(&self, to: &Address, amount: i128) {
        self.token_admin_client.mint(to, &amount);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. PAYMENT FLOW TESTS
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_payment_recording_and_retrieval_flow() {
    let fix = TestFixture::new();
    let payer = Address::generate(&fix.env);
    let payee = Address::generate(&fix.env);

    // Initial stats should be 0
    assert_eq!(fix.client.get_payment_count(), 0);
    let stats = fix.client.get_stats();
    assert_eq!(stats.total_payments_recorded, 0);

    // Record first payment
    let tx_hash_1 = String::from_str(&fix.env, "0x1234abcd5678");
    let meta_1 = String::from_str(&fix.env, "invoice_#1001");
    let id_1 = fix.client.record_payment(
        &payer,
        &payee,
        &5_000_000i128,
        &fix.token_id,
        &tx_hash_1,
        &meta_1,
    );
    assert_eq!(id_1, 1);

    // Record second payment
    let tx_hash_2 = String::from_str(&fix.env, "0x9876fedcba32");
    let meta_2 = String::from_str(&fix.env, "invoice_#1002");
    let id_2 = fix.client.record_payment(
        &payer,
        &payee,
        &12_500_000i128,
        &fix.token_id,
        &tx_hash_2,
        &meta_2,
    );
    assert_eq!(id_2, 2);

    // Verify payment count & stats
    assert_eq!(fix.client.get_payment_count(), 2);
    let stats_after = fix.client.get_stats();
    assert_eq!(stats_after.total_payments_recorded, 2);

    // Fetch and assert payment details
    let payment_1 = fix.client.get_payment(&1);
    assert_eq!(payment_1.id, 1);
    assert_eq!(payment_1.payer, payer);
    assert_eq!(payment_1.payee, payee);
    assert_eq!(payment_1.amount, 5_000_000);
    assert_eq!(payment_1.asset, fix.token_id);
    assert_eq!(payment_1.tx_hash, tx_hash_1);
    assert_eq!(payment_1.metadata, meta_1);
    assert_eq!(payment_1.cancelled, false);
    assert_eq!(payment_1.timestamp, 1_000_000);

    let payment_2 = fix.client.get_payment(&2);
    assert_eq!(payment_2.id, 2);
    assert_eq!(payment_2.amount, 12_500_000);

    // Range retrieval
    let range = fix.client.get_payments_range(&1, &2);
    assert_eq!(range.len(), 2);
}

#[test]
fn test_payment_cancellation_lifecycle() {
    let fix = TestFixture::new();
    let payer = Address::generate(&fix.env);
    let payee = Address::generate(&fix.env);
    let stranger = Address::generate(&fix.env);

    let tx_hash = String::from_str(&fix.env, "0xhash");
    let meta = String::from_str(&fix.env, "cancel_test");
    let pid = fix.client.record_payment(
        &payer,
        &payee,
        &1_000_000i128,
        &fix.token_id,
        &tx_hash,
        &meta,
    );

    // Stranger cannot cancel payment
    let res = fix.client.try_cancel_payment(&stranger, &pid);
    assert!(res.is_err());

    // Owner cancels payment successfully
    fix.client.cancel_payment(&fix.owner, &pid);
    let payment = fix.client.get_payment(&pid);
    assert_eq!(payment.cancelled, true);

    // Duplicate cancellation fails
    let res = fix.client.try_cancel_payment(&fix.owner, &pid);
    assert!(res.is_err());
}

#[test]
fn test_atomic_spend_with_limits_and_rbac() {
    let fix = TestFixture::new();
    let payer = Address::generate(&fix.env);
    let payee = Address::generate(&fix.env);

    // Set daily limit: 10_000_000, monthly limit: 50_000_000
    let expires_at = fix.env.ledger().timestamp() + 86400 * 7;
    fix.client.set_spending_limit(
        &fix.owner,
        &payer,
        &10_000_000i128,
        &50_000_000i128,
        &expires_at,
        &true,
    );

    // Spend within limit
    let tx1 = String::from_str(&fix.env, "0xspend1");
    let meta1 = String::from_str(&fix.env, "spend 1");
    let pid1 = fix
        .client
        .atomic_spend(&payer, &payee, &6_000_000i128, &fix.token_id, &tx1, &meta1);
    assert_eq!(pid1, 1);

    // Second spend exceeding daily limit fails
    let tx2 = String::from_str(&fix.env, "0xspend2");
    let meta2 = String::from_str(&fix.env, "spend 2");
    let res =
        fix.client
            .try_atomic_spend(&payer, &payee, &5_000_000i128, &fix.token_id, &tx2, &meta2);
    assert!(res.is_err());

    // Fast-forward 1 day: daily spend resets, spend succeeds
    fix.env
        .ledger()
        .set_timestamp(fix.env.ledger().timestamp() + 86401);
    let pid2 = fix
        .client
        .atomic_spend(&payer, &payee, &4_000_000i128, &fix.token_id, &tx2, &meta2);
    assert_eq!(pid2, 2);

    // Verify audit logs recorded both atomic spend actions
    let audit_count = fix.client.get_audit_log_count();
    assert!(audit_count >= 2);
}

#[test]
fn test_paused_contract_blocks_payments() {
    let fix = TestFixture::new();
    let payer = Address::generate(&fix.env);
    let payee = Address::generate(&fix.env);

    // Pause contract
    fix.client.emergency_pause_all(&fix.owner);
    assert_eq!(fix.client.is_paused(), true);

    let tx = String::from_str(&fix.env, "0xpaused");
    let meta = String::from_str(&fix.env, "meta");
    let res = fix
        .client
        .try_record_payment(&payer, &payee, &100i128, &fix.token_id, &tx, &meta);
    assert!(res.is_err());

    // Unpause contract
    fix.client.emergency_unpause_all(&fix.owner);
    assert_eq!(fix.client.is_paused(), false);

    let pid = fix
        .client
        .record_payment(&payer, &payee, &100i128, &fix.token_id, &tx, &meta);
    assert_eq!(pid, 1);
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. BATCH PAYMENT FLOW TESTS
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_batch_payment_happy_path() {
    let fix = TestFixture::new();
    let creator = Address::generate(&fix.env);

    let p1 = Address::generate(&fix.env);
    let p2 = Address::generate(&fix.env);
    let p3 = Address::generate(&fix.env);
    let p4 = Address::generate(&fix.env);

    let mut payees = Vec::new(&fix.env);
    payees.push_back(p1.clone());
    payees.push_back(p2.clone());
    payees.push_back(p3.clone());
    payees.push_back(p4.clone());

    let mut amounts = Vec::new(&fix.env);
    amounts.push_back(100_000i128);
    amounts.push_back(250_000i128);
    amounts.push_back(500_000i128);
    amounts.push_back(150_000i128);

    let tx_hash = String::from_str(&fix.env, "0xbatch_tx_hash_123");
    let result = fix
        .client
        .create_batch(&creator, &payees, &amounts, &fix.token_id, &tx_hash);

    assert_eq!(result.batch_id, 1);
    assert_eq!(result.total_requests, 4);
    assert_eq!(result.successful, 4);
    assert_eq!(result.failed, 0);
    assert_eq!(result.total_amount, 1_000_000);

    // Verify batch count & stats
    assert_eq!(fix.client.get_batch_count(), 1);
    let stats = fix.client.get_stats();
    assert_eq!(stats.total_batches_processed, 1);
    assert_eq!(stats.total_amount_batched, 1_000_000);
    assert_eq!(stats.total_payments_recorded, 4);

    // Verify batch structure
    let batch = fix.client.get_batch(&1);
    assert_eq!(batch.id, 1);
    assert_eq!(batch.creator, creator);
    assert_eq!(batch.total_recipients, 4);
    assert_eq!(batch.total_amount, 1_000_000);
    assert_eq!(batch.payment_ids.len(), 4);

    // Verify payments by batch
    let batch_payments = fix.client.get_payments_by_batch(&1);
    assert_eq!(batch_payments.len(), 4);
    assert_eq!(batch_payments.get(0).unwrap().payee, p1);
    assert_eq!(batch_payments.get(0).unwrap().amount, 100_000);
    assert_eq!(batch_payments.get(3).unwrap().payee, p4);
    assert_eq!(batch_payments.get(3).unwrap().amount, 150_000);
}

#[test]
fn test_batch_payment_partial_failure_handling() {
    let fix = TestFixture::new();
    let creator = Address::generate(&fix.env);

    let p1 = Address::generate(&fix.env);
    let p2 = Address::generate(&fix.env);
    let p3 = Address::generate(&fix.env);

    let mut payees = Vec::new(&fix.env);
    payees.push_back(p1.clone());
    payees.push_back(p2.clone());
    payees.push_back(p3.clone());

    // Amount 2 is 0 (invalid), Amount 1 and 3 are valid
    let mut amounts = Vec::new(&fix.env);
    amounts.push_back(500_000i128);
    amounts.push_back(0i128);
    amounts.push_back(300_000i128);

    let tx_hash = String::from_str(&fix.env, "0xpartial_batch");
    let result = fix
        .client
        .create_batch(&creator, &payees, &amounts, &fix.token_id, &tx_hash);

    assert_eq!(result.batch_id, 1);
    assert_eq!(result.total_requests, 3);
    assert_eq!(result.successful, 2);
    assert_eq!(result.failed, 1);
    assert_eq!(result.total_amount, 800_000);

    let batch = fix.client.get_batch(&1);
    assert_eq!(batch.total_recipients, 2);
    assert_eq!(batch.payment_ids.len(), 2);
}

#[test]
fn test_batch_empty_and_overflow_errors() {
    let fix = TestFixture::new();
    let creator = Address::generate(&fix.env);

    // Empty payees
    let empty_payees = Vec::new(&fix.env);
    let empty_amounts = Vec::new(&fix.env);
    let tx_hash = String::from_str(&fix.env, "0xempty");

    let res = fix.client.try_create_batch(
        &creator,
        &empty_payees,
        &empty_amounts,
        &fix.token_id,
        &tx_hash,
    );
    assert!(res.is_err());

    // All zero amounts
    let mut payees = Vec::new(&fix.env);
    payees.push_back(Address::generate(&fix.env));
    let mut zero_amounts = Vec::new(&fix.env);
    zero_amounts.push_back(0i128);

    let res =
        fix.client
            .try_create_batch(&creator, &payees, &zero_amounts, &fix.token_id, &tx_hash);
    assert!(res.is_err());
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. REFUND FLOW TESTS
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_refund_lifecycle_approval_and_processing() {
    let fix = TestFixture::new();
    let payer = Address::generate(&fix.env);
    let payee = Address::generate(&fix.env);

    // Record initial payment
    let tx_hash = String::from_str(&fix.env, "0xpayment_for_refund");
    let meta = String::from_str(&fix.env, "order_#5501");
    let payment_id = fix.client.record_payment(
        &payer,
        &payee,
        &2_000_000i128,
        &fix.token_id,
        &tx_hash,
        &meta,
    );

    // Requester (payer) requests refund
    let reason = String::from_str(&fix.env, "Item defective upon delivery");
    let refund_id = fix.client.request_refund(
        &payer,
        &payment_id,
        &2_000_000i128,
        &fix.token_id,
        &reason,
        &RefundReasonCode::ProductDefect,
    );
    assert_eq!(refund_id, 1);
    assert_eq!(fix.client.get_refund_count(), 1);

    // Inspect initial refund state
    let refund = fix.client.get_refund(&1);
    assert_eq!(refund.id, 1);
    assert_eq!(refund.payment_id, payment_id);
    assert_eq!(refund.requester, payer);
    assert_eq!(refund.amount, 2_000_000);
    assert_eq!(refund.reason_code, RefundReasonCode::ProductDefect);
    assert_eq!(refund.status, RefundStatus::Requested);

    // Owner approves refund
    fix.client.approve_refund(&fix.owner, &refund_id);
    let approved_refund = fix.client.get_refund(&1);
    assert_eq!(approved_refund.status, RefundStatus::Approved);
    assert!(approved_refund.resolved_at > 0);

    // Fund contract so it has tokens to disburse
    fix.mint(&fix.contract_id, 5_000_000);

    // Owner processes refund (token payout)
    let payer_bal_before = fix.token_client.balance(&payer);
    fix.client.process_refund(&fix.owner, &refund_id);
    let payer_bal_after = fix.token_client.balance(&payer);
    assert_eq!(payer_bal_after - payer_bal_before, 2_000_000);

    let processed_refund = fix.client.get_refund(&1);
    assert_eq!(processed_refund.status, RefundStatus::Processed);

    // Reprocessing fails
    let res = fix.client.try_process_refund(&fix.owner, &refund_id);
    assert!(res.is_err());
}

#[test]
fn test_refund_rejection_and_guards() {
    let fix = TestFixture::new();
    let payer = Address::generate(&fix.env);
    let payee = Address::generate(&fix.env);
    let stranger = Address::generate(&fix.env);

    let tx_hash = String::from_str(&fix.env, "0xguard_payment");
    let meta = String::from_str(&fix.env, "order_#5502");
    let payment_id = fix.client.record_payment(
        &payer,
        &payee,
        &1_000_000i128,
        &fix.token_id,
        &tx_hash,
        &meta,
    );

    // Stranger cannot request refund
    let reason = String::from_str(&fix.env, "I want free money");
    let res = fix.client.try_request_refund(
        &stranger,
        &payment_id,
        &1_000_000i128,
        &fix.token_id,
        &reason,
        &RefundReasonCode::Other,
    );
    assert!(res.is_err());

    // Amount exceeding payment amount fails
    let res = fix.client.try_request_refund(
        &payer,
        &payment_id,
        &2_000_000i128,
        &fix.token_id,
        &reason,
        &RefundReasonCode::ProductDefect,
    );
    assert!(res.is_err());

    // Payee requests valid refund
    let valid_reason = String::from_str(&fix.env, "Duplicate charge");
    let refund_id = fix.client.request_refund(
        &payee,
        &payment_id,
        &1_000_000i128,
        &fix.token_id,
        &valid_reason,
        &RefundReasonCode::DuplicateCharge,
    );

    // Owner rejects refund
    fix.client.reject_refund(&fix.owner, &refund_id);
    let rejected = fix.client.get_refund(&refund_id);
    assert_eq!(rejected.status, RefundStatus::Rejected);

    // Processing a rejected refund fails
    let res = fix.client.try_process_refund(&fix.owner, &refund_id);
    assert!(res.is_err());
}

#[test]
fn test_refund_reason_code_analytics() {
    let fix = TestFixture::new();
    let payer = Address::generate(&fix.env);
    let payee = Address::generate(&fix.env);

    let tx_hash = String::from_str(&fix.env, "0xanalytics_payment");
    let meta = String::from_str(&fix.env, "analytics");
    let pid = fix.client.record_payment(
        &payer,
        &payee,
        &10_000_000i128,
        &fix.token_id,
        &tx_hash,
        &meta,
    );

    // Create refunds with various reason codes
    let codes = [
        RefundReasonCode::ProductDefect,
        RefundReasonCode::ProductDefect,
        RefundReasonCode::NonDelivery,
        RefundReasonCode::DuplicateCharge,
        RefundReasonCode::Unauthorized,
        RefundReasonCode::CustomerRequest,
        RefundReasonCode::Other,
    ];

    for code in codes.iter() {
        let reason_str = String::from_str(&fix.env, "reason");
        fix.client
            .request_refund(&payer, &pid, &100_000i128, &fix.token_id, &reason_str, code);
    }

    let analytics = fix.client.get_reason_code_analytics();
    // 6 distinct reason codes
    assert_eq!(analytics.len(), 6);
    // ProductDefect (code 0) has 2 occurrences
    assert_eq!(analytics.get(0).unwrap().1, 2);
    // NonDelivery (code 1) has 1 occurrence
    assert_eq!(analytics.get(1).unwrap().1, 1);
    // DuplicateCharge (code 2) has 1 occurrence
    assert_eq!(analytics.get(2).unwrap().1, 1);
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. GOVERNANCE FLOW TESTS
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_governance_proposal_passing_flow() {
    let fix = TestFixture::new();
    let proposer = Address::generate(&fix.env);
    let voter_1 = Address::generate(&fix.env);
    let voter_2 = Address::generate(&fix.env);
    let voter_3 = Address::generate(&fix.env);

    // 1. Configure governance
    fix.client.configure_governance(
        &fix.owner,
        &500_000i128, // min proposal deposit: 500k
        &86400u64,    // voting period: 24 hours
        &5000u32,     // quorum: 50%
        &true,
    );

    let config = fix.client.get_governance_config().unwrap();
    assert_eq!(config.min_proposal_deposit, 500_000);
    assert_eq!(config.voting_period, 86400);
    assert_eq!(config.enabled, true);

    // 2. Fund proposer with deposit tokens
    fix.mint(&proposer, 1_000_000);

    // 3. Propose action
    let title = String::from_str(&fix.env, "Update Fee Config");
    let desc = String::from_str(&fix.env, "Reduce payment fees by 10 bps");
    let action_type = String::from_str(&fix.env, "set_fee_config");
    let target = String::from_str(&fix.env, "fee_manager");
    let data = String::from_str(&fix.env, "{\"payment_fee_bps\":15}");

    let proposal_id = fix.client.create_proposal(
        &proposer,
        &title,
        &desc,
        &action_type,
        &target,
        &data,
        &fix.token_id,
        &500_000i128,
    );
    assert_eq!(proposal_id, 1);
    assert_eq!(fix.client.get_proposal_count(), 1);

    // Proposer balance decreased by deposit
    assert_eq!(fix.token_client.balance(&proposer), 500_000);

    let proposal = fix.client.get_proposal(&1);
    assert_eq!(proposal.title, title);
    assert_eq!(proposal.yes_votes, 0);
    assert_eq!(proposal.no_votes, 0);
    assert_eq!(proposal.executed, false);

    // 4. Voters cast votes
    fix.client.vote_on_proposal(&voter_1, &1, &true);
    fix.client.vote_on_proposal(&voter_2, &1, &true);
    fix.client.vote_on_proposal(&voter_3, &1, &false);

    // Duplicate vote attempt fails
    let res = fix.client.try_vote_on_proposal(&voter_1, &1, &true);
    assert!(res.is_err());

    let proposal_after_votes = fix.client.get_proposal(&1);
    assert_eq!(proposal_after_votes.yes_votes, 2);
    assert_eq!(proposal_after_votes.no_votes, 1);

    // 5. Early execution fails before voting period ends
    let res = fix.client.try_execute_proposal(&1);
    assert!(res.is_err());

    // 6. Fast-forward time past voting period (24h + 1s)
    fix.env
        .ledger()
        .set_timestamp(fix.env.ledger().timestamp() + 86401);

    // 7. Execute proposal
    let passed = fix.client.execute_proposal(&1);
    assert_eq!(passed, true);

    // Verify proposal marked executed
    let proposal_final = fix.client.get_proposal(&1);
    assert_eq!(proposal_final.executed, true);

    // Verify deposit refunded to proposer
    assert_eq!(fix.token_client.balance(&proposer), 1_000_000);

    // Double execution fails
    let res = fix.client.try_execute_proposal(&1);
    assert!(res.is_err());
}

#[test]
fn test_governance_proposal_defeated_flow() {
    let fix = TestFixture::new();
    let proposer = Address::generate(&fix.env);
    let voter_1 = Address::generate(&fix.env);
    let voter_2 = Address::generate(&fix.env);

    fix.client
        .configure_governance(&fix.owner, &100_000i128, &3600u64, &1000u32, &true);

    fix.mint(&proposer, 200_000);

    let title = String::from_str(&fix.env, "Defeated Prop");
    let desc = String::from_str(&fix.env, "This should fail");
    let action_type = String::from_str(&fix.env, "test");
    let target = String::from_str(&fix.env, "test");
    let data = String::from_str(&fix.env, "{}");

    let pid = fix.client.create_proposal(
        &proposer,
        &title,
        &desc,
        &action_type,
        &target,
        &data,
        &fix.token_id,
        &100_000i128,
    );

    // Vote no
    fix.client.vote_on_proposal(&voter_1, &pid, &false);
    fix.client.vote_on_proposal(&voter_2, &pid, &false);

    fix.env
        .ledger()
        .set_timestamp(fix.env.ledger().timestamp() + 3601);

    // Defeated proposal returns false
    let passed = fix.client.execute_proposal(&pid);
    assert_eq!(passed, false);

    // Proposer deposit is still refunded
    assert_eq!(fix.token_client.balance(&proposer), 200_000);
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. EMITTER AND CROSS-CONTRACT ORCHESTRATION TESTS
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_cross_contract_emitter_linking_and_events() {
    let fix = TestFixture::new();
    let (emitter_id, emitter_client) = fix.setup_emitter();

    // Link emitter to OphirPay contract
    fix.client.set_emitter(&fix.owner, &emitter_id);
    assert_eq!(fix.client.get_emitter(), Some(emitter_id.clone()));

    // Set allow-list on emitter to only accept OphirPay
    emitter_client.set_allowed_source(&fix.owner, &Some(fix.contract_id.clone()));
    assert_eq!(
        emitter_client.get_allowed_source(),
        Some(fix.contract_id.clone())
    );

    // Emit event directly from owner (allowed by owner bypass)
    let payer = Address::generate(&fix.env);
    let payee = Address::generate(&fix.env);
    let source = String::from_str(&fix.env, "OphirPay");
    let tx_hash = String::from_str(&fix.env, "0xemit_1");

    let event_id =
        emitter_client.emit_payment(&fix.owner, &source, &payer, &payee, &500_000i128, &tx_hash);
    assert_eq!(event_id, 1);
    assert_eq!(emitter_client.get_event_count(), 1);

    let evt = emitter_client.get_event(&1);
    assert_eq!(evt.payer, payer);
    assert_eq!(evt.payee, payee);
    assert_eq!(evt.amount, 500_000);
}

#[test]
fn test_cross_contract_emergency_pause_orchestration() {
    let fix = TestFixture::new();
    let (emitter_id, emitter_client) = fix.setup_emitter();

    fix.client.set_emitter(&fix.owner, &emitter_id);

    // Initial state: unpaused
    assert_eq!(fix.client.is_paused(), false);
    assert_eq!(emitter_client.is_paused(), false);

    // Emergency pause all
    fix.client.emergency_pause_all(&fix.owner);
    assert_eq!(fix.client.is_paused(), true);
    assert_eq!(emitter_client.is_paused(), true);

    // Attempting to emit on paused emitter fails
    let payer = Address::generate(&fix.env);
    let payee = Address::generate(&fix.env);
    let source = String::from_str(&fix.env, "OphirPay");
    let tx_hash = String::from_str(&fix.env, "0xpaused_emit");

    let res =
        emitter_client.try_emit_payment(&fix.owner, &source, &payer, &payee, &100i128, &tx_hash);
    assert!(res.is_err());

    // Emergency unpause all
    fix.client.emergency_unpause_all(&fix.owner);
    assert_eq!(fix.client.is_paused(), false);
    assert_eq!(emitter_client.is_paused(), false);

    // Emitting succeeds again
    let evt_id =
        emitter_client.emit_payment(&fix.owner, &source, &payer, &payee, &100i128, &tx_hash);
    assert_eq!(evt_id, 1);
}
