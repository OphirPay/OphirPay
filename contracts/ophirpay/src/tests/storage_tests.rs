use super::*;
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{vec, String, Vec};

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
