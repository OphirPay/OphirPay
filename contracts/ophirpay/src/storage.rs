#![allow(unused_imports)]
#![allow(dead_code)]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token, Address, Env, String,
    Symbol, Vec,
};
pub const PAYMENT_COUNT: Symbol = symbol_short!("PAY_CNT");
pub const ESCROW_COUNT: Symbol = symbol_short!("ESC_CNT");
pub const STREAM_COUNT: Symbol = symbol_short!("STR_CNT");
pub const BATCH_COUNT: Symbol = symbol_short!("BAT_CNT");
pub const OWNER: Symbol = symbol_short!("OWNER");
pub const PAUSED: Symbol = symbol_short!("PAUSED");
pub const VERSION: Symbol = symbol_short!("VERSION");
pub const UPGRADE_HASH: Symbol = symbol_short!("UPG_HASH");
pub const UPGRADE_TIMELOCK: Symbol = symbol_short!("UPG_LOCK");
pub const MULTISIG_CONFIG: Symbol = symbol_short!("MULTI_CF");
pub const APPROVAL_COUNT: Symbol = symbol_short!("APPR_CNT");
pub const SPEND_LIMIT_KEY: Symbol = symbol_short!("SPNDLIM");
pub const ESCALATION_KEY: Symbol = symbol_short!("ESCLATN");
pub const ROLE_KEY: Symbol = symbol_short!("ROLE");
pub const AUDIT_CNT: Symbol = symbol_short!("AUDIT");

// ── Persistent record key namespaces ─────────────────────────────
// Each record type is stored under a (PREFIX, id) tuple key so that
// sequence numbers never collide across types (e.g. payment #1 vs
// audit #1 both writing plain u64 key 1, which silently overwrote
// each other).
pub const AUDIT_LOG_KEY: Symbol = symbol_short!("A_LOG");
pub const PAYMENT_KEY: Symbol = symbol_short!("P_REC");
pub const PAYMENT_REFUND_KEY: Symbol = symbol_short!("P_REF");
pub const PAYMENT_IDEMPOTENCY_KEY: Symbol = symbol_short!("PAY_IDEMP");
pub const ESCROW_KEY: Symbol = symbol_short!("E_REC");
pub const STREAM_KEY: Symbol = symbol_short!("S_REC");
pub const RECURRING_KEY: Symbol = symbol_short!("R_REC");
pub const REFUND_KEY: Symbol = symbol_short!("RF_REC");
pub const TIMELOCK_KEY: Symbol = symbol_short!("T_REC");
pub const PROPOSAL_KEY: Symbol = symbol_short!("G_REC");
pub const APPROVAL_KEY: Symbol = symbol_short!("A_REQ");
pub const HOOK_KEY: Symbol = symbol_short!("H_REC");
pub const PENDING_REVOC_KEY: Symbol = symbol_short!("PR_REV");
pub const VOTE_KEY: Symbol = symbol_short!("V_REC");
pub const BATCH_KEY: Symbol = symbol_short!("B_REC");
/// Persisted header for a multi-asset batch (#1403).
pub const MULTI_BATCH_KEY: Symbol = symbol_short!("MB_REC");
/// Multi-asset batch sequence number, kept separate from `BATCH_COUNT` so the
/// single-asset and multi-asset readers never look up the wrong record.
pub const MULTI_BATCH_COUNT: Symbol = symbol_short!("MB_CNT");
/// Cumulative protocol fees collected per token contract (#1403).
pub const ASSET_FEE_KEY: Symbol = symbol_short!("A_FEE");
pub const RECUR_CNT: Symbol = symbol_short!("REC_CNT");
pub const REFUND_CNT: Symbol = symbol_short!("REF_CNT");
pub const FEE_KEY: Symbol = symbol_short!("FEE_CONF");
pub const FEE_COLL: Symbol = symbol_short!("FEE_COLL");
pub const TMLOCK_CNT: Symbol = symbol_short!("TMLOCK");
pub const TMLOCK_DELAY: u64 = 86400; // 24 hours
/// Owner-controlled switch for the 24h admin timelock. Missing ⇒ enabled.
pub const TIMELOCK_ENABLED: Symbol = symbol_short!("TLOCK_EN");
pub const GOV_CNT: Symbol = symbol_short!("GOV_CNT");
pub const GOV_CONF: Symbol = symbol_short!("GOV_CONF");
pub const EMITTER_ADDR: Symbol = symbol_short!("EMITTER");
pub const HOOK_CNT: Symbol = symbol_short!("HOOK_CNT");
pub const FEE_VER_CNT: Symbol = symbol_short!("FE_VER");
pub const MSIG_VER_CNT: Symbol = symbol_short!("MS_VER");
pub const PENDING_OWNER: Symbol = symbol_short!("PND_OWN");
pub const OWNER_PROPOSED_AT: Symbol = symbol_short!("OWN_PAT");
pub const TOKEN_DEC_KEY: Symbol = symbol_short!("TOK_DEC");

