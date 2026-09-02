#![no_std]
// env.events().publish → #[contractevent] migration is deferred (see docs/GAS.md);
// suppress until that migration lands.
#![allow(deprecated)]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env, String, Symbol,
};

// ── Storage Keys ───────────────────────────────────────────────
const EVENT_COUNT: Symbol = symbol_short!("EVT_CNT");
const EMITTER_OWNER: Symbol = symbol_short!("EM_OWNR");
const UPGRADE_HASH: Symbol = symbol_short!("UPG_HASH");
const UPGRADE_TIMELOCK: Symbol = symbol_short!("UPG_LOCK");
const PAUSED: Symbol = symbol_short!("PAUSED");
const PENDING_OWNER: Symbol = symbol_short!("PND_OWN");
const OWNER_PROPOSED_AT: Symbol = symbol_short!("OWN_PAT");
// Allow-listed source contract (the OphirPay orchestrator). When set,
// emit_payment only accepts events from this address — preventing any
// account from fabricating PaymentEvents (MEDIUM-3 audit fix).
const ALLOWED_SOURCE: Symbol = symbol_short!("ALW_SRC");

// ── Data Types ─────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub struct PaymentEvent {
    pub id: u64,
    pub source: String,
    pub payer: Address,
    pub payee: Address,
    pub amount: i128,
    pub tx_hash: String,
    pub timestamp: u64,
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
    /// Caller must authorize AND be the allow-listed source (typically the main
    /// OphirPay contract). Returns the new event ID, or an EmitterError.
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

        // Allow-list check (MEDIUM-3 audit fix): if an allowed source has been
        // configured, only it may emit. The owner may always emit (owner is
        // implicitly trusted, e.g. during bootstrap before the source is set).
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

        // Reject emits while paused — return EmitterError so cross-contract
        // callers receive a proper error instead of panicking the whole TX.
        let paused: bool = env.storage().instance().get(&PAUSED).unwrap_or(false);
        if paused {
            return Err(EmitterError::ContractPaused);
        }

        let mut count: u64 = env.storage().instance().get(&EVENT_COUNT).unwrap_or(0);
        count += 1;

        let event = PaymentEvent {
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

        // Native event emission
        env.events().publish(
            (Symbol::new(&env, "payment_event"), payer, payee),
            (amount, tx_hash),
        );

        Ok(count)
    }

    /// Get event by ID
    pub fn get_event(env: Env, event_id: u64) -> Result<PaymentEvent, EmitterError> {
        env.storage()
            .persistent()
            .get(&event_id)
            .ok_or(EmitterError::EventNotFound)
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
            if let Some(event) = env.storage().persistent().get::<_, PaymentEvent>(&id) {
                events.push_back(event);
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
    /// Pass `None` to clear the allow-list (not recommended).
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
        let unlock_at = env.ledger().timestamp() + 86400;
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
        if now.saturating_sub(proposed_at) < 86400 {
            return Err(EmitterError::UpgradeTimelockActive);
        }
        env.storage().instance().remove(&PENDING_OWNER);
        env.storage().instance().remove(&OWNER_PROPOSED_AT);
        env.storage().instance().set(&EMITTER_OWNER, &caller);
        env.storage().instance().extend_ttl(5000, 50000);
        Ok(())
    }

    /// Pause event emission (owner only).
    /// Used by the OphirPay orchestrator to freeze both contracts atomically.
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

// ── Tests ─────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};

    #[test]
    fn test_init() {
        let env = Env::default();
        env.mock_all_auths();
        let addr = env.register(PaymentEventEmitter, ());
        let client = PaymentEventEmitterClient::new(&env, &addr);
        let owner = Address::generate(&env);

        let version = client.init(&owner);
        assert_eq!(version, 0);
        assert_eq!(client.get_owner(), owner);
        assert_eq!(client.get_event_count(), 0);
    }

    #[test]
    #[should_panic]
    fn test_init_twice_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let addr = env.register(PaymentEventEmitter, ());
        let client = PaymentEventEmitterClient::new(&env, &addr);
        let owner = Address::generate(&env);

        let _ = client.init(&owner);
        let _ = client.init(&owner);
    }

    #[test]
    fn test_emit_payment() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1000);
        let addr = env.register(PaymentEventEmitter, ());
        let client = PaymentEventEmitterClient::new(&env, &addr);
        let owner = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);

        let _ = client.init(&owner);

        let id = client.emit_payment(
            &owner,
            &String::from_str(&env, "OphirPay"),
            &payer,
            &payee,
            &2500i128,
            &String::from_str(&env, "abc123def456"),
        );
        assert_eq!(id, 1);
        assert_eq!(client.get_event_count(), 1);

        let event = client.get_event(&1);
        assert_eq!(event.id, 1);
        assert_eq!(event.payer, payer);
        assert_eq!(event.payee, payee);
        assert_eq!(event.amount, 2500);
        assert_eq!(event.tx_hash, String::from_str(&env, "abc123def456"));
        assert!(event.timestamp > 0);
    }

    #[test]
    fn test_multiple_events() {
        let env = Env::default();
        env.mock_all_auths();
        let addr = env.register(PaymentEventEmitter, ());
        let client = PaymentEventEmitterClient::new(&env, &addr);
        let owner = Address::generate(&env);
        let p1 = Address::generate(&env);
        let p2 = Address::generate(&env);

        let _ = client.init(&owner);

        for i in 0..5 {
            let _ = client.emit_payment(
                &owner,
                &String::from_str(&env, "test"),
                &p1,
                &p2,
                &((i + 1) * 100),
                &String::from_str(&env, "tx"),
            );
        }
        assert_eq!(client.get_event_count(), 5);
    }

    #[test]
    #[should_panic]
    fn test_not_found() {
        let env = Env::default();
        env.mock_all_auths();
        let addr = env.register(PaymentEventEmitter, ());
        let client = PaymentEventEmitterClient::new(&env, &addr);
        let owner = Address::generate(&env);

        let _ = client.init(&owner);
        let _ = client.get_event(&999);
    }

    #[test]
    fn test_allow_list_blocks_unauthorized_emitters() {
        let env = Env::default();
        env.mock_all_auths();
        let addr = env.register(PaymentEventEmitter, ());
        let client = PaymentEventEmitterClient::new(&env, &addr);
        let owner = Address::generate(&env);
        let allowed = Address::generate(&env);
        let attacker = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);

        let _ = client.init(&owner);
        client.set_allowed_source(&owner, &Some(allowed.clone()));
        assert_eq!(client.get_allowed_source(), Some(allowed.clone()));

        // Allowed source can emit
        let id = client.emit_payment(
            &allowed,
            &String::from_str(&env, "OphirPay"),
            &payer,
            &payee,
            &100i128,
            &String::from_str(&env, "tx1"),
        );
        assert_eq!(id, 1);

        // Attacker cannot emit
        let result = client.try_emit_payment(
            &attacker,
            &String::from_str(&env, "fake"),
            &payer,
            &payee,
            &100i128,
            &String::from_str(&env, "tx2"),
        );
        assert!(result.is_err());
        assert_eq!(client.get_event_count(), 1);

        // Owner can always emit (implicitly trusted)
        let id = client.emit_payment(
            &owner,
            &String::from_str(&env, "owner"),
            &payer,
            &payee,
            &50i128,
            &String::from_str(&env, "tx3"),
        );
        assert_eq!(id, 2);

        // Clearing the allow-list re-opens emission
        client.set_allowed_source(&owner, &None);
        assert_eq!(client.get_allowed_source(), None);
    }

    #[test]
    fn test_transfer_ownership() {
        let env = Env::default();
        env.mock_all_auths();
        let addr = env.register(PaymentEventEmitter, ());
        let client = PaymentEventEmitterClient::new(&env, &addr);
        let owner = Address::generate(&env);
        let new_owner = Address::generate(&env);

        let _ = client.init(&owner);

        // Propose new owner — ownership should NOT change yet
        client.transfer_ownership(&owner, &new_owner);
        assert_eq!(client.get_owner(), owner);

        // Advance time past 24h timelock and accept
        env.ledger().set_timestamp(env.ledger().timestamp() + 86401);
        client.accept_ownership(&new_owner);
        assert_eq!(client.get_owner(), new_owner);
    }

    // ── Pagination Tests ──────────────────────────────────────

    /// Helper: emit `n` events and return the owner address.
    fn emit_n_events(env: &Env, client: &PaymentEventEmitterClient, n: u32) -> Address {
        let owner = Address::generate(env);
        let payer = Address::generate(env);
        let payee = Address::generate(env);
        let _ = client.init(&owner);

        for i in 1..=n {
            let _ = client.emit_payment(
                &owner,
                &String::from_str(env, "src"),
                &payer,
                &payee,
                &((i as i128) * 100),
                &String::from_str(env, "tx"),
            );
        }
        owner
    }

    #[test]
    fn test_get_events_returns_full_range() {
        let env = Env::default();
        env.mock_all_auths();
        let addr = env.register(PaymentEventEmitter, ());
        let client = PaymentEventEmitterClient::new(&env, &addr);

        emit_n_events(&env, &client, 10);
        assert_eq!(client.get_event_count(), 10);

        // Fetch all 10 events in one page
        let events = client.get_events(&1, &10);
        assert_eq!(events.len(), 10);

        // Verify stable ascending order by ID
        for i in 0..events.len() {
            assert_eq!(events.get(i).unwrap().id, (i as u64) + 1);
        }
    }

    #[test]
    fn test_get_events_paginated() {
        let env = Env::default();
        env.mock_all_auths();
        let addr = env.register(PaymentEventEmitter, ());
        let client = PaymentEventEmitterClient::new(&env, &addr);

        emit_n_events(&env, &client, 10);

        // Page 1: events 1-3
        let page1 = client.get_events(&1, &3);
        assert_eq!(page1.len(), 3);
        assert_eq!(page1.get(0).unwrap().id, 1);
        assert_eq!(page1.get(2).unwrap().id, 3);

        // Page 2: events 4-6
        let page2 = client.get_events(&4, &3);
        assert_eq!(page2.len(), 3);
        assert_eq!(page2.get(0).unwrap().id, 4);
        assert_eq!(page2.get(2).unwrap().id, 6);

        // Page 4: events 10-12 (only 10 exists)
        let page4 = client.get_events(&10, &3);
        assert_eq!(page4.len(), 1);
        assert_eq!(page4.get(0).unwrap().id, 10);
    }

    #[test]
    fn test_get_events_empty_when_start_exceeds_count() {
        let env = Env::default();
        env.mock_all_auths();
        let addr = env.register(PaymentEventEmitter, ());
        let client = PaymentEventEmitterClient::new(&env, &addr);

        emit_n_events(&env, &client, 5);

        // start=100 > count=5 → empty
        let events = client.get_events(&100, &10);
        assert_eq!(events.len(), 0);
    }

    #[test]
    fn test_get_events_zero_limit() {
        let env = Env::default();
        env.mock_all_auths();
        let addr = env.register(PaymentEventEmitter, ());
        let client = PaymentEventEmitterClient::new(&env, &addr);

        emit_n_events(&env, &client, 5);

        let events = client.get_events(&1, &0);
        assert_eq!(events.len(), 0);
    }

    #[test]
    fn test_get_events_limit_exceeded() {
        let env = Env::default();
        env.mock_all_auths();
        let addr = env.register(PaymentEventEmitter, ());
        let client = PaymentEventEmitterClient::new(&env, &addr);

        let _ = client.init(&Address::generate(&env));

        // limit > MAX_PAGE_LIMIT (100) → error
        let result = client.try_get_events(&1, &101);
        assert_eq!(result, Err(Ok(EmitterError::PageLimitExceeded)));
    }

    #[test]
    fn test_get_events_boundary_at_max_limit() {
        let env = Env::default();
        env.mock_all_auths();
        let addr = env.register(PaymentEventEmitter, ());
        let client = PaymentEventEmitterClient::new(&env, &addr);

        emit_n_events(&env, &client, 105);

        // limit = MAX_PAGE_LIMIT (100) should succeed
        let events = client.get_events(&1, &100);
        assert_eq!(events.len(), 100);
        assert_eq!(events.get(0).unwrap().id, 1);
        assert_eq!(events.get(99).unwrap().id, 100);

        // Second page: events 101-105
        let events2 = client.get_events(&101, &100);
        assert_eq!(events2.len(), 5);
        assert_eq!(events2.get(0).unwrap().id, 101);
        assert_eq!(events2.get(4).unwrap().id, 105);
    }

    #[test]
    fn test_get_events_returns_correct_amounts() {
        let env = Env::default();
        env.mock_all_auths();
        let addr = env.register(PaymentEventEmitter, ());
        let client = PaymentEventEmitterClient::new(&env, &addr);

        emit_n_events(&env, &client, 5);

        let events = client.get_events(&1, &5);
        assert_eq!(events.get(0).unwrap().amount, 100);
        assert_eq!(events.get(1).unwrap().amount, 200);
        assert_eq!(events.get(2).unwrap().amount, 300);
        assert_eq!(events.get(3).unwrap().amount, 400);
        assert_eq!(events.get(4).unwrap().amount, 500);
    }

    #[test]
    fn test_get_events_no_events_empty_result() {
        let env = Env::default();
        env.mock_all_auths();
        let addr = env.register(PaymentEventEmitter, ());
        let client = PaymentEventEmitterClient::new(&env, &addr);

        let _ = client.init(&Address::generate(&env));

        // No events emitted → empty result
        let events = client.get_events(&1, &10);
        assert_eq!(events.len(), 0);
    }

    #[test]
    fn test_get_events_page_count_calculation() {
        let env = Env::default();
        env.mock_all_auths();
        let addr = env.register(PaymentEventEmitter, ());
        let client = PaymentEventEmitterClient::new(&env, &addr);

        emit_n_events(&env, &client, 25);
        let total = client.get_event_count();
        let limit: u64 = 10;

        // Total pages = ceil(25/10) = 3
        let total_pages = (total + limit - 1) / limit;
        assert_eq!(total_pages, 3);

        // Page 1: events 1-10
        let p1 = client.get_events(&1, &(limit as u32));
        assert_eq!(p1.len(), 10);

        // Page 2: events 11-20
        let p2 = client.get_events(&11, &(limit as u32));
        assert_eq!(p2.len(), 10);

        // Page 3: events 21-25
        let p3 = client.get_events(&21, &(limit as u32));
        assert_eq!(p3.len(), 5);

        // All events accounted for
        let mut all_ids = Vec::new(&env);
        for page in [p1, p2, p3] {
            for i in 0..page.len() {
                all_ids.push_back(page.get(i).unwrap().id);
            }
        }
        assert_eq!(all_ids.len(), 25);
    }
}
