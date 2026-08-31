// SPDX-License-Identifier: MIT
#![cfg(test)]

//! Property-based testing suite for OphirPay multisig threshold logic (Issue #387).
//!
//! Acceptance Criteria:
//! 1. Random N-of-M configurations exercised (1 <= N <= M, signers count up to 10).
//! 2. No false-positive execution under threshold (strictly fails with ThresholdNotMet).
//! 3. Duplicate approvals do not double-count (rejects with AlreadyApproved).
//! 4. Non-signers cannot approve (rejects with NotASigner).
//! 5. Execution succeeds once exact threshold is met and cannot be re-executed (AlreadyExecuted).

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
}

proptest! {
    #![proptest_config(get_proptest_config())]

    /// Test that for any random N-of-M configuration (1 <= N <= M <= 10):
    /// - Execution is blocked for any approval count < N.
    /// - Duplicate approvals by the same signer are rejected with AlreadyApproved.
    /// - Execution succeeds as soon as N distinct valid approvals are recorded.
    /// - Re-execution is blocked with AlreadyExecuted.
    #[test]
    fn prop_multisig_threshold_and_dedupe(
        m_signers in 1u32..=10u32,
        threshold in 1u32..=10u32,
        approver_indices in prop::collection::vec(0usize..10usize, 0..15)
    ) {
        let harness = MultisigHarness::new();
        let env = &harness.env;
        let client = &harness.client;

        // Generate M distinct signer addresses
        let mut signers_vec = Vec::new(env);
        let mut signer_addrs = std::vec::Vec::new();
        for _ in 0..m_signers {
            let s = Address::generate(env);
            signers_vec.push_back(s.clone());
            signer_addrs.push(s);
        }

        // Clamp threshold to valid range 1..=M or test invalid threshold rejection
        if threshold > m_signers || threshold == 0 {
            let res = client.try_set_multisig_config(&harness.owner, &threshold, &signers_vec, &true);
            prop_assert_eq!(res, Err(Ok(PaymentError::InvalidAmount)));
            return Ok(());
        }

        // Configure valid multisig
        client.set_multisig_config(&harness.owner, &threshold, &signers_vec, &true);
        let config = client.get_multisig_config().unwrap();
        prop_assert_eq!(config.threshold, threshold);
        prop_assert_eq!(config.signers.len(), m_signers);

        // Propose a payment
        let payee = Address::generate(env);
        let tx_hash = String::from_str(env, "tx_multisig_prop_test");
        let req_id = client.propose_payment(
            &harness.owner,
            &payee,
            &1000i128,
            &harness.token_id,
            &tx_hash,
        );

        let mut approved_set = std::collections::HashSet::new();

        // Process random sequence of approval attempts
        for raw_idx in approver_indices {
            let idx = raw_idx % (m_signers as usize);
            let signer = &signer_addrs[idx];

            if approved_set.contains(&idx) {
                // Duplicate approval attempt must be rejected
                let res = client.try_approve_payment(signer, &req_id);
                prop_assert_eq!(res, Err(Ok(PaymentError::AlreadyApproved)));
            } else {
                // First approval by this signer
                let threshold_met = client.approve_payment(signer, &req_id);
                approved_set.insert(idx);

                let expected_met = (approved_set.len() as u32) >= threshold;
                prop_assert_eq!(threshold_met, expected_met);

                if !threshold_met {
                    // Quorum not yet met -> execution MUST fail with ThresholdNotMet
                    let exec_res = client.try_execute_approved_payment(&harness.owner, &req_id);
                    prop_assert_eq!(exec_res, Err(Ok(PaymentError::ThresholdNotMet)));
                }
            }
        }

        // If threshold was reached, verify execution works and cannot be repeated
        if (approved_set.len() as u32) >= threshold {
            let exec_res = client.execute_approved_payment(&harness.owner, &req_id);
            prop_assert!(exec_res > 0);

            // Re-execution must fail
            let double_exec = client.try_execute_approved_payment(&harness.owner, &req_id);
            prop_assert_eq!(double_exec, Err(Ok(PaymentError::AlreadyExecuted)));

            // Additional approvals after execution must also fail
            let non_approver = signer_addrs.iter().enumerate().find(|(i, _)| !approved_set.contains(i));
            if let Some((_, signer)) = non_approver {
                let post_exec_approve = client.try_approve_payment(signer, &req_id);
                prop_assert_eq!(post_exec_approve, Err(Ok(PaymentError::AlreadyExecuted)));
            }
        } else {
            // Threshold was NOT reached -> execution must still fail
            let exec_res = client.try_execute_approved_payment(&harness.owner, &req_id);
            prop_assert_eq!(exec_res, Err(Ok(PaymentError::ThresholdNotMet)));
        }
    }

    /// Test non-signer rejection: any address not in signers list is strictly rejected with NotASigner.
    #[test]
    fn prop_multisig_non_signer_rejection(
        m_signers in 1u32..=5u32,
        threshold in 1u32..=5u32
    ) {
        if threshold > m_signers {
            return Ok(());
        }

        let harness = MultisigHarness::new();
        let env = &harness.env;
        let client = &harness.client;

        let mut signers_vec = Vec::new(env);
        for _ in 0..m_signers {
            signers_vec.push_back(Address::generate(env));
        }

        client.set_multisig_config(&harness.owner, &threshold, &signers_vec, &true);

        let payee = Address::generate(env);
        let tx_hash = String::from_str(env, "tx_non_signer_test");
        let req_id = client.propose_payment(
            &harness.owner,
            &payee,
            &500i128,
            &harness.token_id,
            &tx_hash,
        );

        // Generate non-signer
        let outsider = Address::generate(env);
        let res = client.try_approve_payment(&outsider, &req_id);
        prop_assert_eq!(res, Err(Ok(PaymentError::NotASigner)));
    }
}
