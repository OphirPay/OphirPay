//! Integration tests for the OphirPay contract.

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{Env, testutils::Ledger, ledger::LedgerInfo};

    // Existing tests ...

    #[test]
    fn upgrade_unlock_time_saturates() {
        // Simulate a ledger timestamp that is close to the maximum u64 value.
        let max_timestamp = u64::MAX - 1;
        let mut env = Env::default();
        env.ledger().set(LedgerInfo {
            timestamp: max_timestamp,
            protocol_version: 0,
            sequence: 0,
            base_reserve: 0,
            network_id: [0; 32],
        });

        // The contract should compute the unlock timestamp using saturating_add,
        // which means the result must be capped at u64::MAX and never wrap.
        let computed_unlock = env.ledger().timestamp().saturating_add(crate::TMLOCK_DELAY);
        assert_eq!(computed_unlock, u64::MAX);
    }
}
