//! Notification hooks domain entrypoints.

use soroban_sdk::{contractimpl, Address, Env, String, Symbol, Vec};

use crate::errors::PaymentError;
use crate::helpers::*;
use crate::storage_keys::*;
use crate::types::*;
use crate::{OphirPayContract, OphirPayContractArgs, OphirPayContractClient};

#[contractimpl]
impl OphirPayContract {
    // ═══════════════════════════════════════════════════════════
    //  NOTIFICATION HOOKS — On-chain webhook subscriptions
    // ═══════════════════════════════════════════════════════════

    /// Register a notification hook subscription.
    /// Returns the hook ID for later management.
    pub fn register_hook(
        env: Env,
        subscriber: Address,
        event_type: String,
        webhook_url: String,
    ) -> Result<u64, PaymentError> {
        subscriber.require_auth();
        require_not_paused(&env, PauseScope::Hooks)?;
        if event_type.is_empty() || webhook_url.is_empty() {
            return Err(PaymentError::InvalidAmount);
        }

        let mut count: u64 = env.storage().instance().get(&HOOK_CNT).unwrap_or(0);
        count = count.saturating_add(1);

        let hook = NotificationHook {
            id: count,
            subscriber: subscriber.clone(),
            event_type: event_type.clone(),
            webhook_url: webhook_url.clone(),
            active: true,
            created_at: env.ledger().timestamp(),
        };

        // Store hook by ID
        env.storage().persistent().set(&(HOOK_KEY, count), &hook);
        env.storage()
            .persistent()
            .extend_ttl(&(HOOK_KEY, count), BUMP_MIN_TTL, BUMP_MAX_TTL);

        // Index: subscriber → hook IDs (for management)
        let subscriber_clone = subscriber.clone();
        let sub_key = (Symbol::new(&env, "HOOK_SUB"), subscriber);
        let mut subscriber_hooks: Vec<u64> = env
            .storage()
            .persistent()
            .get(&sub_key)
            .unwrap_or(Vec::new(&env));
        subscriber_hooks.push_back(count);
        env.storage().persistent().set(&sub_key, &subscriber_hooks);
        env.storage().persistent().extend_ttl(&sub_key, BUMP_MIN_TTL, BUMP_MAX_TTL);

        env.storage().instance().set(&HOOK_CNT, &count);
        env.storage().instance().extend_ttl(BUMP_MIN_TTL, BUMP_MAX_TTL);

        env.events().publish(
            (Symbol::new(&env, "hook"), Symbol::new(&env, "registered")),
            (count, event_type),
        );

        record_audit(
            &env,
            "hook_registered",
            &subscriber_clone,
            count,
            "Notification hook registered",
        );

        Ok(count)
    }

    /// Unregister (deactivate) a notification hook by ID.
    /// Only the subscriber who created the hook can deactivate it.
    pub fn unregister_hook(env: Env, caller: Address, hook_id: u64) -> Result<(), PaymentError> {
        caller.require_auth();
        let mut hook: NotificationHook = env
            .storage()
            .persistent()
            .get(&(HOOK_KEY, hook_id))
            .ok_or(PaymentError::HookNotFound)?;

        if hook.subscriber != caller {
            return Err(PaymentError::Unauthorized);
        }

        hook.active = false;
        env.storage().persistent().set(&(HOOK_KEY, hook_id), &hook);
        env.storage()
            .persistent()
            .extend_ttl(&(HOOK_KEY, hook_id), BUMP_MIN_TTL, BUMP_MAX_TTL);

        env.events().publish(
            (Symbol::new(&env, "hook"), Symbol::new(&env, "unregistered")),
            hook_id,
        );

        record_audit(
            &env,
            "hook_unregistered",
            &caller,
            hook_id,
            "Notification hook deactivated",
        );

        Ok(())
    }

    /// Get all active hooks for a specific event type.
    /// Used by off-chain relayer to deliver webhooks after an event fires.
    /// Returns (hook_id, webhook_url) pairs for relayers to deliver to.
    pub fn get_hooks_by_event(env: Env, event_type: String) -> Vec<(u64, String)> {
        let total: u64 = env.storage().instance().get(&HOOK_CNT).unwrap_or(0);
        let mut results = Vec::new(&env);

        for id in 1..=total {
            if let Some(hook) = env
                .storage()
                .persistent()
                .get::<_, NotificationHook>(&(HOOK_KEY, id))
            {
                if hook.active && hook.event_type == event_type {
                    results.push_back((id, hook.webhook_url));
                }
            }
            if results.len() >= 50 {
                break;
            }
        }

        results
    }

    /// Get a subscriber's hooks, most recently registered first.
    ///
    /// Bounded enumeration (#742): a subscriber can register an unbounded
    /// number of hooks, so the read is capped at [`MAX_READER_ENTRIES`] and
    /// reports whether it had to stop early — callers can then page or narrow
    /// the query instead of treating an incomplete list as complete.
    pub fn get_subscriber_hooks(env: Env, subscriber: Address) -> HookList {
        let sub_key = (Symbol::new(&env, "HOOK_SUB"), subscriber.clone());
        let hook_ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&sub_key)
            .unwrap_or(Vec::new(&env));

        let total = hook_ids.len();
        let mut items = Vec::new(&env);
        let mut scanned: u32 = 0;

        for index in 0..total {
            if items.len() >= MAX_READER_ENTRIES {
                break;
            }
            scanned += 1;
            // Newest first: `register_hook` appends, so the tail of the index
            // vector holds the most recently created hooks.
            let id = hook_ids.get(total - 1 - index).unwrap_or(0);
            if let Some(hook) = env
                .storage()
                .persistent()
                .get::<_, NotificationHook>(&(HOOK_KEY, id))
            {
                items.push_back(hook);
            }
        }

        HookList {
            items,
            total,
            // Exact: true only when the index vector was not fully walked.
            truncated: scanned < total,
        }
    }

    /// Get total registered hook count.
    pub fn get_hook_count(env: Env) -> u64 {
        env.storage().instance().get(&HOOK_CNT).unwrap_or(0)
    }

}
