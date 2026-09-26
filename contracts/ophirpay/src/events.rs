//! Native Soroban event publishers.

use soroban_sdk::{Address, Env, Symbol};

// ── Native Events ──────────────────────────────────────────────

pub fn emit_payment_event(env: &Env, payer: &Address, payee: &Address, amount: &i128) {
    env.events().publish(
        (Symbol::new(env, "payment"), payer.clone(), payee.clone()),
        *amount,
    );
}

pub fn emit_escrow_event(env: &Env, depositor: &Address, beneficiary: &Address, amount: &i128) {
    env.events().publish(
        (
            Symbol::new(env, "escrow"),
            depositor.clone(),
            beneficiary.clone(),
        ),
        *amount,
    );
}

pub fn emit_stream_event(env: &Env, creator: &Address, recipient: &Address, amount: &i128) {
    env.events().publish(
        (
            Symbol::new(env, "stream"),
            creator.clone(),
            recipient.clone(),
        ),
        *amount,
    );
}

