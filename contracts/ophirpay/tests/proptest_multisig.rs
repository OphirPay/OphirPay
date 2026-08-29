// SPDX-License-Identifier: MIT
#![cfg(test)]

//! Property-based testing suite for OphirPay multisig threshold math and quorum logic.
//!
//! Acceptance Criteria (Issue #387):
//! 1. Random N-of-M configurations exercised.
//! 2. No false-positive execution under threshold.
//! 3. Duplicate approvals do not double-count.
//! 4. Comprehensive quorum checks, approval dedupe, and edge cases around N-of-M configurations.

use ophirpay_contract::{OphirPayContract, OphirPayContractClient, PaymentError};
use proptest::prelude::*;
use proptest::test_runner::Config as ProptestConfig;
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{Address, Env, String, Vec};

const PROPTEST_CASES: u32 = 64;

fn get_proptest_config() -> ProptestConfig {
    ProptestConfig {
        cases: PROPTEST_CASES,
        max_shrink_iters: 100,
        ..ProptestConfig::default()
    }
}

struct MultisigHarness<'a> {
    env: Env,
    client: OphirPayContractClient<'a>,
    owner: Address,
    token_id: Address,
}

impl<'a> MultisigHarness<'a> {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1_000_000);

        let owner = Address::generate(&env);
        let token_admin = Address::generate(&env);

        let token_id = env
            .register_stellar_asset_contract_v2(token_admin.clone())
            .address();

        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        client.init(&owner);

        MultisigHarness {
            env,
            client,
            owner,
            token_id,
        }
    }

    fn configure_multisig(&self, threshold: u32, signers: &Vec<Address>, enabled: bool) {
        self.client
            .set_multisig_config(&self.owner, &threshold, signers, &enabled);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. PROPERTY TESTS: Quorum Checks & No False-Positive Execution Under Threshold
// ═══════════════════════════════════════════════════════════════════════════

proptest! {
    #![proptest_config(get_proptest_config())]

    #[test]
    fn prop_multisig_quorum_and_execution_invariant(
        m in 1u32..=10u32,
        n_offset in 0u32..10u32,
        payment_amount in 100i128..=10_000_000i128,
    ) {
        // n is chosen in 1..=m
        let n = 1 + (n_offset % m);

        let h = MultisigHarness::new();
        let mut signers_native = std::vec::Vec::new();
        let mut signers_soroban = Vec::new(&h.env);

        for _ in 0..m {
            let s = Address::generate(&h.env);
            signers_native.push(s.clone());
            signers_soroban.push_back(s);
        }

        // Configure N-of-M multisig
        h.configure_multisig(n, &signers_soroban, true);

        let payee = Address::generate(&h.env);
        let tx_hash = String::from_str(&h.env, "prop_tx_quorum");

        // Propose payment
        let proposal_id = h.client.propose_payment(
            &signers_native[0],
            &payee,
            &payment_amount,
            &h.token_id,
            &tx_hash,
        );
        prop_assert_eq!(proposal_id, 1);

        let initial_req = h.client.get_approval_request(&proposal_id).unwrap();
        prop_assert_eq!(initial_req.approvals.len(), 0);
        prop_assert_eq!(initial_req.executed, false);

        // Before any approval, execution MUST fail if threshold >= 1
        let pre_exec = h.client.try_execute_approved_payment(&signers_native[0], &proposal_id);
        prop_assert_eq!(pre_exec, Err(Ok(PaymentError::ThresholdNotMet)));

        // Sequentially apply approvals from unique signers
        for (i, signer) in signers_native.iter().enumerate() {
            let approval_idx = (i as u32) + 1;

            if approval_idx < n {
                // Below threshold: approve returns Ok(false)
                let threshold_met = h.client.approve_payment(signer, &proposal_id);
                prop_assert_eq!(threshold_met, false);

                let req = h.client.get_approval_request(&proposal_id).unwrap();
                prop_assert_eq!(req.approvals.len(), approval_idx);
                prop_assert_eq!(req.executed, false);

                // INVARIANT: Execution strictly rejected under threshold (no false positive)
                let exec_res = h.client.try_execute_approved_payment(signer, &proposal_id);
                prop_assert_eq!(exec_res, Err(Ok(PaymentError::ThresholdNotMet)));
                prop_assert_eq!(h.client.get_payment_count(), 0);
            } else if approval_idx == n {
                // Exact threshold: approve returns Ok(true)
                let threshold_met = h.client.approve_payment(signer, &proposal_id);
                prop_assert_eq!(threshold_met, true);

                let req = h.client.get_approval_request(&proposal_id).unwrap();
                prop_assert_eq!(req.approvals.len(), n);
                prop_assert_eq!(req.executed, false);

                // INVARIANT: Execution succeeds once threshold is met
                let exec_res = h.client.try_execute_approved_payment(signer, &proposal_id);
                prop_assert!(exec_res.is_ok());
                prop_assert_eq!(exec_res.unwrap(), Ok(1));
                prop_assert_eq!(h.client.get_payment_count(), 1);

                let executed_req = h.client.get_approval_request(&proposal_id).unwrap();
                prop_assert_eq!(executed_req.executed, true);

                // Subsequent execution attempt MUST be rejected
                let double_exec = h.client.try_execute_approved_payment(signer, &proposal_id);
                prop_assert_eq!(double_exec, Err(Ok(PaymentError::AlreadyExecuted)));
            } else {
                // After execution: further approvals MUST be rejected
                let late_approval = h.client.try_approve_payment(signer, &proposal_id);
                prop_assert_eq!(late_approval, Err(Ok(PaymentError::AlreadyExecuted)));
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. PROPERTY TESTS: Duplicate Approvals Do Not Double-Count
// ═══════════════════════════════════════════════════════════════════════════

proptest! {
    #![proptest_config(get_proptest_config())]

    #[test]
    fn prop_multisig_duplicate_approval_deduplication(
        m in 2u32..=8u32,
        n_offset in 1u32..8u32, // ensures n >= 2
        signer_idx_raw in 0u32..100u32,
        duplicate_attempts in 1u32..=6u32,
    ) {
        // n is chosen in 2..=m
        let n = 2 + (n_offset % (m - 1));

        let h = MultisigHarness::new();
        let mut signers_native = std::vec::Vec::new();
        let mut signers_soroban = Vec::new(&h.env);

        for _ in 0..m {
            let s = Address::generate(&h.env);
            signers_native.push(s.clone());
            signers_soroban.push_back(s);
        }

        h.configure_multisig(n, &signers_soroban, true);

        let payee = Address::generate(&h.env);
        let tx_hash = String::from_str(&h.env, "prop_tx_dedupe");

        let proposal_id = h.client.propose_payment(
            &signers_native[0],
            &payee,
            &50_000i128,
            &h.token_id,
            &tx_hash,
        );

        let chosen_idx = (signer_idx_raw as usize) % (m as usize);
        let chosen_signer = &signers_native[chosen_idx];

        // First valid approval: succeeds, returns false (since n >= 2)
        let first_res = h.client.approve_payment(chosen_signer, &proposal_id);
        prop_assert_eq!(first_res, false);

        let req_after_first = h.client.get_approval_request(&proposal_id).unwrap();
        prop_assert_eq!(req_after_first.approvals.len(), 1);

        // Repeated approval attempts by the SAME signer
        for _ in 0..duplicate_attempts {
            let dup_res = h.client.try_approve_payment(chosen_signer, &proposal_id);
            // INVARIANT: Duplicate approvals return AlreadyApproved error
            prop_assert_eq!(dup_res, Err(Ok(PaymentError::AlreadyApproved)));

            // INVARIANT: Approvals list length does NOT double-count
            let req_after_dup = h.client.get_approval_request(&proposal_id).unwrap();
            prop_assert_eq!(req_after_dup.approvals.len(), 1);

            // INVARIANT: Cannot execute payment via duplicate approvals
            let exec_res = h.client.try_execute_approved_payment(chosen_signer, &proposal_id);
            prop_assert_eq!(exec_res, Err(Ok(PaymentError::ThresholdNotMet)));
        }

        // Verify that only adding DISTINCT remaining signers can reach quorum
        let mut current_unique_approvals = 1u32;
        for (idx, signer) in signers_native.iter().enumerate() {
            if idx == chosen_idx {
                continue;
            }
            current_unique_approvals += 1;
            let expected_met = current_unique_approvals >= n;
            let met = h.client.approve_payment(signer, &proposal_id);
            prop_assert_eq!(met, expected_met);

            if expected_met {
                // Execution succeeds only when genuine distinct signers reach threshold
                let exec_ok = h.client.try_execute_approved_payment(signer, &proposal_id);
                prop_assert!(exec_ok.is_ok());
                break;
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. PROPERTY TESTS: Unauthorized Signers & Non-Signer Rejection
// ═══════════════════════════════════════════════════════════════════════════

proptest! {
    #![proptest_config(get_proptest_config())]

    #[test]
    fn prop_multisig_non_signers_strictly_rejected(
        m in 1u32..=6u32,
        num_strangers in 1u32..=5u32,
    ) {
        let h = MultisigHarness::new();
        let mut signers_soroban = Vec::new(&h.env);
        let mut signers_native = std::vec::Vec::new();

        for _ in 0..m {
            let s = Address::generate(&h.env);
            signers_native.push(s.clone());
            signers_soroban.push_back(s);
        }

        h.configure_multisig(m, &signers_soroban, true);

        let payee = Address::generate(&h.env);
        let tx_hash = String::from_str(&h.env, "prop_tx_strangers");

        let proposal_id = h.client.propose_payment(
            &signers_native[0],
            &payee,
            &25_000i128,
            &h.token_id,
            &tx_hash,
        );

        // Generate strangers not in signers list
        for _ in 0..num_strangers {
            let stranger = Address::generate(&h.env);
            let approve_res = h.client.try_approve_payment(&stranger, &proposal_id);
            // INVARIANT: Non-signers cannot approve
            prop_assert_eq!(approve_res, Err(Ok(PaymentError::NotASigner)));

            // Storage approvals remain empty
            let req = h.client.get_approval_request(&proposal_id).unwrap();
            prop_assert_eq!(req.approvals.len(), 0);

            // Stranger cannot execute
            let exec_res = h.client.try_execute_approved_payment(&stranger, &proposal_id);
            prop_assert_eq!(exec_res, Err(Ok(PaymentError::ThresholdNotMet)));
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. PROPERTY TESTS: Invalid Configurations (N = 0, N > M)
// ═══════════════════════════════════════════════════════════════════════════

proptest! {
    #![proptest_config(get_proptest_config())]

    #[test]
    fn prop_multisig_invalid_configuration_bounds_rejected(
        m in 1u32..=10u32,
        over_threshold_offset in 1u32..=20u32,
    ) {
        let h = MultisigHarness::new();
        let mut signers_soroban = Vec::new(&h.env);

        for _ in 0..m {
            signers_soroban.push_back(Address::generate(&h.env));
        }

        // INVARIANT 1: Threshold = 0 must be rejected with InvalidAmount
        let zero_res = h.client.try_set_multisig_config(&h.owner, &0u32, &signers_soroban, &true);
        prop_assert_eq!(zero_res, Err(Ok(PaymentError::InvalidAmount)));

        // INVARIANT 2: Threshold > M must be rejected with InvalidAmount
        let over_threshold = m + over_threshold_offset;
        let over_res = h.client.try_set_multisig_config(&h.owner, &over_threshold, &signers_soroban, &true);
        prop_assert_eq!(over_res, Err(Ok(PaymentError::InvalidAmount)));

        // If multisig was never configured, get_multisig_config is None
        prop_assert!(h.client.get_multisig_config().is_none());

        // And proposing payment fails with MultisigNotConfigured
        let payee = Address::generate(&h.env);
        let tx_hash = String::from_str(&h.env, "prop_tx_unconfigured");
        let prop_fail = h.client.try_propose_payment(
            &h.owner,
            &payee,
            &1000i128,
            &h.token_id,
            &tx_hash,
        );
        prop_assert_eq!(prop_fail, Err(Ok(PaymentError::MultisigNotConfigured)));
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. PROPERTY TESTS: Extreme Edge Cases (1-of-1, 1-of-M, M-of-M)
// ═══════════════════════════════════════════════════════════════════════════

proptest! {
    #![proptest_config(get_proptest_config())]

    #[test]
    fn prop_multisig_edge_case_1_of_1(
        amount in 1i128..=1_000_000i128,
    ) {
        let h = MultisigHarness::new();
        let sole_signer = Address::generate(&h.env);
        let mut signers = Vec::new(&h.env);
        signers.push_back(sole_signer.clone());

        h.configure_multisig(1, &signers, true);

        let payee = Address::generate(&h.env);
        let tx_hash = String::from_str(&h.env, "1_of_1_tx");

        let pid = h.client.propose_payment(&sole_signer, &payee, &amount, &h.token_id, &tx_hash);

        // 0 approvals: cannot execute
        let pre_exec = h.client.try_execute_approved_payment(&sole_signer, &pid);
        prop_assert_eq!(pre_exec, Err(Ok(PaymentError::ThresholdNotMet)));

        // 1 approval: immediately meets threshold
        let met = h.client.approve_payment(&sole_signer, &pid);
        prop_assert_eq!(met, true);

        // Execute succeeds
        let exec = h.client.execute_approved_payment(&sole_signer, &pid);
        prop_assert_eq!(exec, 1);
        prop_assert_eq!(h.client.get_payment_count(), 1);
    }

    #[test]
    fn prop_multisig_edge_case_1_of_m(
        m in 2u32..=12u32,
        chosen_signer_idx_raw in 0u32..100u32,
    ) {
        let h = MultisigHarness::new();
        let mut signers_native = std::vec::Vec::new();
        let mut signers_soroban = Vec::new(&h.env);

        for _ in 0..m {
            let s = Address::generate(&h.env);
            signers_native.push(s.clone());
            signers_soroban.push_back(s);
        }

        h.configure_multisig(1, &signers_soroban, true);

        let payee = Address::generate(&h.env);
        let tx_hash = String::from_str(&h.env, "1_of_m_tx");

        let pid = h.client.propose_payment(&signers_native[0], &payee, &1000i128, &h.token_id, &tx_hash);

        let chosen_idx = (chosen_signer_idx_raw as usize) % (m as usize);
        let signer = &signers_native[chosen_idx];

        // INVARIANT: In 1-of-M, ANY single signer approval immediately satisfies quorum
        let met = h.client.approve_payment(signer, &pid);
        prop_assert_eq!(met, true);

        let exec = h.client.execute_approved_payment(signer, &pid);
        prop_assert_eq!(exec, 1);
    }

    #[test]
    fn prop_multisig_edge_case_m_of_m_unanimous(
        m in 2u32..=8u32,
    ) {
        let h = MultisigHarness::new();
        let mut signers_native = std::vec::Vec::new();
        let mut signers_soroban = Vec::new(&h.env);

        for _ in 0..m {
            let s = Address::generate(&h.env);
            signers_native.push(s.clone());
            signers_soroban.push_back(s);
        }

        // Unanimous requirement: threshold == m
        h.configure_multisig(m, &signers_soroban, true);

        let payee = Address::generate(&h.env);
        let tx_hash = String::from_str(&h.env, "m_of_m_tx");

        let pid = h.client.propose_payment(&signers_native[0], &payee, &5000i128, &h.token_id, &tx_hash);

        // Approve M-1 signers: threshold must NOT be met
        for i in 0..(m - 1) as usize {
            let met = h.client.approve_payment(&signers_native[i], &pid);
            prop_assert_eq!(met, false);

            let exec = h.client.try_execute_approved_payment(&signers_native[i], &pid);
            prop_assert_eq!(exec, Err(Ok(PaymentError::ThresholdNotMet)));
        }

        // Final M-th signer approves: threshold is met
        let last_idx = (m - 1) as usize;
        let met_final = h.client.approve_payment(&signers_native[last_idx], &pid);
        prop_assert_eq!(met_final, true);

        let exec_final = h.client.execute_approved_payment(&signers_native[last_idx], &pid);
        prop_assert_eq!(exec_final, 1);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. PROPERTY TESTS: Multi-Proposal Isolation & Configuration Versioning
// ═══════════════════════════════════════════════════════════════════════════

proptest! {
    #![proptest_config(get_proptest_config())]

    #[test]
    fn prop_multisig_multiple_proposals_isolated_approvals(
        threshold in 2u32..=4u32,
    ) {
        let h = MultisigHarness::new();
        let mut signers_native = std::vec::Vec::new();
        let mut signers_soroban = Vec::new(&h.env);

        for _ in 0..5 {
            let s = Address::generate(&h.env);
            signers_native.push(s.clone());
            signers_soroban.push_back(s);
        }

        h.configure_multisig(threshold, &signers_soroban, true);

        let payee = Address::generate(&h.env);

        // Create 2 concurrent proposals
        let pid1 = h.client.propose_payment(
            &signers_native[0],
            &payee,
            &10_000i128,
            &h.token_id,
            &String::from_str(&h.env, "p1"),
        );
        let pid2 = h.client.propose_payment(
            &signers_native[1],
            &payee,
            &20_000i128,
            &h.token_id,
            &String::from_str(&h.env, "p2"),
        );

        // Approve proposal 1 up to threshold
        for i in 0..threshold as usize {
            h.client.approve_payment(&signers_native[i], &pid1);
        }

        // Proposal 1 can execute
        let exec1 = h.client.try_execute_approved_payment(&signers_native[0], &pid1);
        prop_assert!(exec1.is_ok());

        // INVARIANT: Proposal 2 still has 0 approvals and CANNOT execute
        let req2 = h.client.get_approval_request(&pid2).unwrap();
        prop_assert_eq!(req2.approvals.len(), 0);
        prop_assert_eq!(req2.executed, false);

        let exec2 = h.client.try_execute_approved_payment(&signers_native[0], &pid2);
        prop_assert_eq!(exec2, Err(Ok(PaymentError::ThresholdNotMet)));
    }

    #[test]
    fn prop_multisig_configuration_version_audit_history(
        num_updates in 2u32..=8u32,
    ) {
        let h = MultisigHarness::new();
        let mut expected_versions = std::vec::Vec::new();

        for v in 1..=num_updates {
            let num_signers = v + 1;
            let mut signers = Vec::new(&h.env);
            for _ in 0..num_signers {
                signers.push_back(Address::generate(&h.env));
            }
            let threshold = v;

            h.client.set_multisig_config(&h.owner, &threshold, &signers, &true);
            expected_versions.push((v, threshold));
        }

        let history = h.client.get_multisig_config_history();
        prop_assert_eq!(history.len(), num_updates);

        // Most recent first
        for (i, version_entry) in history.iter().enumerate() {
            let expected_idx = (num_updates as usize) - 1 - i;
            let (exp_v, exp_thresh) = expected_versions[expected_idx];

            prop_assert_eq!(version_entry.version, exp_v);
            prop_assert_eq!(version_entry.config.threshold, exp_thresh);
            prop_assert_eq!(version_entry.changed_by, h.owner.clone());
        }
    }
}
