#![no_std]
// env.events().publish → #[contractevent] migration is deferred (see docs/GAS.md);
// suppress until that lands. Soroban contract functions also take env + many
// args by design, so the default arity lint does not apply.
#![allow(deprecated)]
#![allow(clippy::too_many_arguments)]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token, Address, BytesN, Env,
    String, Symbol, Vec,
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

const LOCKED_BALANCE: Symbol = symbol_short!("LOCKED");
const REENTRANCY_LOCK: Symbol = symbol_short!("RE_LOCK");

const CONTRACT_VERSION: u32 = 2;

#[contracterror]
#[derive(Clone, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum OphirPayError {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    Unauthorized = 3,
    UpgradeNotProposed = 4,
    UpgradeTimelockActive = 5,
    ContractPaused = 6,
    InvalidAmount = 7,
}

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
        Ok(())
    }

    pub fn propose_upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), OphirPayError> {
        let owner: Address = env
            .storage()
            .instance()
            .get(&OWNER)
            .ok_or(OphirPayError::NotInitialized)?;
        owner.require_auth();

        let unlock = env.ledger().timestamp().saturating_add(TMLOCK_DELAY);
        env.storage().instance().set(&UPGRADE_HASH, &new_wasm_hash);
        env.storage().instance().set(&UPGRADE_TIMELOCK, &unlock);

        Ok(())
    }

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
        OphirPayContract::init(env.clone(), owner.clone()).unwrap();

        env.ledger().set_timestamp(u64::MAX);

        let dummy_hash = BytesN::from_array(&env, &[1u8; 32]);
        OphirPayContract::propose_upgrade(env.clone(), dummy_hash).unwrap();

        let timelock = OphirPayContract::get_upgrade_timelock(env).unwrap();
        assert_eq!(timelock, u64::MAX);
    }
}
