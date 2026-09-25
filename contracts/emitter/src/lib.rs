#![no_std]
// env.events().publish → #[contractevent] migration is deferred (see docs/GAS.md);
// suppress until that migration lands.
#![allow(deprecated)]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env, String, Symbol,
    Vec,
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

// ── Data Types ─────────────────────────────────────────────────
const TMLOCK_DELAY: u64 = 86400; // 24 hours

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
        // Events are stored natively (contracttype conversion), so read them
        // back the same way — try the V1 schema first (with version field),
        // then fall back to the legacy schema (without version field).
        if let Some(event) = env.storage().persistent().get::<_, PaymentEvent>(&event_id) {
            return Ok(event);
        }
        if let Some(legacy) = env.storage().persistent().get::<_, LegacyPaymentEvent>(&event_id) {
            return Ok(legacy.into_payment_event());
        }

        Err(EmitterError::EventNotFound)
    }

    /// Maximum number of events returned per `get_events` call.
    /// Prevents unbounded storage iteration that could exceed gas limits.
    pub const MAX_PAGE_LIMIT: u32 = 100;

    /// Get total event count
    pub fn get_event_count(env: Env) -> u64 {
        env.storage().instance().get(&EVENT_COUNT).unwrap_or(0)
    }

    /// Get a paginated range of events.
    ///
    /// `start` is the first event ID to return (1-indexed).
    /// `limit` is the maximum number of events to return.
    ///
    /// Returns events in stable ascending order by ID (insertion order).
    /// If `start` exceeds the current event count, returns an empty Vec.
    /// If `limit` is 0, returns an empty Vec.
    /// If `limit` exceeds `MAX_PAGE_LIMIT`, returns `PageLimitExceeded`.
    ///
    /// Clients should combine this with `get_event_count()` to compute
    /// total pages: `total_pages = (count + limit - 1) / limit`.
    pub fn get_events(
        env: Env,
        start: u64,
        limit: u32,
    ) -> Result<Vec<PaymentEvent>, EmitterError> {
        if limit > Self::MAX_PAGE_LIMIT {
            return Err(EmitterError::PageLimitExceeded);
        }
        if limit == 0 {
            return Ok(Vec::new(&env));
        }

        let count: u64 = env.storage().instance().get(&EVENT_COUNT).unwrap_or(0);

        // start is 1-indexed; if it exceeds count, return empty
        if start == 0 || start > count {
            return Ok(Vec::new(&env));
        }

        // Cap the end so we never iterate past the last stored event
        let end = core::cmp::min(start.saturating_add(limit as u64 - 1), count);

        let mut events = Vec::new(&env);
        for id in start..=end {
            // Try V1 first, then fallback to legacy
            if let Some(event) = env.storage().persistent().get::<_, PaymentEvent>(&id) {
                events.push_back(event);
            } else if let Some(legacy) = env.storage().persistent().get::<_, LegacyPaymentEvent>(&id) {
                events.push_back(legacy.into_payment_event());
            }
        }

        Ok(events)
    }

    /// Get owner
    pub fn get_owner(env: Env) -> Result<Address, EmitterError> {
        env.storage()
            .instance()
            .get(&EMITTER_OWNER)
            .ok_or(EmitterError::NotInitialized)
    }

    /// Set the allow-listed source contract that may emit events (owner only).
    pub fn set_allowed_source(
        env: Env,
        caller: Address,
        source: Option<Address>,
    ) -> Result<(), EmitterError> {
        caller.require_auth();
        let owner: Address = env
            .storage()
            .instance()
            .get(&EMITTER_OWNER)
            .ok_or(EmitterError::NotInitialized)?;
        if caller != owner {
            return Err(EmitterError::Unauthorized);
        }
        if let Some(src) = source {
            env.storage().instance().set(&ALLOWED_SOURCE, &src);
        } else {
            env.storage().instance().remove(&ALLOWED_SOURCE);
        }
        env.storage().instance().extend_ttl(5000, 50000);
        Ok(())
    }

    /// Get the currently allow-listed source (if any).
    pub fn get_allowed_source(env: Env) -> Option<Address> {
        env.storage().instance().get(&ALLOWED_SOURCE)
    }

    /// Propose an emitter upgrade (owner only). Sets a 24-hour timelock.
    pub fn propose_upgrade(
        env: Env,
        caller: Address,
        new_wasm_hash: soroban_sdk::BytesN<32>,
    ) -> Result<(), EmitterError> {
        caller.require_auth();
        let owner: Address = env
            .storage()
            .instance()
            .get(&EMITTER_OWNER)
            .ok_or(EmitterError::NotInitialized)?;
        if caller != owner {
            return Err(EmitterError::Unauthorized);
        }
        let unlock_at = env.ledger().timestamp().saturating_add(TMLOCK_DELAY);
        env.storage().instance().set(&UPGRADE_HASH, &new_wasm_hash);
        env.storage().instance().set(&UPGRADE_TIMELOCK, &unlock_at);
        env.storage().instance().extend_ttl(5000, 50000);
        Ok(())
    }

    /// Execute a previously proposed upgrade after the timelock expires.
    pub fn execute_upgrade(env: Env) -> Result<(), EmitterError> {
        let new_wasm_hash: soroban_sdk::BytesN<32> = env
            .storage()
            .instance()
            .get(&UPGRADE_HASH)
            .ok_or(EmitterError::UpgradeNotProposed)?;

        let unlock_at: u64 = env.storage().instance().get(&UPGRADE_TIMELOCK).unwrap_or(0);

        if env.ledger().timestamp() < unlock_at {
            return Err(EmitterError::UpgradeTimelockActive);
        }

        env.storage().instance().remove(&UPGRADE_HASH);
        env.storage().instance().remove(&UPGRADE_TIMELOCK);
        env.storage().instance().extend_ttl(5000, 50000);

        env.deployer().update_current_contract_wasm(new_wasm_hash);
        Ok(())
    }

    /// Cancel a pending upgrade (owner only).
    pub fn cancel_upgrade(env: Env, caller: Address) -> Result<(), EmitterError> {
        caller.require_auth();
        let owner: Address = env
            .storage()
            .instance()
            .get(&EMITTER_OWNER)
            .ok_or(EmitterError::NotInitialized)?;
        if caller != owner {
            return Err(EmitterError::Unauthorized);
        }
        env.storage().instance().remove(&UPGRADE_HASH);
        env.storage().instance().remove(&UPGRADE_TIMELOCK);
        env.storage().instance().extend_ttl(5000, 50000);
        Ok(())
    }

    /// Propose a new owner (two-step transfer). The new owner must accept after 24h.
    pub fn transfer_ownership(
        env: Env,
        caller: Address,
        new_owner: Address,
    ) -> Result<(), EmitterError> {
        caller.require_auth();
        let owner: Address = env
            .storage()
            .instance()
            .get(&EMITTER_OWNER)
            .ok_or(EmitterError::NotInitialized)?;
        if caller != owner {
            return Err(EmitterError::Unauthorized);
        }
        env.storage().instance().set(&PENDING_OWNER, &new_owner);
        env.storage()
            .instance()
            .set(&OWNER_PROPOSED_AT, &env.ledger().timestamp());
        env.storage().instance().extend_ttl(5000, 50000);
        Ok(())
    }

    /// Accept ownership after the 24-hour timelock.
    pub fn accept_ownership(env: Env, caller: Address) -> Result<(), EmitterError> {
        caller.require_auth();
        let pending: Address = env
            .storage()
            .instance()
            .get(&PENDING_OWNER)
            .ok_or(EmitterError::UpgradeNotProposed)?;
        if caller != pending {
            return Err(EmitterError::Unauthorized);
        }
        let proposed_at: u64 = env
            .storage()
            .instance()
            .get(&OWNER_PROPOSED_AT)
            .unwrap_or(0);
        let now = env.ledger().timestamp();
        if now.saturating_sub(proposed_at) < TMLOCK_DELAY {
            return Err(EmitterError::UpgradeTimelockActive);
        }
        env.storage().instance().remove(&PENDING_OWNER);
        env.storage().instance().remove(&OWNER_PROPOSED_AT);
        env.storage().instance().set(&EMITTER_OWNER, &caller);
        env.storage().instance().extend_ttl(5000, 50000);
        Ok(())
    }

    /// Pause event emission (owner only).
    pub fn pause(env: Env, caller: Address) -> Result<(), EmitterError> {
        caller.require_auth();
        let owner: Address = env
            .storage()
            .instance()
            .get(&EMITTER_OWNER)
            .ok_or(EmitterError::NotInitialized)?;
        if caller != owner {
            return Err(EmitterError::Unauthorized);
        }
        env.storage().instance().set(&PAUSED, &true);
        env.storage().instance().extend_ttl(5000, 50000);
        Ok(())
    }

    /// Unpause event emission (owner only).
    pub fn unpause(env: Env, caller: Address) -> Result<(), EmitterError> {
        caller.require_auth();
        let owner: Address = env
            .storage()
            .instance()
            .get(&EMITTER_OWNER)
            .ok_or(EmitterError::NotInitialized)?;
        if caller != owner {
            return Err(EmitterError::Unauthorized);
        }
        env.storage().instance().set(&PAUSED, &false);
        env.storage().instance().extend_ttl(5000, 50000);
        Ok(())
    }

    /// Check if the emitter is paused.
    pub fn is_paused(env: Env) -> bool {
        env.storage().instance().get(&PAUSED).unwrap_or(false)
    }
}