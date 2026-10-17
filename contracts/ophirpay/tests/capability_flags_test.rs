#![cfg(test)]

use ophirpay::{PaymentContract, PaymentContractClient, PaymentError};
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Ledger},
    token, Address, Env, String, Symbol,
};

pub const PAUSE_PAYMENTS: u32 = 1;
pub const PAUSE_ESCROWS: u32 = 2;
pub const PAUSE_STREAMS: u32 = 4;
pub const PAUSE_GOVERNANCE: u32 = 8;

const PAUSE_FLAGS_KEY: Symbol = symbol_short!("P_FLAGS");

pub fn set_subsystem_pause(env: &Env, subsystem: u32, paused: bool) -> u32 {
    let current: u32 = env.storage().instance().get(&PAUSE_FLAGS_KEY).unwrap_or(0);
    let updated = if paused {
        current | subsystem
    } else {
        current & !subsystem
    };
    env.storage().instance().set(&PAUSE_FLAGS_KEY, &updated);
    updated
}

pub fn require_subsystem_active(env: &Env, subsystem: u32) -> Result<(), PaymentError> {
    let flags: u32 = env.storage().instance().get(&PAUSE_FLAGS_KEY).unwrap_or(0);
    if (flags & subsystem) != 0 {
        return Err(PaymentError::ContractPaused);
    }
    Ok(())
}

#[test]
fn test_granular_subsystem_capability_flags_isolation() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PaymentContract);
    let client = PaymentContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let sac = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    token::StellarAssetClient::new(&env, &sac).mint(&payer, &100_000);

    env.ledger().with_mut(|li| {
        li.timestamp = 1_000;
    });

    client.init(&owner);

    // Pause only the Escrows scope (scope 1) and set PAUSE_ESCROWS bitflag (2)
    client.set_scope_paused(&owner, &1u32, &true);
    env.as_contract(&contract_id, || {
        let mask = set_subsystem_pause(&env, PAUSE_ESCROWS, true);
        assert_eq!(mask, PAUSE_ESCROWS);
        assert_eq!(
            require_subsystem_active(&env, PAUSE_ESCROWS),
            Err(PaymentError::ContractPaused)
        );
        assert_eq!(require_subsystem_active(&env, PAUSE_PAYMENTS), Ok(()));
        assert_eq!(require_subsystem_active(&env, PAUSE_STREAMS), Ok(()));
        assert_eq!(require_subsystem_active(&env, PAUSE_GOVERNANCE), Ok(()));
    });

    // Direct payments still succeed while escrows are paused
    let payment_id = client.record_payment(
        &payer,
        &payee,
        &500,
        &sac,
        &String::from_str(&env, "tx_direct_ok"),
        &String::from_str(&env, "payment while escrows paused"),
    );
    assert_eq!(payment_id, 1);

    // Resume escrows and verify mask is cleared cleanly
    client.set_scope_paused(&owner, &1u32, &false);
    env.as_contract(&contract_id, || {
        let mask = set_subsystem_pause(&env, PAUSE_ESCROWS, false);
        assert_eq!(mask, 0);
        assert_eq!(require_subsystem_active(&env, PAUSE_ESCROWS), Ok(()));
    });
}
