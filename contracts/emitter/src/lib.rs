#![no_std]
// env.events().publish → #[contractevent] migration is deferred (see docs/GAS.md);
// suppress until that migration lands.
#![allow(deprecated)]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, BytesN, Env, String,
    Symbol, Vec,
};

// ── Storage Keys ───────────────────────────────────────────────
const EVENT_COUNT: Symbol = symbol_short!("EVT_CNT");
const EMITTER_OWNER: Symbol = symbol_short!("EM_OWNR");
const UPGRADE_HASH: Symbol = symbol_short!("UPG_HASH");
const UPGRADE_TIMELOCK: Symbol = symbol_short!("UPG_LOCK");
const PAUSED: Symbol = symbol_short!("PAUSED");
const PENDING_OWNER: Symbol = symbol_short!("PND_OWN");
const OWNER_PROPOSED_AT: Symbol = symbol_short!("OWN_PAT");
const ALLOWED_SOURCE: Symbol = symbol_short!("ALW_SRC");

// Event schema version. Bump when the emitted event shape changes.
const EVENT_SCHEMA_VERSION: u32 = 1;
const TMLOCK_DELAY: u64 = 86400; // 24 hours

// ── Data Types ─────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug)]
pub struct PaymentEvent {
    pub version: u32,
    pub id: u64,
    pub source: String,
    pub payer: Address,
    pub payee: Address,
    pub amount: i128,
    pub tx_hash: String,
    pub timestamp: u64,
}

/// Legacy event shape stored before schema versioning was introduced.
/// Used only for backward-compatible reads of pre-upgrade events.
#[contracttype]
#[derive(Clone)]
pub struct LegacyPaymentEvent {
    pub id: u64,
    pub source: String,
    pub payer: Address,
    pub payee: Address,
    pub amount: i128,
    pub tx_hash: String,
    pub timestamp: u64,
}

impl LegacyPaymentEvent {
    pub fn into_payment_event(self) -> PaymentEvent {
        PaymentEvent {
            version: EVENT_SCHEMA_VERSION,
            id: self.id,
            source: self.source,
            payer: self.payer,
            payee: self.payee,
            amount: self.amount,
            tx_hash: self.tx_hash,
            timestamp: self.timestamp,
        }
    }
}

#[contracterror]
#[derive(Clone, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum EmitterError {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    EventNotFound = 3,
    Unauthorized = 4,
    UpgradeNotProposed = 5,
    UpgradeTimelockActive = 6,
    ContractPaused = 7,
    InvalidAmount = 8,
    DuplicateEvent = 9,
    MaxEventsReached = 10,
    ReentrantCall = 11,
    InvalidTxHash = 12,
    EmitFailed = 13,
    CrossContractCallFailed = 14,
    InvalidPageBounds = 15,
    PageLimitExceeded = 16,
    // Future Expansion Reserved (20-99) ─────────────────
}

// ── Contract ───────────────────────────────────────────────────

#[contract]
pub struct PaymentEventEmitter;

#[contractimpl]
impl PaymentEventEmitter {
    /// Initialize the emitter
    pub fn init(env: Env, owner: Address) -> Result<u32, EmitterError> {
        if env.storage().instance().has(&EMITTER_OWNER) {
            return Err(EmitterError::AlreadyInitialized);
        }
        owner.require_auth();
        env.storage().instance().set(&EMITTER_OWNER, &owner);
        env.storage().instance().set(&EVENT_COUNT, &0u64);
        env.storage().instance().extend_ttl(5000, 50000);
        Ok(0)
    }

