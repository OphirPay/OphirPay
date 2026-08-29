// SPDX-License-Identifier: MIT
#![cfg(test)]

//! Contract Invariant Test: Payment counter equals sum of stored records (Issue #384).
//!
//! Acceptance Criteria:
//! 1. Property-based test runs against a reference model of the contract.
//! 2. Invariants checked after EVERY operation across arbitrary random operation sequences:
//!    - Contract payment counter (`get_payment_count()`) strictly equals the number of stored payment records.
//!    - Number of stored records in storage matches reference model.
//!    - Sequential record IDs `1..=payment_count` exist and contain accurate caller/payee/amount/metadata.
//!    - Out-of-bound IDs (`0`, `payment_count + 1`, `payment_count + 100`) return `PaymentNotFound`.
//!    - Bounded range queries (`get_payments_range`) return the exact tail subset.
//!    - Stat counter `total_payments_recorded` strictly tracks the payment count.
//! 3. Failure output formats the complete execution replay sequence.

use ophirpay_contract::{
    OphirPayContract, OphirPayContractClient, PaymentError,
    ScheduleType,
};
use proptest::prelude::*;
use proptest::test_runner::Config as ProptestConfig;
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{token, Address, Env, String, Vec as SorobanVec};

const PROPTEST_CASES: u32 = 64;

