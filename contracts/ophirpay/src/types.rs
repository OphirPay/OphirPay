#![allow(unused_imports)]
#![allow(dead_code)]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token, Address, Env, String,
    Symbol, Vec,
};
use crate::storage::*;
use crate::errors::*;
use crate::events::*;
use crate::helpers::*;
// ── Data Types ─────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub struct Payment {
    pub id: u64,
    pub payer: Address,
    pub payee: Address,
    pub amount: i128,
    pub asset: Address, // SAC token address, or native XLM sentinel
    pub tx_hash: String,
    pub timestamp: u64,
    pub metadata: String,
    pub cancelled: bool,
}

/// Bounded, most-recent-first view of a batch's payments (#742).
///
/// `total` is the number of payment ids the batch actually holds and
/// `truncated` is true when the reader had to stop before exhausting them, so
/// callers can tell a complete list apart from a capped one instead of
/// silently acting on partial data.
#[contracttype]
#[derive(Clone)]
pub struct PaymentList {
    pub items: Vec<Payment>,
    pub total: u32,
    pub truncated: bool,
}

/// An escrow that locks funds until released by the owner, claimed after
/// deadline, or released by an optional third-party arbiter for disputes.
#[contracttype]
#[derive(Clone)]
pub struct Escrow {
    pub id: u64,
    pub depositor: Address,
    pub beneficiary: Address,
    pub arbiter: Option<Address>,
    pub amount: i128,
    pub asset: Address,
    pub deadline: u64, // ledger timestamp when beneficiary can claim
    pub released: bool,
    pub claimed: bool,
    pub metadata: String,
    pub dispute_initiated_at: u64,
}

pub type EscrowRecord = Escrow;

/// A payment stream that vests tokens over time.
#[contracttype]
#[derive(Clone)]
pub struct Stream {
    pub id: u64,
    pub creator: Address,
    pub recipient: Address,
    pub total_amount: i128,
    pub claimed_amount: i128,
    pub asset: Address,
    pub start_time: u64,
    pub end_time: u64,
    pub cancelled: bool,
    pub metadata: String,
}

/// A batch of payments executed atomically.
#[contracttype]
#[derive(Clone)]
pub struct BatchPayment {
    pub id: u64,
    pub creator: Address,
    pub total_recipients: u32,
    pub total_amount: i128,
    pub asset: Address,
    pub timestamp: u64,
    pub tx_hash: String,
    pub payment_ids: Vec<u64>,
}

/// Result of a batch creation with success/failure counts.
#[contracttype]
#[derive(Clone)]
pub struct BatchCreateResult {
    pub batch_id: u64,
    pub total_requests: u32,
    pub successful: u32,
    pub failed: u32,
    pub total_amount: i128,
}

/// One leg of a multi-asset batch payment (#1403).
///
/// Unlike [`Payment`], the asset moves with each leg rather than being fixed
/// for the whole batch, so a single invocation can pay recipients in XLM,
/// USDC, EURC, or any other SAC token.
#[contracttype]
#[derive(Clone)]
pub struct MultiAssetPayment {
    pub payee: Address,
    pub amount: i128,
    pub asset: Address,
}

/// Protocol fees collected for one asset during a multi-asset batch (#1403).
#[contracttype]
#[derive(Clone)]
pub struct AssetFeeTotal {
    pub asset: Address,
    pub fee: i128,
}

/// Result of [`OphirPayContract::execute_multi_asset_batch`] (#1403).
#[contracttype]
#[derive(Clone)]
pub struct MultiAssetBatchResult {
    pub batch_id: u64,
    pub total_requests: u32,
    pub successful: u32,
    pub failed: u32,
    /// Fees actually collected, grouped by token contract. Empty when fees are
    /// disabled or no fee collector is configured.
    pub fees: Vec<AssetFeeTotal>,
}

