#![no_std]
// env.events().publish → #[contractevent] migration is deferred (see docs/GAS.md);
// suppress until that lands. Soroban contract functions also take env + many
// args by design, so the default arity lint does not apply.
#![allow(deprecated)]
#![allow(clippy::too_many_arguments)]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token, Address, Env, String,
    Symbol, Vec,
};

// ── Storage Keys ───────────────────────────────────────────────
const PAYMENT_COUNT: Symbol = symbol_short!("PAY_CNT");
const ESCROW_COUNT: Symbol = symbol_short!("ESC_CNT");
const STREAM_COUNT: Symbol = symbol_short!("STR_CNT");
const BATCH_COUNT: Symbol = symbol_short!("BAT_CNT");
const OWNER: Symbol = symbol_short!("OWNER");
const PAUSED: Symbol = symbol_short!("PAUSED");
const VERSION: Symbol = symbol_short!("VERSION");
const UPGRADE_HASH: Symbol = symbol_short!("UPG_HASH");
const UPGRADE_TIMELOCK: Symbol = symbol_short!("UPG_LOCK");
const MULTISIG_CONFIG: Symbol = symbol_short!("MULTI_CF");
const APPROVAL_COUNT: Symbol = symbol_short!("APPR_CNT");
const SPEND_LIMIT_KEY: Symbol = symbol_short!("SPNDLIM");
const ESCALATION_KEY: Symbol = symbol_short!("ESCLATN");
const ROLE_KEY: Symbol = symbol_short!("ROLE");
const AUDIT_CNT: Symbol = symbol_short!("AUDIT");

// ── Persistent record key namespaces ─────────────────────────────
// Each record type is stored under a (PREFIX, id) tuple key so that
// sequence numbers never collide across types (e.g. payment #1 vs
// audit #1 both writing plain u64 key 1, which silently overwrote
// each other).
const AUDIT_LOG_KEY: Symbol = symbol_short!("A_LOG");
const PAYMENT_KEY: Symbol = symbol_short!("P_REC");
const ESCROW_KEY: Symbol = symbol_short!("E_REC");
const STREAM_KEY: Symbol = symbol_short!("S_REC");
const RECURRING_KEY: Symbol = symbol_short!("R_REC");
const REFUND_KEY: Symbol = symbol_short!("RF_REC");
const TIMELOCK_KEY: Symbol = symbol_short!("T_REC");
const PROPOSAL_KEY: Symbol = symbol_short!("G_REC");
const APPROVAL_KEY: Symbol = symbol_short!("A_REQ");
const HOOK_KEY: Symbol = symbol_short!("H_REC");
const PENDING_REVOC_KEY: Symbol = symbol_short!("PR_REV");
const VOTE_KEY: Symbol = symbol_short!("V_REC");
const BATCH_KEY: Symbol = symbol_short!("B_REC");
const RECUR_CNT: Symbol = symbol_short!("REC_CNT");
const REFUND_CNT: Symbol = symbol_short!("REF_CNT");
const FEE_KEY: Symbol = symbol_short!("FEE_CONF");
const FEE_COLL: Symbol = symbol_short!("FEE_COLL");
const TMLOCK_CNT: Symbol = symbol_short!("TMLOCK");
const TMLOCK_DELAY: u64 = 86400; // 24 hours
const GOV_CNT: Symbol = symbol_short!("GOV_CNT");
const GOV_CONF: Symbol = symbol_short!("GOV_CONF");
const EMITTER_ADDR: Symbol = symbol_short!("EMITTER");
const HOOK_CNT: Symbol = symbol_short!("HOOK_CNT");
const FEE_VER_CNT: Symbol = symbol_short!("FE_VER");
const MSIG_VER_CNT: Symbol = symbol_short!("MS_VER");
const PENDING_OWNER: Symbol = symbol_short!("PND_OWN");
const OWNER_PROPOSED_AT: Symbol = symbol_short!("OWN_PAT");

// ── Per-counter storage keys (replaces ContractStats monolith) ─
// Gas-optimized: each counter is a single u64/i128 instance key.
// Reading one counter costs ~150 bytes; reading all 11 in a monolith cost ~2000+ bytes.
const STAT_PAYMENTS: Symbol = symbol_short!("S_PAY");
const STAT_ESC_CREATED: Symbol = symbol_short!("S_EC");
const STAT_ESC_RELEASED: Symbol = symbol_short!("S_ER");
const STAT_ESC_CLAIMED: Symbol = symbol_short!("S_ECL");
const STAT_STR_CREATED: Symbol = symbol_short!("S_SC");
const STAT_STR_CLAIMED: Symbol = symbol_short!("S_SCL");
const STAT_STR_CANCELLED: Symbol = symbol_short!("S_SX");
const STAT_BATCHES: Symbol = symbol_short!("S_BAT");
const STAT_AMT_ESCROWED: Symbol = symbol_short!("S_AE");
const STAT_AMT_STREAMED: Symbol = symbol_short!("S_AS");
const STAT_AMT_BATCHED: Symbol = symbol_short!("S_AB");

