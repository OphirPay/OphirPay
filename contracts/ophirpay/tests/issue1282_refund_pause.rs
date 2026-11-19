#![cfg(test)]
// SPDX-License-Identifier: MIT
//
// Issue #1282 — the refund lifecycle must respect the circuit breaker.
//
// `approve_refund`, `reject_refund` and `process_refund` are state-changing
// entry points, so they carry the same `require_not_paused(PauseScope::Refunds)`
// guard as every other mutating function. These tests pin that behaviour down:
// while the contract is globally paused (or the Refunds scope alone is paused)
// each of the three functions must return `PaymentError::ContractPaused`
// *without* mutating the refund, and the same call must succeed once the pause
// is lifted.

use ophirpay_contract::{
    OphirPayContract, OphirPayContractClient, PaymentError, RefundReasonCode, RefundStatus,
};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{token, Address, Env, String};

/// Numeric pause-scope id for `PauseScope::Refunds` (see `parse_pause_scope`).
const REFUNDS_SCOPE: u32 = 4;

struct Fixture<'a> {
    env: Env,
    contract_id: Address,
    client: OphirPayContractClient<'a>,
    owner: Address,
    payer: Address,
    payee: Address,
    token_id: Address,
    token_client: token::Client<'a>,
    token_admin_client: token::StellarAssetClient<'a>,
}

impl<'a> Fixture<'a> {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1_000_000);

        let owner = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token_admin = Address::generate(&env);

        let token_id = env
            .register_stellar_asset_contract_v2(token_admin.clone())
            .address();
        let token_client = token::Client::new(&env, &token_id);
        let token_admin_client = token::StellarAssetClient::new(&env, &token_id);

        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        client.init(&owner);
        client.set_timelock_enabled(&owner, &false);

        Fixture {
            env,
            contract_id,
            client,
            owner,
            payer,
            payee,
            token_id,
            token_client,
            token_admin_client,
        }
    }

    /// Record a payment and open a refund request against it. Returns the
    /// refund id. `tag` keeps the payment tx hash (and therefore the
    /// idempotency key) unique across calls.
    fn requested_refund(&self, amount: i128, tag: &str) -> u64 {
        let tx_hash = String::from_str(&self.env, tag);
        let meta = String::from_str(&self.env, "refund pause regression");
        let payment_id = self.client.record_payment(
            &self.payer,
            &self.payee,
            &amount,
            &self.token_id,
            &tx_hash,
            &meta,
        );

        let reason = String::from_str(&self.env, "regression test");
        self.client.request_refund(
            &self.payer,
            &payment_id,
            &amount,
            &self.token_id,
            &reason,
            &RefundReasonCode::ProductDefect,
        )
    }

    fn fund_contract(&self, amount: i128) {
        self.token_admin_client.mint(&self.contract_id, &amount);
    }
}

/// `approve_refund` is rejected while the contract is globally paused, leaves
/// the refund untouched, and succeeds after the pause is lifted.
#[test]
fn approve_refund_is_blocked_by_global_pause() {
    let fix = Fixture::new();
    let refund_id = fix.requested_refund(500_000, "0xrefund_pause_approve");

    fix.client.emergency_pause_all(&fix.owner);

    let blocked = fix.client.try_approve_refund(&fix.owner, &refund_id);
    assert_eq!(blocked, Err(Ok(PaymentError::ContractPaused)));
    assert_eq!(
        fix.client.get_refund(&refund_id).status,
        RefundStatus::Requested,
        "a paused approve_refund must not mutate the refund"
    );

    fix.client.emergency_unpause_all(&fix.owner);
    fix.client.approve_refund(&fix.owner, &refund_id);
    assert_eq!(
        fix.client.get_refund(&refund_id).status,
        RefundStatus::Approved
    );
}

