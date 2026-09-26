//! Admin, fee management, spending limits, roles, pause, and upgrades domain entrypoints.

use soroban_sdk::{contractimpl, token, Address, Env, String, Symbol, Vec};

use crate::errors::PaymentError;
use crate::events::*;
use crate::helpers::*;
use crate::storage_keys::*;
use crate::types::*;
use crate::{OphirPayContract, OphirPayContractArgs, OphirPayContractClient};

#[contractimpl]
impl OphirPayContract {
    // ═══════════════════════════════════════════════════════════
    //  ADMIN
    // ═══════════════════════════════════════════════════════════

    /// Initialize the contract with owner address.
    pub fn init(env: Env, owner: Address) -> Result<u32, PaymentError> {
        if env.storage().instance().has(&OWNER) {
            return Err(PaymentError::AlreadyInitialized);
        }
        owner.require_auth();
        env.storage().instance().set(&OWNER, &owner);
        env.storage().instance().set(&VERSION, &CONTRACT_VERSION);
        // Counters default to 0 on first read — no need to pre-initialize.
        // This saves 4+ storage writes (~2,000 gas) on deployment.
        env.storage().instance().extend_ttl(BUMP_MIN_TTL, BUMP_MAX_TTL);
        Ok(CONTRACT_VERSION)
    }

    /// Get the owner
    pub fn get_owner(env: Env) -> Result<Address, PaymentError> {
        env.storage()
            .instance()
            .get(&OWNER)
            .ok_or(PaymentError::NotInitialized)
    }

    /// Get contract version
    pub fn get_version(env: Env) -> u32 {
        env.storage().instance().get(&VERSION).unwrap_or(0)
    }

    /// Get aggregate contract statistics.
    /// Builds ContractStats from individual counter keys (gas-optimized:
    /// each counter is a 16-byte read, vs 200+ byte ContractStats struct).
    pub fn get_stats(env: Env) -> ContractStats {
        ContractStats {
            total_payments_recorded: env.storage().instance().get(&STAT_PAYMENTS).unwrap_or(0),
            total_escrows_created: env.storage().instance().get(&STAT_ESC_CREATED).unwrap_or(0),
            total_escrows_released: env
                .storage()
                .instance()
                .get(&STAT_ESC_RELEASED)
                .unwrap_or(0),
            total_escrows_claimed: env.storage().instance().get(&STAT_ESC_CLAIMED).unwrap_or(0),
            total_streams_created: env.storage().instance().get(&STAT_STR_CREATED).unwrap_or(0),
            total_streams_claimed: env.storage().instance().get(&STAT_STR_CLAIMED).unwrap_or(0),
            total_streams_cancelled: env
                .storage()
                .instance()
                .get(&STAT_STR_CANCELLED)
                .unwrap_or(0),
            total_batches_processed: env.storage().instance().get(&STAT_BATCHES).unwrap_or(0),
            total_amount_escrowed: env
                .storage()
                .instance()
                .get(&STAT_AMT_ESCROWED)
                .unwrap_or(0),
            total_amount_streamed: env
                .storage()
                .instance()
                .get(&STAT_AMT_STREAMED)
                .unwrap_or(0),
            total_amount_batched: env.storage().instance().get(&STAT_AMT_BATCHED).unwrap_or(0),
        }
    }


    // ═══════════════════════════════════════════════════════════
    //  SPENDING LIMITS — Per-user caps with escalation tiers
    // ═══════════════════════════════════════════════════════════

    /// Configure platform fees (owner only). Max 1000 bps = 10%.
    pub fn set_fee_config(
        env: Env,
        caller: Address,
        payment_fee_bps: u32,
        escrow_fee_bps: u32,
        stream_fee_bps: u32,
        batch_base_fee: i128,
        batch_per_item_fee: i128,
        enabled: bool,
    ) -> Result<(), PaymentError> {
        caller.require_auth();
        require_owner(&env, &caller)?;
        if payment_fee_bps > 1000 || escrow_fee_bps > 1000 || stream_fee_bps > 1000 {
            return Err(PaymentError::FeeTooHigh);
        }
        let config = FeeConfig {
            payment_fee_bps,
            escrow_fee_bps,
            stream_fee_bps,
            batch_base_fee,
            batch_per_item_fee,
            enabled,
        };

        // Archive previous version before overwriting
        let mut ver_count: u32 = env.storage().instance().get(&FEE_VER_CNT).unwrap_or(0);
        ver_count = ver_count.saturating_add(1);
        let version_entry = FeeConfigVersion {
            version: ver_count,
            config: config.clone(),
            changed_at: env.ledger().timestamp(),
            changed_by: caller.clone(),
        };
        env.storage()
            .persistent()
            .set(&(FEE_VER_CNT, ver_count), &version_entry);
        env.storage()
            .persistent()
            .extend_ttl(&(FEE_VER_CNT, ver_count), BUMP_MIN_TTL, BUMP_MAX_TTL);
        env.storage().instance().set(&FEE_VER_CNT, &ver_count);

        env.storage().instance().set(&FEE_KEY, &config);
        env.storage().instance().extend_ttl(BUMP_MIN_TTL, BUMP_MAX_TTL);

        record_audit(
            &env,
            "fee_config_set",
            &caller,
            0,
            "Fee configuration updated",
        );

        Ok(())
    }