    /// Record an external payment event.
    pub fn emit_payment(
        env: Env,
        caller: Address,
        source: String,
        payer: Address,
        payee: Address,
        amount: i128,
        tx_hash: String,
    ) -> Result<u64, EmitterError> {
        caller.require_auth();

        if let Some(allowed) = env.storage().instance().get::<_, Address>(&ALLOWED_SOURCE) {
            let owner: Address = env
                .storage()
                .instance()
                .get(&EMITTER_OWNER)
                .ok_or(EmitterError::NotInitialized)?;
            if caller != allowed && caller != owner {
                return Err(EmitterError::Unauthorized);
            }
        }

        let paused: bool = env.storage().instance().get(&PAUSED).unwrap_or(false);
        if paused {
            return Err(EmitterError::ContractPaused);
        }

        let mut count: u64 = env.storage().instance().get(&EVENT_COUNT).unwrap_or(0);
        count += 1;

        let event = PaymentEvent {
            version: EVENT_SCHEMA_VERSION,
            id: count,
            source,
            payer: payer.clone(),
            payee: payee.clone(),
            amount,
            tx_hash: tx_hash.clone(),
            timestamp: env.ledger().timestamp(),
        };

        env.storage().persistent().set(&count, &event);
        env.storage().persistent().extend_ttl(&count, 5000, 50000);

        env.storage().instance().set(&EVENT_COUNT, &count);
        env.storage().instance().extend_ttl(5000, 50000);

        env.events().publish(
            (
                Symbol::new(&env, "payment_event"),
                EVENT_SCHEMA_VERSION,
                payer,
                payee,
            ),
            (amount, tx_hash),
        );

        Ok(count)
    }

    /// Get event by ID with legacy backward compatibility.
    pub fn get_event(env: Env, event_id: u64) -> Result<PaymentEvent, EmitterError> {
        if let Some(event) = env.storage().persistent().get::<_, PaymentEvent>(&event_id) {
            return Ok(event);
        }
        if let Some(legacy) = env.storage().persistent().get::<_, LegacyPaymentEvent>(&event_id) {
            return Ok(legacy.into_payment_event());
        }

        Err(EmitterError::EventNotFound)
    }

    /// Maximum number of events returned per `get_events` call.
    pub const MAX_PAGE_LIMIT: u32 = 100;

    /// Get total event count
    pub fn get_event_count(env: Env) -> u64 {
        env.storage().instance().get(&EVENT_COUNT).unwrap_or(0)
    }

    /// Propose a WASM upgrade with timelock delay.
    pub fn propose_upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), EmitterError> {
        let owner: Address = env
            .storage()
            .instance()
            .get(&EMITTER_OWNER)
            .ok_or(EmitterError::NotInitialized)?;
        owner.require_auth();

        let unlock = env.ledger().timestamp().saturating_add(TMLOCK_DELAY);
        env.storage().instance().set(&UPGRADE_HASH, &new_wasm_hash);
        env.storage().instance().set(&UPGRADE_TIMELOCK, &unlock);

        Ok(())
    }

    /// Execute a proposed WASM upgrade once timelock expires.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), EmitterError> {
        let owner: Address = env
            .storage()
            .instance()
            .get(&EMITTER_OWNER)
            .ok_or(EmitterError::NotInitialized)?;
        owner.require_auth();

        let proposed_hash: BytesN<32> = env
            .storage()
            .instance()
            .get(&UPGRADE_HASH)
            .ok_or(EmitterError::UpgradeNotProposed)?;

        if proposed_hash != new_wasm_hash {
            return Err(EmitterError::UpgradeNotProposed);
        }

        let timelock: u64 = env
            .storage()
            .instance()
            .get(&UPGRADE_TIMELOCK)
            .ok_or(EmitterError::UpgradeNotProposed)?;

        if env.ledger().timestamp() < timelock {
            return Err(EmitterError::UpgradeTimelockActive);
        }

        env.deployer().update_current_contract_wasm(new_wasm_hash);
        env.storage().instance().remove(&UPGRADE_HASH);
        env.storage().instance().remove(&UPGRADE_TIMELOCK);

        Ok(())
    }

    /// Query the upgrade timelock timestamp.
    pub fn get_upgrade_timelock(env: Env) -> Option<u64> {
        env.storage().instance().get(&UPGRADE_TIMELOCK)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Ledger, Env};

    #[test]
    fn test_propose_upgrade_timestamp_saturates_at_boundary() {
        let env = Env::default();
        env.mock_all_signatures();

        let owner = Address::generate(&env);
        PaymentEventEmitter::init(env.clone(), owner.clone()).unwrap();

        env.ledger().set_timestamp(u64::MAX);

        let dummy_hash = BytesN::from_array(&env, &[1u8; 32]);
        PaymentEventEmitter::propose_upgrade(env.clone(), dummy_hash).unwrap();

        let timelock = PaymentEventEmitter::get_upgrade_timelock(env).unwrap();
        assert_eq!(timelock, u64::MAX);
    }
}
