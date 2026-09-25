// SPDX-License-Identifier: MIT
#![cfg(test)]

use ophirpay_emitter::{
    EmitterError, PaymentEventEmitter, PaymentEventEmitterClient,
};
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::{Address, Env, String, Vec};

#[test]
fn test_init() {
    let env = Env::default();
    env.mock_all_auths();
    let addr = env.register(PaymentEventEmitter, ());
    let client = PaymentEventEmitterClient::new(&env, &addr);
    let owner = Address::generate(&env);

    let version = client.init(&owner);
    assert_eq!(version, 0);
    assert_eq!(client.get_owner(), owner);
    assert_eq!(client.get_event_count(), 0);
}

#[test]
#[should_panic]
fn test_init_twice_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let addr = env.register(PaymentEventEmitter, ());
    let client = PaymentEventEmitterClient::new(&env, &addr);
    let owner = Address::generate(&env);

    let _ = client.init(&owner);
    let _ = client.init(&owner);
}

#[test]
fn test_emit_payment() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1000);
    let addr = env.register(PaymentEventEmitter, ());
    let client = PaymentEventEmitterClient::new(&env, &addr);
    let owner = Address::generate(&env);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);

    let _ = client.init(&owner);

    let id = client.emit_payment(
        &owner,
        &String::from_str(&env, "OphirPay"),
        &payer,
        &payee,
        &2500i128,
        &String::from_str(&env, "abc123def456"),
    );
    assert_eq!(id, 1);
    assert_eq!(client.get_event_count(), 1);

    let event = client.get_event(&1);
    assert_eq!(event.version, 1);
    assert_eq!(event.id, 1);
    assert_eq!(event.payer, payer);
    assert_eq!(event.payee, payee);
    assert_eq!(event.amount, 2500);
    assert_eq!(event.tx_hash, String::from_str(&env, "abc123def456"));
    assert!(event.timestamp > 0);
}

#[test]
fn test_multiple_events() {
    let env = Env::default();
    env.mock_all_auths();
    let addr = env.register(PaymentEventEmitter, ());
    let client = PaymentEventEmitterClient::new(&env, &addr);
    let owner = Address::generate(&env);
    let p1 = Address::generate(&env);
    let p2 = Address::generate(&env);

    let _ = client.init(&owner);

    for i in 0..5 {
        let _ = client.emit_payment(
            &owner,
            &String::from_str(&env, "test"),
            &p1,
            &p2,
            &((i + 1) * 100),
            &String::from_str(&env, "tx"),
        );
    }
    assert_eq!(client.get_event_count(), 5);
}

#[test]
#[should_panic]
fn test_not_found() {
    let env = Env::default();
    env.mock_all_auths();
    let addr = env.register(PaymentEventEmitter, ());
    let client = PaymentEventEmitterClient::new(&env, &addr);
    let owner = Address::generate(&env);

    let _ = client.init(&owner);
    let _ = client.get_event(&999);
}

#[test]
fn test_allow_list_blocks_unauthorized_emitters() {
    let env = Env::default();
    env.mock_all_auths();
    let addr = env.register(PaymentEventEmitter, ());
    let client = PaymentEventEmitterClient::new(&env, &addr);
    let owner = Address::generate(&env);
    let allowed = Address::generate(&env);
    let attacker = Address::generate(&env);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);

    let _ = client.init(&owner);
    client.set_allowed_source(&owner, &Some(allowed.clone()));
    assert_eq!(client.get_allowed_source(), Some(allowed.clone()));

    let id = client.emit_payment(
        &allowed,
        &String::from_str(&env, "OphirPay"),
        &payer,
        &payee,
        &100i128,
        &String::from_str(&env, "tx1"),
    );
    assert_eq!(id, 1);

    let result = client.try_emit_payment(
        &attacker,
        &String::from_str(&env, "fake"),
        &payer,
        &payee,
        &100i128,
        &String::from_str(&env, "tx2"),
    );
    assert!(result.is_err());
    assert_eq!(client.get_event_count(), 1);

    let id = client.emit_payment(
        &owner,
        &String::from_str(&env, "owner"),
        &payer,
        &payee,
        &50i128,
        &String::from_str(&env, "tx3"),
    );
    assert_eq!(id, 2);

    client.set_allowed_source(&owner, &None);
    assert_eq!(client.get_allowed_source(), None);
}

#[test]
fn test_transfer_ownership() {
    let env = Env::default();
    env.mock_all_auths();
    let addr = env.register(PaymentEventEmitter, ());
    let client = PaymentEventEmitterClient::new(&env, &addr);
    let owner = Address::generate(&env);
    let new_owner = Address::generate(&env);

    let _ = client.init(&owner);

    client.transfer_ownership(&owner, &new_owner);
    assert_eq!(client.get_owner(), owner);

    env.ledger().set_timestamp(env.ledger().timestamp() + 86401);
    client.accept_ownership(&new_owner);
    assert_eq!(client.get_owner(), new_owner);
}

// ── Pagination Tests ──────────────────────────────────────

/// Helper: emit `n` events and return the owner address.
fn emit_n_events(env: &Env, client: &PaymentEventEmitterClient, n: u32) -> Address {
    let owner = Address::generate(env);
    let payer = Address::generate(env);
    let payee = Address::generate(env);
    let _ = client.init(&owner);

    for i in 1..=n {
        let _ = client.emit_payment(
            &owner,
            &String::from_str(env, "src"),
            &payer,
            &payee,
            &((i as i128) * 100),
            &String::from_str(env, "tx"),
        );
    }
    owner
}