    /// Get the current fee configuration.
    pub fn get_fee_config(env: Env) -> Option<FeeConfig> {
        let config: Option<FeeConfig> = env.storage().instance().get(&FEE_KEY);
        config
    }

    /// Get fee configuration version history (most recent first, capped at 100).
    /// Returns the latest 100 versions to prevent unbounded storage reads.
    pub fn get_fee_config_history(env: Env) -> Vec<FeeConfigVersion> {
        let total: u32 = env.storage().instance().get(&FEE_VER_CNT).unwrap_or(0);
        let mut history = Vec::new(&env);
        let start = if total > 100 { total - 99 } else { 1 };
        for v in (start..=total).rev() {
            if let Some(entry) = env.storage().persistent().get(&(FEE_VER_CNT, v)) {
                history.push_back(entry);
            }
        }
        history
    }

    /// Get a specific fee config version by number.
    pub fn get_fee_config_at_version(env: Env, version: u32) -> Option<FeeConfigVersion> {
        env.storage().persistent().get(&(FEE_VER_CNT, version))
    }

    /// Set the fee collector address (owner only).
    pub fn set_fee_collector(
        env: Env,
        caller: Address,
        collector: Address,
    ) -> Result<(), PaymentError> {
        caller.require_auth();
        require_owner(&env, &caller)?;
        env.storage().instance().set(&FEE_COLL, &collector);
        env.storage().instance().extend_ttl(BUMP_MIN_TTL, BUMP_MAX_TTL);
        Ok(())
    }

    /// Get the fee collector address.
    pub fn get_fee_collector(env: Env) -> Option<Address> {
        env.storage().instance().get(&FEE_COLL)
    }


    /// Calculate fee for a given amount based on bps.
    /// Computed entirely locally — zero storage access, minimal CPU.
    pub fn calculate_fee(amount: i128, fee_bps: u32) -> i128 {
        compute_fee(amount, fee_bps)
    }

    /// Set spending limits for a user (owner only).
    pub fn set_spending_limit(
        env: Env,
        caller: Address,
        user: Address,
        daily_limit: i128,
        monthly_limit: i128,
        expires_at: u64,
        is_active: bool,
    ) -> Result<(), PaymentError> {
        caller.require_auth();
        require_owner(&env, &caller)?;
        let limit = SpendingLimit {
            daily_limit,
            monthly_limit,
            current_daily_spend: 0,
            current_monthly_spend: 0,
            last_reset_day: env.ledger().timestamp(),
            last_reset_month: env.ledger().timestamp(),
            expires_at,
            is_active,
        };
        let key = (SPEND_LIMIT_KEY, user);
        env.storage().persistent().set(&key, &limit);
        env.storage().persistent().extend_ttl(&key, BUMP_MIN_TTL, BUMP_MAX_TTL);

        record_audit(
            &env,
            "spending_limit_set",
            &caller,
            0,
            "Spending limit configured",
        );

        Ok(())
    }

    /// Get spending limit for a user.
    pub fn get_spending_limit(env: Env, user: Address) -> Option<SpendingLimit> {
        let key = (SPEND_LIMIT_KEY, user);
        env.storage().persistent().get::<_, SpendingLimit>(&key)
    }

    /// Configure escalation rules (owner only).
    pub fn configure_escalation(
        env: Env,
        caller: Address,
        small_threshold: i128,
        medium_threshold: i128,
        enabled: bool,
    ) -> Result<(), PaymentError> {
        caller.require_auth();
        require_owner(&env, &caller)?;
        if small_threshold <= 0 || medium_threshold <= small_threshold {
            return Err(PaymentError::InvalidAmount);
        }
        let rules = EscalationRules {
            small_threshold,
            medium_threshold,
            enabled,
        };
        env.storage().instance().set(&ESCALATION_KEY, &rules);
        env.storage().instance().extend_ttl(BUMP_MIN_TTL, BUMP_MAX_TTL);

        record_audit(
            &env,
            "escalation_configured",
            &caller,
            0,
            "Escalation rules configured",
        );

        Ok(())
    }

    /// Check if a spend is within limits and escalation rules.
    /// Returns Approved, Escalated, or Rejected.
    pub fn check_spending(env: Env, user: Address, amount: i128) -> SpendCheckResult {
        // Check escalation rules
        if let Some(rules) = env
            .storage()
            .instance()
            .get::<_, EscalationRules>(&ESCALATION_KEY)
        {
            if rules.enabled {
                if amount >= rules.medium_threshold {
                    return SpendCheckResult::Escalated;
                }
                if amount >= rules.small_threshold {
                    // Logged but auto-approved — could emit an event here
                }
            }
        }

        // Check per-user spending limits
        let key = (SPEND_LIMIT_KEY, user.clone());
        if let Some(limit) = env.storage().persistent().get::<_, SpendingLimit>(&key) {
            if !limit.is_active {
                return SpendCheckResult::Rejected;
            }

            let now = env.ledger().timestamp();
            let day_seconds: u64 = 86400;
            let month_seconds: u64 = 30 * 86400;

            // NOTE: this is a read-only check (MEDIUM-1 audit fix). It never
            // mutates storage — the counters are updated by atomic_spend, which
            // is the only authorized write path. Previously any address could
            // call check_spending repeatedly to burn a user's allowance.
            let daily_spend = if now.saturating_sub(limit.last_reset_day) >= day_seconds {
                0
            } else {
                limit.current_daily_spend
            };
            let monthly_spend = if now.saturating_sub(limit.last_reset_month) >= month_seconds {
                0
            } else {
                limit.current_monthly_spend
            };

            // Check limits
            if daily_spend.saturating_add(amount) > limit.daily_limit {
                return SpendCheckResult::Rejected;
            }
            if monthly_spend.saturating_add(amount) > limit.monthly_limit {
                return SpendCheckResult::Rejected;
            }
        }

        SpendCheckResult::Approved
    }