/// `reject_refund` is rejected while the contract is globally paused, leaves
/// the refund untouched, and succeeds after the pause is lifted.
#[test]
fn reject_refund_is_blocked_by_global_pause() {
    let fix = Fixture::new();
    let refund_id = fix.requested_refund(500_000, "0xrefund_pause_reject");

    fix.client.emergency_pause_all(&fix.owner);

    let blocked = fix.client.try_reject_refund(&fix.owner, &refund_id);
    assert_eq!(blocked, Err(Ok(PaymentError::ContractPaused)));
    assert_eq!(
        fix.client.get_refund(&refund_id).status,
        RefundStatus::Requested,
        "a paused reject_refund must not mutate the refund"
    );

    fix.client.emergency_unpause_all(&fix.owner);
    fix.client.reject_refund(&fix.owner, &refund_id);
    assert_eq!(
        fix.client.get_refund(&refund_id).status,
        RefundStatus::Rejected
    );
}

/// `process_refund` is rejected while the contract is globally paused, moves no
/// tokens, and pays out after the pause is lifted.
#[test]
fn process_refund_is_blocked_by_global_pause() {
    let fix = Fixture::new();
    let refund_id = fix.requested_refund(500_000, "0xrefund_pause_process");
    fix.client.approve_refund(&fix.owner, &refund_id);
    fix.fund_contract(1_000_000);

    fix.client.emergency_pause_all(&fix.owner);

    let contract_balance_before = fix.token_client.balance(&fix.contract_id);
    let requester_balance_before = fix.token_client.balance(&fix.payer);

    let blocked = fix.client.try_process_refund(&fix.owner, &refund_id);
    assert_eq!(blocked, Err(Ok(PaymentError::ContractPaused)));
    assert_eq!(
        fix.client.get_refund(&refund_id).status,
        RefundStatus::Approved,
        "a paused process_refund must not mutate the refund"
    );
    assert_eq!(
        fix.token_client.balance(&fix.contract_id),
        contract_balance_before,
        "a paused process_refund must not move contract funds"
    );
    assert_eq!(
        fix.token_client.balance(&fix.payer),
        requester_balance_before
    );

    fix.client.emergency_unpause_all(&fix.owner);
    fix.client.process_refund(&fix.owner, &refund_id);
    assert_eq!(
        fix.client.get_refund(&refund_id).status,
        RefundStatus::Processed
    );
    assert_eq!(
        fix.token_client.balance(&fix.payer) - requester_balance_before,
        500_000
    );
}

/// Pausing only the Refunds scope blocks all three refund transitions while
/// leaving other scopes (payments) operational.
#[test]
fn refunds_scope_pause_blocks_every_refund_transition() {
    let fix = Fixture::new();

    // Two refunds opened before the scope pause: one stays pending, the other
    // is approved so `process_refund` reaches its pause guard.
    let pending_refund = fix.requested_refund(300_000, "0xrefund_scope_pending");
    let approved_refund = fix.requested_refund(200_000, "0xrefund_scope_approved");
    fix.client.approve_refund(&fix.owner, &approved_refund);
    fix.fund_contract(1_000_000);

    fix.client.set_scope_paused(&fix.owner, &REFUNDS_SCOPE, &true);
    assert_eq!(fix.client.is_scope_paused(&REFUNDS_SCOPE), true);
    assert_eq!(fix.client.is_paused(), false);

    assert_eq!(
        fix.client.try_approve_refund(&fix.owner, &pending_refund),
        Err(Ok(PaymentError::ContractPaused))
    );
    assert_eq!(
        fix.client.try_reject_refund(&fix.owner, &pending_refund),
        Err(Ok(PaymentError::ContractPaused))
    );
    assert_eq!(
        fix.client.try_process_refund(&fix.owner, &approved_refund),
        Err(Ok(PaymentError::ContractPaused))
    );
    assert_eq!(
        fix.client.get_refund(&approved_refund).status,
        RefundStatus::Approved
    );

    // Payments are a different scope and keep working.
    let payment_id = fix.client.record_payment(
        &fix.payer,
        &fix.payee,
        &1_000i128,
        &fix.token_id,
        &String::from_str(&fix.env, "0xunaffected"),
        &String::from_str(&fix.env, "still open"),
    );
    assert_eq!(payment_id, 3);

    // Resuming the scope restores the lifecycle.
    fix.client.set_scope_paused(&fix.owner, &REFUNDS_SCOPE, &false);
    fix.client.approve_refund(&fix.owner, &pending_refund);
    assert_eq!(
        fix.client.get_refund(&pending_refund).status,
        RefundStatus::Approved
    );
}
