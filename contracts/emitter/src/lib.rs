//! Emitter contract implementation.
//! ...
use soroban_sdk::{Env, BytesN, Symbol, ...};

/// Delay (in seconds) before an upgrade can be executed after it has been proposed.
pub const TMLOCK_DELAY: u64 = 86_400; // 24 hours

// ... other constants and code ...

/// Proposes a new contract upgrade for the emitter. The upgrade can only be
/// executed after `TMLOCK_DELAY` seconds have passed since the proposal.
pub fn propose_upgrade(env: &Env, new_wasm_hash: BytesN<32>) -> Result<(), Error> {
    // Use saturating_add to avoid overflow when the ledger timestamp is near u64::MAX.
    let unlock_timestamp = env.ledger().timestamp().saturating_add(TMLOCK_DELAY);

    // Persist the proposal with its unlock timestamp.
    UpgradeProposal::save(env, UpgradeInfo {
        wasm_hash: new_wasm_hash,
        unlock_timestamp,
    });

    Ok(())
}

// ... rest of the contract implementation ...