    /// Atomic check-and-spend: validate spending limit, then record payment.
    /// If the limit check fails or the allowance is expired, the entire
    /// call reverts — no partial state. Inspired by AgentPay's DelegationManager.
    pub fn atomic_spend(
        env: Env,
        payer: Address,
        payee: Address,
        amount: i128,
        asset: Address,
        tx_hash: String,
        metadata: String,
    ) -> Result<u64, PaymentError> {
        payer.require_auth();
        require_not_paused(&env, PauseScope::Payments)?;
        if amount <= 0 {
            return Err(PaymentError::InvalidAmount);
        }

        // Check spending limits with expiry enforcement
        let key = (SPEND_LIMIT_KEY, payer.clone());
        if let Some(mut limit) = env.storage().persistent().get::<_, SpendingLimit>(&key) {
            if !limit.is_active {
                return Err(PaymentError::SpendingLimitExpired);
            }

            // Check expiry
            let now = env.ledger().timestamp();
            if limit.expires_at > 0 && now >= limit.expires_at {
                limit.is_active = false;
                env.storage().persistent().set(&key, &limit);
                env.storage().persistent().extend_ttl(&key, BUMP_MIN_TTL, BUMP_MAX_TTL);
                return Err(PaymentError::SpendingLimitExpired);
            }

            let day_seconds: u64 = 86400;
            let month_seconds: u64 = 30 * 86400;
            if now.saturating_sub(limit.last_reset_day) >= day_seconds {
                limit.current_daily_spend = 0;
                limit.last_reset_day = now;
            }
            if now.saturating_sub(limit.last_reset_month) >= month_seconds {
                limit.current_monthly_spend = 0;
                limit.last_reset_month = now;
            }
            if limit.current_daily_spend.saturating_add(amount) > limit.daily_limit {
                return Err(PaymentError::SpendingLimitExpired);
            }
            if limit.current_monthly_spend.saturating_add(amount) > limit.monthly_limit {
                return Err(PaymentError::SpendingLimitExpired);
            }
            limit.current_daily_spend = limit.current_daily_spend.saturating_add(amount);
            limit.current_monthly_spend = limit.current_monthly_spend.saturating_add(amount);
            env.storage().persistent().set(&key, &limit);
            env.storage().persistent().extend_ttl(&key, BUMP_MIN_TTL, BUMP_MAX_TTL);
        }

        // Collect protocol fee atomically (only after limit check passes).
        // If fee transfer fails, the entire atomic_spend reverts.
        let _fee = collect_fee(&env, &payer, &asset, amount)?;

        // Record payment atomically
        let mut count: u64 = env.storage().instance().get(&PAYMENT_COUNT).unwrap_or(0);
        count = count.saturating_add(1);

        let payment = Payment {
            id: count,
            payer: payer.clone(),
            payee: payee.clone(),
            amount,
            asset,
            tx_hash: tx_hash.clone(),
            timestamp: env.ledger().timestamp(),
            metadata,
            cancelled: false,
        };

        env.storage()
            .persistent()
            .set(&(PAYMENT_KEY, count), &payment);
        env.storage()
            .persistent()
            .extend_ttl(&(PAYMENT_KEY, count), BUMP_MIN_TTL, BUMP_MAX_TTL);
        env.storage().instance().set(&PAYMENT_COUNT, &count);
        env.storage().instance().extend_ttl(BUMP_MIN_TTL, BUMP_MAX_TTL);

        emit_payment_event(&env, &payer, &payee, &amount);
        inc_counter(&env, &STAT_PAYMENTS);
        record_audit(
            &env,
            "atomic_spend",
            &payer,
            count,
            "Atomic check-and-spend payment",
        );

        Ok(count)
    }

    // ═══════════════════════════════════════════════════════════
    //  RBAC — Role-Based Access Control
    // ═══════════════════════════════════════════════════════════

    /// Grant a role to an address (admin only).
    pub fn grant_role(
        env: Env,
        caller: Address,
        grantee: Address,
        role: Role,
    ) -> Result<(), PaymentError> {
        caller.require_auth();
        Self::require_role(&env, caller.clone(), Role::Admin)?;
        let grantee_clone = grantee.clone();
        let role_clone = role.clone();
        let key = (ROLE_KEY, grantee);
        env.storage().persistent().set(&key, &role);
        env.storage().persistent().extend_ttl(&key, BUMP_MIN_TTL, BUMP_MAX_TTL);
        env.events().publish(
            (Symbol::new(&env, "rbac"), Symbol::new(&env, "grant")),
            (grantee_clone, role_clone),
        );

        record_audit(&env, "role_granted", &caller, 0, "Role granted");

        Ok(())
    }

