    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger as _};
    use soroban_sdk::{token, vec, Address, Env, String, Vec};

    fn create_token_contract(e: &Env, admin: &Address) -> Address {
        e.register_stellar_asset_contract(admin.clone())
    }

    // ── Admin Tests ─────────────────────────────────────────

    #[test]
    fn test_init_and_owner() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);

        let version = client.init(&owner);
        assert_eq!(version, CONTRACT_VERSION);
        assert_eq!(client.get_owner(), owner);
        assert_eq!(client.get_payment_count(), 0);
    }

    #[test]
    fn test_init_twice_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);

        let _ = client.init(&owner);
        // v27 client try_ variant surfaces the exact contract error
        assert_eq!(
            client.try_init(&owner),
            Err(Ok(PaymentError::AlreadyInitialized))
        );
    }

    #[test]
    fn test_transfer_ownership() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let new_owner = Address::generate(&env);

        let now = env.ledger().timestamp();
        let _ = client.init(&owner);

        // transfer_ownership is now a two-step proposal: the owner does not
        // change until the proposed new owner accepts after the timelock.
        client.transfer_ownership(&owner, &new_owner);
        assert_eq!(client.get_owner(), owner);

        env.ledger().set_timestamp(now + 86401);
        client.accept_ownership(&new_owner);
        assert_eq!(client.get_owner(), new_owner);
    }

    #[test]
    #[should_panic]
    fn test_unauthorized_transfer_ownership_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let rando = Address::generate(&env);

        let _ = client.init(&owner);
        client.transfer_ownership(&rando, &rando); // should panic
    }

    // ── Payment Record Tests ────────────────────────────────

    #[test]
    fn test_record_payment() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1000);
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);

        let _ = client.init(&owner);

        let id = client.record_payment(
            &payer,
            &payee,
            &1000i128,
            &sac,
            &String::from_str(&env, "tx_hash_abc"),
            &String::from_str(&env, "test payment"),
        );
        assert_eq!(id, 1);
        assert_eq!(client.get_payment_count(), 1);

        let payment = client.get_payment(&1);
        assert_eq!(payment.payer, payer);
        assert_eq!(payment.payee, payee);
        assert_eq!(payment.amount, 1000);
        assert_eq!(payment.tx_hash, String::from_str(&env, "tx_hash_abc"));
        assert!(payment.timestamp > 0);
    }

    #[test]
    fn test_record_payment_zero_amount_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);

        let _ = client.init(&owner);
        assert_eq!(
            client.try_record_payment(
                &payer,
                &payee,
                &0i128,
                &sac,
                &String::from_str(&env, "tx"),
                &String::from_str(&env, ""),
            ),
            Err(Ok(PaymentError::InvalidAmount))
        );
    }

    #[test]
    fn test_cancel_payment_by_owner() {
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
            &500i128,
            &sac,
            &String::from_str(&env, "tx"),
            &String::from_str(&env, ""),
        );

        client.cancel_payment(&owner, &1);
        let payment = client.get_payment(&1);
        assert!(payment.cancelled);
        assert_eq!(payment.amount, 500); // amount is preserved, not zeroed
    }

    // ── Escrow Tests ────────────────────────────────────────

    #[test]
    fn test_create_and_release_escrow() {
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

        let escrow_id = client.create_escrow(
            &depositor,
            &beneficiary,
            &Option::<Address>::None,
            &1000i128,
            &sac,
            &(env.ledger().timestamp() + 86400),
            &String::from_str(&env, "escrow test"),
        );
        assert_eq!(escrow_id, 1);
        assert_eq!(client.get_escrow_count(), 1);

        let escrow = client.get_escrow(&1);
        assert_eq!(escrow.depositor, depositor);
        assert_eq!(escrow.beneficiary, beneficiary);
        assert_eq!(escrow.amount, 1000);
        assert!(!escrow.released);

        client.release_escrow(&owner, &1);
        let escrow2 = client.get_escrow(&1);
        assert!(escrow2.released);
        assert!(escrow2.claimed);
    }

    #[test]
    fn test_claim_escrow_after_deadline() {
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

        let now = env.ledger().timestamp();
        let _ = client.init(&owner);
        let _ = client.create_escrow(
            &depositor,
            &beneficiary,
            &None::<Address>,
            &500i128,
            &sac,
            &(now + 100),
            &String::from_str(&env, "deadline test"),
        );

        env.ledger().set_timestamp(now + 200);

        client.claim_escrow(&beneficiary, &1);
        let escrow = client.get_escrow(&1);
        assert!(escrow.claimed);
    }

    #[test]
    fn test_reentrancy_lock_released_after_guarded_ops() {
        // MEDIUM-4 regression: every token-moving operation must release the
        // REENTRANCY_LOCK after the cross-contract transfer completes, so
        // subsequent operations in the same transaction are not blocked.
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

        let now = env.ledger().timestamp();
        let _ = client.init(&owner);
        let _ = client.create_escrow(
            &depositor,
            &beneficiary,
            &None::<Address>,
            &500i128,
            &sac,
            &(now + 100),
            &String::from_str(&env, "reentrancy test"),
        );

        env.ledger().set_timestamp(now + 200);

        // Claim — the guarded operation. Must release the lock on success.
        client.claim_escrow(&beneficiary, &1);

        // A second token-moving operation in the same env must NOT hit
        // ReentrantCall — proving the lock was released.
        let _ = client.create_escrow(
            &depositor,
            &beneficiary,
            &None::<Address>,
            &300i128,
            &sac,
            &(now + 200),
            &String::from_str(&env, "second escrow"),
        );
        env.ledger().set_timestamp(now + 300);
        client.claim_escrow(&beneficiary, &2);

        // Lock must be false after all guarded operations.
        let locked: bool = env.as_contract(&contract_id, || {
            env.storage()
                .instance()
                .get(&REENTRANCY_LOCK)
                .unwrap_or(false)
        });
        assert!(!locked);
    }

    #[test]
    #[should_panic]
    fn test_claim_escrow_before_deadline_fails() {
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

        let now = env.ledger().timestamp();
        let _ = client.init(&owner);
        let _ = client.create_escrow(
            &depositor,
            &beneficiary,
            &None::<Address>,
            &500i128,
            &sac,
            &(now + 10000),
            &String::from_str(&env, "future"),
        );

        client.claim_escrow(&beneficiary, &1); // should panic before deadline
    }

    // ── Stream Tests ───────────────────────────────────────

    #[test]
    fn test_create_and_claim_stream() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        let creator = Address::generate(&env);
        let recipient = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);
        let sac_client = token::StellarAssetClient::new(&env, &sac);
        sac_client.mint(&creator, &10_000i128);

        let now = env.ledger().timestamp();
        let _ = client.init(&owner);

        let stream_id = client.create_stream(
            &creator,
            &recipient,
            &1000i128,
            &sac,
            &now,
            &(now + 1000),
            &String::from_str(&env, "salary"),
        );
        assert_eq!(stream_id, 1);
        assert_eq!(client.get_stream_count(), 1);

        let stream = client.get_stream(&1);
        assert_eq!(stream.total_amount, 1000);
        assert_eq!(stream.claimed_amount, 0);
        assert!(!stream.cancelled);

        env.ledger().set_timestamp(now + 500);
        let claimed = client.claim_stream(&recipient, &1);
        assert_eq!(claimed, 500);

        env.ledger().set_timestamp(now + 2000);
        let claimed2 = client.claim_stream(&recipient, &1);
        assert_eq!(claimed2, 500);

        let stream_final = client.get_stream(&1);
        assert_eq!(stream_final.claimed_amount, 1000);
    }

    #[test]
    fn test_cancel_stream_returns_unvested() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        let creator = Address::generate(&env);
        let recipient = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);
        let sac_client = token::StellarAssetClient::new(&env, &sac);
        sac_client.mint(&creator, &10_000i128);

        let now = env.ledger().timestamp();
        let _ = client.init(&owner);
        let _ = client.create_stream(
            &creator,
            &recipient,
            &1000i128,
            &sac,
            &now,
            &(now + 1000),
            &String::from_str(&env, "cancel test"),
        );

        env.ledger().set_timestamp(now + 200);
        let returned = client.cancel_stream(&creator, &1);
        assert_eq!(returned, 800);

        let stream = client.get_stream(&1);
        assert!(stream.cancelled);
    }

    // ── Vesting Overflow (AUDIT LOW-1 / issue #691) ─────────

    /// `i128::MAX * 2` overflows. The old code returned `0` here, silently
    /// under-vesting a stream that is 50% through its schedule.
    #[test]
    fn test_compute_vested_overflow_is_exact_and_not_zero() {
        let total = i128::MAX;
        let start = 1_000u64;
        let end = start + 4; // duration 4 seconds
        let now = start + 2; // elapsed 2 seconds → exactly 50%

        let vested = compute_vested(total, start, end, now);

        assert!(vested > 0, "overflow must not collapse vesting to zero");
        assert_eq!(vested, total / 2, "exact half of the stream must vest");
        assert!(vested <= total, "vested amount must never exceed the total");
    }

    /// The widened multiply stays exact for quotients that are not a clean
    /// fraction, and never exceeds the stream total (INV-5).
    #[test]
    fn test_compute_vested_overflow_is_bounded_and_monotonic() {
        let total = i128::MAX;
        let start = 0u64;
        let end = 9u64;

        assert_eq!(compute_vested(total, start, end, 3), total / 3);

        let mut previous = 0i128;
        for now in 1..=end {
            let vested = compute_vested(total, start, end, now);
            assert!(vested <= total, "vesting exceeded the stream total");
            assert!(vested >= previous, "vesting must be non-decreasing");
            previous = vested;
        }
        assert_eq!(previous, total);
    }

    /// `now >= end_time` short-circuits to the full amount even though the
    /// multiply for a fully elapsed stream would overflow.
    #[test]
    fn test_compute_vested_overflow_fully_vests_at_end() {
        let total = i128::MAX;
        assert_eq!(compute_vested(total, 10, 20, 20), total);
        assert_eq!(compute_vested(total, 10, 20, 1_000), total);
    }

    /// End-to-end: a stream whose vesting multiply overflows must still pay the
    /// recipient the correct remaining balance at every step.
    #[test]
    fn test_claim_stream_with_overflowing_vesting_pays_correct_balance() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        let creator = Address::generate(&env);
        let recipient = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);
        let sac_client = token::StellarAssetClient::new(&env, &sac);
        sac_client.mint(&creator, &i128::MAX);

        let now = env.ledger().timestamp();
        let _ = client.init(&owner);

        let stream_id = client.create_stream(
            &creator,
            &recipient,
            &i128::MAX,
            &sac,
            &now,
            &(now + 4),
            &String::from_str(&env, "overflow"),
        );
        assert_eq!(stream_id, 1);

        // 50% through: the multiply (`MAX * 2`) overflows i128.
        env.ledger().set_timestamp(now + 2);
        let first = client.claim_stream(&recipient, &1);
        assert_eq!(first, i128::MAX / 2, "half of the stream must be claimable");
        assert!(first > 0, "claim must not silently pay nothing");

        // Fully vested: the remainder is exactly what has not been claimed.
        env.ledger().set_timestamp(now + 10);
        let second = client.claim_stream(&recipient, &1);
        assert_eq!(second, i128::MAX - (i128::MAX / 2));

        assert_eq!(client.get_stream(&1).claimed_amount, i128::MAX);
        let token_client = token::Client::new(&env, &sac);
        assert_eq!(token_client.balance(&recipient), i128::MAX);

        // Nothing is left to claim and the stream is not over-paid.
        let third = client.try_claim_stream(&recipient, &1);
        assert!(third.is_err(), "a fully claimed stream must reject further claims");
    }

    // ── Batch Tests ────────────────────────────────────────

    #[test]
    fn test_create_batch() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        let creator = Address::generate(&env);
        let p1 = Address::generate(&env);
        let p2 = Address::generate(&env);
        let p3 = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);

        let _ = client.init(&owner);

        let payees = vec![&env, p1.clone(), p2.clone(), p3.clone()];
        let amounts = vec![&env, 100i128, 200i128, 300i128];

        let result = client.create_batch(
            &creator,
            &payees,
            &amounts,
            &sac,
            &String::from_str(&env, "batch_tx_hash"),
        );
        assert_eq!(result.batch_id, 1);
        assert_eq!(client.get_batch_count(), 1);
        assert_eq!(client.get_payment_count(), 3);
        assert_eq!(result.successful, 3);
        assert_eq!(result.failed, 0);

        let batch = client.get_batch(&1);
        assert_eq!(batch.total_amount, 600);
        assert_eq!(batch.total_recipients, 3);
        assert_eq!(batch.payment_ids.len(), 3);

        // Query batch payments (#742: bounded, newest-first, with a flag)
        let batch_payments = client.get_payments_by_batch(&1);
        assert_eq!(batch_payments.total, 3);
        assert!(!batch_payments.truncated);
        assert_eq!(batch_payments.items.len(), 3);
    }

    #[test]
    #[should_panic]
    fn test_empty_batch_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        let creator = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);

        let _ = client.init(&owner);

        let payees = Vec::<Address>::new(&env);
        let amounts = Vec::<i128>::new(&env);
        client.create_batch(
            &creator,
            &payees,
            &amounts,
            &sac,
            &String::from_str(&env, "empty"),
        );
    }

    // ── Pause Tests ────────────────────────────────────────

    #[test]
    fn test_pause_blocks_record_payment() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);

        let _ = client.init(&owner);
        assert!(!client.is_paused());

        client.emergency_pause_all(&owner);
        assert!(client.is_paused());

        // record_payment should fail when paused
        let result = client.try_record_payment(
            &payer,
            &payee,
            &100i128,
            &sac,
            &String::from_str(&env, "tx"),
            &String::from_str(&env, ""),
        );
        assert!(result.is_err());

        client.emergency_unpause_all(&owner);
        assert!(!client.is_paused());

        // Should work after unpause
        let id = client.record_payment(
            &payer,
            &payee,
            &100i128,
            &sac,
            &String::from_str(&env, "tx2"),
            &String::from_str(&env, ""),
        );
        assert_eq!(id, 1);
    }

    #[test]
    #[should_panic]
    fn test_pause_blocks_create_escrow() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let depositor = Address::generate(&env);
        let beneficiary = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);
        let sac_client = token::StellarAssetClient::new(&env, &sac);
        sac_client.mint(&depositor, &1000i128);

        let _ = client.init(&owner);
        client.emergency_pause_all(&owner);

        client.create_escrow(
            &depositor,
            &beneficiary,
            &None::<Address>,
            &100i128,
            &sac,
            &(env.ledger().timestamp() + 100),
            &String::from_str(&env, "paused"),
        );
    }

    #[test]
    #[should_panic]
    fn test_pause_blocks_create_stream() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let creator = Address::generate(&env);
        let recipient = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);
        let sac_client = token::StellarAssetClient::new(&env, &sac);
        sac_client.mint(&creator, &1000i128);

        let now = env.ledger().timestamp();
        let _ = client.init(&owner);
        client.emergency_pause_all(&owner);

        client.create_stream(
            &creator,
            &recipient,
            &500i128,
            &sac,
            &now,
            &(now + 1000),
            &String::from_str(&env, "paused"),
        );
    }

    // ── Re-cancellation test ───────────────────────────────

    #[test]
    #[should_panic]
    fn test_cancel_already_cancelled_fails() {
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
            &String::from_str(&env, ""),
        );

        client.cancel_payment(&owner, &1);
        assert!(client.get_payment(&1).cancelled);

        // Second cancel should panic with PaymentAlreadyCancelled
        client.cancel_payment(&owner, &1);
    }

    // ── Multisig Tests ─────────────────────────────────────

    #[test]
    fn test_multisig_configure_and_propose() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let signer1 = Address::generate(&env);
        let signer2 = Address::generate(&env);
        let signer3 = Address::generate(&env);
        let payee = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);

        let _ = client.init(&owner);

        let signers = vec![&env, signer1.clone(), signer2.clone(), signer3.clone()];
        client.set_multisig_config(&owner, &2u32, &signers, &true);

        let config = client.get_multisig_config();
        assert!(config.is_some());
        let cfg = config.unwrap();
        assert_eq!(cfg.threshold, 2);
        assert!(cfg.enabled);

        let proposal_id = client.propose_payment(
            &signer1,
            &payee,
            &1000i128,
            &sac,
            &String::from_str(&env, "tx1"),
        );
        assert_eq!(proposal_id, 1);

        let req = client.get_approval_request(&1);
        assert!(req.is_some());
        assert!(!req.unwrap().executed);
    }

    #[test]
    fn test_multisig_approve_and_execute() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let signer1 = Address::generate(&env);
        let signer2 = Address::generate(&env);
        let signer3 = Address::generate(&env);
        let payee = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);

        let _ = client.init(&owner);

        let signers = vec![&env, signer1.clone(), signer2.clone(), signer3.clone()];
        client.set_multisig_config(&owner, &2u32, &signers, &true);

        let _ = client.propose_payment(
            &signer1,
            &payee,
            &1000i128,
            &sac,
            &String::from_str(&env, "tx1"),
        );

        let threshold_met = client.approve_payment(&signer2, &1);
        assert!(!threshold_met);

        let threshold_met = client.approve_payment(&signer3, &1);
        assert!(threshold_met);

        let pay_id = client.execute_approved_payment(&signer1, &1);
        assert_eq!(pay_id, 1);
        assert_eq!(client.get_payment_count(), 1);
    }

    // ── Spending Limit Tests ───────────────────────────────

    #[test]
    fn test_spending_limit_approved() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let user = Address::generate(&env);

        let _ = client.init(&owner);
        client.set_spending_limit(
            &owner,
            &user,
            &1000i128,
            &5000i128,
            &(env.ledger().timestamp() + 86400),
            &true,
        );

        let result = client.check_spending(&user, &500i128);
        assert!(matches!(result, SpendCheckResult::Approved));
    }

    #[test]
    fn test_spending_limit_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let user = Address::generate(&env);

        let _ = client.init(&owner);
        client.set_spending_limit(&owner, &user, &100i128, &1000i128, &0u64, &true);

        let result = client.check_spending(&user, &500i128);
        assert!(matches!(result, SpendCheckResult::Rejected));
    }

    #[test]
    fn test_escalation_rules() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let user = Address::generate(&env);

        let _ = client.init(&owner);
        client.configure_escalation(&owner, &100i128, &1000i128, &true);

        let result = client.check_spending(&user, &2000i128);
        assert!(matches!(result, SpendCheckResult::Escalated));
    }

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

    // ── Recurring Payment Tests ─────────────────────────────

    #[test]
    fn test_create_recurring_payment() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let creator = Address::generate(&env);
        let payee = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);

        let _ = client.init(&owner);

        let id = client.create_recurring(
            &creator,
            &payee,
            &100i128,
            &sac,
            &ScheduleType::Daily,
            &10u32,
            &String::from_str(&env, "subscription"),
        );
        assert_eq!(id, 1);
        assert_eq!(client.get_recurring_count(), 1);

        let rec = client.get_recurring(&1);
        assert!(rec.active);
    }

    #[test]
    fn test_execute_recurring_payment() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let creator = Address::generate(&env);
        let payee = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);

        let now = env.ledger().timestamp();
        let _ = client.init(&owner);

        let id = client.create_recurring(
            &creator,
            &payee,
            &100i128,
            &sac,
            &ScheduleType::Daily,
            &5u32,
            &String::from_str(&env, "sub"),
        );

        env.ledger().set_timestamp(now + 86400 + 1);
        let pay_id = client.execute_recurring(&creator, &id);
        assert_eq!(pay_id, 1);
        assert_eq!(client.get_payment_count(), 1);
    }

    #[test]
    fn test_cancel_recurring_payment() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let creator = Address::generate(&env);
        let payee = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);

        let _ = client.init(&owner);
        let id = client.create_recurring(
            &creator,
            &payee,
            &100i128,
            &sac,
            &ScheduleType::Daily,
            &10u32,
            &String::from_str(&env, "sub"),
        );

        client.cancel_recurring(&creator, &id);
        let rec = client.get_recurring(&id);
        assert!(!rec.active);
    }

    // ── Fee Config Tests ───────────────────────────────────

    #[test]
    fn test_set_and_get_fee_config() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);

        let _ = client.init(&owner);
        client.set_fee_config(&owner, &50u32, &100u32, &200u32, &10i128, &1i128, &true);

        let config = client.get_fee_config();
        assert!(config.is_some());
        let cfg = config.unwrap();
        assert_eq!(cfg.payment_fee_bps, 50);
        assert!(cfg.enabled);
    }

    #[test]
    fn test_calculate_fee() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);

        let fee = client.calculate_fee(&1000i128, &100u32);
        assert_eq!(fee, 10);

        let fee = client.calculate_fee(&0i128, &100u32);
        assert_eq!(fee, 0);
    }

    // ── Timelocked Action Tests ────────────────────────────

    #[test]
    fn test_timelocked_action_propose_and_execute() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);

        let now = env.ledger().timestamp();
        let _ = client.init(&owner);

        let id = client.propose_timelocked_action(
            &owner,
            &String::from_str(&env, "set_fee_config"),
            &String::from_str(&env, "set_fee_config"),
            &String::from_str(&env, "params"),
        );
        assert_eq!(id, 1);
        assert_eq!(client.get_timelock_count(), 1);

        let action = client.get_timelocked_action(&1);
        assert!(!action.executed);

        env.ledger().set_timestamp(now + TMLOCK_DELAY + 1);
        client.execute_timelocked_action(&1);

        let action = client.get_timelocked_action(&1);
        assert!(action.executed);
    }

    #[test]
    fn test_timelocked_action_cancel() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);

        let _ = client.init(&owner);
        let id = client.propose_timelocked_action(
            &owner,
            &String::from_str(&env, "pause"),
            &String::from_str(&env, "pause"),
            &String::from_str(&env, ""),
        );

        client.cancel_timelocked_action(&owner, &id);
        let action = client.get_timelocked_action(&id);
        assert!(action.executed);
    }

    // ── Governance Tests ───────────────────────────────────

    #[test]
    fn test_governance_proposal_vote_execute() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let proposer = Address::generate(&env);
        let voter = Address::generate(&env);

        let now = env.ledger().timestamp();
        let _ = client.init(&owner);

        client.configure_governance(&owner, &0i128, &1000u64, &51u32, &true);

        // min_proposal_deposit = 0, so any deposit_asset/amount works
        let deposit_asset = Address::generate(&env);
        let pid = client.create_proposal(
            &proposer,
            &String::from_str(&env, "Test Proposal"),
            &String::from_str(&env, "A test description"),
            &String::from_str(&env, "upgrade"),
            &String::from_str(&env, "execute_upgrade"),
            &String::from_str(&env, "hash"),
            &deposit_asset,
            &0i128,
        );
        assert_eq!(pid, 1);
        assert_eq!(client.get_proposal_count(), 1);

        // Each voter contributes exactly 1 vote (no self-reported weight)
        client.vote_on_proposal(&voter, &1, &true);

        let prop = client.get_proposal(&1);
        assert_eq!(prop.yes_votes, 1);
        assert_eq!(prop.no_votes, 0);

        env.ledger().set_timestamp(now + 2000);
        let passed = client.execute_proposal(&1);
        assert!(passed);
    }
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

    // ── Orchestration Tests ────────────────────────────────

    #[test]
    fn test_emergency_pause_all() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);

        let _ = client.init(&owner);

        // Pause all (even without emitter linked, pauses OphirPay)
        client.emergency_pause_all(&owner);
        assert!(client.is_paused());

        // Unpause all
        client.emergency_unpause_all(&owner);
        assert!(!client.is_paused());
    }

    #[test]
    fn test_set_and_get_emitter() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let emitter = Address::generate(&env);

        let _ = client.init(&owner);
        client.set_emitter(&owner, &emitter);

        let stored = client.get_emitter();
        assert_eq!(stored.unwrap(), emitter);
    }

    // ── Notification Hook Tests ────────────────────────────

    #[test]
    fn test_register_and_unregister_hook() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let subscriber = Address::generate(&env);

        let _ = client.init(&owner);

        let hid = client.register_hook(
            &subscriber,
            &String::from_str(&env, "payment_recorded"),
            &String::from_str(&env, "https://example.com/webhook"),
        );
        assert_eq!(hid, 1);
        assert_eq!(client.get_hook_count(), 1);

        // Get hooks by event type
        let hooks = client.get_hooks_by_event(&String::from_str(&env, "payment_recorded"));
        assert_eq!(hooks.len(), 1);

        // Get subscriber hooks (#742: bounded, newest-first, with a flag)
        let sub_hooks = client.get_subscriber_hooks(&subscriber);
        assert_eq!(sub_hooks.total, 1);
        assert!(!sub_hooks.truncated);
        assert_eq!(sub_hooks.items.len(), 1);
        assert!(sub_hooks.items.get(0).unwrap().active);

        // Unregister
        client.unregister_hook(&subscriber, &1);

        let sub_hooks = client.get_subscriber_hooks(&subscriber);
        assert!(!sub_hooks.items.get(0).unwrap().active);
    }

    #[test]
    fn test_get_hooks_by_event_empty() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);

        let _ = client.init(&owner);
        let hooks = client.get_hooks_by_event(&String::from_str(&env, "nonexistent"));
        assert_eq!(hooks.len(), 0);
    }

    // ── Policy Versioning Tests ────────────────────────────

    #[test]
    fn test_fee_config_versioning() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);

        let _ = client.init(&owner);

        // Set config twice
        client.set_fee_config(&owner, &100u32, &200u32, &300u32, &10i128, &1i128, &true);
        client.set_fee_config(&owner, &150u32, &250u32, &350u32, &20i128, &2i128, &true);

        // Check current config reflects latest
        let current = client.get_fee_config().unwrap();
        assert_eq!(current.payment_fee_bps, 150);

        // Check version history
        let history = client.get_fee_config_history();
        assert_eq!(history.len(), 2);

        // Check specific version
        let v1 = client.get_fee_config_at_version(&1);
        assert_eq!(v1.unwrap().config.payment_fee_bps, 100);
    }

    #[test]
    fn test_multisig_config_versioning() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let s1 = Address::generate(&env);
        let s2 = Address::generate(&env);
        let s3 = Address::generate(&env);

        let _ = client.init(&owner);

        let signers_v1 = vec![&env, s1.clone(), s2.clone()];
        client.set_multisig_config(&owner, &2u32, &signers_v1, &true);

        let signers_v2 = vec![&env, s1.clone(), s2.clone(), s3.clone()];
        client.set_multisig_config(&owner, &3u32, &signers_v2, &true);

        let history = client.get_multisig_config_history();
        assert_eq!(history.len(), 2);
    }

    // ── Two-Step Ownership Tests ───────────────────────────

    #[test]
    fn test_two_step_ownership_transfer() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let new_owner = Address::generate(&env);

        let now = env.ledger().timestamp();
        let _ = client.init(&owner);

        // Propose transfer
        client.transfer_ownership(&owner, &new_owner);

        // Check pending owner
        let pending = client.get_pending_owner();
        assert!(pending.is_some());

        // Cannot accept before timelock
        // (skip — this panics, test separately)

        // Advance past 24h
        env.ledger().set_timestamp(now + 86401);

        // Accept
        client.accept_ownership(&new_owner);

        // Verify
        assert_eq!(client.get_owner(), new_owner);
        assert!(client.get_pending_owner().is_none());
    }

    #[test]
    #[should_panic]
    fn test_accept_ownership_before_timelock_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let new_owner = Address::generate(&env);

        let _ = client.init(&owner);
        client.transfer_ownership(&owner, &new_owner);
        // Should panic — timelock hasn't elapsed
        client.accept_ownership(&new_owner);
    }

    #[test]
    fn test_cancel_ownership_transfer() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let new_owner = Address::generate(&env);

        let _ = client.init(&owner);
        client.transfer_ownership(&owner, &new_owner);
        assert!(client.get_pending_owner().is_some());

        client.cancel_ownership_transfer(&owner);
        assert!(client.get_pending_owner().is_none());
    }

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

    /// INV-10: Fee config version history is capped at 100 entries
    #[test]
    fn test_fee_version_history_capped() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        let _ = client.init(&owner);

        // Create 150 fee config changes
        for i in 0u32..150u32 {
            client.set_fee_config(&owner, &(100 + i), &200, &300, &1000i128, &100i128, &true);
        }

        let history = client.get_fee_config_history();
        // Should return at most 100 entries
        assert!(history.len() <= 100);
        // The most recent should have version 150
        assert!(history.len() > 0);
        let latest = history.get(0).unwrap();
        assert_eq!(latest.version, 150);

        // Single-version lookup should still work for older versions
        let old_version = client.get_fee_config_at_version(&10);
        assert!(old_version.is_some());
        assert_eq!(old_version.unwrap().version, 10);
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

    // ── Multisig Tests ────────────────────────────────────────

    #[test]
    fn test_multisig_threshold_enforcement() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        let signer1 = Address::generate(&env);
        let signer2 = Address::generate(&env);
        let signer3 = Address::generate(&env);
        let payee = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);

        let _ = client.init(&owner);

        // Configure 2-of-3 multisig
        let signers = vec![&env, signer1.clone(), signer2.clone(), signer3.clone()];
        client.set_multisig_config(&owner, &2u32, &signers, &true);

        let config = client.get_multisig_config();
        assert!(config.is_some());
        let cfg = config.unwrap();
        assert_eq!(cfg.threshold, 2);
        assert!(cfg.enabled);

        // Propose payment
        let proposal_id = client.propose_payment(
            &signer1,
            &payee,
            &1000i128,
            &sac,
            &String::from_str(&env, "tx_proposal_1"),
        );
        assert_eq!(proposal_id, 1);

        // One approval — not enough yet
        let met = client.approve_payment(&signer1, &1);
        assert!(!met);

        // Second approval — threshold met
        let met2 = client.approve_payment(&signer2, &1);
        assert!(met2);

        // Execute
        let pay_id = client.execute_approved_payment(&signer1, &1);
        assert_eq!(pay_id, 1);
        assert_eq!(client.get_payment_count(), 1);
    }

    #[test]
    fn test_multisig_duplicate_approval_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        let signer1 = Address::generate(&env);
        let signer2 = Address::generate(&env);
        let payee = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);

        let _ = client.init(&owner);

        let signers = vec![&env, signer1.clone(), signer2.clone()];
        client.set_multisig_config(&owner, &2u32, &signers, &true);

        client.propose_payment(
            &signer1,
            &payee,
            &500i128,
            &sac,
            &String::from_str(&env, "tx"),
        );

        // First approval
        client.approve_payment(&signer1, &1);

        // Duplicate approval should fail
        let result = client.try_approve_payment(&signer1, &1);
        assert!(result.is_err());
    }

    // ── Spending Limit Tests ──────────────────────────────────

    #[test]
    fn test_spending_limit_expiry_rejects_spend() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);

        let now = env.ledger().timestamp();
        let _ = client.init(&owner);

        // Set spending limit that expires in 100 seconds
        client.set_spending_limit(&owner, &payer, &10000i128, &50000i128, &(now + 100), &true);

        let limit = client.get_spending_limit(&payer);
        assert!(limit.is_some());
        assert!(limit.unwrap().is_active);

        // Spend within expiry — should succeed
        let id = client.atomic_spend(
            &payer,
            &payee,
            &500i128,
            &sac,
            &String::from_str(&env, "tx1"),
            &String::from_str(&env, "valid"),
        );
        assert_eq!(id, 1);

        // Advance past expiry
        env.ledger().set_timestamp(now + 200);

        // Spend after expiry — should fail
        let result = client.try_atomic_spend(
            &payer,
            &payee,
            &500i128,
            &sac,
            &String::from_str(&env, "tx2"),
            &String::from_str(&env, "expired"),
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_atomic_spend_updates_spend_counters() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);

        let _ = client.init(&owner);

        client.set_spending_limit(&owner, &payer, &5000i128, &10000i128, &0, &true);

        // Spend 2000
        client.atomic_spend(
            &payer,
            &payee,
            &2000i128,
            &sac,
            &String::from_str(&env, "tx_a"),
            &String::from_str(&env, "spend 1"),
        );

        let limit = client.get_spending_limit(&payer);
        assert_eq!(limit.unwrap().current_daily_spend, 2000);

        // Spend another 3000 = total 5000 (at limit)
        client.atomic_spend(
            &payer,
            &payee,
            &3000i128,
            &sac,
            &String::from_str(&env, "tx_b"),
            &String::from_str(&env, "spend 2"),
        );

        // Next spend exceeds daily limit — should fail
        let result = client.try_atomic_spend(
            &payer,
            &payee,
            &1i128,
            &sac,
            &String::from_str(&env, "tx_c"),
            &String::from_str(&env, "over limit"),
        );
        assert!(result.is_err());
    }

    // ── New Error Path Tests (governance + reentrancy) ──

    /// GOV-1: Double-voting is rejected with AlreadyVoted error
    #[test]
    fn test_double_vote_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let proposer = Address::generate(&env);
        let voter = Address::generate(&env);

        let _ = client.init(&owner);
        client.configure_governance(&owner, &0i128, &1000u64, &51u32, &true);

        let deposit_asset = Address::generate(&env);
        let _ = client.create_proposal(
            &proposer,
            &String::from_str(&env, "P"),
            &String::from_str(&env, "D"),
            &String::from_str(&env, "upgrade"),
            &String::from_str(&env, "t"),
            &String::from_str(&env, "d"),
            &deposit_asset,
            &0i128,
        );

        // First vote succeeds
        client.vote_on_proposal(&voter, &1, &true);

        // Second vote from same voter should fail with AlreadyVoted
        let result = client.try_vote_on_proposal(&voter, &1, &false);
        assert!(result.is_err());
    }

    /// GOV-2: Proposal creation fails when deposit is below minimum
    #[test]
    fn test_deposit_too_low_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let proposer = Address::generate(&env);

        let _ = client.init(&owner);
        // Set min_proposal_deposit to 100
        client.configure_governance(&owner, &100i128, &1000u64, &51u32, &true);

        let deposit_asset = Address::generate(&env);
        // Try with deposit_amount = 50 (below 100 minimum)
        let result = client.try_create_proposal(
            &proposer,
            &String::from_str(&env, "P"),
            &String::from_str(&env, "D"),
            &String::from_str(&env, "upgrade"),
            &String::from_str(&env, "t"),
            &String::from_str(&env, "d"),
            &deposit_asset,
            &50i128,
        );
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

    // ── Storage-Bump Policy Tests ────────────────────────────────

    #[test]
    fn test_get_bump_policy_returns_constants() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let _ = client.init(&owner);

        let (min, max, maintenance) = client.get_bump_policy();
        assert_eq!(min, 5_000);
        assert_eq!(max, 50_000);
        assert_eq!(maintenance, 100_000);
    }

    #[test]
    fn test_bump_storage_noop_on_empty_ranges() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let _ = client.init(&owner);

        let zero = (0u64, 0u64);
        let bumped = client.bump_storage(
            &zero, &zero, &zero, &zero, &zero, &zero, &zero, &zero, &zero,
        );
        // No entries exist yet, so nothing should be bumped.
        assert_eq!(bumped, 0);
    }

    #[test]
    fn test_bump_storage_extends_existing_entries() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1_000_000);
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);

        let _ = client.init(&owner);

        // Record a payment so there's a persistent entry to bump.
        client.record_payment(
            &payer,
            &payee,
            &1000i128,
            &sac,
            &String::from_str(&env, "tx1"),
            &String::from_str(&env, "meta1"),
        );

        // Bump the payment range.
        let bumped = client.bump_storage(
            &(1u64, 1u64),
            &(0u64, 0u64),
            &(0u64, 0u64),
            &(0u64, 0u64),
            &(0u64, 0u64),
            &(0u64, 0u64),
            &(0u64, 0u64),
            &(0u64, 0u64),
            &(0u64, 0u64),
        );
        assert_eq!(bumped, 1);

        // Verify the payment still exists and is readable.
        let p = client.get_payment(&1);
        assert_eq!(p.id, 1);
        assert_eq!(p.amount, 1000);
    }

    #[test]
    fn test_bump_storage_gas_cost_accounting() {
        // Verify that bump_storage is callable and returns without panic.
        // The actual gas cost is bounded by the number of entries scanned;
        // an empty range should cost ~5 000 instructions (instance bump only).
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let _ = client.init(&owner);

        let zero = (0u64, 0u64);
        // Empty ranges — minimal gas.
        let bumped = client.bump_storage(
            &zero, &zero, &zero, &zero, &zero, &zero, &zero, &zero, &zero,
        );
        assert_eq!(bumped, 0);

        // A single-entry bump should also succeed without excessive gas.
        // (If gas exceeds budget the test will panic / OOG.)
        let bumped2 = client.bump_storage(
            &(1u64, 1u64),
            &(1u64, 1u64),
            &(1u64, 1u64),
            &(1u64, 1u64),
            &(1u64, 1u64),
            &(1u64, 1u64),
            &(1u64, 1u64),
            &(1u64, 1u64),
            &(1u64, 1u64),
        );
        // No entries exist, so 0 bumped — but the call succeeded.
        assert_eq!(bumped2, 0);
    }

    #[test]
    fn test_bump_storage_multi_type_entries() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1_000_000);
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);

        let _ = client.init(&owner);

        // Create 2 payments and 1 batch (2 payments in batch).
        client.record_payment(
            &payer,
            &payee,
            &500i128,
            &sac,
            &String::from_str(&env, "tx_a"),
            &String::from_str(&env, "m_a"),
        );
        client.record_payment(
            &payer,
            &payee,
            &300i128,
            &sac,
            &String::from_str(&env, "tx_b"),
            &String::from_str(&env, "m_b"),
        );

        let mut payees = Vec::new(&env);
        payees.push_back(payee.clone());
        let mut amounts = Vec::new(&env);
        amounts.push_back(200i128);
        client.create_batch(
            &payer,
            &payees,
            &amounts,
            &sac,
            &String::from_str(&env, "batch_tx"),
        );

        // Now bump payments 1–2 and batch 1.
        let bumped = client.bump_storage(
            &(1u64, 2u64),  // payments
            &(0u64, 0u64),  // escrows
            &(0u64, 0u64),  // streams
            &(1u64, 1u64),  // batches
            &(0u64, 0u64),  // audit
            &(0u64, 0u64),  // timelocks
            &(0u64, 0u64),  // proposals
            &(0u64, 0u64),  // approvals
            &(0u64, 0u64),  // hooks
        );
        // 2 payments + 1 batch = 3 bumped
        assert_eq!(bumped, 3);

        // Verify data integrity after bump.
        let p1 = client.get_payment(&1);
        assert_eq!(p1.amount, 500);
        let p2 = client.get_payment(&2);
        assert_eq!(p2.amount, 300);
        let b1 = client.get_batch(&1);
        assert_eq!(b1.total_amount, 200);
    }

    // ── Bounded readers (issue #742) ────────────────────────

    /// A subscriber can register an unbounded number of hooks, so the reader
    /// must cap the result and say so rather than walking the whole index.
    #[test]
    fn test_get_subscriber_hooks_caps_and_flags_truncation() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let subscriber = Address::generate(&env);
        let _ = client.init(&owner);

        let overflow_count = MAX_READER_ENTRIES + 5;
        for i in 0..overflow_count {
            let hid = client.register_hook(
                &subscriber,
                &String::from_str(&env, "payment_recorded"),
                &String::from_str(&env, "https://example.com/webhook"),
            );
            assert_eq!(hid, (i + 1) as u64);
        }

        let result = client.get_subscriber_hooks(&subscriber);

        // Cap enforced, truncation reported, and the total stays accurate so a
        // caller can page rather than guess.
        assert_eq!(result.items.len(), MAX_READER_ENTRIES);
        assert_eq!(result.total, overflow_count);
        assert!(result.truncated);

        // Most recent first: the last hook registered leads the list.
        assert_eq!(result.items.get(0).unwrap().id, overflow_count as u64);
        assert_eq!(
            result
                .items
                .get(MAX_READER_ENTRIES - 1)
                .unwrap()
                .id,
            (overflow_count - MAX_READER_ENTRIES + 1) as u64,
        );
    }

    /// Exactly at the cap is a complete list, not a truncated one.
    #[test]
    fn test_get_subscriber_hooks_at_cap_is_not_truncated() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let subscriber = Address::generate(&env);
        let _ = client.init(&owner);

        for _ in 0..MAX_READER_ENTRIES {
            client.register_hook(
                &subscriber,
                &String::from_str(&env, "refund_processed"),
                &String::from_str(&env, "https://example.com/webhook"),
            );
        }

        let result = client.get_subscriber_hooks(&subscriber);
        assert_eq!(result.items.len(), MAX_READER_ENTRIES);
        assert_eq!(result.total, MAX_READER_ENTRIES);
        assert!(!result.truncated);
    }

    /// `create_batch` caps a batch at 100 recipients, but a batch written
    /// before that guard existed can hold more ids than the writer accepts
    /// today — the reader must still bound itself. The oversized record is
    /// injected directly into storage to model exactly that legacy shape.
    #[test]
    fn test_get_payments_by_batch_caps_and_flags_truncation() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1_000_000);
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);
        let _ = client.init(&owner);

        let overflow_count: u64 = (MAX_READER_ENTRIES + 5) as u64;
        for _ in 0..overflow_count {
            client.record_payment(
                &payer,
                &payee,
                &100i128,
                &sac,
                &String::from_str(&env, "tx_legacy"),
                &String::from_str(&env, "legacy batch entry"),
            );
        }

        let mut payment_ids = Vec::new(&env);
        for id in 1..=overflow_count {
            payment_ids.push_back(id);
        }
        let legacy_batch = BatchPayment {
            id: 1,
            creator: owner.clone(),
            total_recipients: overflow_count as u32,
            total_amount: (overflow_count as i128) * 100,
            asset: sac.clone(),
            timestamp: env.ledger().timestamp(),
            tx_hash: String::from_str(&env, "legacy_batch_tx"),
            payment_ids,
        };
        env.as_contract(&contract_id, || {
            env.storage()
                .persistent()
                .set(&(BATCH_KEY, 1u64), &legacy_batch);
        });

        let result = client.get_payments_by_batch(&1);
        assert_eq!(result.items.len(), MAX_READER_ENTRIES);
        assert_eq!(result.total, overflow_count as u32);
        assert!(result.truncated);
        // Newest first: the last payment recorded leads the list.
        assert_eq!(result.items.get(0).unwrap().id, overflow_count);
        assert_eq!(
            result.items.get(MAX_READER_ENTRIES - 1).unwrap().id,
            overflow_count - (MAX_READER_ENTRIES as u64) + 1,
        );
    }

    /// A batch the writer accepted today (≤ 100 recipients) is complete and
    /// must not claim truncation — and an unknown batch must not either.
    #[test]
    fn test_get_payments_by_batch_within_cap_is_not_truncated() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1_000_000);
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);
        let _ = client.init(&owner);

        // The batch record is written straight to storage rather than through
        // `create_batch`: the writer emits one event per recipient and a
        // 100-entry batch trips the *test host's* per-invocation event-size
        // budget (soroban-env-host defaults), which has nothing to do with the
        // reader boundary under test. Each `record_payment` is its own
        // invocation, so the 100 payments themselves fit the budget.
        for _ in 0..MAX_READER_ENTRIES {
            client.record_payment(
                &payer,
                &payee,
                &100i128,
                &sac,
                &String::from_str(&env, "tx_full"),
                &String::from_str(&env, "full batch entry"),
            );
        }

        let mut payment_ids = Vec::new(&env);
        for id in 1..=(MAX_READER_ENTRIES as u64) {
            payment_ids.push_back(id);
        }
        let full_batch = BatchPayment {
            id: 1,
            creator: owner.clone(),
            total_recipients: MAX_READER_ENTRIES,
            total_amount: (MAX_READER_ENTRIES as i128) * 100,
            asset: sac.clone(),
            timestamp: env.ledger().timestamp(),
            tx_hash: String::from_str(&env, "full_batch_tx"),
            payment_ids,
        };
        env.as_contract(&contract_id, || {
            env.storage()
                .persistent()
                .set(&(BATCH_KEY, 1u64), &full_batch);
        });

        let result = client.get_payments_by_batch(&1);
        assert_eq!(result.items.len(), MAX_READER_ENTRIES);
        assert_eq!(result.total, MAX_READER_ENTRIES);
        assert!(!result.truncated);

        let missing = client.get_payments_by_batch(&999);
        assert_eq!(missing.items.len(), 0);
        assert_eq!(missing.total, 0);
        assert!(!missing.truncated);
    }