#[test]
fn test_get_events_returns_full_range() {
    let env = Env::default();
    env.mock_all_auths();
    let addr = env.register(PaymentEventEmitter, ());
    let client = PaymentEventEmitterClient::new(&env, &addr);

    emit_n_events(&env, &client, 10);
    assert_eq!(client.get_event_count(), 10);

    // Fetch all 10 events in one page
    let events = client.get_events(&1, &10);
    assert_eq!(events.len(), 10);

    // Verify stable ascending order by ID
    for i in 0..events.len() {
        assert_eq!(events.get(i).unwrap().id, (i as u64) + 1);
    }
}

#[test]
fn test_get_events_paginated() {
    let env = Env::default();
    env.mock_all_auths();
    let addr = env.register(PaymentEventEmitter, ());
    let client = PaymentEventEmitterClient::new(&env, &addr);

    emit_n_events(&env, &client, 10);

    // Page 1: events 1-3
    let page1 = client.get_events(&1, &3);
    assert_eq!(page1.len(), 3);
    assert_eq!(page1.get(0).unwrap().id, 1);
    assert_eq!(page1.get(2).unwrap().id, 3);

    // Page 2: events 4-6
    let page2 = client.get_events(&4, &3);
    assert_eq!(page2.len(), 3);
    assert_eq!(page2.get(0).unwrap().id, 4);
    assert_eq!(page2.get(2).unwrap().id, 6);

    // Page 4: events 10-12 (only 10 exists)
    let page4 = client.get_events(&10, &3);
    assert_eq!(page4.len(), 1);
    assert_eq!(page4.get(0).unwrap().id, 10);
}

#[test]
fn test_get_events_empty_when_start_exceeds_count() {
    let env = Env::default();
    env.mock_all_auths();
    let addr = env.register(PaymentEventEmitter, ());
    let client = PaymentEventEmitterClient::new(&env, &addr);

    emit_n_events(&env, &client, 5);

    // start=100 > count=5 → empty
    let events = client.get_events(&100, &10);
    assert_eq!(events.len(), 0);
}

#[test]
fn test_get_events_zero_limit() {
    let env = Env::default();
    env.mock_all_auths();
    let addr = env.register(PaymentEventEmitter, ());
    let client = PaymentEventEmitterClient::new(&env, &addr);

    emit_n_events(&env, &client, 5);

    let events = client.get_events(&1, &0);
    assert_eq!(events.len(), 0);
}

#[test]
fn test_get_events_limit_exceeded() {
    let env = Env::default();
    env.mock_all_auths();
    let addr = env.register(PaymentEventEmitter, ());
    let client = PaymentEventEmitterClient::new(&env, &addr);

    let _ = client.init(&Address::generate(&env));

    // limit > MAX_PAGE_LIMIT (100) → error
    let result = client.try_get_events(&1, &101);
    assert_eq!(result, Err(Ok(EmitterError::PageLimitExceeded)));
}

#[test]
fn test_get_events_boundary_at_max_limit() {
    let env = Env::default();
    env.mock_all_auths();
    let addr = env.register(PaymentEventEmitter, ());
    let client = PaymentEventEmitterClient::new(&env, &addr);

    emit_n_events(&env, &client, 105);

    // limit = MAX_PAGE_LIMIT (100) should succeed
    let events = client.get_events(&1, &100);
    assert_eq!(events.len(), 100);
    assert_eq!(events.get(0).unwrap().id, 1);
    assert_eq!(events.get(99).unwrap().id, 100);

    // Second page: events 101-105
    let events2 = client.get_events(&101, &100);
    assert_eq!(events2.len(), 5);
    assert_eq!(events2.get(0).unwrap().id, 101);
    assert_eq!(events2.get(4).unwrap().id, 105);
}

#[test]
fn test_get_events_returns_correct_amounts() {
    let env = Env::default();
    env.mock_all_auths();
    let addr = env.register(PaymentEventEmitter, ());
    let client = PaymentEventEmitterClient::new(&env, &addr);

    emit_n_events(&env, &client, 5);

    let events = client.get_events(&1, &5);
    assert_eq!(events.get(0).unwrap().amount, 100);
    assert_eq!(events.get(1).unwrap().amount, 200);
    assert_eq!(events.get(2).unwrap().amount, 300);
    assert_eq!(events.get(3).unwrap().amount, 400);
    assert_eq!(events.get(4).unwrap().amount, 500);
}

#[test]
fn test_get_events_no_events_empty_result() {
    let env = Env::default();
    env.mock_all_auths();
    let addr = env.register(PaymentEventEmitter, ());
    let client = PaymentEventEmitterClient::new(&env, &addr);

    let _ = client.init(&Address::generate(&env));

    // No events emitted → empty result
    let events = client.get_events(&1, &10);
    assert_eq!(events.len(), 0);
}

#[test]
fn test_get_events_page_count_calculation() {
    let env = Env::default();
    env.mock_all_auths();
    let addr = env.register(PaymentEventEmitter, ());
    let client = PaymentEventEmitterClient::new(&env, &addr);

    emit_n_events(&env, &client, 25);
    let total = client.get_event_count();
    let limit: u64 = 10;

    // Total pages = ceil(25/10) = 3
    let total_pages = (total + limit - 1) / limit;
    assert_eq!(total_pages, 3);

    // Page 1: events 1-10
    let p1 = client.get_events(&1, &(limit as u32));
    assert_eq!(p1.len(), 10);

    // Page 2: events 11-20
    let p2 = client.get_events(&11, &(limit as u32));
    assert_eq!(p2.len(), 10);

    // Page 3: events 21-25
    let p3 = client.get_events(&21, &(limit as u32));
    assert_eq!(p3.len(), 5);

    // All events accounted for
    let mut all_ids = Vec::new(&env);
    for page in [p1, p2, p3] {
        for i in 0..page.len() {
            all_ids.push_back(page.get(i).unwrap().id);
        }
    }
    assert_eq!(all_ids.len(), 25);
}