    /// Revoke a role from an address immediately (admin only).
    ///
    /// For a safer two-step flow, use `propose_revoke_role` followed by
    /// `execute_revoke_role` after the 24-hour timelock.
    pub fn revoke_role(env: Env, caller: Address, grantee: Address) -> Result<(), PaymentError> {
        caller.require_auth();
        Self::require_role(&env, caller.clone(), Role::Admin)?;
        let key = (ROLE_KEY, grantee);
        env.storage().persistent().remove(&key);

        record_audit(&env, "role_revoked", &caller, 0, "Role revoked");

        Ok(())
    }

    // ═══════════════════════════════════════════════════════════
    //  TWO-STEP ADMIN REVOCATION
    // ═══════════════════════════════════════════════════════════

    /// Propose revoking a role from an address (admin only).
    ///
    /// Creates a `PendingRevocation` with a 24-hour timelock.  The target
    /// retains their role until `execute_revoke_role` is called after the
    /// delay.  This prevents accidental or malicious single-transaction
    /// removal of critical admin/auditor roles.
    ///
    /// An admin can only have one pending revocation at a time.  If a
    /// revocation is already pending for the target, this returns an error.
    pub fn propose_revoke_role(
        env: Env,
        caller: Address,
        target: Address,
    ) -> Result<u64, PaymentError> {
        caller.require_auth();
        Self::require_role(&env, caller.clone(), Role::Admin)?;

        if caller == target {
            return Err(PaymentError::CannotRevokeSelf);
        }

        // Verify target actually has a role
        let target_role: Option<Role> = env
            .storage()
            .persistent()
            .get(&(ROLE_KEY, target.clone()));
        if target_role.is_none() {
            return Err(PaymentError::NotARoleHolder);
        }

        // Check no existing pending revocation for this target
        let existing: Option<PendingRevocation> = env
            .storage()
            .persistent()
            .get(&(PENDING_REVOC_KEY, target.clone()));
        if let Some(ref pending) = existing {
            if !pending.executed {
                return Err(PaymentError::RevocationAlreadyExecuted); // reuse: pending exists
            }
        }

        let now = env.ledger().timestamp();
        let pending = PendingRevocation {
            target: target.clone(),
            role: target_role.unwrap(),
            proposed_by: caller.clone(),
            proposed_at: now,
            unlocks_at: now.saturating_add(TMLOCK_DELAY),
            executed: false,
        };

        env.storage()
            .persistent()
            .set(&(PENDING_REVOC_KEY, target.clone()), &pending);
        env.storage()
            .persistent()
            .extend_ttl(&(PENDING_REVOC_KEY, target.clone()), BUMP_MIN_TTL, BUMP_MAX_TTL);

        env.events().publish(
            (
                Symbol::new(&env, "rbac"),
                Symbol::new(&env, "revocation_proposed"),
            ),
            (target.clone(), pending.unlocks_at),
        );

        record_audit(
            &env,
            "role_revocation_proposed",
            &caller,
            0,
            "Admin role revocation proposed (24h timelock)",
        );

        // Return the unlocks_at timestamp so clients know when to execute
        Ok(pending.unlocks_at)
    }

    /// Execute a pending role revocation after the 24-hour timelock.
    ///
    /// Anyone can call this once the timelock has elapsed — the proposal
    /// is already authorized by the original admin.  The target's role is
    /// removed and a `role_revoked` audit entry is recorded.
    pub fn execute_revoke_role(
        env: Env,
        target: Address,
    ) -> Result<(), PaymentError> {
        let mut pending: PendingRevocation = env
            .storage()
            .persistent()
            .get(&(PENDING_REVOC_KEY, target.clone()))
            .ok_or(PaymentError::RevocationNotFound)?;

        if pending.executed {
            return Err(PaymentError::RevocationAlreadyExecuted);
        }

        let now = env.ledger().timestamp();
        if now < pending.unlocks_at {
            return Err(PaymentError::RevocationNotDue);
        }

        // Execute: remove the role
        let key = (ROLE_KEY, target.clone());
        env.storage().persistent().remove(&key);

        // Mark pending revocation as executed
        pending.executed = true;
        env.storage()
            .persistent()
            .set(&(PENDING_REVOC_KEY, target.clone()), &pending);
        env.storage()
            .persistent()
            .extend_ttl(&(PENDING_REVOC_KEY, target.clone()), BUMP_MIN_TTL, BUMP_MAX_TTL);

        env.events().publish(
            (
                Symbol::new(&env, "rbac"),
                Symbol::new(&env, "revocation_executed"),
            ),
            target.clone(),
        );

        record_audit(
            &env,
            "role_revoked",
            &pending.proposed_by,
            0,
            "Admin role revoked via two-step flow",
        );

        Ok(())
    }

    /// Cancel a pending role revocation (admin only).
    ///
    /// Prevents execution of a previously proposed revocation.  The target
    /// retains their role indefinitely.  Only cancellable before execution.
    pub fn cancel_revoke_role(
        env: Env,
        caller: Address,
        target: Address,
    ) -> Result<(), PaymentError> {
        caller.require_auth();
        Self::require_role(&env, caller.clone(), Role::Admin)?;

        let mut pending: PendingRevocation = env
            .storage()
            .persistent()
            .get(&(PENDING_REVOC_KEY, target.clone()))
            .ok_or(PaymentError::RevocationNotFound)?;

        if pending.executed {
            return Err(PaymentError::RevocationAlreadyExecuted);
        }

        pending.executed = true; // mark as cancelled via execution flag
        env.storage()
            .persistent()
            .set(&(PENDING_REVOC_KEY, target.clone()), &pending);
        env.storage()
            .persistent()
            .extend_ttl(&(PENDING_REVOC_KEY, target.clone()), BUMP_MIN_TTL, BUMP_MAX_TTL);

        env.events().publish(
            (
                Symbol::new(&env, "rbac"),
                Symbol::new(&env, "revocation_cancelled"),
            ),
            target,
        );

        record_audit(
            &env,
            "role_revocation_cancelled",
            &caller,
            0,
            "Pending admin role revocation cancelled",
        );

        Ok(())
    }