/// Running total of funds locked in active escrows + streams + proposal deposits.
/// Incremented on create_escrow / create_stream / create_proposal (deposit).
/// Decremented on release_escrow / claim_escrow / claim_stream / cancel_stream
/// / execute_proposal (deposit refund).
/// emergency_withdraw enforces: withdraw_amount <= contract_balance - LOCKED_BALANCE.
/// Prevents the owner from draining user-deposited funds (critical invariant).
const LOCKED_BALANCE: Symbol = symbol_short!("LOCKED");
const REENTRANCY_LOCK: Symbol = symbol_short!("RE_LOCK");

// ── Contract Version ───────────────────────────────────────────
const CONTRACT_VERSION: u32 = 2;

// ── Storage-Bump Policy Constants ──────────────────────────────
const BUMP_MIN_TTL: u32 = 5_000;
const BUMP_MAX_TTL: u32 = 50_000;
const BUMP_MAINTENANCE_TTL: u32 = 100_000;

/// Maximum allowed signers in multisig configuration.
const MAX_SIGNERS: u32 = 10;

// ── Data Types ─────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Payment {
    pub id: u64,
    pub payer: Address,
    pub payee: Address,
    pub amount: i128,
    pub asset: Address,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MultisigConfig {
    pub threshold: u32,
    pub signers: Vec<Address>,
    pub enabled: bool,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ApprovalRequest {
    pub id: u64,
    pub proposer: Address,
    pub payee: Address,
    pub amount: i128,
    pub asset: Address,
    pub approvals: Vec<Address>,
    pub executed: bool,
}

#[contracterror]
#[derive(Clone, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum OphirPayError {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    Unauthorized = 3,
    ContractPaused = 4,
    InvalidAmount = 5,
    PaymentNotFound = 6,
    MultisigNotConfigured = 7,
    NotASigner = 8,
    AlreadyApproved = 9,
    ThresholdNotMet = 10,
    AlreadyExecuted = 11,
    InvalidThreshold = 12,
    MaxSignersExceeded = 13,
    ReentrantCall = 14,
}

// ── Contract Implementation ────────────────────────────────────

#[contract]
pub struct OphirPayContract;

#[contractimpl]
impl OphirPayContract {
    pub fn init(env: Env, owner: Address) -> Result<(), OphirPayError> {
        if env.storage().instance().has(&OWNER) {
            return Err(OphirPayError::AlreadyInitialized);
        }
        owner.require_auth();
        env.storage().instance().set(&OWNER, &owner);
        env.storage().instance().set(&VERSION, &CONTRACT_VERSION);
        env.storage().instance().set(&PAUSED, &false);
        env.storage().instance().set(&LOCKED_BALANCE, &0i128);
        env.storage().instance().extend_ttl(BUMP_MIN_TTL, BUMP_MAX_TTL);
        Ok(())
    }

    fn require_owner(env: &Env, caller: &Address) -> Result<(), OphirPayError> {
        let owner: Address = env
            .storage()
            .instance()
            .get(&OWNER)
            .ok_or(OphirPayError::NotInitialized)?;
        if caller != &owner {
            return Err(OphirPayError::Unauthorized);
        }
        Ok(())
    }

    /// Configures the multisig requirements.
    ///
    /// Deduplicates the input signer list on write, enforces that unique signers <= MAX_SIGNERS,
    /// and ensures 1 <= threshold <= unique_signers.len().
    pub fn set_multisig_config(
        env: Env,
        caller: Address,
        threshold: u32,
        signers: Vec<Address>,
        enabled: bool,
    ) -> Result<(), OphirPayError> {
        caller.require_auth();
        Self::require_owner(&env, &caller)?;

        let mut unique_signers = Vec::new(&env);
        for signer in signers.iter() {
            if !unique_signers.contains(&signer) {
                unique_signers.push_back(signer);
            }
        }

        if unique_signers.len() > MAX_SIGNERS {
            return Err(OphirPayError::MaxSignersExceeded);
        }

        if threshold == 0 || threshold > unique_signers.len() {
            return Err(OphirPayError::InvalidThreshold);
        }

        let config = MultisigConfig {
            threshold,
            signers: unique_signers,
            enabled,
        };

        env.storage().instance().set(&MULTISIG_CONFIG, &config);
        env.storage().instance().extend_ttl(BUMP_MIN_TTL, BUMP_MAX_TTL);

        let mut ver: u32 = env.storage().instance().get(&MSIG_VER_CNT).unwrap_or(0);
        ver += 1;
        env.storage().instance().set(&MSIG_VER_CNT, &ver);

        Ok(())
    }

