use super::*;
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{vec, String, Vec};

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