    /// Get the pending revocation for an address (if any).
    pub fn get_pending_revocation(env: Env, target: Address) -> Option<PendingRevocation> {
        env.storage()
            .persistent()
            .get(&(PENDING_REVOC_KEY, target))
    }

    /// Get the role for an address.
    pub fn get_role(env: Env, addr: Address) -> Option<Role> {
        let key = (ROLE_KEY, addr);
        env.storage().persistent().get::<_, Role>(&key)
    }

    /// Check that `caller` holds at least `required` role.
    /// Admin > Operator > Auditor. Admin can do anything.
    pub fn require_role(env: &Env, caller: Address, required: Role) -> Result<(), PaymentError> {
        let key = (ROLE_KEY, caller.clone());
        let role: Option<Role> = env.storage().persistent().get::<_, Role>(&key);
        match role {
            Some(Role::Admin) => Ok(()), // Admin can do anything
            Some(Role::Operator) if required == Role::Operator || required == Role::Auditor => {
                Ok(())
            }
            Some(Role::Auditor) if required == Role::Auditor => Ok(()),
            Some(ref r) if r == &required => Ok(()),
            _ => {
                // Fallback: check legacy owner
                let owner: Option<Address> = env.storage().instance().get(&OWNER);
                if owner.as_ref() == Some(&caller) {
                    return Ok(());
                }
                Err(PaymentError::NotARoleHolder)
            }
        }
    }

    /// Get total audit log entry count.
    pub fn get_audit_log_count(env: Env) -> u64 {
        env.storage().instance().get(&AUDIT_CNT).unwrap_or(0)
    }

    /// Get a single audit entry by ID.
    pub fn get_audit_entry(env: Env, entry_id: u64) -> Result<AuditEntry, PaymentError> {
        env.storage()
            .persistent()
            .get(&(AUDIT_LOG_KEY, entry_id))
            .ok_or(PaymentError::AuditEntryNotFound)
    }

    /// Get a range of audit entries (most recent first, capped at 100).
    pub fn get_audit_log_range(env: Env, start_id: u64, end_id: u64) -> Vec<AuditEntry> {
        let mut entries = Vec::new(&env);
        for id in (start_id..=end_id).rev() {
            if entries.len() >= 100 {
                break;
            }
            if let Some(e) = env
                .storage()
                .persistent()
                .get::<_, AuditEntry>(&(AUDIT_LOG_KEY, id))
            {
                entries.push_back(e);
            }
        }
        entries
    }

    /// Set the linked Emitter contract address for cross-contract orchestration.
    /// Owner only. Enables emergency_pause_all / emergency_unpause_all.
    pub fn set_emitter(env: Env, caller: Address, emitter: Address) -> Result<(), PaymentError> {
        caller.require_auth();
        require_owner(&env, &caller)?;
        env.storage().instance().set(&EMITTER_ADDR, &emitter);
        env.storage().instance().extend_ttl(BUMP_MIN_TTL, BUMP_MAX_TTL);
        record_audit(&env, "emitter_set", &caller, 0, "Emitter contract linked");
        Ok(())
    }

    /// Get the linked Emitter contract address.
    pub fn get_emitter(env: Env) -> Option<Address> {
        env.storage().instance().get(&EMITTER_ADDR)
    }

    /// Emergency pause: pauses BOTH OphirPay AND the linked Emitter contract
    /// in a single atomic transaction. If the Emitter is not linked, only
    /// OphirPay is paused. This mirrors FacilPay's cross-contract pause_all.
    pub fn emergency_pause_all(env: Env, caller: Address) -> Result<(), PaymentError> {
        let _guard = acquire_reentrancy_lock(&env)?;
        caller.require_auth();
        require_owner(&env, &caller)?;

        // Pause OphirPay
        env.storage().instance().set(&PAUSED, &true);
        env.storage().instance().extend_ttl(BUMP_MIN_TTL, BUMP_MAX_TTL);

        // Cross-contract call: pause the Emitter if linked. The result is
        // propagated (MEDIUM-5 audit fix): if the emitter fails to pause — e.g.
        // its owner differs from this contract's — the whole operation reverts
        // instead of silently leaving the emitter running.
        if let Some(emitter) = env.storage().instance().get(&EMITTER_ADDR) {
            let pause_fn = Symbol::new(&env, "pause");
            let args = soroban_sdk::vec![&env, caller.to_val()];
            let _: () = env.invoke_contract(&emitter, &pause_fn, args);
            release_reentrancy_lock(&env);
        } else {
            release_reentrancy_lock(&env);
        }

        record_audit(
            &env,
            "emergency_pause_all",
            &caller,
            0,
            "All contracts paused",
        );
        Ok(())
    }