/// Persisted header for a multi-asset batch (#1403).
///
/// `payment_ids` point at the individual [`Payment`] records, exactly like
/// [`BatchPayment`]; the per-asset fee totals are stored here as well so an
/// auditor can reconcile the batch without replaying token history.
#[contracttype]
#[derive(Clone)]
pub struct MultiAssetBatchRecord {
    pub id: u64,
    pub creator: Address,
    pub total_recipients: u32,
    pub timestamp: u64,
    pub tx_hash: String,
    pub payment_ids: Vec<u64>,
    pub fees: Vec<AssetFeeTotal>,
}

/// Aggregate statistics across all contract activity.
#[contracttype]
#[derive(Clone)]
pub struct ContractStats {
    pub total_payments_recorded: u64,
    pub total_escrows_created: u64,
    pub total_escrows_released: u64,
    pub total_escrows_claimed: u64,
    pub total_streams_created: u64,
    pub total_streams_claimed: u64,
    pub total_streams_cancelled: u64,
    pub total_batches_processed: u64,
    pub total_amount_escrowed: i128,
    pub total_amount_streamed: i128,
    pub total_amount_batched: i128,
}

/// Multisig configuration for high-value payment approvals.
#[contracttype]
#[derive(Clone)]
pub struct MultisigConfig {
    pub threshold: u32,
    pub signers: Vec<Address>,
    pub enabled: bool,
}

/// A payment proposal awaiting multisig approval.
#[contracttype]
#[derive(Clone)]
pub struct ApprovalRequest {
    pub id: u64,
    pub proposer: Address,
    pub payee: Address,
    pub amount: i128,
    pub asset: Address,
    pub tx_hash: String,
    pub approvals: Vec<Address>,
    pub executed: bool,
    pub created_at: u64,
}

/// Per-user spending limit configuration with optional expiry.
#[contracttype]
#[derive(Clone)]
pub struct SpendingLimit {
    pub daily_limit: i128,
    pub monthly_limit: i128,
    pub current_daily_spend: i128,
    pub current_monthly_spend: i128,
    pub last_reset_day: u64,
    pub last_reset_month: u64,
    pub is_active: bool,
    /// Ledger timestamp when this limit self-destructs (0 = never).
    /// After expiry, all spends are rejected. Useful for temporary vendor access.
    pub expires_at: u64,
}

/// Escalation rules for spending enforcement.
#[contracttype]
#[derive(Clone)]
pub struct EscalationRules {
    pub small_threshold: i128,  // auto-approve below this
    pub medium_threshold: i128, // log above this
    pub enabled: bool,          // above medium → requires admin approval
}

/// Result of a spending limit check.
#[contracttype]
#[derive(Clone)]
pub enum SpendCheckResult {
    Approved,
    Escalated,
    Rejected,
}

/// Role-based access control roles.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Role {
    Admin,
    Operator,
    Auditor,
}

/// Recurring payment schedule type.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ScheduleType {
    Daily,
    Weekly,
    Monthly,
}

/// Governance configuration for DAO-style proposal voting.
#[contracttype]
#[derive(Clone)]
pub struct GovernanceConfig {
    pub min_proposal_deposit: i128, // minimum stake to create proposal
    pub voting_period: u64,         // seconds proposals remain open
    pub quorum_bps: u32,            // basis points of token supply needed
    pub enabled: bool,
}

/// A governance proposal with yes/no voting.
#[contracttype]
#[derive(Clone)]
pub struct Proposal {
    pub id: u64,
    pub proposer: Address,
    pub title: String,
    pub description: String,
    pub action_type: String, // e.g. "upgrade", "set_fee_config", "transfer_ownership"
    pub target: String,      // function to call
    pub data: String,        // serialized parameters
    pub yes_votes: i128,
    pub no_votes: i128,
    pub voting_ends_at: u64,
    pub executed: bool,
    pub created_at: u64,
    pub deposit_asset: Address, // asset locked as proposal deposit
    pub deposit_amount: i128,   // amount locked (>= min_proposal_deposit)
}

