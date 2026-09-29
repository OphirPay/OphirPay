#![allow(unused_imports)]
#![allow(dead_code)]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token, Address, Env, String,
    Symbol, Vec,
};
use crate::storage::*;
use crate::types::*;
use crate::errors::*;
use crate::events::*;
use crate::helpers::*;
// ── Contract Version ───────────────────────────────────────────
pub const CONTRACT_VERSION: u32 = 2;

// ── Storage-Bump Policy Constants ──────────────────────────────
// Soroban persistent storage entries have a TTL measured in ledgers.
// Without periodic bumps, entries expire and data is lost permanently.
//
// Policy:
//   • `BUMP_MIN_TTL` (5 000 ledgers ≈ 3.5 days): minimum TTL applied
//     on every write.  If residual TTL is already ≥ 5 000 the call is a
//     no-op (Soroban clamps to current_ttl + min/max).
//   • `BUMP_MAX_TTL` (50 000 ledgers ≈ 35 days): the ceiling that entries
//     are bumped to on every write or maintenance call.
//   • `BUMP_MAINTENANCE_TTL` (100 000 ledgers ≈ 70 days): the ceiling
//     used by the `bump_storage` maintenance function.  Higher than
//     on-write bumps to reduce maintenance frequency.
//
// Hot entries (payments, escrows, streams, batches, audit logs,
// approval requests, timelocks, proposals, hooks, fees, multisig
// config versions) are bumped on every write.
//
// Cold entries (roles, spending limits, escalation rules) are bumped
// on every write as well, since the gas cost is negligible (~1 500
// WASM instructions per extend_ttl call).
pub const BUMP_MIN_TTL: u32 = 5_000;
pub const BUMP_MAX_TTL: u32 = 50_000;
pub const BUMP_MAINTENANCE_TTL: u32 = 100_000;

// ── Enumeration Cap (docs/AUDIT.md MEDIUM-2, issue #742) ───────
// Every *enumerating* reader is bounded by this many entries, newest first.
// The upstream collections are only bounded by what a writer pushed into them
// (a subscriber can register an unlimited number of hooks, and a batch written
// before the `BatchTooLarge` guard existed can hold more ids than
// `create_batch` accepts today), so without a cap a single read could walk an
// arbitrarily long stored vector and exceed the instruction budget. Capping
// turns that into a bounded result plus an explicit `truncated` flag instead of
// an unreliable endpoint. Matches the existing 100-entry caps in
// `get_audit_log_range`, `get_payments_range`, `get_fee_config_history` and
// `get_reason_code_analytics`.
pub const MAX_READER_ENTRIES: u32 = 100;

// ── Contract ───────────────────────────────────────────────────