    /// Emergency unpause: unpauses BOTH OphirPay AND the linked Emitter contract
    /// in a single atomic transaction.
    pub fn emergency_unpause_all(env: Env, caller: Address) -> Result<(), PaymentError> {
        let _guard = acquire_reentrancy_lock(&env)?;
        caller.require_auth();
        require_owner(&env, &caller)?;

        // Unpause OphirPay
        env.storage().instance().set(&PAUSED, &false);
        env.storage().instance().extend_ttl(BUMP_MIN_TTL, BUMP_MAX_TTL);

        // Cross-contract call: unpause the Emitter if linked. Result propagated
        // (MEDIUM-5 audit fix) so a failure reverts the atomic unpause.
        if let Some(emitter) = env.storage().instance().get(&EMITTER_ADDR) {
            let unpause_fn = Symbol::new(&env, "unpause");
            let args = soroban_sdk::vec![&env, caller.to_val()];
            let _: () = env.invoke_contract(&emitter, &unpause_fn, args);
            release_reentrancy_lock(&env);
        } else {
            release_reentrancy_lock(&env);
        }

        record_audit(
            &env,
            "emergency_unpause_all",
            &caller,
            0,
            "All contracts unpaused",
        );
        Ok(())
    }

    /// Check if the contract is paused.
    pub fn is_paused(env: Env) -> bool {
        env.storage().instance().get(&PAUSED).unwrap_or(false)
    }

    /// Owner-only: pause or resume a single feature scope. The global
    /// emergency pause still overrides every scope. Unknown scope ids are
    /// rejected with `InvalidPauseScope`.
    pub fn set_scope_paused(
        env: Env,
        caller: Address,
        scope: u32,
        paused: bool,
    ) -> Result<(), PaymentError> {
        caller.require_auth();
        require_owner(&env, &caller)?;

        let parsed = parse_pause_scope(scope)?;
        env.storage()
            .instance()
            .set(&pause_scope_key(&env, parsed), &paused);
        env.storage().instance().extend_ttl(BUMP_MIN_TTL, BUMP_MAX_TTL);

        let action = if paused { "scope_paused" } else { "scope_resumed" };
        let details = if paused {
            "Feature scope paused"
        } else {
            "Feature scope resumed"
        };
        record_audit(&env, action, &caller, scope as u64, details);
        Ok(())
    }

    /// Read-only: whether a single feature scope is paused. Unknown scope ids
    /// are rejected with `InvalidPauseScope`.
    pub fn is_scope_paused(env: Env, scope: u32) -> Result<bool, PaymentError> {
        Ok(is_scope_flag_set(&env, parse_pause_scope(scope)?))
    }

    /// Read-only: numeric ids of every scope that is currently paused, in
    /// ascending order. An empty vector means no feature scope is paused.
    pub fn get_paused_scopes(env: Env) -> Vec<u32> {
        let mut paused = Vec::new(&env);
        let mut id: u32 = 0;
        while id < 8 {
            if let Ok(scope) = parse_pause_scope(id) {
                if is_scope_flag_set(&env, scope) {
                    paused.push_back(id);
                }
            }
            id += 1;
        }
        paused
    }

    /// Get the current locked balance (escrows, streams, proposal deposits).
    pub fn get_locked_balance(env: Env) -> i128 {
        env.storage().instance().get(&LOCKED_BALANCE).unwrap_or(0)
    }