    pub fn get_multisig_config(env: Env) -> Result<MultisigConfig, OphirPayError> {
        env.storage()
            .instance()
            .get(&MULTISIG_CONFIG)
            .ok_or(OphirPayError::MultisigNotConfigured)
    }

    pub fn propose_multisig_payment(
        env: Env,
        caller: Address,
        payee: Address,
        amount: i128,
        asset: Address,
    ) -> Result<u64, OphirPayError> {
        caller.require_auth();
        let config = Self::get_multisig_config(env.clone())?;
        if !config.enabled {
            return Err(OphirPayError::MultisigNotConfigured);
        }
        if !config.signers.contains(&caller) {
            return Err(OphirPayError::NotASigner);
        }
        if amount <= 0 {
            return Err(OphirPayError::InvalidAmount);
        }

        let mut req_cnt: u64 = env.storage().instance().get(&APPROVAL_COUNT).unwrap_or(0);
        req_cnt += 1;

        let request = ApprovalRequest {
            id: req_cnt,
            proposer: caller,
            payee,
            amount,
            asset,
            approvals: Vec::new(&env),
            executed: false,
        };

        env.storage().persistent().set(&(APPROVAL_KEY, req_cnt), &request);
        env.storage().persistent().extend_ttl(&(APPROVAL_KEY, req_cnt), BUMP_MIN_TTL, BUMP_MAX_TTL);
        env.storage().instance().set(&APPROVAL_COUNT, &req_cnt);

        Ok(req_cnt)
    }

    pub fn approve_multisig_payment(
        env: Env,
        caller: Address,
        request_id: u64,
    ) -> Result<bool, OphirPayError> {
        caller.require_auth();
        let config = Self::get_multisig_config(env.clone())?;
        if !config.enabled {
            return Err(OphirPayError::MultisigNotConfigured);
        }
        if !config.signers.contains(&caller) {
            return Err(OphirPayError::NotASigner);
        }

        let mut request: ApprovalRequest = env
            .storage()
            .persistent()
            .get(&(APPROVAL_KEY, request_id))
            .ok_or(OphirPayError::PaymentNotFound)?;

        if request.executed {
            return Err(OphirPayError::AlreadyExecuted);
        }
        if request.approvals.contains(&caller) {
            return Err(OphirPayError::AlreadyApproved);
        }

        request.approvals.push_back(caller);
        let threshold_met = request.approvals.len() >= config.threshold;

        env.storage().persistent().set(&(APPROVAL_KEY, request_id), &request);
        env.storage().persistent().extend_ttl(&(APPROVAL_KEY, request_id), BUMP_MIN_TTL, BUMP_MAX_TTL);

        Ok(threshold_met)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::Env;

    #[test]
    fn test_set_multisig_config_deduplicates_signers() {
        let env = Env::default();
        env.mock_all_signatures();

        let owner = Address::generate(&env);
        let s1 = Address::generate(&env);
        let s2 = Address::generate(&env);

        OphirPayContract::init(env.clone(), owner.clone()).unwrap();

        let mut signers = Vec::new(&env);
        signers.push_back(s1.clone());
        signers.push_back(s2.clone());
        signers.push_back(s1.clone()); // duplicate
        signers.push_back(s2.clone()); // duplicate

        OphirPayContract::set_multisig_config(env.clone(), owner.clone(), 2, signers, true).unwrap();

        let config = OphirPayContract::get_multisig_config(env.clone()).unwrap();
        assert_eq!(config.signers.len(), 2);
        assert_eq!(config.signers.get(0).unwrap(), s1);
        assert_eq!(config.signers.get(1).unwrap(), s2);
    }

    #[test]
    fn test_set_multisig_config_threshold_exceeds_unique_signers() {
        let env = Env::default();
        env.mock_all_signatures();

        let owner = Address::generate(&env);
        let s1 = Address::generate(&env);
        let s2 = Address::generate(&env);

        OphirPayContract::init(env.clone(), owner.clone()).unwrap();

        let mut signers = Vec::new(&env);
        signers.push_back(s1.clone());
        signers.push_back(s2.clone());
        signers.push_back(s1.clone());

        // Raw count is 3, but unique count is 2. Threshold 3 must be rejected.
        let res = OphirPayContract::set_multisig_config(env.clone(), owner.clone(), 3, signers, true);
        assert_eq!(res, Err(OphirPayError::InvalidThreshold));
    }

    #[test]
    fn test_set_multisig_config_max_signers_exceeded() {
        let env = Env::default();
        env.mock_all_signatures();

        let owner = Address::generate(&env);
        OphirPayContract::init(env.clone(), owner.clone()).unwrap();

        let mut signers = Vec::new(&env);
        for _ in 0..11 {
            signers.push_back(Address::generate(&env));
        }

        let res = OphirPayContract::set_multisig_config(env.clone(), owner.clone(), 5, signers, true);
        assert_eq!(res, Err(OphirPayError::MaxSignersExceeded));
    }
}