#[contract]
pub struct OphirPayContract;

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
    //  MULTISIG APPROVALS — N-of-M signers for large payments
    // ═══════════════════════════════════════════════════════════

    /// Configure multisig (owner only). Set threshold and signer list.
    pub fn set_multisig_config(
        env: Env,
        caller: Address,
        threshold: u32,
        signers: Vec<Address>,
        enabled: bool,
    ) -> Result<(), PaymentError> {
        caller.require_auth();
        require_owner(&env, &caller)?;

        let mut unique_signers = Vec::new(&env);
        for signer in signers.into_iter() {
            if !unique_signers.contains(signer.clone()) {
                unique_signers.push_back(signer);
            }
        }

        if unique_signers.len() > 50 {
            return Err(PaymentError::MaxSignersExceeded);
        }

        if threshold == 0 || threshold > unique_signers.len() {
            return Err(PaymentError::InvalidAmount);
        }

        let config = MultisigConfig {
            threshold,
            signers: unique_signers,
            enabled,
        };

        // Archive previous version before overwriting
        let mut ver_count: u32 = env.storage().instance().get(&MSIG_VER_CNT).unwrap_or(0);
        ver_count = ver_count.saturating_add(1);
        let version_entry = MultisigVersion {
            version: ver_count,
            config: config.clone(),
            changed_at: env.ledger().timestamp(),
            changed_by: caller.clone(),
        };
        env.storage()
            .persistent()
            .set(&(MSIG_VER_CNT, ver_count), &version_entry);
        env.storage()
            .persistent()
            .extend_ttl(&(MSIG_VER_CNT, ver_count), BUMP_MIN_TTL, BUMP_MAX_TTL);
        env.storage().instance().set(&MSIG_VER_CNT, &ver_count);

        env.storage().instance().set(&MULTISIG_CONFIG, &config);
        env.storage().instance().extend_ttl(BUMP_MIN_TTL, BUMP_MAX_TTL);

        record_audit(
            &env,
            "multisig_configured",
            &caller,
            threshold as u64,
            "Multisig configured",
        );

        Ok(())
    }

    /// Get current multisig config.
    pub fn get_multisig_config(env: Env) -> Option<MultisigConfig> {
        let config: Option<MultisigConfig> = env.storage().instance().get(&MULTISIG_CONFIG);
        config
    }

    /// Get multisig configuration version history (most recent first, capped at 100).
    /// Returns the latest 100 versions to prevent unbounded storage reads.
    pub fn get_multisig_config_history(env: Env) -> Vec<MultisigVersion> {
        let total: u32 = env.storage().instance().get(&MSIG_VER_CNT).unwrap_or(0);
        let mut history = Vec::new(&env);
        let start = if total > 100 { total - 99 } else { 1 };
        for v in (start..=total).rev() {
            if let Some(entry) = env.storage().persistent().get(&(MSIG_VER_CNT, v)) {
                history.push_back(entry);
            }
        }
        history
    }

    /// Propose a payment that requires multisig approval.
    pub fn propose_payment(
        env: Env,
        proposer: Address,
        payee: Address,
        amount: i128,
        asset: Address,
        tx_hash: String,
    ) -> Result<u64, PaymentError> {
        proposer.require_auth();
        require_not_paused(&env, PauseScope::Payments)?;

        let config: MultisigConfig = env
            .storage()
            .instance()
            .get(&MULTISIG_CONFIG)
            .ok_or(PaymentError::MultisigNotConfigured)?;
        if !config.enabled {
            return Err(PaymentError::MultisigNotConfigured);
        }

        let mut count: u64 = env.storage().instance().get(&APPROVAL_COUNT).unwrap_or(0);
        count += 1;

        let approvals: Vec<Address> = Vec::new(&env);
        let proposer_clone = proposer.clone();
        let request = ApprovalRequest {
            id: count,
            proposer,
            payee,
            amount,
            asset,
            tx_hash,
            approvals,
            executed: false,
            created_at: env.ledger().timestamp(),
        };

        env.storage()
            .persistent()
            .set(&(APPROVAL_KEY, count), &request);
        env.storage()
            .persistent()
            .extend_ttl(&(APPROVAL_KEY, count), BUMP_MIN_TTL, BUMP_MAX_TTL);
        env.storage().instance().set(&APPROVAL_COUNT, &count);
        env.storage().instance().extend_ttl(BUMP_MIN_TTL, BUMP_MAX_TTL);

        env.events().publish(
            (Symbol::new(&env, "approval"), Symbol::new(&env, "proposed")),
            count,
        );

        record_audit(
            &env,
            "multisig_proposed",
            &proposer_clone,
            count,
            "Multisig payment proposed",
        );

        Ok(count)
    }

    /// Signer approves a pending payment proposal.
    pub fn approve_payment(
        env: Env,
        signer: Address,
        request_id: u64,
    ) -> Result<bool, PaymentError> {
        signer.require_auth();
        require_not_paused(&env, PauseScope::Payments)?;

        let config: MultisigConfig = env
            .storage()
            .instance()
            .get(&MULTISIG_CONFIG)
            .ok_or(PaymentError::MultisigNotConfigured)?;

        // Verify signer is in the list
        let is_signer = config.signers.iter().any(|s| s == signer);
        if !is_signer {
            return Err(PaymentError::NotASigner);
        }

        let mut request: ApprovalRequest = env
            .storage()
            .persistent()
            .get(&(APPROVAL_KEY, request_id))
            .ok_or(PaymentError::PaymentNotFound)?;

        if request.executed {
            return Err(PaymentError::AlreadyExecuted);
        }

        // Check for duplicate approval
        if request.approvals.iter().any(|a| a == signer) {
            return Err(PaymentError::AlreadyApproved);
        }

        request.approvals.push_back(signer.clone());
        env.storage()
            .persistent()
            .set(&(APPROVAL_KEY, request_id), &request);
        env.storage()
            .persistent()
            .extend_ttl(&(APPROVAL_KEY, request_id), BUMP_MIN_TTL, BUMP_MAX_TTL);

        let threshold_met = request.approvals.len() >= config.threshold;

        env.events().publish(
            (Symbol::new(&env, "approval"), Symbol::new(&env, "approved")),
            (request_id, signer),
        );

        Ok(threshold_met)
    }

    /// Execute a fully-approved payment (any signer can trigger).
    pub fn execute_approved_payment(
        env: Env,
        caller: Address,
        request_id: u64,
    ) -> Result<u64, PaymentError> {
        caller.require_auth();
        require_not_paused(&env, PauseScope::Payments)?;

        let config: MultisigConfig = env
            .storage()
            .instance()
            .get(&MULTISIG_CONFIG)
            .ok_or(PaymentError::MultisigNotConfigured)?;

        let mut request: ApprovalRequest = env
            .storage()
            .persistent()
            .get(&(APPROVAL_KEY, request_id))
            .ok_or(PaymentError::PaymentNotFound)?;

        if request.executed {
            return Err(PaymentError::AlreadyExecuted);
        }
        if request.approvals.len() < config.threshold {
            return Err(PaymentError::ThresholdNotMet);
        }

        // Record the payment
        let mut pay_count: u64 = env.storage().instance().get(&PAYMENT_COUNT).unwrap_or(0);
        pay_count += 1;

        let payment = Payment {
            id: pay_count,
            payer: request.proposer.clone(),
            payee: request.payee.clone(),
            amount: request.amount,
            asset: request.asset.clone(),
            tx_hash: request.tx_hash.clone(),
            timestamp: env.ledger().timestamp(),
            metadata: String::from_str(&env, "multisig"),
            cancelled: false,
        };

        env.storage()
            .persistent()
            .set(&(PAYMENT_KEY, pay_count), &payment);
        env.storage()
            .persistent()
            .extend_ttl(&(PAYMENT_KEY, pay_count), BUMP_MIN_TTL, BUMP_MAX_TTL);
        env.storage().instance().set(&PAYMENT_COUNT, &pay_count);
        env.storage().instance().extend_ttl(BUMP_MIN_TTL, BUMP_MAX_TTL);

        request.executed = true;
        env.storage()
            .persistent()
            .set(&(APPROVAL_KEY, request_id), &request);
        env.storage()
            .persistent()
            .extend_ttl(&(APPROVAL_KEY, request_id), BUMP_MIN_TTL, BUMP_MAX_TTL);

        inc_counter(&env, &STAT_PAYMENTS);

        env.events().publish(
            (Symbol::new(&env, "approval"), Symbol::new(&env, "executed")),
            (request_id, pay_count),
        );

        record_audit(
            &env,
            "multisig_executed",
            &caller,
            request_id,
            "Multisig payment executed",
        );

        Ok(pay_count)
    }

    /// Get an approval request by ID.
    pub fn get_approval_request(env: Env, request_id: u64) -> Option<ApprovalRequest> {
        env.storage().persistent().get(&(APPROVAL_KEY, request_id))
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

    // ═══════════════════════════════════════════════════════════
    //  TIMELOCKED ACTIONS — 24h delay on sensitive admin ops
    // ═══════════════════════════════════════════════════════════

    /// Propose a timelocked admin action. Returns the action ID.
    /// After 24 hours, anyone can call `execute_timelocked_action`.
    pub fn propose_timelocked_action(
        env: Env,
        caller: Address,
        action_type: String,
        target: String,
        data: String,
    ) -> Result<u64, PaymentError> {
        caller.require_auth();
        require_owner(&env, &caller)?;

        let now = env.ledger().timestamp();
        let mut count: u64 = env.storage().instance().get(&TMLOCK_CNT).unwrap_or(0);
        count = count.saturating_add(1);

        let action = TimelockedAction {
            id: count,
            action_type,
            target,
            data,
            proposed_by: caller.clone(),
            proposed_at: now,
            unlocks_at: now.saturating_add(TMLOCK_DELAY),
            executed: false,
        };

        env.storage()
            .persistent()
            .set(&(TIMELOCK_KEY, count), &action);
        env.storage()
            .persistent()
            .extend_ttl(&(TIMELOCK_KEY, count), BUMP_MIN_TTL, BUMP_MAX_TTL);
        env.storage().instance().set(&TMLOCK_CNT, &count);
        env.storage().instance().extend_ttl(BUMP_MIN_TTL, BUMP_MAX_TTL);

        env.events().publish(
            (Symbol::new(&env, "timelock"), Symbol::new(&env, "proposed")),
            count,
        );

        record_audit(
            &env,
            "timelock_proposed",
            &caller,
            count,
            "Timelocked action proposed",
        );

        Ok(count)
    }

    /// Execute a timelocked action after the delay has passed.
    /// This marks it as executed; the actual state change is performed by
    /// an off-chain relayer that reads the action data.
    pub fn execute_timelocked_action(env: Env, action_id: u64) -> Result<(), PaymentError> {
        let mut action: TimelockedAction = env
            .storage()
            .persistent()
            .get(&(TIMELOCK_KEY, action_id))
            .ok_or(PaymentError::TimelockNotFound)?;

        if action.executed {
            return Err(PaymentError::TimelockAlreadyExecuted);
        }

        let now = env.ledger().timestamp();
        if now < action.unlocks_at {
            return Err(PaymentError::TimelockNotDue);
        }

        action.executed = true;
        env.storage()
            .persistent()
            .set(&(TIMELOCK_KEY, action_id), &action);
        env.storage()
            .persistent()
            .extend_ttl(&(TIMELOCK_KEY, action_id), BUMP_MIN_TTL, BUMP_MAX_TTL);

        env.events().publish(
            (Symbol::new(&env, "timelock"), Symbol::new(&env, "executed")),
            action_id,
        );

        record_audit(
            &env,
            "timelock_executed",
            &env.current_contract_address(),
            action_id,
            "Timelocked action executed",
        );

        Ok(())
    }

    /// Cancel a pending timelocked action (owner only).
    pub fn cancel_timelocked_action(
        env: Env,
        caller: Address,
        action_id: u64,
    ) -> Result<(), PaymentError> {
        caller.require_auth();
        require_owner(&env, &caller)?;

        let mut action: TimelockedAction = env
            .storage()
            .persistent()
            .get(&(TIMELOCK_KEY, action_id))
            .ok_or(PaymentError::TimelockNotFound)?;

        if action.executed {
            return Err(PaymentError::TimelockAlreadyExecuted);
        }

        action.executed = true; // mark as "cancelled" via execution flag
        env.storage()
            .persistent()
            .set(&(TIMELOCK_KEY, action_id), &action);
        env.storage()
            .persistent()
            .extend_ttl(&(TIMELOCK_KEY, action_id), BUMP_MIN_TTL, BUMP_MAX_TTL);

        record_audit(
            &env,
            "timelock_cancelled",
            &caller,
            action_id,
            "Timelocked action cancelled",
        );

        Ok(())
    }

    /// Get a timelocked action by ID.
    pub fn get_timelocked_action(
        env: Env,
        action_id: u64,
    ) -> Result<TimelockedAction, PaymentError> {
        env.storage()
            .persistent()
            .get(&(TIMELOCK_KEY, action_id))
            .ok_or(PaymentError::TimelockNotFound)
    }

    /// Get timelock action count.
    pub fn get_timelock_count(env: Env) -> u64 {
        env.storage().instance().get(&TMLOCK_CNT).unwrap_or(0)
    }

    // ═══════════════════════════════════════════════════════════
    //  GOVERNANCE — DAO-ready proposal → vote → execute
    // ═══════════════════════════════════════════════════════════

    /// Configure governance parameters (owner only).
    pub fn configure_governance(
        env: Env,
        caller: Address,
        min_proposal_deposit: i128,
        voting_period: u64,
        quorum_bps: u32,
        enabled: bool,
    ) -> Result<(), PaymentError> {
        caller.require_auth();
        require_owner(&env, &caller)?;
        if quorum_bps > 10000 {
            return Err(PaymentError::InvalidAmount);
        }
        let config = GovernanceConfig {
            min_proposal_deposit,
            voting_period,
            quorum_bps,
            enabled,
        };
        env.storage().instance().set(&GOV_CONF, &config);
        env.storage().instance().extend_ttl(BUMP_MIN_TTL, BUMP_MAX_TTL);

        record_audit(
            &env,
            "governance_configured",
            &caller,
            0,
            "Governance configured",
        );

        Ok(())
    }

    /// Get governance configuration.
    pub fn get_governance_config(env: Env) -> Option<GovernanceConfig> {
        env.storage().instance().get(&GOV_CONF)
    }

    /// Create a governance proposal. Requires minimum deposit.
    /// If min_proposal_deposit > 0, proposer must transfer that amount in
    /// `deposit_asset` to the contract. The deposit is locked until the
    /// proposal is executed (passed or defeated), at which point it can
    /// be reclaimed by the proposer. This prevents spam proposals.
    pub fn create_proposal(
        env: Env,
        proposer: Address,
        title: String,
        description: String,
        action_type: String,
        target: String,
        data: String,
        deposit_asset: Address,
        deposit_amount: i128,
    ) -> Result<u64, PaymentError> {
        let _guard = acquire_reentrancy_lock(&env)?;
        proposer.require_auth();
        require_not_paused(&env, PauseScope::Governance)?;

        let config: GovernanceConfig = env
            .storage()
            .instance()
            .get(&GOV_CONF)
            .ok_or(PaymentError::GovernanceNotConfigured)?;

        if !config.enabled {
            return Err(PaymentError::GovernanceNotConfigured);
        }

        // Enforce minimum proposal deposit
        if deposit_amount < config.min_proposal_deposit {
            return Err(PaymentError::DepositTooLow);
        }

        // Transfer deposit from proposer to contract (if deposit > 0).
        // Reentrancy-guarded (MEDIUM-4) — a malicious deposit asset could
        // otherwise call back into the contract mid-transfer.
        if deposit_amount > 0 {
            let token_client = token::Client::new(&env, &deposit_asset);
            let contract_addr = env.current_contract_address();
            token_client.transfer(&proposer, &contract_addr, &deposit_amount);
            // Track deposit in LOCKED_BALANCE so emergency_withdraw can't drain it
            add_locked(&env, deposit_amount);
        }

        let now = env.ledger().timestamp();
        let mut count: u64 = env.storage().instance().get(&GOV_CNT).unwrap_or(0);
        count = count.saturating_add(1);

        let proposal = Proposal {
            id: count,
            proposer: proposer.clone(),
            title,
            description,
            action_type,
            target,
            data,
            yes_votes: 0,
            no_votes: 0,
            voting_ends_at: now.saturating_add(config.voting_period),
            executed: false,
            created_at: now,
            deposit_asset: deposit_asset.clone(),
            deposit_amount,
        };

        env.storage()
            .persistent()
            .set(&(PROPOSAL_KEY, count), &proposal);
        env.storage()
            .persistent()
            .extend_ttl(&(PROPOSAL_KEY, count), BUMP_MIN_TTL, BUMP_MAX_TTL);
        env.storage().instance().set(&GOV_CNT, &count);
        env.storage().instance().extend_ttl(BUMP_MIN_TTL, BUMP_MAX_TTL);

        env.events().publish(
            (
                Symbol::new(&env, "governance"),
                Symbol::new(&env, "proposed"),
            ),
            count,
        );

        record_audit(
            &env,
            "proposal_created",
            &proposer,
            count,
            "Governance proposal created",
        );

        Ok(count)
    }

    /// Vote on a proposal. Each address gets exactly 1 vote per proposal.
    /// Voting weight is NOT self-reported — it is always 1 per unique voter.
    /// This prevents the "self-reported weight" attack where a caller could
    /// claim arbitrary voting power.
    pub fn vote_on_proposal(
        env: Env,
        voter: Address,
        proposal_id: u64,
        support: bool, // true = yes, false = no
    ) -> Result<(), PaymentError> {
        voter.require_auth();
        require_not_paused(&env, PauseScope::Governance)?;

        let mut proposal: Proposal = env
            .storage()
            .persistent()
            .get(&(PROPOSAL_KEY, proposal_id))
            .ok_or(PaymentError::ProposalNotFound)?;

        if proposal.executed {
            return Err(PaymentError::ProposalAlreadyExecuted);
        }

        let now = env.ledger().timestamp();
        if now > proposal.voting_ends_at {
            return Err(PaymentError::VotingPeriodEnded);
        }

        // Prevent double-voting: each address votes exactly once per proposal
        let vote_key = (VOTE_KEY, proposal_id, voter.clone());
        if env.storage().persistent().has(&vote_key) {
            return Err(PaymentError::AlreadyVoted);
        }
        env.storage().persistent().set(&vote_key, &true);
        env.storage()
            .persistent()
            .extend_ttl(&vote_key, BUMP_MIN_TTL, BUMP_MAX_TTL);

        // Each voter contributes exactly 1 vote (1 address = 1 vote)
        if support {
            proposal.yes_votes = proposal.yes_votes.saturating_add(1);
        } else {
            proposal.no_votes = proposal.no_votes.saturating_add(1);
        }

        env.storage()
            .persistent()
            .set(&(PROPOSAL_KEY, proposal_id), &proposal);
        env.storage()
            .persistent()
            .extend_ttl(&(PROPOSAL_KEY, proposal_id), BUMP_MIN_TTL, BUMP_MAX_TTL);

        env.events().publish(
            (Symbol::new(&env, "governance"), Symbol::new(&env, "vote")),
            (proposal_id, voter),
        );

        Ok(())
    }

    /// Execute a passed proposal after voting ends.
    /// Returns true if the proposal passed (yes > no).
    /// Refunds the deposit to the proposer regardless of outcome — deposit
    /// exists to prevent spam, not to punish defeated proposals.
    pub fn execute_proposal(env: Env, proposal_id: u64) -> Result<bool, PaymentError> {
        let _guard = acquire_reentrancy_lock(&env)?;
        let mut proposal: Proposal = env
            .storage()
            .persistent()
            .get(&(PROPOSAL_KEY, proposal_id))
            .ok_or(PaymentError::ProposalNotFound)?;

        if proposal.executed {
            return Err(PaymentError::ProposalAlreadyExecuted);
        }

        let now = env.ledger().timestamp();
        if now <= proposal.voting_ends_at {
            return Err(PaymentError::VotingPeriodEnded);
        }

        let passed = proposal.yes_votes > proposal.no_votes;
        proposal.executed = true;
        env.storage()
            .persistent()
            .set(&(PROPOSAL_KEY, proposal_id), &proposal);
        env.storage()
            .persistent()
            .extend_ttl(&(PROPOSAL_KEY, proposal_id), BUMP_MIN_TTL, BUMP_MAX_TTL);

        // Refund the deposit to the proposer regardless of outcome.
        // The deposit serves as spam-protection, not punishment.
        // Reentrancy-guarded (MEDIUM-4).
        if proposal.deposit_amount > 0 {
            let token_client = token::Client::new(&env, &proposal.deposit_asset);
            let contract_addr = env.current_contract_address();
            token_client.transfer(&contract_addr, &proposal.proposer, &proposal.deposit_amount);
            // Release deposit from LOCKED_BALANCE now that it's refunded
            add_locked(&env, -proposal.deposit_amount);
        }

        env.events().publish(
            (
                Symbol::new(&env, "governance"),
                Symbol::new(&env, "executed"),
            ),
            (proposal_id, passed),
        );

        record_audit(
            &env,
            if passed {
                "proposal_passed"
            } else {
                "proposal_defeated"
            },
            &env.current_contract_address(),
            proposal_id,
            if passed {
                "Proposal passed"
            } else {
                "Proposal defeated"
            },
        );

        Ok(passed)
    }

    /// Get a proposal by ID.
    pub fn get_proposal(env: Env, proposal_id: u64) -> Result<Proposal, PaymentError> {
        env.storage()
            .persistent()
            .get(&(PROPOSAL_KEY, proposal_id))
            .ok_or(PaymentError::ProposalNotFound)
    }

    /// Get total proposal count.
    pub fn get_proposal_count(env: Env) -> u64 {
        env.storage().instance().get(&GOV_CNT).unwrap_or(0)
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

    // ═══════════════════════════════════════════════════════════
    //  PAYMENT RECORDS (for Horizon-based XLM payments)
    // ═══════════════════════════════════════════════════════════

    /// Record an off-chain payment on the Soroban ledger.
    /// Anyone can call — this just stores a record, no tokens move.
    pub fn record_payment(
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

        // Collect protocol fee before recording.  If fee transfer fails
        // (insufficient balance, missing trustline), the entire payment
        // reverts — no partial state.
        let _fee = collect_fee(&env, &payer, &asset, amount)?;

        let mut count: u64 = env.storage().instance().get(&PAYMENT_COUNT).unwrap_or(0);
        count += 1;

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

        // Native event
        emit_payment_event(&env, &payer, &payee, &amount);

        inc_counter(&env, &STAT_PAYMENTS);

        record_audit(&env, "payment_recorded", &payer, count, "Payment recorded");

        Ok(count)
    }

    /// Get a payment by ID
    pub fn get_payment(env: Env, payment_id: u64) -> Result<Payment, PaymentError> {
        env.storage()
            .persistent()
            .get(&(PAYMENT_KEY, payment_id))
            .ok_or(PaymentError::PaymentNotFound)
    }

    /// Get total payment count
    pub fn get_payment_count(env: Env) -> u64 {
        env.storage().instance().get(&PAYMENT_COUNT).unwrap_or(0)
    }

    /// Get range of payments
    pub fn get_payments_range(env: Env, start_id: u64, end_id: u64) -> Vec<Payment> {
        // Bounded enumeration (MEDIUM-2 audit fix): iterate the most recent
        // tail first and cap at 100 entries, matching get_audit_log_range.
        let mut payments = Vec::new(&env);
        for id in (start_id..=end_id).rev() {
            if payments.len() >= 100 {
                break;
            }
            if let Some(p) = env
                .storage()
                .persistent()
                .get::<_, Payment>(&(PAYMENT_KEY, id))
            {
                payments.push_back(p);
            }
        }
        payments
    }

    /// Cancel a payment record (owner only). Idempotent — re-cancelling is an error.
    pub fn cancel_payment(env: Env, caller: Address, payment_id: u64) -> Result<(), PaymentError> {
        caller.require_auth();
        require_owner(&env, &caller)?;

        let mut payment: Payment = env
            .storage()
            .persistent()
            .get(&(PAYMENT_KEY, payment_id))
            .ok_or(PaymentError::PaymentNotFound)?;

        if payment.cancelled {
            return Err(PaymentError::PaymentAlreadyCancelled);
        }

        payment.cancelled = true;
        env.storage()
            .persistent()
            .set(&(PAYMENT_KEY, payment_id), &payment);
        env.storage()
            .persistent()
            .extend_ttl(&(PAYMENT_KEY, payment_id), BUMP_MIN_TTL, BUMP_MAX_TTL);

        record_audit(
            &env,
            "payment_cancelled",
            &caller,
            payment_id,
            "Payment cancelled",
        );

        Ok(())
    }

    // ═══════════════════════════════════════════════════════════
    //  ESCROW — Lock funds, release on command or deadline
    // ═══════════════════════════════════════════════════════════

    /// Create an escrow. Tokens are transferred from depositor to this contract.
    /// The beneficiary can claim after `deadline`; owner can release early;
    /// optional arbiter can resolve disputes.
    pub fn create_escrow(
        env: Env,
        depositor: Address,
        beneficiary: Address,
        arbiter: Option<Address>,
        amount: i128,
        asset: Address,
        deadline: u64,
        metadata: String,
    ) -> Result<u64, PaymentError> {
        // Reentrancy guard MUST be the first check so a locked contract rejects
        // every token-moving call (even with otherwise-invalid inputs).
        let _guard = acquire_reentrancy_lock(&env)?;
        depositor.require_auth();
        require_not_paused(&env, PauseScope::Escrows)?;
        if amount <= 0 {
            return Err(PaymentError::InvalidAmount);
        }

        // Transfer tokens from depositor to this contract (reentrancy-guarded, MEDIUM-4)
        let token_client = token::Client::new(&env, &asset);
        let contract_addr = env.current_contract_address();
        token_client.transfer(&depositor, &contract_addr, &amount);

        add_locked(&env, amount);

        let mut count: u64 = env.storage().instance().get(&ESCROW_COUNT).unwrap_or(0);
        count += 1;

        let depositor_clone = depositor.clone();
        let escrow = Escrow {
            id: count,
            depositor,
            beneficiary: beneficiary.clone(),
            arbiter: arbiter.clone(),
            amount,
            asset,
            deadline,
            released: false,
            claimed: false,
            metadata,
        };

        env.storage()
            .persistent()
            .set(&(ESCROW_KEY, count), &escrow);
        env.storage()
            .persistent()
            .extend_ttl(&(ESCROW_KEY, count), BUMP_MIN_TTL, BUMP_MAX_TTL);
        env.storage().instance().set(&ESCROW_COUNT, &count);
        env.storage().instance().extend_ttl(BUMP_MIN_TTL, BUMP_MAX_TTL);

        emit_escrow_event(&env, &env.current_contract_address(), &beneficiary, &amount);

        inc_counter(&env, &STAT_ESC_CREATED);
        add_counter(&env, &STAT_AMT_ESCROWED, amount);

        record_audit(
            &env,
            "escrow_created",
            &depositor_clone,
            count,
            "Escrow created",
        );

        Ok(count)
    }

    /// Owner releases escrow to the beneficiary (anytime).
    pub fn release_escrow(env: Env, owner: Address, escrow_id: u64) -> Result<(), PaymentError> {
        let _guard = acquire_reentrancy_lock(&env)?;
        owner.require_auth();
        require_not_paused(&env, PauseScope::Escrows)?;
        let stored_owner: Address = env
            .storage()
            .instance()
            .get(&OWNER)
            .ok_or(PaymentError::NotInitialized)?;
        if owner != stored_owner {
            return Err(PaymentError::Unauthorized);
        }

        let mut escrow: Escrow = env
            .storage()
            .persistent()
            .get(&(ESCROW_KEY, escrow_id))
            .ok_or(PaymentError::EscrowNotFound)?;

        if escrow.released || escrow.claimed {
            return Err(PaymentError::EscrowAlreadyReleased);
        }

        // Transfer tokens to beneficiary (reentrancy-guarded, MEDIUM-4)
        let token_client = token::Client::new(&env, &escrow.asset);
        let contract_addr = env.current_contract_address();
        add_locked(&env, -escrow.amount);

        token_client.transfer(&contract_addr, &escrow.beneficiary, &escrow.amount);

        escrow.released = true;
        escrow.claimed = true;
        env.storage()
            .persistent()
            .set(&(ESCROW_KEY, escrow_id), &escrow);
        env.storage()
            .persistent()
            .extend_ttl(&(ESCROW_KEY, escrow_id), BUMP_MIN_TTL, BUMP_MAX_TTL);

        inc_counter(&env, &STAT_ESC_RELEASED);

        record_audit(
            &env,
            "escrow_released_owner",
            &owner,
            escrow_id,
            "Escrow released by owner",
        );

        Ok(())
    }

    /// Arbiter releases escrow to either party (dispute resolution).
    /// Only the escrow's designated arbiter can call this.
    pub fn release_by_arbiter(
        env: Env,
        arbiter: Address,
        escrow_id: u64,
        release_to_beneficiary: bool,
    ) -> Result<(), PaymentError> {
        let _guard = acquire_reentrancy_lock(&env)?;
        arbiter.require_auth();
        require_not_paused(&env, PauseScope::Escrows)?;

        let mut escrow: Escrow = env
            .storage()
            .persistent()
            .get(&(ESCROW_KEY, escrow_id))
            .ok_or(PaymentError::EscrowNotFound)?;

        // Verify caller is the designated arbiter
        match &escrow.arbiter {
            Some(a) if *a == arbiter => {}
            _ => return Err(PaymentError::Unauthorized),
        }

        if escrow.released || escrow.claimed {
            return Err(PaymentError::EscrowAlreadyReleased);
        }

        let recipient = if release_to_beneficiary {
            escrow.beneficiary.clone()
        } else {
            escrow.depositor.clone()
        };

        let token_client = token::Client::new(&env, &escrow.asset);
        let contract_addr = env.current_contract_address();
        add_locked(&env, -escrow.amount);

        token_client.transfer(&contract_addr, &recipient, &escrow.amount);

        escrow.released = true;
        escrow.claimed = true;
        env.storage()
            .persistent()
            .set(&(ESCROW_KEY, escrow_id), &escrow);
        env.storage()
            .persistent()
            .extend_ttl(&(ESCROW_KEY, escrow_id), BUMP_MIN_TTL, BUMP_MAX_TTL);

        inc_counter(&env, &STAT_ESC_RELEASED);

        record_audit(
            &env,
            "escrow_released_arbiter",
            &arbiter,
            escrow_id,
            "Escrow released by arbiter",
        );

        Ok(())
    }

    /// Beneficiary claims escrow after deadline.
    pub fn claim_escrow(
        env: Env,
        beneficiary: Address,
        escrow_id: u64,
    ) -> Result<(), PaymentError> {
        let _guard = acquire_reentrancy_lock(&env)?;
        beneficiary.require_auth();
        require_not_paused(&env, PauseScope::Escrows)?;

        let mut escrow: Escrow = env
            .storage()
            .persistent()
            .get(&(ESCROW_KEY, escrow_id))
            .ok_or(PaymentError::EscrowNotFound)?;

        if beneficiary != escrow.beneficiary {
            return Err(PaymentError::Unauthorized);
        }
        if escrow.released || escrow.claimed {
            return Err(PaymentError::EscrowAlreadyReleased);
        }
        if env.ledger().timestamp() < escrow.deadline {
            return Err(PaymentError::EscrowNotDue);
        }

        // Transfer tokens to beneficiary (reentrancy-guarded, MEDIUM-4)
        let token_client = token::Client::new(&env, &escrow.asset);
        let contract_addr = env.current_contract_address();
        add_locked(&env, -escrow.amount);

        token_client.transfer(&contract_addr, &beneficiary, &escrow.amount);

        escrow.claimed = true;
        env.storage()
            .persistent()
            .set(&(ESCROW_KEY, escrow_id), &escrow);
        env.storage()
            .persistent()
            .extend_ttl(&(ESCROW_KEY, escrow_id), BUMP_MIN_TTL, BUMP_MAX_TTL);

        inc_counter(&env, &STAT_ESC_CLAIMED);

        record_audit(
            &env,
            "escrow_claimed",
            &beneficiary,
            escrow_id,
            "Escrow claimed by beneficiary",
        );

        Ok(())
    }

    /// Get escrow by ID
    pub fn get_escrow(env: Env, escrow_id: u64) -> Result<Escrow, PaymentError> {
        env.storage()
            .persistent()
            .get(&(ESCROW_KEY, escrow_id))
            .ok_or(PaymentError::EscrowNotFound)
    }

    /// Get escrow count
    pub fn get_escrow_count(env: Env) -> u64 {
        env.storage().instance().get(&ESCROW_COUNT).unwrap_or(0)
    }

    // ═══════════════════════════════════════════════════════════
    //  PAYMENT STREAMING — Vest tokens linearly over time
    // ═══════════════════════════════════════════════════════════

    /// Create a payment stream. Tokens are locked and vest linearly.
    pub fn create_stream(
        env: Env,
        creator: Address,
        recipient: Address,
        total_amount: i128,
        asset: Address,
        start_time: u64,
        end_time: u64,
        metadata: String,
    ) -> Result<u64, PaymentError> {
        let _guard = acquire_reentrancy_lock(&env)?;
        creator.require_auth();
        require_not_paused(&env, PauseScope::Streams)?;
        if total_amount <= 0 {
            return Err(PaymentError::InvalidAmount);
        }
        if end_time <= start_time {
            return Err(PaymentError::InvalidAmount);
        }

        // Transfer total amount from creator to contract (reentrancy-guarded, MEDIUM-4)
        let token_client = token::Client::new(&env, &asset);
        let contract_addr = env.current_contract_address();
        token_client.transfer(&creator, &contract_addr, &total_amount);

        add_locked(&env, total_amount);

        let mut count: u64 = env.storage().instance().get(&STREAM_COUNT).unwrap_or(0);
        count += 1;

        let creator_clone = creator.clone();
        let stream = Stream {
            id: count,
            creator,
            recipient: recipient.clone(),
            total_amount,
            claimed_amount: 0,
            asset,
            start_time,
            end_time,
            cancelled: false,
            metadata,
        };

        env.storage()
            .persistent()
            .set(&(STREAM_KEY, count), &stream);
        env.storage()
            .persistent()
            .extend_ttl(&(STREAM_KEY, count), BUMP_MIN_TTL, BUMP_MAX_TTL);
        env.storage().instance().set(&STREAM_COUNT, &count);
        env.storage().instance().extend_ttl(BUMP_MIN_TTL, BUMP_MAX_TTL);

        emit_stream_event(
            &env,
            &env.current_contract_address(),
            &recipient,
            &total_amount,
        );

        inc_counter(&env, &STAT_STR_CREATED);
        add_counter(&env, &STAT_AMT_STREAMED, total_amount);

        record_audit(
            &env,
            "stream_created",
            &creator_clone,
            count,
            "Stream created",
        );

        Ok(count)
    }

    /// Claim vested tokens from a stream. Can be called any time.
    pub fn claim_stream(
        env: Env,
        recipient: Address,
        stream_id: u64,
    ) -> Result<i128, PaymentError> {
        let _guard = acquire_reentrancy_lock(&env)?;
        recipient.require_auth();
        require_not_paused(&env, PauseScope::Streams)?;

        let mut stream: Stream = env
            .storage()
            .persistent()
            .get(&(STREAM_KEY, stream_id))
            .ok_or(PaymentError::StreamNotFound)?;

        if recipient != stream.recipient {
            return Err(PaymentError::Unauthorized);
        }
        if stream.cancelled {
            return Err(PaymentError::StreamAlreadyCancelled);
        }

        let now = env.ledger().timestamp();
        if now < stream.start_time {
            return Err(PaymentError::StreamNotStarted);
        }

        // Calculate vested amount linearly with overflow protection
        let vested = compute_vested(stream.total_amount, stream.start_time, stream.end_time, now);

        // INV-5: `vested` is monotonically non-decreasing over time and is the
        // only value ever written to `claimed_amount`, so this subtraction must
        // be non-negative. Check rather than wrap: an impossible negative (or
        // wrapped) claimable would pay the recipient a nonsensical amount.
        let claimable = vested
            .checked_sub(stream.claimed_amount)
            .ok_or(PaymentError::StreamInvariantViolated)?;
        if claimable <= 0 {
            return Err(PaymentError::StreamFullyClaimed);
        }

        // Transfer claimable amount to recipient (reentrancy-guarded, MEDIUM-4)
        let token_client = token::Client::new(&env, &stream.asset);
        let contract_addr = env.current_contract_address();
        add_locked(&env, -claimable);

        token_client.transfer(&contract_addr, &recipient, &claimable);

        stream.claimed_amount += claimable;
        env.storage()
            .persistent()
            .set(&(STREAM_KEY, stream_id), &stream);
        env.storage()
            .persistent()
            .extend_ttl(&(STREAM_KEY, stream_id), BUMP_MIN_TTL, BUMP_MAX_TTL);

        inc_counter(&env, &STAT_STR_CLAIMED);

        record_audit(
            &env,
            "stream_claimed",
            &recipient,
            stream_id,
            "Stream claimed",
        );

        Ok(claimable)
    }

    /// Creator cancels a stream. All tokens not yet claimed are returned to creator.
    pub fn cancel_stream(env: Env, creator: Address, stream_id: u64) -> Result<i128, PaymentError> {
        let _guard = acquire_reentrancy_lock(&env)?;
        creator.require_auth();
        require_not_paused(&env, PauseScope::Streams)?;

        let mut stream: Stream = env
            .storage()
            .persistent()
            .get(&(STREAM_KEY, stream_id))
            .ok_or(PaymentError::StreamNotFound)?;

        if creator != stream.creator {
            return Err(PaymentError::Unauthorized);
        }
        if stream.cancelled {
            return Err(PaymentError::StreamAlreadyCancelled);
        }

        let now = env.ledger().timestamp();
        let vested = compute_vested(stream.total_amount, stream.start_time, stream.end_time, now);

        let unvested = stream.total_amount.saturating_sub(vested);

        stream.cancelled = true;
        env.storage()
            .persistent()
            .set(&(STREAM_KEY, stream_id), &stream);
        env.storage()
            .persistent()
            .extend_ttl(&(STREAM_KEY, stream_id), BUMP_MIN_TTL, BUMP_MAX_TTL);

        if unvested > 0 {
            // Reentrancy-guarded transfer (MEDIUM-4)
            let token_client = token::Client::new(&env, &stream.asset);
            let contract_addr = env.current_contract_address();
            token_client.transfer(&contract_addr, &creator, &unvested);
            add_locked(&env, -unvested);
        }

        inc_counter(&env, &STAT_STR_CANCELLED);

        record_audit(
            &env,
            "stream_cancelled",
            &creator,
            stream_id,
            "Stream cancelled",
        );

        Ok(unvested)
    }

    /// Get a stream by ID
    pub fn get_stream(env: Env, stream_id: u64) -> Result<Stream, PaymentError> {
        env.storage()
            .persistent()
            .get(&(STREAM_KEY, stream_id))
            .ok_or(PaymentError::StreamNotFound)
    }

    /// Get stream count
    pub fn get_stream_count(env: Env) -> u64 {
        env.storage().instance().get(&STREAM_COUNT).unwrap_or(0)
    }

    // ═══════════════════════════════════════════════════════════
    //  RECURRING PAYMENTS — Cron-like scheduled auto-payments
    // ═══════════════════════════════════════════════════════════

    /// Create a recurring payment schedule. Anyone can trigger execution
    /// after the next_execution timestamp passes.
    pub fn create_recurring(
        env: Env,
        creator: Address,
        payee: Address,
        amount: i128,
        asset: Address,
        schedule: ScheduleType,
        remaining: u32,
        metadata: String,
    ) -> Result<u64, PaymentError> {
        creator.require_auth();
        require_not_paused(&env, PauseScope::Recurring)?;
        if amount <= 0 {
            return Err(PaymentError::InvalidAmount);
        }

        let now = env.ledger().timestamp();
        let interval: u64 = match schedule {
            ScheduleType::Daily => 86400,
            ScheduleType::Weekly => 604800,
            ScheduleType::Monthly => 2592000,
        };

        let next_execution = now.saturating_add(interval);

        let mut count: u64 = env.storage().instance().get(&RECUR_CNT).unwrap_or(0);
        count = count.saturating_add(1);

        let recurring = RecurringPayment {
            id: count,
            creator: creator.clone(),
            payee,
            amount,
            asset,
            schedule,
            next_execution,
            remaining,
            times_executed: 0,
            active: true,
            metadata,
        };

        env.storage()
            .persistent()
            .set(&(RECURRING_KEY, count), &recurring);
        env.storage()
            .persistent()
            .extend_ttl(&(RECURRING_KEY, count), BUMP_MIN_TTL, BUMP_MAX_TTL);
        env.storage().instance().set(&RECUR_CNT, &count);
        env.storage().instance().extend_ttl(BUMP_MIN_TTL, BUMP_MAX_TTL);

        record_audit(
            &env,
            "recurring_created",
            &creator,
            count,
            "Recurring payment created",
        );

        Ok(count)
    }

    /// Execute a recurring payment if it's due. Anyone can call this —
    /// it's permissionless execution. Tokens must be transferred separately
    /// (this function records the payment on-chain).
    pub fn execute_recurring(
        env: Env,
        caller: Address,
        recurring_id: u64,
    ) -> Result<u64, PaymentError> {
        caller.require_auth();
        require_not_paused(&env, PauseScope::Recurring)?;

        let mut recurring: RecurringPayment = env
            .storage()
            .persistent()
            .get(&(RECURRING_KEY, recurring_id))
            .ok_or(PaymentError::RecurringNotFound)?;

        if !recurring.active {
            return Err(PaymentError::RecurringAlreadyCancelled);
        }

        let now = env.ledger().timestamp();
        if now < recurring.next_execution {
            return Err(PaymentError::RecurringNotDue);
        }

        // Record the payment
        let mut pay_count: u64 = env.storage().instance().get(&PAYMENT_COUNT).unwrap_or(0);
        pay_count = pay_count.saturating_add(1);

        let payment = Payment {
            id: pay_count,
            payer: recurring.creator.clone(),
            payee: recurring.payee.clone(),
            amount: recurring.amount,
            asset: recurring.asset.clone(),
            tx_hash: String::from_str(&env, "recurring"),
            timestamp: now,
            metadata: String::from_str(&env, "recurring"),
            cancelled: false,
        };

        env.storage()
            .persistent()
            .set(&(PAYMENT_KEY, pay_count), &payment);
        env.storage()
            .persistent()
            .extend_ttl(&(PAYMENT_KEY, pay_count), BUMP_MIN_TTL, BUMP_MAX_TTL);
        env.storage().instance().set(&PAYMENT_COUNT, &pay_count);
        env.storage().instance().extend_ttl(BUMP_MIN_TTL, BUMP_MAX_TTL);

        emit_payment_event(
            &env,
            &recurring.creator,
            &recurring.payee,
            &recurring.amount,
        );

        // Update recurring state
        let interval: u64 = match recurring.schedule {
            ScheduleType::Daily => 86400,
            ScheduleType::Weekly => 604800,
            ScheduleType::Monthly => 2592000,
        };

        recurring.next_execution = now.saturating_add(interval);
        recurring.times_executed = recurring.times_executed.saturating_add(1);

        if recurring.remaining > 0 {
            recurring.remaining = recurring.remaining.saturating_sub(1);
            if recurring.remaining == 0 {
                recurring.active = false;
            }
        }

        env.storage()
            .persistent()
            .set(&(RECURRING_KEY, recurring_id), &recurring);
        env.storage()
            .persistent()
            .extend_ttl(&(RECURRING_KEY, recurring_id), BUMP_MIN_TTL, BUMP_MAX_TTL);

        inc_counter(&env, &STAT_PAYMENTS);

        record_audit(
            &env,
            "recurring_executed",
            &caller,
            recurring_id,
            "Recurring payment executed",
        );

        Ok(pay_count)
    }

    /// Cancel a recurring payment schedule (creator or owner only).
    pub fn cancel_recurring(
        env: Env,
        caller: Address,
        recurring_id: u64,
    ) -> Result<(), PaymentError> {
        caller.require_auth();

        let mut recurring: RecurringPayment = env
            .storage()
            .persistent()
            .get(&(RECURRING_KEY, recurring_id))
            .ok_or(PaymentError::RecurringNotFound)?;

        if !recurring.active {
            return Err(PaymentError::RecurringAlreadyCancelled);
        }

        // Check auth: creator or owner can cancel
        let owner: Address = env
            .storage()
            .instance()
            .get(&OWNER)
            .ok_or(PaymentError::NotInitialized)?;
        if caller != recurring.creator && caller != owner {
            return Err(PaymentError::Unauthorized);
        }

        recurring.active = false;
        recurring.remaining = 0;
        env.storage()
            .persistent()
            .set(&(RECURRING_KEY, recurring_id), &recurring);
        env.storage()
            .persistent()
            .extend_ttl(&(RECURRING_KEY, recurring_id), BUMP_MIN_TTL, BUMP_MAX_TTL);

        record_audit(
            &env,
            "recurring_cancelled",
            &caller,
            recurring_id,
            "Recurring payment cancelled",
        );

        Ok(())
    }

    /// Get a recurring payment schedule by ID.
    pub fn get_recurring(env: Env, recurring_id: u64) -> Result<RecurringPayment, PaymentError> {
        env.storage()
            .persistent()
            .get(&(RECURRING_KEY, recurring_id))
            .ok_or(PaymentError::RecurringNotFound)
    }

    /// Get total recurring payment count.
    pub fn get_recurring_count(env: Env) -> u64 {
        env.storage().instance().get(&RECUR_CNT).unwrap_or(0)
    }

    // ═══════════════════════════════════════════════════════════
    //  REFUNDS — Structured refund lifecycle with reason codes
    // ═══════════════════════════════════════════════════════════

    /// Request a refund for a recorded payment. Stores the refund on-chain
    /// with a typed reason code for analytics.
    pub fn request_refund(
        env: Env,
        requester: Address,
        payment_id: u64,
        amount: i128,
        asset: Address,
        reason: String,
        reason_code: RefundReasonCode,
    ) -> Result<u64, PaymentError> {
        requester.require_auth();
        require_not_paused(&env, PauseScope::Refunds)?;
        if amount <= 0 {
            return Err(PaymentError::InvalidAmount);
        }

        // Verify payment exists and isn't already refunded
        let payment: Payment = env
            .storage()
            .persistent()
            .get(&(PAYMENT_KEY, payment_id))
            .ok_or(PaymentError::PaymentNotFound)?;

        if payment.cancelled {
            return Err(PaymentError::PaymentAlreadyCancelled);
        }

        // ── Fund-safety validation (HIGH-1 audit fix) ──────────────────
        // The requester must be the payer or payee of the payment, the refund
        // amount must not exceed the recorded payment amount, and the asset
        // must match the payment's asset. Without these checks an owner could
        // request a refund of the entire contract balance and drain funds
        // locked in escrows/streams, bypassing the LOCKED_BALANCE invariant.
        if requester != payment.payer && requester != payment.payee {
            return Err(PaymentError::Unauthorized);
        }
        if amount > payment.amount {
            return Err(PaymentError::InvalidAmount);
        }
        if asset != payment.asset {
            return Err(PaymentError::AssetNotSupported);
        }

        let mut count: u64 = env.storage().instance().get(&REFUND_CNT).unwrap_or(0);
        count = count.saturating_add(1);

        let refund = Refund {
            id: count,
            payment_id,
            requester: requester.clone(),
            amount,
            asset,
            reason,
            reason_code,
            status: RefundStatus::Requested,
            requested_at: env.ledger().timestamp(),
            resolved_at: 0,
        };

        env.storage()
            .persistent()
            .set(&(REFUND_KEY, count), &refund);
        env.storage()
            .persistent()
            .extend_ttl(&(REFUND_KEY, count), BUMP_MIN_TTL, BUMP_MAX_TTL);
        env.storage().instance().set(&REFUND_CNT, &count);
        env.storage().instance().extend_ttl(BUMP_MIN_TTL, BUMP_MAX_TTL);

        env.events().publish(
            (Symbol::new(&env, "refund"), Symbol::new(&env, "requested")),
            count,
        );

        record_audit(
            &env,
            "refund_requested",
            &requester,
            count,
            "Refund requested",
        );

        Ok(count)
    }

    /// Approve a refund request (owner only). Moves status to Approved.
    pub fn approve_refund(env: Env, caller: Address, refund_id: u64) -> Result<(), PaymentError> {
        caller.require_auth();
        require_owner(&env, &caller)?;
        require_not_paused(&env, PauseScope::Refunds)?;

        let mut refund: Refund = env
            .storage()
            .persistent()
            .get(&(REFUND_KEY, refund_id))
            .ok_or(PaymentError::RefundNotFound)?;

        if refund.status != RefundStatus::Requested {
            return Err(PaymentError::RefundAlreadyProcessed);
        }

        refund.status = RefundStatus::Approved;
        refund.resolved_at = env.ledger().timestamp();
        env.storage()
            .persistent()
            .set(&(REFUND_KEY, refund_id), &refund);
        env.storage()
            .persistent()
            .extend_ttl(&(REFUND_KEY, refund_id), BUMP_MIN_TTL, BUMP_MAX_TTL);

        record_audit(
            &env,
            "refund_approved",
            &caller,
            refund_id,
            "Refund approved",
        );

        Ok(())
    }

    /// Reject a refund request (owner only).
    pub fn reject_refund(env: Env, caller: Address, refund_id: u64) -> Result<(), PaymentError> {
        caller.require_auth();
        require_owner(&env, &caller)?;
        require_not_paused(&env, PauseScope::Refunds)?;

        let mut refund: Refund = env
            .storage()
            .persistent()
            .get(&(REFUND_KEY, refund_id))
            .ok_or(PaymentError::RefundNotFound)?;

        if refund.status != RefundStatus::Requested {
            return Err(PaymentError::RefundAlreadyProcessed);
        }

        refund.status = RefundStatus::Rejected;
        refund.resolved_at = env.ledger().timestamp();
        env.storage()
            .persistent()
            .set(&(REFUND_KEY, refund_id), &refund);
        env.storage()
            .persistent()
            .extend_ttl(&(REFUND_KEY, refund_id), BUMP_MIN_TTL, BUMP_MAX_TTL);

        record_audit(
            &env,
            "refund_rejected",
            &caller,
            refund_id,
            "Refund rejected",
        );

        Ok(())
    }

    /// Process an approved refund — transfers tokens back to requester.
    pub fn process_refund(env: Env, caller: Address, refund_id: u64) -> Result<(), PaymentError> {
        let _guard = acquire_reentrancy_lock(&env)?;
        caller.require_auth();
        require_owner(&env, &caller)?;
        require_not_paused(&env, PauseScope::Refunds)?;

        let mut refund: Refund = env
            .storage()
            .persistent()
            .get(&(REFUND_KEY, refund_id))
            .ok_or(PaymentError::RefundNotFound)?;

        if refund.status != RefundStatus::Approved {
            return Err(PaymentError::RefundAlreadyProcessed);
        }

        // Reentrancy-guarded transfer (MEDIUM-4)
        let token_client = token::Client::new(&env, &refund.asset);
        let contract_addr = env.current_contract_address();
        token_client.transfer(&contract_addr, &refund.requester, &refund.amount);

        refund.status = RefundStatus::Processed;
        refund.resolved_at = env.ledger().timestamp();
        env.storage()
            .persistent()
            .set(&(REFUND_KEY, refund_id), &refund);
        env.storage()
            .persistent()
            .extend_ttl(&(REFUND_KEY, refund_id), BUMP_MIN_TTL, BUMP_MAX_TTL);

        env.events().publish(
            (Symbol::new(&env, "refund"), Symbol::new(&env, "processed")),
            refund_id,
        );

        record_audit(
            &env,
            "refund_processed",
            &env.current_contract_address(),
            refund_id,
            "Refund processed",
        );

        Ok(())
    }

    /// Get a refund by ID.
    pub fn get_refund(env: Env, refund_id: u64) -> Result<Refund, PaymentError> {
        env.storage()
            .persistent()
            .get(&(REFUND_KEY, refund_id))
            .ok_or(PaymentError::RefundNotFound)
    }

    /// Get total refund count.
    pub fn get_refund_count(env: Env) -> u64 {
        env.storage().instance().get(&REFUND_CNT).unwrap_or(0)
    }

    /// Analytics: count refunds grouped by reason code.
    /// Returns a sorted list of (reason_code, count) pairs.
    pub fn get_reason_code_analytics(env: Env) -> Vec<(u32, u64)> {
        let total: u64 = env.storage().instance().get(&REFUND_CNT).unwrap_or(0);
        let mut counts: Vec<(u32, u64)> = Vec::new(&env);

        // Initialize buckets for each reason code
        let codes = [0u32, 1, 2, 3, 4, 5]; // ProductDefect=0 .. Other=5
        for code in codes.iter() {
            counts.push_back((*code, 0));
        }

        // Bounded enumeration (MEDIUM-2 audit fix): cap the scan at the most
        // recent 100 refunds so analytics never iterates the full catalog.
        let start = total.saturating_sub(99); // last 100 (1-based ids)
        for id in start..=total {
            if let Some(refund) = env
                .storage()
                .persistent()
                .get::<_, Refund>(&(REFUND_KEY, id))
            {
                let code_idx = match refund.reason_code {
                    RefundReasonCode::ProductDefect => 0,
                    RefundReasonCode::NonDelivery => 1,
                    RefundReasonCode::DuplicateCharge => 2,
                    RefundReasonCode::Unauthorized => 3,
                    RefundReasonCode::CustomerRequest => 4,
                    RefundReasonCode::Other => 5,
                };
                let idx = code_idx as u32;
                if idx < counts.len() {
                    let old_entry = counts.get(idx).unwrap();
                    counts.set(idx, (old_entry.0, old_entry.1.saturating_add(1)));
                }
            }
        }

        counts
    }

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

    // ═══════════════════════════════════════════════════════════
    //  BATCH PAYMENTS — Record multiple payments atomically
    // ═══════════════════════════════════════════════════════════

    /// Record a batch of payments with partial failure support.
    /// Valid entries are processed; invalid (zero amount, out-of-range index)
    /// entries are skipped and counted as failures. The batch succeeds as
    /// long as at least one payment was recorded.
    pub fn create_batch(
        env: Env,
        creator: Address,
        payees: Vec<Address>,
        amounts: Vec<i128>,
        asset: Address,
        tx_hash: String,
    ) -> Result<BatchCreateResult, PaymentError> {
        creator.require_auth();
        require_not_paused(&env, PauseScope::Batches)?;

        let len = payees.len();
        if len == 0 {
            return Err(PaymentError::BatchEmpty);
        }
        if len > 100 {
            return Err(PaymentError::BatchTooLarge);
        }

        let mut total_amount: i128 = 0;
        let mut pay_count: u64 = env.storage().instance().get(&PAYMENT_COUNT).unwrap_or(0);
        let mut payment_ids: Vec<u64> = Vec::new(&env);
        let mut actual_recipients: u32 = 0;

        // Two-pass: collect valid entries, then execute
        for i in 0..len {
            let amount = if i < amounts.len() {
                amounts.get(i).unwrap_or(0)
            } else {
                0 // out-of-range → skip
            };
            let payee = payees.get(i);

            // Skip invalid entries (zero/negative amount or missing payee)
            if amount <= 0 {
                continue;
            }
            total_amount = total_amount.checked_add(amount).ok_or(PaymentError::MathOverflow)?;
            pay_count += 1;
            actual_recipients += 1;
            payment_ids.push_back(pay_count);

            let payee_addr = payee.clone().ok_or(PaymentError::InvalidAmount)?;
            let payment = Payment {
                id: pay_count,
                payer: creator.clone(),
                payee: payee_addr.clone(),
                amount,
                asset: asset.clone(),
                tx_hash: tx_hash.clone(),
                timestamp: env.ledger().timestamp(),
                metadata: String::from_str(&env, "batch"),
                cancelled: false,
            };

            env.storage()
                .persistent()
                .set(&(PAYMENT_KEY, pay_count), &payment);
            env.storage()
                .persistent()
                .extend_ttl(&(PAYMENT_KEY, pay_count), BUMP_MIN_TTL, BUMP_MAX_TTL);

            emit_payment_event(&env, &creator, &payee_addr, &amount);
        }

        let successful = actual_recipients;
        let failed = len - successful;

        // Fail only if zero payments were recorded
        if successful == 0 {
            return Err(PaymentError::BatchEmpty);
        }

        env.storage().instance().set(&PAYMENT_COUNT, &pay_count);
        env.storage().instance().extend_ttl(BUMP_MIN_TTL, BUMP_MAX_TTL);

        let mut batch_count: u64 = env.storage().instance().get(&BATCH_COUNT).unwrap_or(0);
        batch_count += 1;

        let creator_clone = creator.clone();
        let batch = BatchPayment {
            id: batch_count,
            creator,
            total_recipients: actual_recipients,
            total_amount,
            asset,
            timestamp: env.ledger().timestamp(),
            tx_hash,
            payment_ids,
        };

        env.storage()
            .persistent()
            .set(&(BATCH_KEY, batch_count), &batch);
        env.storage()
            .persistent()
            .extend_ttl(&(BATCH_KEY, batch_count), BUMP_MIN_TTL, BUMP_MAX_TTL);
        env.storage().instance().set(&BATCH_COUNT, &batch_count);
        env.storage().instance().extend_ttl(BUMP_MIN_TTL, BUMP_MAX_TTL);

        inc_counter(&env, &STAT_BATCHES);
        add_counter(&env, &STAT_AMT_BATCHED, total_amount);
        add_u64_counter(&env, &STAT_PAYMENTS, successful as u64);

        record_audit(
            &env,
            "batch_created",
            &creator_clone,
            batch_count,
            "Batch payment created",
        );

        Ok(BatchCreateResult {
            batch_id: batch_count,
            total_requests: len,
            successful,
            failed,
            total_amount,
        })
    }

    /// Get a batch by ID
    pub fn get_batch(env: Env, batch_id: u64) -> Result<BatchPayment, PaymentError> {
        env.storage()
            .persistent()
            .get(&(BATCH_KEY, batch_id))
            .ok_or(PaymentError::PaymentNotFound)
    }

    /// Get batch count
    pub fn get_batch_count(env: Env) -> u64 {
        env.storage().instance().get(&BATCH_COUNT).unwrap_or(0)
    }

    /// Get the payments belonging to a batch, most recent first.
    ///
    /// Bounded enumeration (#742): the batch's id vector is only as small as
    /// the writer made it — batches created before the `BatchTooLarge` guard
    /// can hold more than `create_batch` accepts today — so the read is capped
    /// at [`MAX_READER_ENTRIES`] and reports truncation instead of walking the
    /// whole vector inside a single invocation.
    pub fn get_payments_by_batch(env: Env, batch_id: u64) -> PaymentList {
        let batch: Option<BatchPayment> = env.storage().persistent().get(&(BATCH_KEY, batch_id));
        let mut items = Vec::new(&env);
        let mut total: u32 = 0;
        let mut scanned: u32 = 0;

        if let Some(b) = batch {
            total = b.payment_ids.len();
            for index in 0..total {
                if items.len() >= MAX_READER_ENTRIES {
                    break;
                }
                scanned += 1;
                // Newest first: `create_batch` appends ids in creation order.
                if let Some(pid) = b.payment_ids.get(total - 1 - index) {
                    if let Some(p) = env.storage().persistent().get(&(PAYMENT_KEY, pid)) {
                        items.push_back(p);
                    }
                }
            }
        }

        PaymentList {
            items,
            total,
            // Exact: true only when the id vector was not fully walked.
            truncated: scanned < total,
        }
    }
}