    /// Check if the reentrancy lock is currently held.
    pub fn is_reentrancy_locked(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&REENTRANCY_LOCK)
            .unwrap_or(false)
    }

    // ═══════════════════════════════════════════════════════════
    //  STORAGE-BUMP MAINTENANCE
    // ═══════════════════════════════════════════════════════════

    /// Maintenance function: extend TTL on hot persistent entries so they
    /// never expire under Soroban's rent model.  Called by off-chain cron
    /// or by anyone willing to pay the gas (~5 000–15 000 instructions
    /// per batch).
    ///
    /// Accepts optional ID ranges for each record type.  When a range is
    /// empty (start > end), that record type is skipped.  Pass 0,0 to
    /// skip a type entirely.  The function bumps entries whose current
    /// TTL is below `BUMP_MAINTENANCE_TTL` and leaves healthy entries
    /// untouched to minimise gas.
    ///
    /// Returns the total number of entries bumped.
    pub fn bump_storage(
        env: Env,
        payment_range: (u64, u64),
        escrow_range: (u64, u64),
        stream_range: (u64, u64),
        batch_range: (u64, u64),
        audit_range: (u64, u64),
        timelock_range: (u64, u64),
        proposal_range: (u64, u64),
        approval_range: (u64, u64),
        hook_range: (u64, u64),
    ) -> u32 {
        let mut bumped: u32 = 0;

        // Payments
        for id in payment_range.0..=payment_range.1 {
            if env.storage().persistent().has(&(PAYMENT_KEY, id)) {
                env.storage()
                    .persistent()
                    .extend_ttl(&(PAYMENT_KEY, id), BUMP_MIN_TTL, BUMP_MAINTENANCE_TTL);
                bumped += 1;
            }
        }

        // Escrows
        for id in escrow_range.0..=escrow_range.1 {
            if env.storage().persistent().has(&(ESCROW_KEY, id)) {
                env.storage()
                    .persistent()
                    .extend_ttl(&(ESCROW_KEY, id), BUMP_MIN_TTL, BUMP_MAINTENANCE_TTL);
                bumped += 1;
            }
        }

        // Streams
        for id in stream_range.0..=stream_range.1 {
            if env.storage().persistent().has(&(STREAM_KEY, id)) {
                env.storage()
                    .persistent()
                    .extend_ttl(&(STREAM_KEY, id), BUMP_MIN_TTL, BUMP_MAINTENANCE_TTL);
                bumped += 1;
            }
        }

        // Batch payments
        for id in batch_range.0..=batch_range.1 {
            if env.storage().persistent().has(&(BATCH_KEY, id)) {
                env.storage()
                    .persistent()
                    .extend_ttl(&(BATCH_KEY, id), BUMP_MIN_TTL, BUMP_MAINTENANCE_TTL);
                bumped += 1;
            }
        }

        // Audit log entries
        for id in audit_range.0..=audit_range.1 {
            if env.storage().persistent().has(&(AUDIT_LOG_KEY, id)) {
                env.storage()
                    .persistent()
                    .extend_ttl(&(AUDIT_LOG_KEY, id), BUMP_MIN_TTL, BUMP_MAINTENANCE_TTL);
                bumped += 1;
            }
        }

        // Timelocked actions
        for id in timelock_range.0..=timelock_range.1 {
            if env.storage().persistent().has(&(TIMELOCK_KEY, id)) {
                env.storage()
                    .persistent()
                    .extend_ttl(&(TIMELOCK_KEY, id), BUMP_MIN_TTL, BUMP_MAINTENANCE_TTL);
                bumped += 1;
            }
        }

        // Governance proposals
        for id in proposal_range.0..=proposal_range.1 {
            if env.storage().persistent().has(&(PROPOSAL_KEY, id)) {
                env.storage()
                    .persistent()
                    .extend_ttl(&(PROPOSAL_KEY, id), BUMP_MIN_TTL, BUMP_MAINTENANCE_TTL);
                bumped += 1;
            }
        }

        // Multisig approval requests
        for id in approval_range.0..=approval_range.1 {
            if env.storage().persistent().has(&(APPROVAL_KEY, id)) {
                env.storage()
                    .persistent()
                    .extend_ttl(&(APPROVAL_KEY, id), BUMP_MIN_TTL, BUMP_MAINTENANCE_TTL);
                bumped += 1;
            }
        }

        // Notification hooks
        for id in hook_range.0..=hook_range.1 {
            if env.storage().persistent().has(&(HOOK_KEY, id)) {
                env.storage()
                    .persistent()
                    .extend_ttl(&(HOOK_KEY, id), BUMP_MIN_TTL, BUMP_MAINTENANCE_TTL);
                bumped += 1;
            }
        }

        // Always bump instance storage (counters, config, etc.)
        env.storage().instance().extend_ttl(BUMP_MIN_TTL, BUMP_MAINTENANCE_TTL);

        bumped
    }

    /// Return the current bump policy parameters.  Off-chain tooling can
    /// call this to verify the contract's TTL settings without inspecting
    /// WASM constants.
    pub fn get_bump_policy(env: Env) -> (u32, u32, u32) {
        let _ = env; // no storage read needed – constants are compile-time
        (BUMP_MIN_TTL, BUMP_MAX_TTL, BUMP_MAINTENANCE_TTL)
    }

    /// Emergency withdraw: owner can rescue tokens accidentally sent directly
    /// to this contract (bypassing escrow/stream creation). Only withdraws
    /// tokens NOT locked in active escrows or streams.
    ///
    /// SAFETY INVARIANT: withdraw_amount ≤ contract_balance - locked_balance.
    /// This prevents the owner from draining user-deposited funds even if the
    /// owner key is compromised. Violating this invariant returns
    /// InsufficientUnlockedBalance.
    pub fn emergency_withdraw(
        env: Env,
        caller: Address,
        asset: Address,
        amount: i128,
    ) -> Result<(), PaymentError> {
        let _guard = acquire_reentrancy_lock(&env)?;
        caller.require_auth();
        let owner: Address = env
            .storage()
            .instance()
            .get(&OWNER)
            .ok_or(PaymentError::NotInitialized)?;
        if caller != owner {
            return Err(PaymentError::Unauthorized);
        }
        if amount <= 0 {
            return Err(PaymentError::NoTokensToWithdraw);
        }

        // INVARIANT: cannot withdraw locked user funds
        let token_client = token::Client::new(&env, &asset);
        let contract_addr = env.current_contract_address();
        let contract_balance = token_client.balance(&contract_addr);
        let locked: i128 = env.storage().instance().get(&LOCKED_BALANCE).unwrap_or(0);
        let unlocked = contract_balance.saturating_sub(locked);
        if amount > unlocked {
            return Err(PaymentError::NoTokensToWithdraw);
        }

        token_client.transfer(&contract_addr, &owner, &amount);

        record_audit(
            &env,
            "emergency_withdraw",
            &caller,
            0,
            "Emergency withdrawal",
        );

        Ok(())
    }

    /// Propose a contract upgrade (owner only). Sets a 24-hour timelock.
    /// After the timelock expires, anyone can call `execute_upgrade`.
    pub fn propose_upgrade(
        env: Env,
        caller: Address,
        new_wasm_hash: soroban_sdk::BytesN<32>,
    ) -> Result<(), PaymentError> {
        caller.require_auth();
        require_owner(&env, &caller)?;
        let unlock_at = env.ledger().timestamp().saturating_add(TMLOCK_DELAY); // 24 hours
        env.storage().instance().set(&UPGRADE_HASH, &new_wasm_hash);
        env.storage().instance().set(&UPGRADE_TIMELOCK, &unlock_at);
        env.storage().instance().extend_ttl(BUMP_MIN_TTL, BUMP_MAX_TTL);

        record_audit(&env, "upgrade_proposed", &caller, 0, "Upgrade proposed");

        Ok(())
    }

    /// Execute a previously proposed upgrade after the timelock expires.
    pub fn execute_upgrade(env: Env) -> Result<(), PaymentError> {
        let new_wasm_hash: soroban_sdk::BytesN<32> = env
            .storage()
            .instance()
            .get(&UPGRADE_HASH)
            .ok_or(PaymentError::UpgradeNotProposed)?;

        let unlock_at: u64 = env.storage().instance().get(&UPGRADE_TIMELOCK).unwrap_or(0);

        if env.ledger().timestamp() < unlock_at {
            return Err(PaymentError::UpgradeTimelockActive);
        }

        // Clear the pending upgrade
        env.storage().instance().remove(&UPGRADE_HASH);
        env.storage().instance().remove(&UPGRADE_TIMELOCK);
        env.storage().instance().extend_ttl(BUMP_MIN_TTL, BUMP_MAX_TTL);

        env.deployer().update_current_contract_wasm(new_wasm_hash);

        record_audit(
            &env,
            "upgrade_executed",
            &env.current_contract_address(),
            0,
            "Upgrade executed",
        );

        Ok(())
    }

    /// Cancel a pending upgrade (owner only).
    pub fn cancel_upgrade(env: Env, caller: Address) -> Result<(), PaymentError> {
        caller.require_auth();
        require_owner(&env, &caller)?;
        env.storage().instance().remove(&UPGRADE_HASH);
        env.storage().instance().remove(&UPGRADE_TIMELOCK);
        env.storage().instance().extend_ttl(BUMP_MIN_TTL, BUMP_MAX_TTL);

        record_audit(&env, "upgrade_cancelled", &caller, 0, "Upgrade cancelled");

        Ok(())
    }

    /// Propose a new owner (two-step transfer).
    /// The current owner proposes a new owner. After a 24-hour timelock,
    /// the new owner must call `accept_ownership` to complete the transfer.
    /// This prevents accidental or malicious ownership changes.
    pub fn transfer_ownership(
        env: Env,
        caller: Address,
        new_owner: Address,
    ) -> Result<(), PaymentError> {
        caller.require_auth();
        require_owner(&env, &caller)?;

        env.storage().instance().set(&PENDING_OWNER, &new_owner);
        env.storage()
            .instance()
            .set(&OWNER_PROPOSED_AT, &env.ledger().timestamp());
        env.storage().instance().extend_ttl(BUMP_MIN_TTL, BUMP_MAX_TTL);

        record_audit(
            &env,
            "ownership_proposed",
            &caller,
            0,
            "Two-step ownership transfer proposed",
        );

        Ok(())
    }

    /// Accept ownership after the 24-hour timelock.
    /// Called by the proposed new owner. Reverts if no transfer is pending
    /// or if the timelock hasn't elapsed.
    pub fn accept_ownership(env: Env, caller: Address) -> Result<(), PaymentError> {
        caller.require_auth();

        let pending: Address = env
            .storage()
            .instance()
            .get(&PENDING_OWNER)
            .ok_or(PaymentError::NoPendingOwner)?; // no pending transfer

        if caller != pending {
            return Err(PaymentError::Unauthorized);
        }

        let proposed_at: u64 = env
            .storage()
            .instance()
            .get(&OWNER_PROPOSED_AT)
            .unwrap_or(0);

        let now = env.ledger().timestamp();
        let min_delay: u64 = 86400; // 24 hours
        if now.saturating_sub(proposed_at) < min_delay {
            return Err(PaymentError::UpgradeTimelockActive); // reuse: timelock not elapsed
        }

        // Clear pending state
        env.storage().instance().remove(&PENDING_OWNER);
        env.storage().instance().remove(&OWNER_PROPOSED_AT);

        // Complete the transfer
        env.storage().instance().set(&OWNER, &caller);
        env.storage().instance().extend_ttl(BUMP_MIN_TTL, BUMP_MAX_TTL);

        record_audit(
            &env,
            "ownership_accepted",
            &caller,
            0,
            "Two-step ownership transfer completed",
        );

        Ok(())
    }

    /// Cancel a pending ownership transfer (current owner only).
    pub fn cancel_ownership_transfer(env: Env, caller: Address) -> Result<(), PaymentError> {
        caller.require_auth();
        require_owner(&env, &caller)?;

        env.storage().instance().remove(&PENDING_OWNER);
        env.storage().instance().remove(&OWNER_PROPOSED_AT);
        env.storage().instance().extend_ttl(BUMP_MIN_TTL, BUMP_MAX_TTL);

        record_audit(
            &env,
            "ownership_cancelled",
            &caller,
            0,
            "Pending ownership transfer cancelled",
        );

        Ok(())
    }

    /// Check if there's a pending ownership transfer.
    pub fn get_pending_owner(env: Env) -> Option<(Address, u64)> {
        let pending: Option<Address> = env.storage().instance().get(&PENDING_OWNER);
        let proposed_at: Option<u64> = env.storage().instance().get(&OWNER_PROPOSED_AT);
        match (pending, proposed_at) {
            (Some(addr), Some(ts)) => Some((addr, ts)),
            _ => None,
        }
    }

}
