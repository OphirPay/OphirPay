//! Helper functions used across the contract.
//!
//! These utilities are intentionally small and pure so that they can be
//! reused by any module without pulling in unnecessary dependencies.

use soroban_sdk::{Env, Symbol};

/// Returns the current block timestamp as a `u64`.
pub fn current_timestamp(env: &Env) -> u64 {
    env.ledger().timestamp()
}

/// Creates a unique symbol from a string slice.
pub fn symbol_from_str(s: &str) -> Symbol {
    Symbol::new(s)
}
