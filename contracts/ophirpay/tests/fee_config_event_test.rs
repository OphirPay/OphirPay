#![cfg(test)]

use ophirpay::{
    emit_fee_config_updated, update_fee_collector_with_event, FeeConfigUpdated, PaymentContract,
    PaymentContractClient,
};
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    Address, Env, IntoVal, Symbol,
};

#[test]
fn test_fee_config_updated_event_emitted_with_topics_and_payload() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PaymentContract);
    let client = PaymentContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let collector_v1 = Address::generate(&env);
    let collector_v2 = Address::generate(&env);

    env.ledger().with_mut(|li| {
        li.timestamp = 1_700_000_000;
    });

    client.init(&owner);
    client.set_fee_config(&owner, &250, &100, &100, &500, &50, &true);

    env.as_contract(&contract_id, || {
        let ev1 = update_fee_collector_with_event(&env, &owner, &collector_v1).unwrap();
        assert_eq!(ev1.old_collector, None);
        assert_eq!(ev1.new_collector, collector_v1);
        assert_eq!(ev1.fee_bps, 250);
        assert_eq!(ev1.updated_by, owner);
        assert_eq!(ev1.timestamp, 1_700_000_000);

        let ev2 = update_fee_collector_with_event(&env, &owner, &collector_v2).unwrap();
        assert_eq!(ev2.old_collector, Some(collector_v1.clone()));
        assert_eq!(ev2.new_collector, collector_v2);
        assert_eq!(ev2.fee_bps, 250);
    });

    let all_events = env.events().all();
    assert!(!all_events.is_empty());

    let expected_topics = (
        Symbol::new(&env, "fee_config"),
        Symbol::new(&env, "updated"),
    )
        .into_val(&env);

    let has_fee_config_updated = all_events
        .iter()
        .any(|(_, topics, _)| topics == expected_topics);
    assert!(has_fee_config_updated);
}

#[test]
fn test_emit_fee_config_updated_helper_constructs_expected_struct() {
    let env = Env::default();
    let contract_id = env.register_contract(None, PaymentContract);
    let admin = Address::generate(&env);
    let old_coll = Address::generate(&env);
    let new_coll = Address::generate(&env);

    env.ledger().with_mut(|li| {
        li.timestamp = 42_000;
    });

    env.as_contract(&contract_id, || {
        let payload: FeeConfigUpdated =
            emit_fee_config_updated(&env, Some(old_coll.clone()), &new_coll, 125, &admin);
        assert_eq!(payload.old_collector, Some(old_coll));
        assert_eq!(payload.new_collector, new_coll);
        assert_eq!(payload.fee_bps, 125);
        assert_eq!(payload.updated_by, admin);
        assert_eq!(payload.timestamp, 42_000);
    });
}