/// Typed payload for granting a role through the timelock.
#[contracttype]
#[derive(Clone)]
pub struct RoleGrantAction {
    pub grantee: Address,
    pub role: Role,
}

/// Typed payload for setting a user's spending limit through the timelock.
#[contracttype]
#[derive(Clone)]
pub struct SpendingLimitAction {
    pub user: Address,
    pub daily_limit: i128,
    pub monthly_limit: i128,
    pub expires_at: u64,
    pub is_active: bool,
}

/// Typed, on-chain representation of every timelockable admin operation.
///
/// Storing a typed value (rather than the legacy free-form `data` string)
/// means `execute_timelocked_action` can dispatch the change itself and a
/// proposer cannot substitute a different action between approval and
/// execution.
#[contracttype]
#[derive(Clone)]
pub enum TimelockAction {
    /// Legacy string-only action (no on-chain dispatch).
    Legacy,
    FeeConfig(FeeConfig),
    MultisigConfig(MultisigConfig),
    GrantRole(RoleGrantAction),
    GovernanceConfig(GovernanceConfig),
    SpendingLimit(SpendingLimitAction),
}

/// A timelocked admin action. Proposed now, executable after `unlocks_at`.
/// This protects against compromised admin keys by forcing a 24h delay
/// on sensitive operations.
#[contracttype]
#[derive(Clone)]
pub struct TimelockedAction {
    pub id: u64,
    pub action_type: String, // e.g. "set_fee_config", "set_multisig", "pause"
    pub target: String,      // the target of the action (e.g. function name)
    pub data: String,        // serialized params (for off-chain relay to decode)
    pub proposed_by: Address,
    pub proposed_at: u64,
    pub unlocks_at: u64,
    pub executed: bool,
    /// Typed payload executed on-chain. `Legacy` for string-only actions
    /// proposed through the compatibility entrypoint (e.g. "pause"), which
    /// remain informational and are only marked executed.
    pub action: TimelockAction,
}

/// Configurable platform fee structure per operation type.
#[contracttype]
#[derive(Clone)]
pub struct FeeConfig {
    pub payment_fee_bps: u32,     // basis points (1/10000) per payment record
    pub escrow_fee_bps: u32,      // fee for creating escrow
    pub stream_fee_bps: u32,      // fee for creating stream
    pub batch_base_fee: i128,     // flat base fee per batch (in stroops)
    pub batch_per_item_fee: i128, // additional fee per batch item
    pub enabled: bool,
}

/// Structured refund reason codes — enforced by the type system so analytics
/// never sees free-form strings. Mirrors FacilPay's RefundReasonCode pattern.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RefundReasonCode {
    ProductDefect,
    NonDelivery,
    DuplicateCharge,
    Unauthorized,
    CustomerRequest,
    Other,
}

/// Lifecycle status of a refund request.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RefundStatus {
    Requested,
    Approved,
    Rejected,
    Processed,
}

/// On-chain refund record with structured reason codes and analytics support.
#[contracttype]
#[derive(Clone)]
pub struct Refund {
    pub id: u64,
    pub payment_id: u64,
    pub requester: Address,
    pub amount: i128,
    pub asset: Address,
    pub reason: String, // free-text explanation
    pub reason_code: RefundReasonCode,
    pub status: RefundStatus,
    pub requested_at: u64,
    pub resolved_at: u64,
}

/// A scheduled recurring payment that can be executed by anyone after due.
#[contracttype]
#[derive(Clone)]
pub struct RecurringPayment {
    pub id: u64,
    pub creator: Address,
    pub payee: Address,
    pub amount: i128,
    pub asset: Address,
    pub schedule: ScheduleType,
    pub next_execution: u64, // ledger timestamp when next payment is due
    pub remaining: u32,      // number of payments left (0 = infinite)
    pub times_executed: u32,
    pub active: bool,
    pub metadata: String,
}

