//! Storage key constants and namespaces.

use soroban_sdk::{symbol_short, Symbol};

// ── Storage Keys ───────────────────────────────────────────────
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
pub const RECUR_CNT: Symbol = symbol_short!("REC_CNT");
pub const REFUND_CNT: Symbol = symbol_short!("REF_CNT");
pub const FEE_KEY: Symbol = symbol_short!("FEE_CONF");
pub const FEE_COLL: Symbol = symbol_short!("FEE_COLL");
pub const TMLOCK_CNT: Symbol = symbol_short!("TMLOCK");
pub const TMLOCK_DELAY: u64 = 86400; // 24 hours
pub const GOV_CNT: Symbol = symbol_short!("GOV_CNT");
pub const GOV_CONF: Symbol = symbol_short!("GOV_CONF");
pub const EMITTER_ADDR: Symbol = symbol_short!("EMITTER");
pub const HOOK_CNT: Symbol = symbol_short!("HOOK_CNT");
pub const FEE_VER_CNT: Symbol = symbol_short!("FE_VER");
pub const MSIG_VER_CNT: Symbol = symbol_short!("MS_VER");
pub const PENDING_OWNER: Symbol = symbol_short!("PND_OWN");
pub const OWNER_PROPOSED_AT: Symbol = symbol_short!("OWN_PAT");

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

