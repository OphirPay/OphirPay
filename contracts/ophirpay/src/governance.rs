//! Governance and timelocked actions domain entrypoints.

use soroban_sdk::{contractimpl, token, Address, Env, String, Symbol};

use crate::errors::PaymentError;
use crate::helpers::*;
use crate::storage_keys::*;
use crate::types::*;
use crate::{OphirPayContract, OphirPayContractArgs, OphirPayContractClient};

#[contractimpl]
impl OphirPayContract {
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

}