/// Immutable audit trail entry for every contract state change.
#[contracttype]
#[derive(Clone)]
pub struct AuditEntry {
    pub id: u64,
    pub timestamp: u64,
    pub action: String, // e.g. "payment_recorded", "escrow_created"
    pub actor: Address,
    pub target_id: u64,  // the affected entity id (payment, escrow, stream, etc.)
    pub details: String, // human-readable summary
}

/// A pending two-step role revocation.  Created by `propose_revoke_role`,
/// executable after a 24-hour timelock via `execute_revoke_role`.
/// The target account retains its role until execution — giving them
/// time to wind down operations and转移 assets.
#[contracttype]
#[derive(Clone)]
pub struct PendingRevocation {
    pub target: Address,
    pub role: Role,
    pub proposed_by: Address,
    pub proposed_at: u64,
    pub unlocks_at: u64,
    pub executed: bool,
}

/// Immutable version snapshot of fee configuration.
/// Each time `set_fee_config` is called, the previous config is archived
/// under a new version entry. Enables audit trails and rollback analysis.
#[contracttype]
#[derive(Clone)]
pub struct FeeConfigVersion {
    pub version: u32,
    pub config: FeeConfig,
    pub changed_at: u64,
    pub changed_by: Address,
}

/// Immutable version snapshot of multisig configuration.
/// Each change to multisig config is versioned for audit and rollback.
#[contracttype]
#[derive(Clone)]
pub struct MultisigVersion {
    pub version: u32,
    pub config: MultisigConfig,
    pub changed_at: u64,
    pub changed_by: Address,
}

/// On-chain notification hook subscription.
/// When a matching event fires, an off-chain relayer queries `get_hooks_by_event`
/// and delivers webhooks to each registered subscriber. This is the on-chain
/// source of truth — no missed events, no tampered delivery lists.
#[contracttype]
#[derive(Clone)]
pub struct NotificationHook {
    pub id: u64,
    pub subscriber: Address,
    pub event_type: String, // e.g. "payment_recorded", "refund_processed", "escrow_created"
    pub webhook_url: String,
    pub active: bool,
    pub created_at: u64,
}

/// Bounded, most-recent-first view of a subscriber's notification hooks
/// (#742). Mirrors [`PaymentList`] — see that type for the meaning of `total`
/// and `truncated`.
#[contracttype]
#[derive(Clone)]
pub struct HookList {
    pub items: Vec<NotificationHook>,
    pub total: u32,
    pub truncated: bool,
}

/// Minimum duration for a payment stream (60 seconds / 1 minute) (#1350).
pub const MIN_STREAM_DURATION: u64 = 60;

/// Maximum duration for a payment stream (5 years in seconds: 157,680,000s) (#1350).
pub const MAX_STREAM_DURATION: u64 = 5 * 365 * 86_400;

/// Default decimal places for Stellar classic and standard tokens (XLM, USDC on Stellar have 7 decimals) (#1347).
pub const DEFAULT_STELLAR_DECIMALS: u32 = 7;

/// Maximum allowable decimal precision for custom tokens (0 to 18 decimals) (#1347).
pub const MAX_TOKEN_DECIMALS: u32 = 18;

// ── Subsystem Capability Bitflags (#1358) ────────────────────
pub const PAUSE_PAYMENTS: u32 = 1;
pub const PAUSE_ESCROWS: u32 = 2;
pub const PAUSE_STREAMS: u32 = 4;
pub const PAUSE_GOVERNANCE: u32 = 8;
pub const PAUSE_RECURRING: u32 = 16;
pub const PAUSE_REFUNDS: u32 = 32;
pub const PAUSE_HOOKS: u32 = 64;
pub const PAUSE_BATCHES: u32 = 128;
pub const PAUSE_ALL: u32 = 255;