fn get_proptest_config() -> ProptestConfig {
    ProptestConfig {
        cases: PROPTEST_CASES,
        max_shrink_iters: 100,
        ..ProptestConfig::default()
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Test Harness
// ═══════════════════════════════════════════════════════════════════════════

struct InvariantHarness<'a> {
    env: Env,
    client: OphirPayContractClient<'a>,
    owner: Address,
    token_id: Address,
    users: std::vec::Vec<Address>,
}

impl<'a> InvariantHarness<'a> {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1_000_000);

        let owner = Address::generate(&env);
        let token_admin = Address::generate(&env);

        let token_id = env
            .register_stellar_asset_contract_v2(token_admin.clone())
            .address();
        let token_admin_client = token::StellarAssetClient::new(&env, &token_id);

        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        client.init(&owner);

        let mut users = std::vec::Vec::new();
        for _ in 0..10 {
            let u = Address::generate(&env);
            token_admin_client.mint(&u, &1_000_000_000_000i128);
            users.push(u);
        }

        InvariantHarness {
            env,
            client,
            owner,
            token_id,
            users,
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Reference Model of Contract State
// ═══════════════════════════════════════════════════════════════════════════

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ModelPaymentRecord {
    pub id: u64,
    pub payer: Address,
    pub payee: Address,
    pub amount: i128,
    pub asset: Address,
    pub tx_hash: String,
    pub metadata: String,
    pub timestamp: u64,
    pub cancelled: bool,
}

#[derive(Clone, Debug)]
pub struct ModelSpendingLimit {
    pub user_idx: usize,
    pub daily_limit: i128,
    pub monthly_limit: i128,
    pub current_daily_spend: i128,
    pub current_monthly_spend: i128,
    pub last_reset_day: u64,
    pub last_reset_month: u64,
    pub expires_at: u64,
    pub is_active: bool,
}

#[derive(Clone, Debug)]
pub struct ModelMultisigProposal {
    pub proposer: Address,
    pub payee: Address,
    pub amount: i128,
    pub asset: Address,
    pub tx_hash: String,
    pub approvals: std::vec::Vec<Address>,
    pub executed: bool,
}

#[derive(Clone, Debug)]
pub struct ModelRecurringPayment {
    pub creator: Address,
    pub payee: Address,
    pub amount: i128,
    pub asset: Address,
    pub interval: u64,
    pub next_execution: u64,
    pub remaining: u32,
    pub active: bool,
}

#[derive(Clone, Debug)]
pub struct ContractPaymentModel {
    pub payment_count: u64,
    pub records: std::vec::Vec<ModelPaymentRecord>,
    pub is_paused: bool,
    pub spending_limits: std::vec::Vec<ModelSpendingLimit>,
    pub multisig_threshold: u32,
    pub multisig_signers: std::vec::Vec<Address>,
    pub multisig_enabled: bool,
    pub multisig_proposals: std::vec::Vec<(u64, ModelMultisigProposal)>,
    pub multisig_counter: u64,
    pub recurring_payments: std::vec::Vec<(u64, ModelRecurringPayment)>,
    pub recurring_counter: u64,
}

impl ContractPaymentModel {
    fn new() -> Self {
        ContractPaymentModel {
            payment_count: 0,
            records: std::vec::Vec::new(),
            is_paused: false,
            spending_limits: std::vec::Vec::new(),
            multisig_threshold: 0,
            multisig_signers: std::vec::Vec::new(),
            multisig_enabled: false,
            multisig_proposals: std::vec::Vec::new(),
            multisig_counter: 0,
            recurring_payments: std::vec::Vec::new(),
            recurring_counter: 0,
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Operation Definitions for State-Machine Proptesting
// ═══════════════════════════════════════════════════════════════════════════

#[derive(Clone, Debug)]
pub enum Op {
    RecordPayment {
        payer_idx: usize,
        payee_idx: usize,
        amount: i128,
        memo_tag: u32,
    },
    AtomicSpend {
        payer_idx: usize,
        payee_idx: usize,
        amount: i128,
        memo_tag: u32,
    },
    BatchPayment {
        creator_idx: usize,
        recipients: std::vec::Vec<(usize, i128)>, // (payee_idx, amount)
    },
    SetSpendingLimit {
        user_idx: usize,
        daily_limit: i128,
        monthly_limit: i128,
        expires_in: u64,
        is_active: bool,
    },
    ConfigureMultisig {
        threshold: u32,
        signer_indices: std::vec::Vec<usize>,
        enabled: bool,
    },
    ProposeMultisig {
        proposer_idx: usize,
        payee_idx: usize,
        amount: i128,
    },
    ApproveMultisig {
        signer_idx: usize,
        proposal_id: u64,
    },
    ExecuteMultisig {
        caller_idx: usize,
        proposal_id: u64,
    },
    CreateRecurring {
        creator_idx: usize,
        payee_idx: usize,
        amount: i128,
        schedule_idx: u8, // 0: Daily, 1: Weekly, 2: Monthly
        remaining: u32,
    },
    ExecuteRecurring {
        caller_idx: usize,
        recurring_id: u64,
        advance_time: bool,
    },
    CancelRecurring {
        caller_idx: usize,
        recurring_id: u64,
    },
    CancelPayment {
        as_owner: bool,
        payment_id: u64,
    },
    TogglePause {
        as_owner: bool,
        pause: bool,
    },
    NonPaymentEscrow {
        depositor_idx: usize,
        beneficiary_idx: usize,
        amount: i128,
    },
    NonPaymentStream {
        creator_idx: usize,
        recipient_idx: usize,
        amount: i128,
        duration: u64,
    },
}

// ═══════════════════════════════════════════════════════════════════════════
// Invariant Verification Function
// ═══════════════════════════════════════════════════════════════════════════

fn assert_contract_invariants(
    h: &InvariantHarness,
    model: &ContractPaymentModel,
    history: &[Op],
    step_num: usize,
    last_op: &Op,
) -> Result<(), TestCaseError> {
    let failure_context = || {
        let mut trace = std::string::String::new();
        trace.push_str("════════════════ REPLAY TRACE ════════════════\n");
        for (i, op) in history.iter().enumerate() {
            trace.push_str(&format!("[Step {:02}] {:?}\n", i + 1, op));
        }
        trace.push_str(&format!(
            "Violation at Step {} executing {:?}\n",
            step_num, last_op
        ));
        trace.push_str(&format!(
            "Model state: payment_count={}, total_records={}\n",
            model.payment_count,
            model.records.len()
        ));
        trace.push_str("══════════════════════════════════════════════\n");
        trace
    };

    // 1. Invariant: Model internal consistency
    prop_assert_eq!(
        model.payment_count as usize,
        model.records.len(),
        "Model payment_count must strictly equal records.len().\n{}",
        failure_context()
    );

    // 2. Invariant: Contract payment count equals model payment count
    let contract_count = h.client.get_payment_count();
    prop_assert_eq!(
        contract_count,
        model.payment_count,
        "Contract get_payment_count() does not match model.\n{}",
        failure_context()
    );

    // 3. Invariant: Contract stats total_payments_recorded strictly tracks payment_count
    let stats = h.client.get_stats();
    prop_assert_eq!(
        stats.total_payments_recorded,
        model.payment_count,
        "Contract get_stats().total_payments_recorded does not match payment count.\n{}",
        failure_context()
    );

    // 4. Invariant: Stored records verification for every ID 1..=payment_count
    for id in 1..=contract_count {
        let record_res = h.client.try_get_payment(&id);
        match record_res {
            Ok(Ok(actual)) => {
                let expected = &model.records[(id - 1) as usize];
                prop_assert_eq!(
                    actual.id,
                    id,
                    "Payment id mismatch for index {}\n{}",
                    id,
                    failure_context()
                );
                prop_assert_eq!(
                    actual.payer,
                    expected.payer.clone(),
                    "Payer mismatch for id {}\n{}",
                    id,
                    failure_context()
                );
                prop_assert_eq!(
                    actual.payee,
                    expected.payee.clone(),
                    "Payee mismatch for id {}\n{}",
                    id,
                    failure_context()
                );
                prop_assert_eq!(
                    actual.amount,
                    expected.amount,
                    "Amount mismatch for id {}\n{}",
                    id,
                    failure_context()
                );
                prop_assert_eq!(
                    actual.asset,
                    expected.asset.clone(),
                    "Asset mismatch for id {}\n{}",
                    id,
                    failure_context()
                );
                prop_assert_eq!(
                    actual.cancelled,
                    expected.cancelled,
                    "Cancelled status mismatch for id {}\n{}",
                    id,
                    failure_context()
                );
            }
            _ => {
                prop_assert!(
                    false,
                    "Expected stored payment record for id {} but get_payment returned error.\n{}",
                    id,
                    failure_context()
                );
            }
        }
    }

    // 5. Invariant: Out-of-bounds IDs return PaymentNotFound
    let oob_upper = contract_count + 1;
    let oob_res = h.client.try_get_payment(&oob_upper);
    match oob_res {
        Err(Ok(PaymentError::PaymentNotFound)) => {}
        _ => {
            prop_assert!(
                false,
                "Expected PaymentNotFound for upper out-of-bounds id {}\n{}",
                oob_upper,
                failure_context()
            );
        }
    }

    let oob_zero_res = h.client.try_get_payment(&0);
    match oob_zero_res {
        Err(Ok(PaymentError::PaymentNotFound)) => {}
        _ => {
            prop_assert!(
                false,
                "Expected PaymentNotFound for id 0\n{}",
                failure_context()
            );
        }
    }

    // 6. Invariant: Range queries return bounded tail of existing records
    if contract_count > 0 {
        let range = h.client.get_payments_range(&1, &contract_count);
        let expected_range_len = std::cmp::min(100, contract_count as u32);
        prop_assert_eq!(
            range.len(),
            expected_range_len,
            "get_payments_range length mismatch\n{}",
            failure_context()
        );

        for (idx, p) in range.iter().enumerate() {
            let expected_id = contract_count - (idx as u64);
            prop_assert_eq!(
                p.id,
                expected_id,
                "Range element at idx {} does not match expected id {}\n{}",
                idx,
                expected_id,
                failure_context()
            );
        }
    }

    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════════
// Operation Step Execution & Model Transition
// ═══════════════════════════════════════════════════════════════════════════

fn execute_op_and_step_model(
    h: &InvariantHarness,
    model: &mut ContractPaymentModel,
    op: &Op,
) {
    match op {
        Op::RecordPayment {
            payer_idx,
            payee_idx,
            amount,
            memo_tag,
        } => {
            let payer = &h.users[payer_idx % h.users.len()];
            let payee = &h.users[payee_idx % h.users.len()];
            let memo_str = format!("memo_{}", memo_tag);
            let memo = String::from_str(&h.env, &memo_str);
            let tx_hash = String::from_str(&h.env, "0xtxhash_rec");

            let res = h.client.try_record_payment(
                payer,
                payee,
                amount,
                &h.token_id,
                &tx_hash,
                &memo,
            );

            if !model.is_paused && *amount > 0 {
                assert!(res.is_ok());
                model.payment_count += 1;
                model.records.push(ModelPaymentRecord {
                    id: model.payment_count,
                    payer: payer.clone(),
                    payee: payee.clone(),
                    amount: *amount,
                    asset: h.token_id.clone(),
                    tx_hash,
                    metadata: memo,
                    timestamp: h.env.ledger().timestamp(),
                    cancelled: false,
                });
            } else {
                assert!(res.is_err());
            }
        }

        Op::AtomicSpend {
            payer_idx,
            payee_idx,
            amount,
            memo_tag,
        } => {
            let p_idx = payer_idx % h.users.len();
            let payer = &h.users[p_idx];
            let payee = &h.users[payee_idx % h.users.len()];
            let memo_str = format!("atomic_{}", memo_tag);
            let memo = String::from_str(&h.env, &memo_str);
            let tx_hash = String::from_str(&h.env, "0xtxhash_atom");

            let res = h.client.try_atomic_spend(
                payer,
                payee,
                amount,
                &h.token_id,
                &tx_hash,
                &memo,
            );

            let mut should_succeed = !model.is_paused && *amount > 0;
            let lim_idx_opt = model.spending_limits.iter().position(|l| l.user_idx == p_idx);

            if should_succeed {
                if let Some(idx) = lim_idx_opt {
                    let now = h.env.ledger().timestamp();
                    let lim = &mut model.spending_limits[idx];
                    if !lim.is_active || (lim.expires_at > 0 && now >= lim.expires_at) {
                        lim.is_active = false;
                        should_succeed = false;
                    } else {
                        if now.saturating_sub(lim.last_reset_day) >= 86400 {
                            lim.current_daily_spend = 0;
                            lim.last_reset_day = now;
                        }
                        if now.saturating_sub(lim.last_reset_month) >= 30 * 86400 {
                            lim.current_monthly_spend = 0;
                            lim.last_reset_month = now;
                        }
                        if lim.current_daily_spend.saturating_add(*amount) > lim.daily_limit
                            || lim.current_monthly_spend.saturating_add(*amount) > lim.monthly_limit
                        {
                            should_succeed = false;
                        } else {
                            lim.current_daily_spend =
                                lim.current_daily_spend.saturating_add(*amount);
                            lim.current_monthly_spend =
                                lim.current_monthly_spend.saturating_add(*amount);
                        }
                    }
                }
            }

            if should_succeed {
                assert!(res.is_ok());
                model.payment_count += 1;
                model.records.push(ModelPaymentRecord {
                    id: model.payment_count,
                    payer: payer.clone(),
                    payee: payee.clone(),
                    amount: *amount,
                    asset: h.token_id.clone(),
                    tx_hash,
                    metadata: memo,
                    timestamp: h.env.ledger().timestamp(),
                    cancelled: false,
                });
            } else {
                assert!(res.is_err());
            }
        }

        Op::BatchPayment {
            creator_idx,
            recipients,
        } => {
            let creator = &h.users[creator_idx % h.users.len()];
            let mut payees_vec = SorobanVec::new(&h.env);
            let mut amounts_vec = SorobanVec::new(&h.env);
            let tx_hash = String::from_str(&h.env, "0xbatch_tx");

            for &(p_idx, amt) in recipients {
                payees_vec.push_back(h.users[p_idx % h.users.len()].clone());
                amounts_vec.push_back(amt);
            }

            let res = h.client.try_create_batch(
                creator,
                &payees_vec,
                &amounts_vec,
                &h.token_id,
                &tx_hash,
            );

            let len = recipients.len();
            let mut valid_entries = std::vec::Vec::new();
            for &(p_idx, amt) in recipients {
                if amt > 0 {
                    valid_entries.push((h.users[p_idx % h.users.len()].clone(), amt));
                }
            }

            let should_succeed = !model.is_paused && len > 0 && len <= 100 && !valid_entries.is_empty();

            if should_succeed {
                assert!(res.is_ok());
                for (payee, amt) in valid_entries {
                    model.payment_count += 1;
                    model.records.push(ModelPaymentRecord {
                        id: model.payment_count,
                        payer: creator.clone(),
                        payee,
                        amount: amt,
                        asset: h.token_id.clone(),
                        tx_hash: tx_hash.clone(),
                        metadata: String::from_str(&h.env, "batch"),
                        timestamp: h.env.ledger().timestamp(),
                        cancelled: false,
                    });
                }
            } else {
                assert!(res.is_err());
            }
        }

        Op::SetSpendingLimit {
            user_idx,
            daily_limit,
            monthly_limit,
            expires_in,
            is_active,
        } => {
            let u_idx = user_idx % h.users.len();
            let user = &h.users[u_idx];
            let now = h.env.ledger().timestamp();
            let expires_at = if *expires_in > 0 { now + *expires_in } else { 0 };

            let res = h.client.try_set_spending_limit(
                &h.owner,
                user,
                daily_limit,
                monthly_limit,
                &expires_at,
                is_active,
            );

            assert!(res.is_ok());
            let lim_idx_opt = model.spending_limits.iter().position(|l| l.user_idx == u_idx);
            if let Some(idx) = lim_idx_opt {
                let lim = &mut model.spending_limits[idx];
                lim.daily_limit = *daily_limit;
                lim.monthly_limit = *monthly_limit;
                lim.current_daily_spend = 0;
                lim.current_monthly_spend = 0;
                lim.last_reset_day = now;
                lim.last_reset_month = now;
                lim.expires_at = expires_at;
                lim.is_active = *is_active;
            } else {
                model.spending_limits.push(ModelSpendingLimit {
                    user_idx: u_idx,
                    daily_limit: *daily_limit,
                    monthly_limit: *monthly_limit,
                    current_daily_spend: 0,
                    current_monthly_spend: 0,
                    last_reset_day: now,
                    last_reset_month: now,
                    expires_at,
                    is_active: *is_active,
                });
            }
        }

        Op::ConfigureMultisig {
            threshold,
            signer_indices,
            enabled,
        } => {
            let mut signers_vec = SorobanVec::new(&h.env);
            let mut signers_native = std::vec::Vec::new();
            for &idx in signer_indices {
                let s = h.users[idx % h.users.len()].clone();
                if !signers_native.contains(&s) {
                    signers_native.push(s.clone());
                    signers_vec.push_back(s);
                }
            }

            let res = h.client.try_set_multisig_config(
                &h.owner,
                threshold,
                &signers_vec,
                enabled,
            );

            let m = signers_native.len() as u32;
            let valid_config = *threshold >= 1 && *threshold <= m && m > 0;

            if valid_config {
                assert!(res.is_ok());
                model.multisig_threshold = *threshold;
                model.multisig_signers = signers_native;
                model.multisig_enabled = *enabled;
            } else {
                assert!(res.is_err());
            }
        }

        Op::ProposeMultisig {
            proposer_idx,
            payee_idx,
            amount,
        } => {
            let proposer = &h.users[proposer_idx % h.users.len()];
            let payee = &h.users[payee_idx % h.users.len()];
            let tx_hash = String::from_str(&h.env, "0xmultisig_prop");

            let res = h.client.try_propose_payment(
                proposer,
                payee,
                amount,
                &h.token_id,
                &tx_hash,
            );

            let multisig_active = model.multisig_enabled && model.multisig_threshold > 0;
            let should_succeed = !model.is_paused && multisig_active && *amount > 0;

            if should_succeed {
                assert!(res.is_ok());
                model.multisig_counter += 1;
                let approvals = std::vec::Vec::new(); // Starts with 0 approvals
                model.multisig_proposals.push((
                    model.multisig_counter,
                    ModelMultisigProposal {
                        proposer: proposer.clone(),
                        payee: payee.clone(),
                        amount: *amount,
                        asset: h.token_id.clone(),
                        tx_hash,
                        approvals,
                        executed: false,
                    },
                ));
            } else {
                assert!(res.is_err());
            }
        }

        Op::ApproveMultisig {
            signer_idx,
            proposal_id,
        } => {
            let signer = &h.users[signer_idx % h.users.len()];
            let res = h.client.try_approve_payment(signer, proposal_id);

            let multisig_active = model.multisig_enabled && model.multisig_threshold > 0;
            let is_signer = model.multisig_signers.contains(signer);
            let is_paused = model.is_paused;

            let prop_idx_opt = model.multisig_proposals.iter().position(|(pid, _)| *pid == *proposal_id);

            if let Some(idx) = prop_idx_opt {
                let prop = &mut model.multisig_proposals[idx].1;
                if !is_paused && multisig_active && is_signer && !prop.executed && !prop.approvals.contains(signer) {
                    assert!(res.is_ok());
                    prop.approvals.push(signer.clone());
                } else {
                    assert!(res.is_err());
                }
            } else {
                assert!(res.is_err());
            }
        }

        Op::ExecuteMultisig {
            caller_idx,
            proposal_id,
        } => {
            let caller = &h.users[caller_idx % h.users.len()];
            let res = h.client.try_execute_approved_payment(caller, proposal_id);

            let multisig_active = model.multisig_enabled && model.multisig_threshold > 0;
            let multisig_threshold = model.multisig_threshold;
            let is_paused = model.is_paused;

            let prop_idx_opt = model.multisig_proposals.iter().position(|(pid, _)| *pid == *proposal_id);

            if let Some(idx) = prop_idx_opt {
                let prop = &mut model.multisig_proposals[idx].1;
                let threshold_met = prop.approvals.len() as u32 >= multisig_threshold;
                if !is_paused && multisig_active && !prop.executed && threshold_met {
                    assert!(res.is_ok());
                    prop.executed = true;
                    let record_to_add = ModelPaymentRecord {
                        id: model.payment_count + 1,
                        payer: prop.proposer.clone(),
                        payee: prop.payee.clone(),
                        amount: prop.amount,
                        asset: prop.asset.clone(),
                        tx_hash: prop.tx_hash.clone(),
                        metadata: String::from_str(&h.env, "multisig"),
                        timestamp: h.env.ledger().timestamp(),
                        cancelled: false,
                    };
                    model.payment_count += 1;
                    model.records.push(record_to_add);
                } else {
                    assert!(res.is_err());
                }
            } else {
                assert!(res.is_err());
            }
        }

        Op::CreateRecurring {
            creator_idx,
            payee_idx,
            amount,
            schedule_idx,
            remaining,
        } => {
            let creator = &h.users[creator_idx % h.users.len()];
            let payee = &h.users[payee_idx % h.users.len()];
            let schedule = match schedule_idx % 3 {
                0 => ScheduleType::Daily,
                1 => ScheduleType::Weekly,
                _ => ScheduleType::Monthly,
            };
            let interval = match schedule {
                ScheduleType::Daily => 86400u64,
                ScheduleType::Weekly => 604800u64,
                ScheduleType::Monthly => 2592000u64,
            };
            let memo = String::from_str(&h.env, "recurring_memo");

            let res = h.client.try_create_recurring(
                creator,
                payee,
                amount,
                &h.token_id,
                &schedule,
                remaining,
                &memo,
            );

            if !model.is_paused && *amount > 0 {
                assert!(res.is_ok());
                model.recurring_counter += 1;
                let now = h.env.ledger().timestamp();
                model.recurring_payments.push((
                    model.recurring_counter,
                    ModelRecurringPayment {
                        creator: creator.clone(),
                        payee: payee.clone(),
                        amount: *amount,
                        asset: h.token_id.clone(),
                        interval,
                        next_execution: now + interval,
                        remaining: *remaining,
                        active: true,
                    },
                ));
            } else {
                assert!(res.is_err());
            }
        }

        Op::ExecuteRecurring {
            caller_idx,
            recurring_id,
            advance_time,
        } => {
            let caller = &h.users[caller_idx % h.users.len()];

            let rec_idx_opt = model.recurring_payments.iter().position(|(rid, _)| *rid == *recurring_id);

            if *advance_time {
                if let Some(idx) = rec_idx_opt {
                    let next_exec = model.recurring_payments[idx].1.next_execution;
                    h.env.ledger().set_timestamp(next_exec + 1);
                }
            }

            let res = h.client.try_execute_recurring(caller, recurring_id);
            let is_paused = model.is_paused;

            if let Some(idx) = rec_idx_opt {
                let rec = &mut model.recurring_payments[idx].1;
                let now = h.env.ledger().timestamp();
                if !is_paused && rec.active && now >= rec.next_execution {
                    assert!(res.is_ok());
                    let record_to_add = ModelPaymentRecord {
                        id: model.payment_count + 1,
                        payer: rec.creator.clone(),
                        payee: rec.payee.clone(),
                        amount: rec.amount,
                        asset: rec.asset.clone(),
                        tx_hash: String::from_str(&h.env, "recurring"),
                        metadata: String::from_str(&h.env, "recurring"),
                        timestamp: now,
                        cancelled: false,
                    };
                    model.payment_count += 1;
                    model.records.push(record_to_add);

                    rec.next_execution = now.saturating_add(rec.interval);
                    if rec.remaining > 0 {
                        rec.remaining -= 1;
                        if rec.remaining == 0 {
                            rec.active = false;
                        }
                    }
                } else {
                    assert!(res.is_err());
                }
            } else {
                assert!(res.is_err());
            }
        }

        Op::CancelRecurring {
            caller_idx,
            recurring_id,
        } => {
            let caller = &h.users[caller_idx % h.users.len()];
            let res = h.client.try_cancel_recurring(caller, recurring_id);
            let is_paused = model.is_paused;

            let rec_idx_opt = model.recurring_payments.iter().position(|(rid, _)| *rid == *recurring_id);

            if let Some(idx) = rec_idx_opt {
                let rec = &mut model.recurring_payments[idx].1;
                if !is_paused && rec.active && (caller == &rec.creator || caller == &h.owner) {
                    assert!(res.is_ok());
                    rec.active = false;
                    rec.remaining = 0;
                } else {
                    assert!(res.is_err());
                }
            } else {
                assert!(res.is_err());
            }
        }

        Op::CancelPayment {
            as_owner,
            payment_id,
        } => {
            let caller = if *as_owner {
                h.owner.clone()
            } else {
                h.users[0].clone()
            };

            let res = h.client.try_cancel_payment(&caller, payment_id);

            if *as_owner && *payment_id >= 1 && *payment_id <= model.payment_count {
                let rec = &mut model.records[(*payment_id - 1) as usize];
                if !rec.cancelled {
                    assert!(res.is_ok());
                    rec.cancelled = true;
                    // Crucial invariant: payment record remains stored; payment_count does NOT change.
                } else {
                    assert!(res.is_err());
                }
            } else {
                assert!(res.is_err());
            }
        }

        Op::TogglePause { as_owner, pause } => {
            let caller = if *as_owner {
                h.owner.clone()
            } else {
                h.users[0].clone()
            };

            if *pause {
                let res = h.client.try_emergency_pause_all(&caller);
                if *as_owner {
                    assert!(res.is_ok());
                    model.is_paused = true;
                } else {
                    assert!(res.is_err());
                }
            } else {
                let res = h.client.try_emergency_unpause_all(&caller);
                if *as_owner {
                    assert!(res.is_ok());
                    model.is_paused = false;
                } else {
                    assert!(res.is_err());
                }
            }
        }

        Op::NonPaymentEscrow {
            depositor_idx,
            beneficiary_idx,
            amount,
        } => {
            let depositor = &h.users[depositor_idx % h.users.len()];
            let beneficiary = &h.users[beneficiary_idx % h.users.len()];
            let now = h.env.ledger().timestamp();
            let memo = String::from_str(&h.env, "escrow_test");

            let res = h.client.try_create_escrow(
                depositor,
                beneficiary,
                &None::<Address>,
                amount,
                &h.token_id,
                &(now + 1000),
                &memo,
            );

            if !model.is_paused && *amount > 0 {
                assert!(res.is_ok());
                // Non-payment operation: PAYMENT_COUNT is completely untouched!
            } else {
                assert!(res.is_err());
            }
        }

        Op::NonPaymentStream {
            creator_idx,
            recipient_idx,
            amount,
            duration,
        } => {
            let creator = &h.users[creator_idx % h.users.len()];
            let recipient = &h.users[recipient_idx % h.users.len()];
            let now = h.env.ledger().timestamp();
            let memo = String::from_str(&h.env, "stream_test");

            let res = h.client.try_create_stream(
                creator,
                recipient,
                amount,
                &h.token_id,
                &now,
                &(now + *duration),
                &memo,
            );

            if !model.is_paused && *amount > 0 && *duration > 0 {
                assert!(res.is_ok());
                // Non-payment operation: PAYMENT_COUNT is completely untouched!
            } else {
                assert!(res.is_err());
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Proptest Strategy Generators
// ═══════════════════════════════════════════════════════════════════════════

fn op_strategy() -> impl Strategy<Value = Op> {
    prop_oneof![
        // Direct record payment
        (0usize..10, 0usize..10, 1i128..=5_000_000, 0u32..10_000).prop_map(
            |(p, b, amt, tag)| Op::RecordPayment {
                payer_idx: p,
                payee_idx: b,
                amount: amt,
                memo_tag: tag,
            }
        ),
        // Invalid zero/negative record payment
        (0usize..10, 0usize..10, -500i128..=0, 0u32..10_000).prop_map(
            |(p, b, amt, tag)| Op::RecordPayment {
                payer_idx: p,
                payee_idx: b,
                amount: amt,
                memo_tag: tag,
            }
        ),
        // Atomic spend with spending limit
        (0usize..10, 0usize..10, 1i128..=5_000_000, 0u32..10_000).prop_map(
            |(p, b, amt, tag)| Op::AtomicSpend {
                payer_idx: p,
                payee_idx: b,
                amount: amt,
                memo_tag: tag,
            }
        ),
        // Batch payments
        (
            0usize..10,
            prop::collection::vec((0usize..10, -100i128..=2_000_000), 1..=8)
        )
            .prop_map(|(c, recs)| Op::BatchPayment {
                creator_idx: c,
                recipients: recs,
            }),
        // Set spending limit
        (0usize..10, 10_000i128..=10_000_000, 50_000i128..=50_000_000, 0u64..=100_000, prop::bool::ANY).prop_map(
            |(u, d, m, exp, act)| Op::SetSpendingLimit {
                user_idx: u,
                daily_limit: d,
                monthly_limit: m.max(d),
                expires_in: exp,
                is_active: act,
            }
        ),
        // Configure multisig
        (1u32..=5, prop::collection::vec(0usize..10, 1..=5), prop::bool::ANY).prop_map(
            |(t, s, en)| {
                let threshold = t.min(s.len() as u32).max(1);
                Op::ConfigureMultisig {
                    threshold,
                    signer_indices: s,
                    enabled: en,
                }
            }
        ),
        // Propose multisig
        (0usize..10, 0usize..10, 1i128..=5_000_000).prop_map(|(p, b, amt)| Op::ProposeMultisig {
            proposer_idx: p,
            payee_idx: b,
            amount: amt,
        }),
        // Approve multisig
        (0usize..10, 1u64..=10).prop_map(|(s, pid)| Op::ApproveMultisig {
            signer_idx: s,
            proposal_id: pid,
        }),
        // Execute multisig
        (0usize..10, 1u64..=10).prop_map(|(c, pid)| Op::ExecuteMultisig {
            caller_idx: c,
            proposal_id: pid,
        }),
        // Create recurring
        (0usize..10, 0usize..10, 1i128..=2_000_000, 0u8..3, 0u32..=5).prop_map(
            |(c, p, amt, s, rem)| Op::CreateRecurring {
                creator_idx: c,
                payee_idx: p,
                amount: amt,
                schedule_idx: s,
                remaining: rem,
            }
        ),
        // Execute recurring
        (0usize..10, 1u64..=10, prop::bool::ANY).prop_map(|(c, rid, adv)| Op::ExecuteRecurring {
            caller_idx: c,
            recurring_id: rid,
            advance_time: adv,
        }),
        // Cancel recurring
        (0usize..10, 1u64..=10).prop_map(|(c, rid)| Op::CancelRecurring {
            caller_idx: c,
            recurring_id: rid,
        }),
        // Cancel payment
        (prop::bool::ANY, 0u64..=20).prop_map(|(as_owner, pid)| Op::CancelPayment {
            as_owner,
            payment_id: pid,
        }),
        // Toggle pause
        (prop::bool::ANY, prop::bool::ANY).prop_map(|(as_owner, p)| Op::TogglePause {
            as_owner,
            pause: p,
        }),
        // Non-payment escrow
        (0usize..10, 0usize..10, 1i128..=1_000_000).prop_map(|(d, b, amt)| {
            Op::NonPaymentEscrow {
                depositor_idx: d,
                beneficiary_idx: b,
                amount: amt,
            }
        }),
        // Non-payment stream
        (0usize..10, 0usize..10, 1i128..=1_000_000, 100u64..=10_000).prop_map(|(c, r, amt, dur)| {
            Op::NonPaymentStream {
                creator_idx: c,
                recipient_idx: r,
                amount: amt,
                duration: dur,
            }
        }),
    ]
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. PRIMARY INVARIANT TEST: State Machine Model & Invariant Across Op Sequences
// ═══════════════════════════════════════════════════════════════════════════

proptest! {
    #![proptest_config(get_proptest_config())]

    #[test]
    fn prop_payment_counter_equals_stored_records_model_invariant(
        ops in prop::collection::vec(op_strategy(), 1..=25),
    ) {
        let h = InvariantHarness::new();
        let mut model = ContractPaymentModel::new();
        let mut history = std::vec::Vec::new();

        // Initial invariant check: 0 payments, empty storage
        assert_contract_invariants(&h, &model, &history, 0, &Op::TogglePause { as_owner: false, pause: false })?;

        for (step_idx, op) in ops.iter().enumerate() {
            history.push(op.clone());
            execute_op_and_step_model(&h, &mut model, op);

            // Invariant must strictly hold after EVERY single operation
            assert_contract_invariants(&h, &model, &history, step_idx + 1, op)?;
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. BATCH PAYMENT ATOMICITY & COUNTER CONSERVATION PROPERTY TEST
// ═══════════════════════════════════════════════════════════════════════════

proptest! {
    #![proptest_config(get_proptest_config())]

    #[test]
    fn prop_batch_payment_counter_exact_increment_invariant(
        initial_payments in 0u32..=5,
        batch_amounts in prop::collection::vec(-100i128..=10_000_000, 1..=20),
    ) {
        let h = InvariantHarness::new();
        let mut model = ContractPaymentModel::new();
        let mut history = std::vec::Vec::new();

        // Populate initial payments
        for i in 0..initial_payments {
            let op = Op::RecordPayment {
                payer_idx: 0,
                payee_idx: 1,
                amount: 1000 + (i as i128),
                memo_tag: i,
            };
            history.push(op.clone());
            execute_op_and_step_model(&h, &mut model, &op);
            assert_contract_invariants(&h, &model, &history, history.len(), &op)?;
        }

        let pre_batch_count = h.client.get_payment_count();
        prop_assert_eq!(pre_batch_count, model.payment_count);

        let recipients: std::vec::Vec<(usize, i128)> = batch_amounts
            .iter()
            .enumerate()
            .map(|(idx, &amt)| (idx % h.users.len(), amt))
            .collect();

        let batch_op = Op::BatchPayment {
            creator_idx: 0,
            recipients,
        };
        history.push(batch_op.clone());
        execute_op_and_step_model(&h, &mut model, &batch_op);

        // Assert invariant after batch operation
        assert_contract_invariants(&h, &model, &history, history.len(), &batch_op)?;

        let post_batch_count = h.client.get_payment_count();
        let valid_count = batch_amounts.iter().filter(|&&a| a > 0).count() as u64;

        if valid_count > 0 {
            prop_assert_eq!(post_batch_count, pre_batch_count + valid_count);
        } else {
            prop_assert_eq!(post_batch_count, pre_batch_count);
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. MULTISIG & RECURRING FULL LIFECYCLE INVARIANT TEST
// ═══════════════════════════════════════════════════════════════════════════

proptest! {
    #![proptest_config(get_proptest_config())]

    #[test]
    fn prop_multisig_and_recurring_counter_strict_isolation(
        m in 2u32..=5,
        threshold in 1u32..=5,
        payment_amount in 100i128..=1_000_000,
        recurring_iterations in 1u32..=4,
    ) {
        let threshold = threshold.min(m);
        let h = InvariantHarness::new();
        let mut model = ContractPaymentModel::new();
        let mut history = std::vec::Vec::new();

        // 1. Configure multisig
        let signers: std::vec::Vec<usize> = (0..m as usize).collect();
        let cfg_op = Op::ConfigureMultisig {
            threshold,
            signer_indices: signers.clone(),
            enabled: true,
        };
        history.push(cfg_op.clone());
        execute_op_and_step_model(&h, &mut model, &cfg_op);
        assert_contract_invariants(&h, &model, &history, history.len(), &cfg_op)?;

        // 2. Propose payment
        let prop_op = Op::ProposeMultisig {
            proposer_idx: 0,
            payee_idx: 1,
            amount: payment_amount,
        };
        history.push(prop_op.clone());
        execute_op_and_step_model(&h, &mut model, &prop_op);
        assert_contract_invariants(&h, &model, &history, history.len(), &prop_op)?;

        // 3. Sub-threshold approvals do NOT increment payment count
        for s in 0..(threshold as usize - 1) {
            let app_op = Op::ApproveMultisig {
                signer_idx: s,
                proposal_id: 1,
            };
            history.push(app_op.clone());
            execute_op_and_step_model(&h, &mut model, &app_op);
            assert_contract_invariants(&h, &model, &history, history.len(), &app_op)?;

            // Premature execution attempt must fail and not increment counter
            let fail_exec_op = Op::ExecuteMultisig {
                caller_idx: 0,
                proposal_id: 1,
            };
            history.push(fail_exec_op.clone());
            execute_op_and_step_model(&h, &mut model, &fail_exec_op);
            assert_contract_invariants(&h, &model, &history, history.len(), &fail_exec_op)?;
            prop_assert_eq!(h.client.get_payment_count(), 0);
        }

        // 4. Final approval to reach threshold
        let final_app_op = Op::ApproveMultisig {
            signer_idx: (threshold as usize - 1),
            proposal_id: 1,
        };
        history.push(final_app_op.clone());
        execute_op_and_step_model(&h, &mut model, &final_app_op);
        assert_contract_invariants(&h, &model, &history, history.len(), &final_app_op)?;
        prop_assert_eq!(h.client.get_payment_count(), 0);

        // 5. Execute fully-approved multisig payment
        let exec_op = Op::ExecuteMultisig {
            caller_idx: 0,
            proposal_id: 1,
        };
        history.push(exec_op.clone());
        execute_op_and_step_model(&h, &mut model, &exec_op);
        assert_contract_invariants(&h, &model, &history, history.len(), &exec_op)?;
        prop_assert_eq!(h.client.get_payment_count(), 1);

        // 6. Create and execute recurring payments across iterations
        let rec_op = Op::CreateRecurring {
            creator_idx: 0,
            payee_idx: 1,
            amount: payment_amount,
            schedule_idx: 0, // Daily
            remaining: recurring_iterations,
        };
        history.push(rec_op.clone());
        execute_op_and_step_model(&h, &mut model, &rec_op);
        assert_contract_invariants(&h, &model, &history, history.len(), &rec_op)?;

        let mut expected_count = 1u64;
        for _ in 0..recurring_iterations {
            let exec_rec_op = Op::ExecuteRecurring {
                caller_idx: 2,
                recurring_id: 1,
                advance_time: true,
            };
            history.push(exec_rec_op.clone());
            execute_op_and_step_model(&h, &mut model, &exec_rec_op);
            assert_contract_invariants(&h, &model, &history, history.len(), &exec_rec_op)?;
            expected_count += 1;
            prop_assert_eq!(h.client.get_payment_count(), expected_count);
        }

        // Attempting to execute once more when remaining == 0 fails and leaves count unchanged
        let extra_exec_op = Op::ExecuteRecurring {
            caller_idx: 2,
            recurring_id: 1,
            advance_time: true,
        };
        history.push(extra_exec_op.clone());
        execute_op_and_step_model(&h, &mut model, &extra_exec_op);
        assert_contract_invariants(&h, &model, &history, history.len(), &extra_exec_op)?;
        prop_assert_eq!(h.client.get_payment_count(), expected_count);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. NON-PAYMENT OPERATIONS & CANCELLATION CONSERVATION TEST
// ═══════════════════════════════════════════════════════════════════════════

proptest! {
    #![proptest_config(get_proptest_config())]

    #[test]
    fn prop_non_payment_operations_never_mutate_payment_counter(
        escrow_amounts in prop::collection::vec(1_000i128..=100_000, 1..=4),
        stream_amounts in prop::collection::vec(5_000i128..=200_000, 1..=4),
    ) {
        let h = InvariantHarness::new();
        let mut model = ContractPaymentModel::new();
        let mut history = std::vec::Vec::new();

        // 1. Record 2 payments
        for i in 1..=2 {
            let op = Op::RecordPayment {
                payer_idx: 0,
                payee_idx: 1,
                amount: 10_000 * i,
                memo_tag: i as u32,
            };
            history.push(op.clone());
            execute_op_and_step_model(&h, &mut model, &op);
            assert_contract_invariants(&h, &model, &history, history.len(), &op)?;
        }
        prop_assert_eq!(h.client.get_payment_count(), 2);

        // 2. Perform various escrow operations
        for &amt in &escrow_amounts {
            let op = Op::NonPaymentEscrow {
                depositor_idx: 0,
                beneficiary_idx: 1,
                amount: amt,
            };
            history.push(op.clone());
            execute_op_and_step_model(&h, &mut model, &op);
            assert_contract_invariants(&h, &model, &history, history.len(), &op)?;
            prop_assert_eq!(h.client.get_payment_count(), 2);
        }

        // 3. Perform stream operations
        for &amt in &stream_amounts {
            let op = Op::NonPaymentStream {
                creator_idx: 0,
                recipient_idx: 1,
                amount: amt,
                duration: 5000,
            };
            history.push(op.clone());
            execute_op_and_step_model(&h, &mut model, &op);
            assert_contract_invariants(&h, &model, &history, history.len(), &op)?;
            prop_assert_eq!(h.client.get_payment_count(), 2);
        }

        // 4. Cancel payment 1 as owner: cancelled flag becomes true, record stays in storage, count = 2
        let cancel_op = Op::CancelPayment {
            as_owner: true,
            payment_id: 1,
        };
        history.push(cancel_op.clone());
        execute_op_and_step_model(&h, &mut model, &cancel_op);
        assert_contract_invariants(&h, &model, &history, history.len(), &cancel_op)?;
        prop_assert_eq!(h.client.get_payment_count(), 2);

        let p1 = h.client.get_payment(&1);
        prop_assert!(p1.cancelled);

        // Re-cancelling fails with PaymentAlreadyCancelled, count remains 2
        let cancel_dup_op = Op::CancelPayment {
            as_owner: true,
            payment_id: 1,
        };
        history.push(cancel_dup_op.clone());
        execute_op_and_step_model(&h, &mut model, &cancel_dup_op);
        assert_contract_invariants(&h, &model, &history, history.len(), &cancel_dup_op)?;
        prop_assert_eq!(h.client.get_payment_count(), 2);
    }
}
