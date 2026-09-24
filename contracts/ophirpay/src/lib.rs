//! OphirPay contract implementation.
//! ...
use soroban_sdk::{Env, BytesN, Symbol, ...};

/// Delay (in seconds) before an upgrade can be executed after it has been proposed.
pub const TMLOCK_DELAY: u64 = 86_400; // 24 hours

// ... other constants and code ...

/// Proposes a new contract upgrade. The upgrade can only be executed after
/// `TMLOCK_DELAY` seconds have passed since the proposal.
pub fn propose_upgrade(env: &Env, new_wasm_hash: BytesN<32>) -> Result<(), Error> {
    // NOTE: Previously this used a plain addition which could overflow.
    // We now use saturating_add to guarantee the timestamp never wraps.
    let unlock_timestamp = env.ledger().timestamp().saturating_add(TMLOCK_DELAY);

    // Store the proposal together with its unlock timestamp.
    // (The exact storage logic is unchanged; only the timestamp calculation
    //  has been fixed to be safe against overflow.)
    UpgradeProposal::save(env, UpgradeInfo {
        wasm_hash: new_wasm_hash,
        unlock_timestamp,
    });

    Ok(())
}

// ... rest of the contract implementation ...