// ── Per-counter storage keys (replaces ContractStats monolith) ─
// Gas-optimized: each counter is a single u64/i128 instance key.
// Reading one counter costs ~150 bytes; reading all 11 in a monolith cost ~2000+ bytes.
pub const STAT_PAYMENTS: Symbol = symbol_short!("S_PAY");
pub const STAT_ESC_CREATED: Symbol = symbol_short!("S_EC");
pub const STAT_ESC_RELEASED: Symbol = symbol_short!("S_ER");
pub const STAT_ESC_CLAIMED: Symbol = symbol_short!("S_ECL");
pub const STAT_STR_CREATED: Symbol = symbol_short!("S_SC");
pub const STAT_STR_CLAIMED: Symbol = symbol_short!("S_SCL");
pub const STAT_STR_CANCELLED: Symbol = symbol_short!("S_SX");
pub const STAT_BATCHES: Symbol = symbol_short!("S_BAT");
pub const STAT_AMT_ESCROWED: Symbol = symbol_short!("S_AE");
pub const STAT_AMT_STREAMED: Symbol = symbol_short!("S_AS");
pub const STAT_AMT_BATCHED: Symbol = symbol_short!("S_AB");

/// Running total of funds locked in active escrows + streams + proposal deposits.
/// Incremented on create_escrow / create_stream / create_proposal (deposit).
/// Decremented on release_escrow / claim_escrow / claim_stream / cancel_stream
/// / execute_proposal (deposit refund).
/// emergency_withdraw enforces: withdraw_amount <= contract_balance - LOCKED_BALANCE.
/// Prevents the owner from draining user-deposited funds (critical invariant).
pub const LOCKED_BALANCE: Symbol = symbol_short!("LOCKED");
pub const REENTRANCY_LOCK: Symbol = symbol_short!("RE_LOCK");

/// Automatic TTL extension threshold (`10_000` ledgers, ~14 hours at 5s/ledger)
/// for active escrow and stream persistent records (#1352).
pub const TTL_THRESHOLD: u32 = 10_000;

/// Target TTL extension ceiling (`50_000` ledgers, ~2.9 days at 5s/ledger) applied when an
/// active escrow or stream record is created, read, claimed, or updated (#1352).
pub const TTL_EXTEND_TO: u32 = 50_000;

/// Automatically extend the persistent storage TTL of an active escrow or
/// stream record using `TTL_THRESHOLD` (`10_000`) and `TTL_EXTEND_TO` (`50_000`),
/// and bump instance storage TTL so contract metadata stays live alongside the record.
pub fn touch_record_ttl<K: soroban_sdk::IntoVal<Env, soroban_sdk::Val>>(env: &Env, key: &K) {
    if env.storage().persistent().has(key) {
        env.storage()
            .persistent()
            .extend_ttl(key, TTL_THRESHOLD, TTL_EXTEND_TO);
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
    }
}

/// Subsystem capability pause bitflags storage key (#1358)
pub const PAUSE_FLAGS: Symbol = symbol_short!("PAUS_FLG");

pub const MIN_DISPUTE_PERIOD_KEY: Symbol = symbol_short!("DISP_PER");
pub const DEFAULT_MIN_DISPUTE_PERIOD: u64 = 86_400;



