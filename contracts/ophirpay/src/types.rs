//! Core contract data structures and domain types.

use soroban_sdk::{contracttype, Address, String, Vec};

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
}

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


/// Feature domains that can be paused individually. The global emergency pause
/// (`emergency_pause_all`) still overrides every scope, so a scope flag can
/// never re-enable a write while the whole contract is paused.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PauseScope {
    Payments,
    Escrows,
    Streams,
    Recurring,
    Refunds,
    Governance,
    Hooks,
    Batches,
}
