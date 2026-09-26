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
const BUMP_MIN_TTL: u32 = 5_000;
const BUMP_MAX_TTL: u32 = 50_000;
const BUMP_MAINTENANCE_TTL: u32 = 100_000;

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
const MAX_READER_ENTRIES: u32 = 100;

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

#[contracterror]
#[derive(Clone, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum PaymentError {
    // ── Core Errors (1-10) ───────────────────────────────────
    /// Contract not initialized: call init() first
    NotInitialized = 1,
    /// Contract already initialized
    AlreadyInitialized = 2,
    /// Payment not found
    PaymentNotFound = 3,
    /// Unauthorized: caller does not have permission
    Unauthorized = 4,
    /// Invalid amount: must be greater than zero
    InvalidAmount = 5,
    /// Escrow not yet due: deadline has not passed
    EscrowNotDue = 6,
    /// Escrow already released
    EscrowAlreadyReleased = 7,
    /// Escrow not found
    EscrowNotFound = 8,
    /// Stream not started: start time is in the future
    StreamNotStarted = 9,
    /// Stream already cancelled
    StreamAlreadyCancelled = 10,
    // ── Stream + Batch Errors (11-20) ────────────────────────
    /// Stream not found
    StreamNotFound = 11,
    /// Stream fully claimed: no remaining balance
    StreamFullyClaimed = 12,
    /// Batch too large: exceeds maximum recipients
    BatchTooLarge = 13,
    /// Batch empty: no recipients provided
    BatchEmpty = 14,
    /// Token transfer failed
    TokenTransferFailed = 15,
    /// Insufficient balance to cover payment
    InsufficientBalance = 16,
    /// Payment already cancelled
    PaymentAlreadyCancelled = 17,
    /// Contract paused: operations are temporarily disabled
    ContractPaused = 18,
    /// No tokens available to withdraw
    NoTokensToWithdraw = 19,
    /// Upgrade not proposed: call propose_upgrade() first
    UpgradeNotProposed = 20,
    // ── Upgrade + Multisig Errors (21-30) ────────────────────
    /// Upgrade timelock active: 24-hour delay has not elapsed
    UpgradeTimelockActive = 21,
    /// Multisig not configured: call set_multisig_config() first
    MultisigNotConfigured = 22,
    /// Not a signer: you are not in the multisig signer list
    NotASigner = 23,
    /// Already approved: duplicate approval detected
    AlreadyApproved = 24,
    /// Threshold not met: insufficient approvals
    ThresholdNotMet = 25,
    /// Already executed: this action has already been processed
    AlreadyExecuted = 26,
    /// Not a role holder: insufficient RBAC permissions
    NotARoleHolder = 27,
    /// Audit log empty: no entries recorded
    AuditLogEmpty = 28,
    /// Audit entry not found
    AuditEntryNotFound = 29,
    /// Recurring payment not found
    RecurringNotFound = 30,
    // ── Recurring + Fee Errors (31-40) ────────────────────
    /// Recurring payment not yet due
    RecurringNotDue = 31,
    /// Recurring payment already cancelled
    RecurringAlreadyCancelled = 32,
    /// Recurring payment expired: all payments completed
    RecurringExpired = 33,
    /// Fee configuration not found
    FeeConfigNotFound = 34,
    /// Fee too high: exceeds maximum 1000 bps (10%)
    FeeTooHigh = 35,
    /// Timelocked action not found
    TimelockNotFound = 36,
    /// Timelocked action not yet due: 24-hour delay has not elapsed
    TimelockNotDue = 37,
    /// Timelocked action already executed
    TimelockAlreadyExecuted = 38,
    /// Governance not configured: call configure_governance() first
    GovernanceNotConfigured = 39,
    /// Proposal not found
    ProposalNotFound = 40,
    // ── Governance + Spend Errors (41-52) ───────────────────
    /// Voting period ended: proposal is closed
    VotingPeriodEnded = 41,
    /// Proposal already executed
    ProposalAlreadyExecuted = 42,
    /// Quorum not met: insufficient votes cast
    QuorumNotMet = 43,
    /// Proposal defeated: no votes exceeded yes votes
    ProposalDefeated = 44,
    /// Deposit too low: must meet minimum proposal deposit
    DepositTooLow = 45,
    /// Spending limit expired: limit has been deactivated or expired
    SpendingLimitExpired = 46,
    /// Refund not found
    RefundNotFound = 47,
    /// Refund already processed
    RefundAlreadyProcessed = 48,
    /// Payment already refunded
    PaymentAlreadyRefunded = 49,
    /// Refund window expired
    RefundWindowExpired = 50,
    /// Already voted: each address may vote only once per proposal
    AlreadyVoted = 51,
    /// Reentrant call detected: cross-contract reentry blocked
    ReentrantCall = 52,
    // ── Spend + Dispute Errors (53-59) ──────────────────────
    /// Spending cap exceeded: total spend exceeds authorization
    SpendCapExceeded = 53,
    /// Dispute already filed: a dispute exists for this transaction
    DisputeAlreadyFiled = 54,
    /// Dispute not found
    DisputeNotFound = 55,
    /// Dispute window expired: too late to file a dispute
    DisputeWindowExpired = 56,
    /// Refund rejected: refund request was denied
    RefundRejected = 57,
    /// Insufficient liquidity: pool cannot fulfill the order
    InsufficientLiquidity = 58,
    /// Asset depegged: stablecoin is off its target peg
    AssetDepegged = 59,
    // ── Extended Errors (60-99) ───────────────────────────────
    /// Proposal not passed: insufficient yes votes
    ProposalNotPassed = 60,
    /// Invalid signature: recovered signer does not match
    InvalidSignature = 61,
    /// Hook not found
    HookNotFound = 62,
    /// Hook already exists: duplicate hook registration
    HookAlreadyExists = 63,
    /// Rate limit exceeded: too many requests
    RateLimitExceeded = 64,
    /// Asset not supported by this contract
    AssetNotSupported = 65,
    /// Invalid metadata length: exceeds maximum allowed
    InvalidMetadataLength = 66,
    /// Maximum recipients exceeded
    MaxRecipientsExceeded = 67,
    /// Duplicate recipient in batch
    DuplicateRecipient = 68,
    /// Stream end time must be after start time
    StreamEndBeforeStart = 69,
    /// Escrow deadline must be in the future
    EscrowDeadlineInPast = 70,
    /// Pending ownership transfer: accept or cancel first
    PendingOwnershipTransfer = 71,
    /// Ownership transfer expired: timelock elapsed without acceptance
    OwnershipTransferExpired = 72,
    /// Invalid address format
    InvalidAddressFormat = 73,
    /// Batch item failed: individual payment in batch error
    BatchItemFailed = 74,
    /// Invalid recurring schedule type
    RecurringScheduleInvalid = 75,
    /// Fee collector address not set
    FeeCollectorNotSet = 76,
    /// Emitter contract not linked: call set_emitter() first
    EmitterNotLinked = 77,
    /// Proposal deposit is locked: cannot withdraw while voting
    ProposalDepositLocked = 78,
    /// Multisig signer limit exceeded
    MultisigSignerLimit = 79,
    /// Invalid token contract address
    InvalidTokenContract = 80,
    /// Storage limit exceeded: contract storage is full
    StorageLimitExceeded = 81,
    /// Contract migration required: upgrade to continue
    ContractMigrationRequired = 82,
    /// Invalid event type for notification hook
    InvalidEventType = 83,
    /// Webhook URL too long: exceeds maximum length
    WebhookUrlTooLong = 84,
    /// Maximum notification hooks exceeded
    MaxHooksExceeded = 85,
    /// Notification hook is not active
    HookNotActive = 86,
    /// Cross-contract call failed
    CrossContractCallFailed = 87,
    /// Invalid ScVal encoding in parameters
    InvalidScValEncoding = 88,
    /// Unsupported operation: not available in this version
    UnsupportedOperation = 89,
    /// Contract not linked: configure linked contract first
    ContractNotLinked = 90,
    /// Maximum signers exceeded for multisig
    MaxSignersExceeded = 91,
    /// Zero address not allowed for this operation
    ZeroAddressNotAllowed = 92,
    /// Invalid network: wrong Stellar network configured
    InvalidNetwork = 93,
    // ── Staking & Rewards (94-109) ───────────────────────────
    /// Staking not configured: call configure_staking() first
    StakingNotConfigured = 94,
    /// Staking already active: cannot modify while staking
    StakingAlreadyActive = 95,
    /// Rewards pool empty: no rewards available for distribution
    RewardsPoolEmpty = 96,
    /// Unstaking period active: funds are still in cooldown
    UnstakingPeriodActive = 97,
    /// Minimum stake not met: stake must exceed the minimum
    MinimumStakeNotMet = 98,
    /// Maximum stake exceeded: stake cannot exceed the cap
    MaximumStakeExceeded = 99,
    /// Rewards already claimed for this epoch
    RewardsAlreadyClaimed = 100,
    /// Delegation not allowed: delegator is not authorized
    DelegationNotAllowed = 101,
    /// Validator not active: selected validator is offline
    ValidatorNotActive = 102,
    /// Slashing condition met: stake is subject to penalty
    SlashingConditionMet = 103,
    /// Staking is currently paused
    StakingPaused = 104,
    /// Compound rewards failed: auto-compound error
    CompoundRewardsFailed = 105,
    /// Yield too low: below minimum acceptable rate
    YieldTooLow = 106,
    /// Staking period not ended: cannot unstake yet
    StakingPeriodNotEnded = 107,
    /// Reward distribution failed: transfer error
    RewardDistributionFailed = 108,
    /// Delegator not authorized for this validator
    UnauthorizedDelegator = 109,
    // ── Cross-Chain & Bridge (110-119) ──────────────────────
    /// Bridge not configured: call configure_bridge() first
    BridgeNotConfigured = 110,
    /// Bridge is currently paused
    BridgePaused = 111,
    /// Invalid source chain identifier
    InvalidSourceChain = 112,
    /// Invalid destination chain identifier
    InvalidDestinationChain = 113,
    /// Cross-chain proof invalid: verification failed
    CrossChainProofInvalid = 114,
    /// Bridge relayer not set: configure relayer address
    BridgeRelayerNotSet = 115,
    /// Bridge amount too low: below minimum transfer
    BridgeAmountTooLow = 116,
    /// Bridge amount too high: exceeds maximum transfer
    BridgeAmountTooHigh = 117,
    /// Bridge transaction expired: timeout reached
    BridgeTransactionExpired = 118,
    /// Unsupported token pair for bridge transfer
    UnsupportedTokenPair = 119,
    // ── Insurance & Risk (120-129) ──────────────────────────
    /// Insurance fund not configured
    InsuranceFundNotConfigured = 120,
    /// Insurance fund empty: no funds available for claims
    InsuranceFundEmpty = 121,
    /// Insurance claim already filed for this event
    InsuranceClaimAlreadyFiled = 122,
    /// Insurance claim rejected: does not meet criteria
    InsuranceClaimRejected = 123,
    /// Insurance claim window expired
    InsuranceClaimWindowExpired = 124,
    /// Coverage limit exceeded: claim exceeds policy cap
    CoverageLimitExceeded = 125,
    /// Premium not paid: insurance coverage is inactive
    PremiumNotPaid = 126,
    /// Risk score too high: coverage denied
    RiskScoreTooHigh = 127,
    /// Underwriting failed: risk assessment error
    UnderwritingFailed = 128,
    /// Insurance operations are currently paused
    InsurancePaused = 129,
    // ── Identity & Compliance (130-139) ─────────────────────
    /// KYC not completed: identity verification required
    KYCNotCompleted = 130,
    /// KYC tier too low: upgrade verification level
    KYCTierTooLow = 131,
    /// AML flag raised: transaction blocked for review
    AMLFlagRaised = 132,
    /// Sanctions list match: address is restricted
    SanctionsListMatch = 133,
    /// Identity verification failed: documents invalid
    IdentityVerificationFailed = 134,
    /// Travel rule violation: beneficiary info required
    TravelRuleViolation = 135,
    /// Jurisdiction not supported for this operation
    JurisdictionNotSupported = 136,
    /// Residency check failed: proof of residency required
    ResidencyCheckFailed = 137,
    /// Accreditation required: investor status not verified
    AccreditationRequired = 138,
    /// Age verification failed: minimum age not met
    AgeVerificationFailed = 139,
    // ── Payment Routing & Splitting (140-149) ───────────────
    /// Payment route not found: no valid path
    PaymentRouteNotFound = 140,
    /// Payment split failed: distribution error
    PaymentSplitFailed = 141,
    /// Split percentage invalid: must sum to 100%
    SplitPercentageInvalid = 142,
    /// Route hop limit exceeded: path too long
    RouteHopLimitExceeded = 143,
    /// Path payment too expensive: exceeds max fee
    PathPaymentTooExpensive = 144,
    /// Liquidity pool not found for asset pair
    LiquidityPoolNotFound = 145,
    /// Slippage exceeded: price moved beyond tolerance
    SlippageExceeded = 146,
    /// Deadline exceeded: transaction too old
    DeadlineExceeded = 147,
    /// Price oracle stale: last update too old
    PriceOracleStale = 148,
    /// Flash loan not repaid in same transaction
    FlashLoanNotRepaid = 149,
    // ── Gas & Resource Management (150-159) ─────────────────
    /// Out of gas: computation budget exhausted
    OutOfGas = 150,
    /// Gas price too low: below network minimum
    GasPriceTooLow = 151,
    /// Gas refund failed: refund transfer error
    GasRefundFailed = 152,
    /// Memory limit exceeded: allocation too large
    MemoryLimitExceeded = 153,
    /// Stack depth exceeded: too many nested calls
    StackDepthExceeded = 154,
    /// Instruction budget exceeded: too many operations
    InstructionBudgetExceeded = 155,
    /// Read budget exceeded: too many storage reads
    ReadBudgetExceeded = 156,
    /// Write budget exceeded: too many storage writes
    WriteBudgetExceeded = 157,
    /// TTL too low: entry would expire too soon
    TTLTooLow = 158,
    /// Ledger entry limit reached: cannot create more
    LedgerEntryLimitReached = 159,
    // ── Oracle & Data Feeds (160-169) ───────────────────────
    /// Oracle not configured: call set_oracle() first
    OracleNotConfigured = 160,
    /// Oracle timeout: response took too long
    OracleTimeout = 161,
    /// Oracle price deviation: outlier detected
    OraclePriceDeviation = 162,
    /// Data feed unavailable: source is offline
    DataFeedUnavailable = 163,
    /// Data feed tampered: integrity check failed
    DataFeedTampered = 164,
    /// Oracle already active: duplicate registration
    OracleAlreadyActive = 165,
    /// Price feed stale: last update exceeds threshold
    PriceFeedStale = 166,
    /// Confidence interval too wide: price uncertain
    ConfidenceIntervalTooWide = 167,
    /// Oracle signature invalid: attestation failed
    OracleSignatureInvalid = 168,
    /// Maximum price age exceeded: feed too old
    MaxPriceAgeExceeded = 169,
    // ── Batch & Streaming Advanced (170-179) ────────────────
    /// Batch execution timeout: not all items finished
    BatchExecutionTimeout = 170,
    /// Batch partial failure: some items failed
    BatchPartialFailure = 171,
    /// Stream rate invalid: must be positive non-zero
    StreamRateInvalid = 172,
    /// Stream duration too long: exceeds maximum
    StreamTooLong = 173,
    /// Stream claim too early: minimum interval not met
    StreamClaimTooEarly = 174,
    /// Batch authorization failed: signer rejected
    BatchAuthorizationFailed = 175,
    /// Batch duplicate ID: transaction already processed
    BatchDuplicateId = 176,
    /// Stream beneficiary unchanged: same as current
    StreamBeneficiaryUnchanged = 177,
    /// Stream transfer not allowed: stream is non-transferable
    StreamTransferNotAllowed = 178,
    /// Batch cleanup failed: stale state removal error
    BatchCleanupFailed = 179,
    // ── Dispute Resolution (180-189) ────────────────────────
    /// Dispute not open: no active dispute found
    DisputeNotOpen = 180,
    /// Dispute arbiter not set: configure arbiter first
    DisputeArbiterNotSet = 181,
    /// Dispute evidence required: must submit proof
    DisputeEvidenceRequired = 182,
    /// Dispute already resolved: final decision made
    DisputeAlreadyResolved = 183,
    /// Dispute resolution timed out: arbiter did not respond
    DisputeResolutionTimedOut = 184,
    /// Arbiter not authorized: not in approved list
    ArbiterNotAuthorized = 185,
    /// Mediation failed: parties could not agree
    MediationFailed = 186,
    /// Appeal window closed: too late to appeal
    AppealWindowClosed = 187,
    /// Dispute bond insufficient: must stake more
    DisputeBondInsufficient = 188,
    /// Dispute escalation failed: higher authority error
    DisputeEscalationFailed = 189,
    // ── Miscellaneous Guards (190-199) ──────────────────────
    /// Maximum storage entries reached: ledger full
    MaxStorageEntriesReached = 190,
    /// Storage fee not paid: rent payment required
    StorageFeeNotPaid = 191,
    /// Archive entry not found: record already pruned
    ArchiveEntryNotFound = 192,
    /// State sync mismatch: ledger state inconsistent
    StateSyncMismatch = 193,
    /// Migration in progress: try again later
    MigrationInProgress = 194,
    /// Rollback detected: chain reorganization
    RollbackDetected = 195,
    /// Snapshot verification failed: hash mismatch
    SnapshotVerificationFailed = 196,
    /// Contract deprecated: use the new version
    ContractDeprecated = 197,
    /// Emergency shutdown active: all operations blocked
    EmergencyShutdownActive = 198,
    /// System overloaded: too many concurrent requests
    SystemOverloaded = 199,
    // ── Advanced Governance (200-209) ───────────────────────
    /// Delegate not active: delegator is offline or disabled
    DelegateNotActive = 200,
    /// Delegation expired: delegation period has ended
    DelegationExpired = 201,
    /// Vote delegation mismatch: delegate does not match voter
    VoteDelegationMismatch = 202,
    /// Proposal cancelled: proposal was withdrawn by creator
    ProposalCancelled = 203,
    /// Proposal quorum changed: quorum was modified mid-vote
    ProposalQuorumChanged = 204,
    /// Emergency governance paused: voting is temporarily suspended
    EmergencyGovernancePaused = 205,
    /// Governance token locked: tokens are in a lockup period
    GovernanceTokenLocked = 206,
    /// Voting power frozen: votes are immobilized by a freeze
    VotingPowerFrozen = 207,
    /// Proposal execution failed: on-chain execution reverted
    ProposalExecutionFailed = 208,
    /// Governance upgrade pending: upgrade has not been finalized
    GovernanceUpgradePending = 209,
    // ── Treasury & Reserves (210-219) ───────────────────────
    /// Treasury not configured: call configure_treasury() first
    TreasuryNotConfigured = 210,
    /// Treasury withdrawal pending: timelock has not elapsed
    TreasuryWithdrawalPending = 211,
    /// Reserve requirement not met: minimum reserve ratio breached
    ReserveRequirementNotMet = 212,
    /// Treasury multisig required: threshold signatures missing
    TreasuryMultisigRequired = 213,
    /// Reserve asset unavailable: asset cannot be used as reserve
    ReserveAssetUnavailable = 214,
    /// Treasury report mismatch: balance does not match ledger
    TreasuryReportMismatch = 215,
    /// Reserve ratio breached: reserves fell below the minimum
    ReserveRatioBreached = 216,
    /// Treasury audit failed: reconciliation check did not pass
    TreasuryAuditFailed = 217,
    /// Reserve rebalance failed: allocation update reverted
    ReserveRebalanceFailed = 218,
    /// Treasury access revoked: caller permissions were removed
    TreasuryAccessRevoked = 219,
    // ── Token & Asset Management (220-229) ──────────────────
    /// Token already listed: asset is already supported
    TokenAlreadyListed = 220,
    /// Token delisting pending: removal is awaiting timelock
    TokenDelistingPending = 221,
    /// Asset pair not found: no market exists for the pair
    AssetPairNotFound = 222,
    /// Token supply cap exceeded: mint would exceed the cap
    TokenSupplyCapExceeded = 223,
    /// Minting paused: new issuance is temporarily disabled
    MintingPaused = 224,
    /// Burning paused: token destruction is temporarily disabled
    BurningPaused = 225,
    /// Token frozen: asset transfers are blocked
    TokenFrozen = 226,
    /// Asset trustline missing: trustline must be established
    AssetTrustlineMissing = 227,
    /// Token metadata invalid: name, symbol, or decimals malformed
    TokenMetadataInvalid = 228,
    /// Asset migration pending: upgrade to new contract incomplete
    AssetMigrationPending = 229,
    // ── Lending & Credit (230-239) ──────────────────────────
    /// Lending pool not configured: call configure_lending() first
    LendingPoolNotConfigured = 230,
    /// Loan not found
    LoanNotFound = 231,
    /// Loan already repaid: no outstanding balance
    LoanAlreadyRepaid = 232,
    /// Collateral insufficient: below required ratio
    CollateralInsufficient = 233,
    /// Liquidation pending: position is in the process of liquidation
    LiquidationPending = 234,
    /// Interest rate invalid: outside allowed bounds
    InterestRateInvalid = 235,
    /// Credit limit exceeded: borrow would exceed the limit
    CreditLimitExceeded = 236,
    /// Loan maturity reached: repayment is now due
    LoanMaturityReached = 237,
    /// Collateral frozen: collateral cannot be moved
    CollateralFrozen = 238,
    /// Lending paused: borrow and lend operations are suspended
    LendingPaused = 239,
    // ── Recurring & Subscriptions (240-249) ─────────────────
    /// Subscription not found
    SubscriptionNotFound = 240,
    /// Subscription already cancelled
    SubscriptionAlreadyCancelled = 241,
    /// Subscription renewal failed: payment did not settle
    SubscriptionRenewalFailed = 242,
    /// Billing cycle invalid: interval is not supported
    BillingCycleInvalid = 243,
    /// Subscription paused: renewals are temporarily halted
    SubscriptionPaused = 244,
    /// Trial period expired: paid plan is now required
    TrialPeriodExpired = 245,
    /// Payment method invalid: token or method not accepted
    PaymentMethodInvalid = 246,
    /// Subscription tier not allowed: upgrade is restricted
    SubscriptionTierNotAllowed = 247,
    /// Usage quota exceeded: plan allowance has been reached
    UsageQuotaExceeded = 248,
    /// Subscription upgrade pending: change has not been applied
    SubscriptionUpgradePending = 249,
    // ── Privacy & Zero-Knowledge (250-259) ──────────────────
    /// Zero-knowledge proof invalid: verification failed
    ZkProofInvalid = 250,
    /// Privacy pool not configured: call configure_privacy() first
    PrivacyPoolNotConfigured = 251,
    /// Commitment already spent: double-spend detected
    CommitmentAlreadySpent = 252,
    /// Nullifier already used: proof was previously consumed
    NullifierAlreadyUsed = 253,
    /// Merkle path invalid: membership proof is malformed
    MerklePathInvalid = 254,
    /// Privacy deposit too low: below the minimum amount
    PrivacyDepositTooLow = 255,
    /// Privacy withdrawal pending: timelock has not elapsed
    PrivacyWithdrawalPending = 256,
    /// Stealth address invalid: cannot derive recipient
    StealthAddressInvalid = 257,
    /// Confidential transfer failed: shielded amount mismatch
    ConfidentialTransferFailed = 258,
    /// Privacy paused: shielded operations are suspended
    PrivacyPaused = 259,
    // ── Messaging & Notifications (260-269) ─────────────────
    /// Notification service down: delivery backend unavailable
    NotificationServiceDown = 260,
    /// Message too long: exceeds maximum length
    MessageTooLong = 261,
    /// Recipient unsubscribed: target has opted out
    RecipientUnsubscribed = 262,
    /// Notification delivery failed: could not reach recipient
    NotificationDeliveryFailed = 263,
    /// Notification rate limited: too many messages sent
    NotificationRateLimited = 264,
    /// Message signature invalid: sender could not be verified
    MessageSignatureInvalid = 265,
    /// Inbox full: recipient storage limit reached
    InboxFull = 266,
    /// Notification template invalid: malformed payload
    NotificationTemplateInvalid = 267,
    /// Message expired: delivery window has passed
    MessageExpired = 268,
    /// Notification channel closed: channel is no longer active
    NotificationChannelClosed = 269,
    // ── Analytics & Reporting (270-279) ─────────────────────
    /// Report generation failed: aggregation error
    ReportGenerationFailed = 270,
    /// Analytics data missing: required metrics unavailable
    AnalyticsDataMissing = 271,
    /// Metric out of range: value exceeds allowed bounds
    MetricOutOfRange = 272,
    /// Report too large: exceeds maximum output size
    ReportTooLarge = 273,
    /// Snapshot not found: requested point-in-time state missing
    SnapshotNotFound = 274,
    /// Aggregation window invalid: time range is malformed
    AggregationWindowInvalid = 275,
    /// Data retention expired: historical data was pruned
    DataRetentionExpired = 276,
    /// Report access denied: insufficient permissions
    ReportAccessDenied = 277,
    /// Analytics quota exceeded: too many report requests
    AnalyticsQuotaExceeded = 278,
    /// Export format unsupported: requested format is not available
    ExportFormatUnsupported = 279,
    // ── Interoperability & Standards (280-289) ──────────────
    /// SEP protocol violation: interface contract was not honored
    SepProtocolViolation = 280,
    /// Asset not SEP-compliant: missing required SEP behavior
    AssetNotSepCompliant = 281,
    /// Cross-contract version mismatch: incompatible API versions
    CrossContractVersionMismatch = 282,
    /// Interface not implemented: required method is missing
    InterfaceNotImplemented = 283,
    /// Standards compliance failed: validation did not pass
    StandardsComplianceFailed = 284,
    /// Protocol upgrade required: dependency is out of date
    ProtocolUpgradeRequired = 285,
    /// Interop handshake failed: connection could not be established
    InteropHandshakeFailed = 286,
    /// Namespace collision: identifier is already registered
    NamespaceCollision = 287,
    /// External system unavailable: dependency is offline
    ExternalSystemUnavailable = 288,
    /// Interop rate limit exceeded: too many cross-system calls
    InteropRateLimitExceeded = 289,
    // ── System & Protocol Guards (290-300) ──────────────────
    /// Contract upgrade scheduled: upgrade is pending execution
    ContractUpgradeScheduled = 290,
    /// Maintenance mode active: operations temporarily disabled
    MaintenanceModeActive = 291,
    /// Circuit breaker tripped: safety threshold was exceeded
    CircuitBreakerTripped = 292,
    /// Emergency freeze active: all state changes are blocked
    EmergencyFreezeActive = 293,
    /// System clock drift detected: ledger time is inconsistent
    SystemClockDriftDetected = 294,
    /// Ledger version unsupported: network upgrade required
    LedgerVersionUnsupported = 295,
    /// Network partition detected: consensus is unavailable
    NetworkPartitionDetected = 296,
    /// Resource exhaustion warning: limits are near capacity
    ResourceExhaustionWarning = 297,
    /// Grace period active: transitional restrictions in effect
    GracePeriodActive = 298,
    /// Configuration invalid: stored configuration is malformed
    ConfigurationInvalid = 299,
    /// System fatal error: unrecoverable internal failure
    SystemFatalError = 300,
    // ── Two-Step Revocation (301-305) ──────────────────────
    /// Revocation not found
    RevocationNotFound = 301,
    /// Revocation not due
    RevocationNotDue = 302,
    /// Revocation already executed
    RevocationAlreadyExecuted = 303,
    /// Cannot revoke self
    CannotRevokeSelf = 304,
    /// No pending ownership transfer
    NoPendingOwner = 305,
    /// Math overflow
    MathOverflow = 306,
    // ── Stream Accounting Guards (307) ─────────────────────
    /// Stream accounting invariant violated: refused to pay an inconsistent amount
    StreamInvariantViolated = 307,
}

// ── Native Events ──────────────────────────────────────────────

fn emit_payment_event(env: &Env, payer: &Address, payee: &Address, amount: &i128) {
    env.events().publish(
        (Symbol::new(env, "payment"), payer.clone(), payee.clone()),
        *amount,
    );
}

fn emit_escrow_event(env: &Env, depositor: &Address, beneficiary: &Address, amount: &i128) {
    env.events().publish(
        (
            Symbol::new(env, "escrow"),
            depositor.clone(),
            beneficiary.clone(),
        ),
        *amount,
    );
}

fn emit_stream_event(env: &Env, creator: &Address, recipient: &Address, amount: &i128) {
    env.events().publish(
        (
            Symbol::new(env, "stream"),
            creator.clone(),
            recipient.clone(),
        ),
        *amount,
    );
}

/// Increment a u64 counter key by 1. Gas-optimized: single-key read+write
/// instead of deserializing/serializing an 11-field ContractStats struct.
/// Note: does NOT extend TTL — callers should batch TTL extensions at the end
/// of each function to avoid redundant metadata writes.
fn inc_counter(env: &Env, key: &Symbol) {
    let val: u64 = env.storage().instance().get(key).unwrap_or(0);
    env.storage().instance().set(key, &val.saturating_add(1));
}

/// Add delta to a u64 counter key. Same single-key optimization.
fn add_u64_counter(env: &Env, key: &Symbol, delta: u64) {
    let val: u64 = env.storage().instance().get(key).unwrap_or(0);
    env.storage()
        .instance()
        .set(key, &val.saturating_add(delta));
}

/// Add delta to an i128 counter key. Same single-key optimization.
/// Same TTL note as inc_counter.
fn add_counter(env: &Env, key: &Symbol, delta: i128) {
    let val: i128 = env.storage().instance().get(key).unwrap_or(0);
    env.storage()
        .instance()
        .set(key, &val.saturating_add(delta));
}

/// Track funds locked in active escrows/streams. Pass the actual amount being
/// deposited (positive) or withdrawn (negative). Used by emergency_withdraw
/// to prevent the owner from withdrawing user-deposited funds.
fn add_locked(env: &Env, delta: i128) {
    let val: i128 = env.storage().instance().get(&LOCKED_BALANCE).unwrap_or(0);
    let new_val = val.saturating_add(delta);
    // Clamp at 0 — locked balance must never go negative
    let clamped = if new_val < 0 { 0 } else { new_val };
    env.storage().instance().set(&LOCKED_BALANCE, &clamped);
}

/// Compute the protocol fee for an amount at the given fee basis points.
/// Shared by the public `calculate_fee` contract method and the internal
/// `collect_fee` helper so fee math stays in one place.
fn compute_fee(amount: i128, fee_bps: u32) -> i128 {
    if fee_bps == 0 || amount <= 0 {
        return 0;
    }
    amount.saturating_mul(fee_bps as i128) / 10000
}

/// Collect protocol fees from the payer and transfer to the fee collector.
/// Returns the fee amount collected (0 if fees are disabled or no collector
/// is set).  Returns an error if the fee transfer fails — which reverts
/// the entire payment, ensuring fee collection is atomic.
fn collect_fee(
    env: &Env,
    payer: &Address,
    asset: &Address,
    payment_amount: i128,
) -> Result<i128, PaymentError> {
    // Read fee config; if disabled or no collector, skip fee collection.
    let config: Option<FeeConfig> = env.storage().instance().get(&FEE_KEY);
    let config = match config {
        Some(c) if c.enabled => c,
        _ => return Ok(0),
    };
    let collector: Address = match env.storage().instance().get(&FEE_COLL) {
        Some(c) => c,
        None => return Ok(0),
    };

    let fee = compute_fee(payment_amount, config.payment_fee_bps);
    if fee <= 0 {
        return Ok(0);
    }

    // Transfer fee from payer to collector.  If this fails (insufficient
    // balance, missing trustline, etc.), the entire payment reverts.
    let token_client = token::Client::new(env, asset);
    token_client.transfer(payer, &collector, &fee);

    Ok(fee)
}

/// Get the current locked balance (funds held in active escrows + streams).
fn record_audit(env: &Env, action: &str, actor: &Address, target_id: u64, details: &str) {
    let mut count: u64 = env.storage().instance().get(&AUDIT_CNT).unwrap_or(0);
    count = count.saturating_add(1);
    let entry = AuditEntry {
        id: count,
        timestamp: env.ledger().timestamp(),
        action: String::from_str(env, action),
        actor: actor.clone(),
        target_id,
        details: String::from_str(env, details),
    };
    env.storage()
        .persistent()
        .set(&(AUDIT_LOG_KEY, count), &entry);
    env.storage()
        .persistent()
        .extend_ttl(&(AUDIT_LOG_KEY, count), BUMP_MIN_TTL, BUMP_MAX_TTL);
    env.storage().instance().set(&AUDIT_CNT, &count);
    env.storage().instance().extend_ttl(BUMP_MIN_TTL, BUMP_MAX_TTL);
    env.events().publish(
        (Symbol::new(env, "audit"), Symbol::new(env, action)),
        (actor.clone(), target_id),
    );
}

/// Guard: caller must be the contract owner. Deduplicates the 15+ identical
/// owner-check blocks, reducing Wasm code size and deployment gas.
fn require_owner(env: &Env, caller: &Address) -> Result<(), PaymentError> {
    let owner: Address = env
        .storage()
        .instance()
        .get(&OWNER)
        .ok_or(PaymentError::NotInitialized)?;
    if caller != &owner {
        return Err(PaymentError::Unauthorized);
    }
    Ok(())
}

/// Guard: reject all write operations while the contract is paused.
fn require_not_paused(env: &Env) -> Result<(), PaymentError> {
    let paused: bool = env.storage().instance().get(&PAUSED).unwrap_or(false);
    if paused {
        return Err(PaymentError::ContractPaused);
    }
    Ok(())
}

/// Reentrancy guard: set lock before cross-contract calls.
/// Soroban contracts are single-threaded per invocation, but reentrancy
/// can occur when a cross-contract call loops back to this contract.
///
/// The returned guard automatically releases the lock when dropped, so it is
/// safe to `?`-return from the guarded function without leaking the lock.
/// Because the check must reject reentrant calls even for otherwise-invalid
/// inputs, this must be the FIRST operation in any token-moving function.
struct ReentrancyGuard<'a> {
    env: &'a Env,
}

impl Drop for ReentrancyGuard<'_> {
    fn drop(&mut self) {
        release_reentrancy_lock(self.env);
    }
}

fn acquire_reentrancy_lock<'a>(env: &'a Env) -> Result<ReentrancyGuard<'a>, PaymentError> {
    let locked: bool = env
        .storage()
        .instance()
        .get(&REENTRANCY_LOCK)
        .unwrap_or(false);
    if locked {
        return Err(PaymentError::ReentrantCall);
    }
    env.storage().instance().set(&REENTRANCY_LOCK, &true);
    Ok(ReentrancyGuard { env })
}

/// Release the reentrancy lock after cross-contract calls complete.
/// Prefer using the [`ReentrancyGuard`] returned by [`acquire_reentrancy_lock`],
/// which releases automatically on drop. This is only used internally by the guard.
fn release_reentrancy_lock(env: &Env) {
    env.storage().instance().set(&REENTRANCY_LOCK, &false);
}

/// Calculate the linearly vested amount without ever losing precision.
///
/// `total_amount * elapsed` can exceed `i128::MAX` for very large streams
/// (AUDIT LOW-1). Returning `0` on overflow silently under-vests the recipient
/// — the stream stops paying out exactly when the amount is large enough to
/// matter. Capping at `total_amount` instead is just as wrong in the other
/// direction: it would treat a barely-started stream as fully vested and let
/// the recipient drain the contract (INV-5).
///
/// The multiply is therefore performed at 256-bit precision so the result is
/// always the exact linear vesting value and can never exceed `total_amount`.
fn compute_vested(total_amount: i128, start_time: u64, end_time: u64, now: u64) -> i128 {
    if now >= end_time {
        return total_amount;
    }
    if now <= start_time {
        return 0;
    }
    let elapsed = (now - start_time) as i128;
    let total_duration = (end_time - start_time) as i128;
    if total_duration == 0 {
        return total_amount;
    }

    if let Some(product) = total_amount.checked_mul(elapsed) {
        return product / total_duration;
    }

    // The 128-bit product overflowed. `create_stream` rejects non-positive
    // amounts, so `total_amount > 0`, and `now < end_time` guarantees
    // `0 < elapsed < total_duration`. The exact result is therefore
    //
    //     floor(a * b / d) == (a / d) * b + floor((a % d) * b / d)
    //
    // with `a = total_amount`, `b = elapsed`, `d = total_duration`. Both `b`
    // and `d` originate from u64 timestamps, so `(a % d) * b` fits in u128 and
    // the sum is bounded by `total_amount` — no precision is lost and the
    // INV-5 ceiling holds.
    if total_amount <= 0 {
        // Unreachable for streams; keeps the u128 casts below value-preserving.
        return total_amount;
    }
    let amount = total_amount as u128;
    let divisor = total_duration as u128;
    let multiplier = elapsed as u128;
    let whole = (amount / divisor) * multiplier;
    let fractional = ((amount % divisor) * multiplier) / divisor;
    (whole + fractional) as i128
}

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
        require_not_paused(&env)?;

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
        require_not_paused(&env)?;

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
        require_not_paused(&env)?;

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
        require_not_paused(&env)?;

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
        require_not_paused(&env)?;

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
        require_not_paused(&env)?;
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
        require_not_paused(&env)?;
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
        require_not_paused(&env)?;
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
        require_not_paused(&env)?;
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
        require_not_paused(&env)?;

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
        require_not_paused(&env)?;

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
        require_not_paused(&env)?;
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
        require_not_paused(&env)?;

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
        require_not_paused(&env)?;

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
        require_not_paused(&env)?;
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
        require_not_paused(&env)?;

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
        require_not_paused(&env)?;
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
        require_not_paused(&env)?;

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
        require_not_paused(&env)?;

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
        require_not_paused(&env)?;

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
        require_not_paused(&env)?;
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
        require_not_paused(&env)?;

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

// ── Tests ─────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger as _};
    use soroban_sdk::{vec, String};

    fn create_token_contract(e: &Env, admin: &Address) -> Address {
        e.register_stellar_asset_contract(admin.clone())
    }

    // ── Admin Tests ─────────────────────────────────────────

    #[test]
    fn test_init_and_owner() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);

        let version = client.init(&owner);
        assert_eq!(version, CONTRACT_VERSION);
        assert_eq!(client.get_owner(), owner);
        assert_eq!(client.get_payment_count(), 0);
    }

    #[test]
    fn test_init_twice_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);

        let _ = client.init(&owner);
        // v27 client try_ variant surfaces the exact contract error
        assert_eq!(
            client.try_init(&owner),
            Err(Ok(PaymentError::AlreadyInitialized))
        );
    }

    #[test]
    fn test_transfer_ownership() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let new_owner = Address::generate(&env);

        let now = env.ledger().timestamp();
        let _ = client.init(&owner);

        // transfer_ownership is now a two-step proposal: the owner does not
        // change until the proposed new owner accepts after the timelock.
        client.transfer_ownership(&owner, &new_owner);
        assert_eq!(client.get_owner(), owner);

        env.ledger().set_timestamp(now + 86401);
        client.accept_ownership(&new_owner);
        assert_eq!(client.get_owner(), new_owner);
    }

    #[test]
    #[should_panic]
    fn test_unauthorized_transfer_ownership_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let rando = Address::generate(&env);

        let _ = client.init(&owner);
        client.transfer_ownership(&rando, &rando); // should panic
    }

    // ── Payment Record Tests ────────────────────────────────

    #[test]
    fn test_record_payment() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1000);
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);

        let _ = client.init(&owner);

        let id = client.record_payment(
            &payer,
            &payee,
            &1000i128,
            &sac,
            &String::from_str(&env, "tx_hash_abc"),
            &String::from_str(&env, "test payment"),
        );
        assert_eq!(id, 1);
        assert_eq!(client.get_payment_count(), 1);

        let payment = client.get_payment(&1);
        assert_eq!(payment.payer, payer);
        assert_eq!(payment.payee, payee);
        assert_eq!(payment.amount, 1000);
        assert_eq!(payment.tx_hash, String::from_str(&env, "tx_hash_abc"));
        assert!(payment.timestamp > 0);
    }

    #[test]
    fn test_record_payment_zero_amount_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);

        let _ = client.init(&owner);
        assert_eq!(
            client.try_record_payment(
                &payer,
                &payee,
                &0i128,
                &sac,
                &String::from_str(&env, "tx"),
                &String::from_str(&env, ""),
            ),
            Err(Ok(PaymentError::InvalidAmount))
        );
    }

    #[test]
    fn test_cancel_payment_by_owner() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);

        let _ = client.init(&owner);
        let _ = client.record_payment(
            &payer,
            &payee,
            &500i128,
            &sac,
            &String::from_str(&env, "tx"),
            &String::from_str(&env, ""),
        );

        client.cancel_payment(&owner, &1);
        let payment = client.get_payment(&1);
        assert!(payment.cancelled);
        assert_eq!(payment.amount, 500); // amount is preserved, not zeroed
    }

    // ── Escrow Tests ────────────────────────────────────────

    #[test]
    fn test_create_and_release_escrow() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        let depositor = Address::generate(&env);
        let beneficiary = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);
        let sac_client = token::StellarAssetClient::new(&env, &sac);
        sac_client.mint(&depositor, &10_000i128);

        let _ = client.init(&owner);

        let escrow_id = client.create_escrow(
            &depositor,
            &beneficiary,
            &Option::<Address>::None,
            &1000i128,
            &sac,
            &(env.ledger().timestamp() + 86400),
            &String::from_str(&env, "escrow test"),
        );
        assert_eq!(escrow_id, 1);
        assert_eq!(client.get_escrow_count(), 1);

        let escrow = client.get_escrow(&1);
        assert_eq!(escrow.depositor, depositor);
        assert_eq!(escrow.beneficiary, beneficiary);
        assert_eq!(escrow.amount, 1000);
        assert!(!escrow.released);

        client.release_escrow(&owner, &1);
        let escrow2 = client.get_escrow(&1);
        assert!(escrow2.released);
        assert!(escrow2.claimed);
    }

    #[test]
    fn test_claim_escrow_after_deadline() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        let depositor = Address::generate(&env);
        let beneficiary = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);
        let sac_client = token::StellarAssetClient::new(&env, &sac);
        sac_client.mint(&depositor, &10_000i128);

        let now = env.ledger().timestamp();
        let _ = client.init(&owner);
        let _ = client.create_escrow(
            &depositor,
            &beneficiary,
            &None::<Address>,
            &500i128,
            &sac,
            &(now + 100),
            &String::from_str(&env, "deadline test"),
        );

        env.ledger().set_timestamp(now + 200);

        client.claim_escrow(&beneficiary, &1);
        let escrow = client.get_escrow(&1);
        assert!(escrow.claimed);
    }

    #[test]
    fn test_reentrancy_lock_released_after_guarded_ops() {
        // MEDIUM-4 regression: every token-moving operation must release the
        // REENTRANCY_LOCK after the cross-contract transfer completes, so
        // subsequent operations in the same transaction are not blocked.
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        let depositor = Address::generate(&env);
        let beneficiary = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);
        let sac_client = token::StellarAssetClient::new(&env, &sac);
        sac_client.mint(&depositor, &10_000i128);

        let now = env.ledger().timestamp();
        let _ = client.init(&owner);
        let _ = client.create_escrow(
            &depositor,
            &beneficiary,
            &None::<Address>,
            &500i128,
            &sac,
            &(now + 100),
            &String::from_str(&env, "reentrancy test"),
        );

        env.ledger().set_timestamp(now + 200);

        // Claim — the guarded operation. Must release the lock on success.
        client.claim_escrow(&beneficiary, &1);

        // A second token-moving operation in the same env must NOT hit
        // ReentrantCall — proving the lock was released.
        let _ = client.create_escrow(
            &depositor,
            &beneficiary,
            &None::<Address>,
            &300i128,
            &sac,
            &(now + 200),
            &String::from_str(&env, "second escrow"),
        );
        env.ledger().set_timestamp(now + 300);
        client.claim_escrow(&beneficiary, &2);

        // Lock must be false after all guarded operations.
        let locked: bool = env.as_contract(&contract_id, || {
            env.storage()
                .instance()
                .get(&REENTRANCY_LOCK)
                .unwrap_or(false)
        });
        assert!(!locked);
    }

    #[test]
    #[should_panic]
    fn test_claim_escrow_before_deadline_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        let depositor = Address::generate(&env);
        let beneficiary = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);
        let sac_client = token::StellarAssetClient::new(&env, &sac);
        sac_client.mint(&depositor, &10_000i128);

        let now = env.ledger().timestamp();
        let _ = client.init(&owner);
        let _ = client.create_escrow(
            &depositor,
            &beneficiary,
            &None::<Address>,
            &500i128,
            &sac,
            &(now + 10000),
            &String::from_str(&env, "future"),
        );

        client.claim_escrow(&beneficiary, &1); // should panic before deadline
    }

    // ── Stream Tests ───────────────────────────────────────

    #[test]
    fn test_create_and_claim_stream() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        let creator = Address::generate(&env);
        let recipient = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);
        let sac_client = token::StellarAssetClient::new(&env, &sac);
        sac_client.mint(&creator, &10_000i128);

        let now = env.ledger().timestamp();
        let _ = client.init(&owner);

        let stream_id = client.create_stream(
            &creator,
            &recipient,
            &1000i128,
            &sac,
            &now,
            &(now + 1000),
            &String::from_str(&env, "salary"),
        );
        assert_eq!(stream_id, 1);
        assert_eq!(client.get_stream_count(), 1);

        let stream = client.get_stream(&1);
        assert_eq!(stream.total_amount, 1000);
        assert_eq!(stream.claimed_amount, 0);
        assert!(!stream.cancelled);

        env.ledger().set_timestamp(now + 500);
        let claimed = client.claim_stream(&recipient, &1);
        assert_eq!(claimed, 500);

        env.ledger().set_timestamp(now + 2000);
        let claimed2 = client.claim_stream(&recipient, &1);
        assert_eq!(claimed2, 500);

        let stream_final = client.get_stream(&1);
        assert_eq!(stream_final.claimed_amount, 1000);
    }

    #[test]
    fn test_cancel_stream_returns_unvested() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        let creator = Address::generate(&env);
        let recipient = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);
        let sac_client = token::StellarAssetClient::new(&env, &sac);
        sac_client.mint(&creator, &10_000i128);

        let now = env.ledger().timestamp();
        let _ = client.init(&owner);
        let _ = client.create_stream(
            &creator,
            &recipient,
            &1000i128,
            &sac,
            &now,
            &(now + 1000),
            &String::from_str(&env, "cancel test"),
        );

        env.ledger().set_timestamp(now + 200);
        let returned = client.cancel_stream(&creator, &1);
        assert_eq!(returned, 800);

        let stream = client.get_stream(&1);
        assert!(stream.cancelled);
    }

    // ── Vesting Overflow (AUDIT LOW-1 / issue #691) ─────────

    /// `i128::MAX * 2` overflows. The old code returned `0` here, silently
    /// under-vesting a stream that is 50% through its schedule.
    #[test]
    fn test_compute_vested_overflow_is_exact_and_not_zero() {
        let total = i128::MAX;
        let start = 1_000u64;
        let end = start + 4; // duration 4 seconds
        let now = start + 2; // elapsed 2 seconds → exactly 50%

        let vested = compute_vested(total, start, end, now);

        assert!(vested > 0, "overflow must not collapse vesting to zero");
        assert_eq!(vested, total / 2, "exact half of the stream must vest");
        assert!(vested <= total, "vested amount must never exceed the total");
    }

    /// The widened multiply stays exact for quotients that are not a clean
    /// fraction, and never exceeds the stream total (INV-5).
    #[test]
    fn test_compute_vested_overflow_is_bounded_and_monotonic() {
        let total = i128::MAX;
        let start = 0u64;
        let end = 9u64;

        assert_eq!(compute_vested(total, start, end, 3), total / 3);

        let mut previous = 0i128;
        for now in 1..=end {
            let vested = compute_vested(total, start, end, now);
            assert!(vested <= total, "vesting exceeded the stream total");
            assert!(vested >= previous, "vesting must be non-decreasing");
            previous = vested;
        }
        assert_eq!(previous, total);
    }

    /// `now >= end_time` short-circuits to the full amount even though the
    /// multiply for a fully elapsed stream would overflow.
    #[test]
    fn test_compute_vested_overflow_fully_vests_at_end() {
        let total = i128::MAX;
        assert_eq!(compute_vested(total, 10, 20, 20), total);
        assert_eq!(compute_vested(total, 10, 20, 1_000), total);
    }

    /// End-to-end: a stream whose vesting multiply overflows must still pay the
    /// recipient the correct remaining balance at every step.
    #[test]
    fn test_claim_stream_with_overflowing_vesting_pays_correct_balance() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        let creator = Address::generate(&env);
        let recipient = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);
        let sac_client = token::StellarAssetClient::new(&env, &sac);
        sac_client.mint(&creator, &i128::MAX);

        let now = env.ledger().timestamp();
        let _ = client.init(&owner);

        let stream_id = client.create_stream(
            &creator,
            &recipient,
            &i128::MAX,
            &sac,
            &now,
            &(now + 4),
            &String::from_str(&env, "overflow"),
        );
        assert_eq!(stream_id, 1);

        // 50% through: the multiply (`MAX * 2`) overflows i128.
        env.ledger().set_timestamp(now + 2);
        let first = client.claim_stream(&recipient, &1);
        assert_eq!(first, i128::MAX / 2, "half of the stream must be claimable");
        assert!(first > 0, "claim must not silently pay nothing");

        // Fully vested: the remainder is exactly what has not been claimed.
        env.ledger().set_timestamp(now + 10);
        let second = client.claim_stream(&recipient, &1);
        assert_eq!(second, i128::MAX - (i128::MAX / 2));

        assert_eq!(client.get_stream(&1).claimed_amount, i128::MAX);
        let token_client = token::Client::new(&env, &sac);
        assert_eq!(token_client.balance(&recipient), i128::MAX);

        // Nothing is left to claim and the stream is not over-paid.
        let third = client.try_claim_stream(&recipient, &1);
        assert!(third.is_err(), "a fully claimed stream must reject further claims");
    }

    // ── Batch Tests ────────────────────────────────────────

    #[test]
    fn test_create_batch() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        let creator = Address::generate(&env);
        let p1 = Address::generate(&env);
        let p2 = Address::generate(&env);
        let p3 = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);

        let _ = client.init(&owner);

        let payees = vec![&env, p1.clone(), p2.clone(), p3.clone()];
        let amounts = vec![&env, 100i128, 200i128, 300i128];

        let result = client.create_batch(
            &creator,
            &payees,
            &amounts,
            &sac,
            &String::from_str(&env, "batch_tx_hash"),
        );
        assert_eq!(result.batch_id, 1);
        assert_eq!(client.get_batch_count(), 1);
        assert_eq!(client.get_payment_count(), 3);
        assert_eq!(result.successful, 3);
        assert_eq!(result.failed, 0);

        let batch = client.get_batch(&1);
        assert_eq!(batch.total_amount, 600);
        assert_eq!(batch.total_recipients, 3);
        assert_eq!(batch.payment_ids.len(), 3);

        // Query batch payments (#742: bounded, newest-first, with a flag)
        let batch_payments = client.get_payments_by_batch(&1);
        assert_eq!(batch_payments.total, 3);
        assert!(!batch_payments.truncated);
        assert_eq!(batch_payments.items.len(), 3);
    }

    #[test]
    #[should_panic]
    fn test_empty_batch_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        let creator = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);

        let _ = client.init(&owner);

        let payees = Vec::<Address>::new(&env);
        let amounts = Vec::<i128>::new(&env);
        client.create_batch(
            &creator,
            &payees,
            &amounts,
            &sac,
            &String::from_str(&env, "empty"),
        );
    }

    // ── Pause Tests ────────────────────────────────────────

    #[test]
    fn test_pause_blocks_record_payment() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);

        let _ = client.init(&owner);
        assert!(!client.is_paused());

        client.emergency_pause_all(&owner);
        assert!(client.is_paused());

        // record_payment should fail when paused
        let result = client.try_record_payment(
            &payer,
            &payee,
            &100i128,
            &sac,
            &String::from_str(&env, "tx"),
            &String::from_str(&env, ""),
        );
        assert!(result.is_err());

        client.emergency_unpause_all(&owner);
        assert!(!client.is_paused());

        // Should work after unpause
        let id = client.record_payment(
            &payer,
            &payee,
            &100i128,
            &sac,
            &String::from_str(&env, "tx2"),
            &String::from_str(&env, ""),
        );
        assert_eq!(id, 1);
    }

    #[test]
    #[should_panic]
    fn test_pause_blocks_create_escrow() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let depositor = Address::generate(&env);
        let beneficiary = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);
        let sac_client = token::StellarAssetClient::new(&env, &sac);
        sac_client.mint(&depositor, &1000i128);

        let _ = client.init(&owner);
        client.emergency_pause_all(&owner);

        client.create_escrow(
            &depositor,
            &beneficiary,
            &None::<Address>,
            &100i128,
            &sac,
            &(env.ledger().timestamp() + 100),
            &String::from_str(&env, "paused"),
        );
    }

    #[test]
    #[should_panic]
    fn test_pause_blocks_create_stream() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let creator = Address::generate(&env);
        let recipient = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);
        let sac_client = token::StellarAssetClient::new(&env, &sac);
        sac_client.mint(&creator, &1000i128);

        let now = env.ledger().timestamp();
        let _ = client.init(&owner);
        client.emergency_pause_all(&owner);

        client.create_stream(
            &creator,
            &recipient,
            &500i128,
            &sac,
            &now,
            &(now + 1000),
            &String::from_str(&env, "paused"),
        );
    }

    // ── Re-cancellation test ───────────────────────────────

    #[test]
    #[should_panic]
    fn test_cancel_already_cancelled_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);

        let _ = client.init(&owner);
        let _ = client.record_payment(
            &payer,
            &payee,
            &100i128,
            &sac,
            &String::from_str(&env, "tx"),
            &String::from_str(&env, ""),
        );

        client.cancel_payment(&owner, &1);
        assert!(client.get_payment(&1).cancelled);

        // Second cancel should panic with PaymentAlreadyCancelled
        client.cancel_payment(&owner, &1);
    }

    // ── Multisig Tests ─────────────────────────────────────

    #[test]
    fn test_multisig_configure_and_propose() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let signer1 = Address::generate(&env);
        let signer2 = Address::generate(&env);
        let signer3 = Address::generate(&env);
        let payee = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);

        let _ = client.init(&owner);

        let signers = vec![&env, signer1.clone(), signer2.clone(), signer3.clone()];
        client.set_multisig_config(&owner, &2u32, &signers, &true);

        let config = client.get_multisig_config();
        assert!(config.is_some());
        let cfg = config.unwrap();
        assert_eq!(cfg.threshold, 2);
        assert!(cfg.enabled);

        let proposal_id = client.propose_payment(
            &signer1,
            &payee,
            &1000i128,
            &sac,
            &String::from_str(&env, "tx1"),
        );
        assert_eq!(proposal_id, 1);

        let req = client.get_approval_request(&1);
        assert!(req.is_some());
        assert!(!req.unwrap().executed);
    }

    #[test]
    fn test_multisig_approve_and_execute() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let signer1 = Address::generate(&env);
        let signer2 = Address::generate(&env);
        let signer3 = Address::generate(&env);
        let payee = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);

        let _ = client.init(&owner);

        let signers = vec![&env, signer1.clone(), signer2.clone(), signer3.clone()];
        client.set_multisig_config(&owner, &2u32, &signers, &true);

        let _ = client.propose_payment(
            &signer1,
            &payee,
            &1000i128,
            &sac,
            &String::from_str(&env, "tx1"),
        );

        let threshold_met = client.approve_payment(&signer2, &1);
        assert!(!threshold_met);

        let threshold_met = client.approve_payment(&signer3, &1);
        assert!(threshold_met);

        let pay_id = client.execute_approved_payment(&signer1, &1);
        assert_eq!(pay_id, 1);
        assert_eq!(client.get_payment_count(), 1);
    }

    // ── Spending Limit Tests ───────────────────────────────

    #[test]
    fn test_spending_limit_approved() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let user = Address::generate(&env);

        let _ = client.init(&owner);
        client.set_spending_limit(
            &owner,
            &user,
            &1000i128,
            &5000i128,
            &(env.ledger().timestamp() + 86400),
            &true,
        );

        let result = client.check_spending(&user, &500i128);
        assert!(matches!(result, SpendCheckResult::Approved));
    }

    #[test]
    fn test_spending_limit_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let user = Address::generate(&env);

        let _ = client.init(&owner);
        client.set_spending_limit(&owner, &user, &100i128, &1000i128, &0u64, &true);

        let result = client.check_spending(&user, &500i128);
        assert!(matches!(result, SpendCheckResult::Rejected));
    }

    #[test]
    fn test_escalation_rules() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let user = Address::generate(&env);

        let _ = client.init(&owner);
        client.configure_escalation(&owner, &100i128, &1000i128, &true);

        let result = client.check_spending(&user, &2000i128);
        assert!(matches!(result, SpendCheckResult::Escalated));
    }

    // ── RBAC Tests ──────────────────────────────────────────

    #[test]
    fn test_grant_and_revoke_role() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let operator = Address::generate(&env);

        let _ = client.init(&owner);
        client.grant_role(&owner, &operator, &Role::Operator);

        let role = client.get_role(&operator);
        assert!(role.is_some());

        client.revoke_role(&owner, &operator);
        let role = client.get_role(&operator);
        assert!(role.is_none());
    }

    // ── Audit Log Test ─────────────────────────────────────

    #[test]
    fn test_audit_log_after_payment() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);

        let _ = client.init(&owner);
        let _ = client.record_payment(
            &payer,
            &payee,
            &100i128,
            &sac,
            &String::from_str(&env, "tx"),
            &String::from_str(&env, "audit"),
        );

        let count = client.get_audit_log_count();
        assert!(count >= 1);

        let entry = client.get_audit_entry(&1);
        assert!(entry.id >= 1);
    }

    // ── Recurring Payment Tests ─────────────────────────────

    #[test]
    fn test_create_recurring_payment() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let creator = Address::generate(&env);
        let payee = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);

        let _ = client.init(&owner);

        let id = client.create_recurring(
            &creator,
            &payee,
            &100i128,
            &sac,
            &ScheduleType::Daily,
            &10u32,
            &String::from_str(&env, "subscription"),
        );
        assert_eq!(id, 1);
        assert_eq!(client.get_recurring_count(), 1);

        let rec = client.get_recurring(&1);
        assert!(rec.active);
    }

    #[test]
    fn test_execute_recurring_payment() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let creator = Address::generate(&env);
        let payee = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);

        let now = env.ledger().timestamp();
        let _ = client.init(&owner);

        let id = client.create_recurring(
            &creator,
            &payee,
            &100i128,
            &sac,
            &ScheduleType::Daily,
            &5u32,
            &String::from_str(&env, "sub"),
        );

        env.ledger().set_timestamp(now + 86400 + 1);
        let pay_id = client.execute_recurring(&creator, &id);
        assert_eq!(pay_id, 1);
        assert_eq!(client.get_payment_count(), 1);
    }

    #[test]
    fn test_cancel_recurring_payment() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let creator = Address::generate(&env);
        let payee = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);

        let _ = client.init(&owner);
        let id = client.create_recurring(
            &creator,
            &payee,
            &100i128,
            &sac,
            &ScheduleType::Daily,
            &10u32,
            &String::from_str(&env, "sub"),
        );

        client.cancel_recurring(&creator, &id);
        let rec = client.get_recurring(&id);
        assert!(!rec.active);
    }

    // ── Fee Config Tests ───────────────────────────────────

    #[test]
    fn test_set_and_get_fee_config() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);

        let _ = client.init(&owner);
        client.set_fee_config(&owner, &50u32, &100u32, &200u32, &10i128, &1i128, &true);

        let config = client.get_fee_config();
        assert!(config.is_some());
        let cfg = config.unwrap();
        assert_eq!(cfg.payment_fee_bps, 50);
        assert!(cfg.enabled);
    }

    #[test]
    fn test_calculate_fee() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);

        let fee = client.calculate_fee(&1000i128, &100u32);
        assert_eq!(fee, 10);

        let fee = client.calculate_fee(&0i128, &100u32);
        assert_eq!(fee, 0);
    }

    // ── Timelocked Action Tests ────────────────────────────

    #[test]
    fn test_timelocked_action_propose_and_execute() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);

        let now = env.ledger().timestamp();
        let _ = client.init(&owner);

        let id = client.propose_timelocked_action(
            &owner,
            &String::from_str(&env, "set_fee_config"),
            &String::from_str(&env, "set_fee_config"),
            &String::from_str(&env, "params"),
        );
        assert_eq!(id, 1);
        assert_eq!(client.get_timelock_count(), 1);

        let action = client.get_timelocked_action(&1);
        assert!(!action.executed);

        env.ledger().set_timestamp(now + TMLOCK_DELAY + 1);
        client.execute_timelocked_action(&1);

        let action = client.get_timelocked_action(&1);
        assert!(action.executed);
    }

    #[test]
    fn test_timelocked_action_cancel() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);

        let _ = client.init(&owner);
        let id = client.propose_timelocked_action(
            &owner,
            &String::from_str(&env, "pause"),
            &String::from_str(&env, "pause"),
            &String::from_str(&env, ""),
        );

        client.cancel_timelocked_action(&owner, &id);
        let action = client.get_timelocked_action(&id);
        assert!(action.executed);
    }

    // ── Governance Tests ───────────────────────────────────

    #[test]
    fn test_governance_proposal_vote_execute() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let proposer = Address::generate(&env);
        let voter = Address::generate(&env);

        let now = env.ledger().timestamp();
        let _ = client.init(&owner);

        client.configure_governance(&owner, &0i128, &1000u64, &51u32, &true);

        // min_proposal_deposit = 0, so any deposit_asset/amount works
        let deposit_asset = Address::generate(&env);
        let pid = client.create_proposal(
            &proposer,
            &String::from_str(&env, "Test Proposal"),
            &String::from_str(&env, "A test description"),
            &String::from_str(&env, "upgrade"),
            &String::from_str(&env, "execute_upgrade"),
            &String::from_str(&env, "hash"),
            &deposit_asset,
            &0i128,
        );
        assert_eq!(pid, 1);
        assert_eq!(client.get_proposal_count(), 1);

        // Each voter contributes exactly 1 vote (no self-reported weight)
        client.vote_on_proposal(&voter, &1, &true);

        let prop = client.get_proposal(&1);
        assert_eq!(prop.yes_votes, 1);
        assert_eq!(prop.no_votes, 0);

        env.ledger().set_timestamp(now + 2000);
        let passed = client.execute_proposal(&1);
        assert!(passed);
    }
    // ── Refund Tests ───────────────────────────────────────

    #[test]
    fn test_request_refund() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);

        let _ = client.init(&owner);
        let asset = Address::generate(&env);
        let pid = client.record_payment(
            &payer,
            &payee,
            &1000i128,
            &asset,
            &String::from_str(&env, "tx_refund_test"),
            &String::from_str(&env, "test"),
        );

        let rid = client.request_refund(
            &payer,
            &pid,
            &1000i128,
            &asset,
            &String::from_str(&env, "Defective product"),
            &RefundReasonCode::ProductDefect,
        );
        assert_eq!(rid, 1);
        assert_eq!(client.get_refund_count(), 1);

        let refund = client.get_refund(&1);
        assert_eq!(refund.reason_code, RefundReasonCode::ProductDefect);
    }

    #[test]
    fn test_approve_and_process_refund() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);
        let sac_client = token::StellarAssetClient::new(&env, &sac);
        sac_client.mint(&owner, &10_000i128);

        let _ = client.init(&owner);
        let pid = client.record_payment(
            &payer,
            &payee,
            &500i128,
            &sac,
            &String::from_str(&env, "tx_approve"),
            &String::from_str(&env, "test"),
        );

        let rid = client.request_refund(
            &payer,
            &pid,
            &500i128,
            &sac,
            &String::from_str(&env, "Never received"),
            &RefundReasonCode::NonDelivery,
        );

        // Approve as owner
        client.approve_refund(&owner, &rid);

        let refund = client.get_refund(&rid);
        assert!(matches!(refund.status, RefundStatus::Approved));

        // Transfer tokens to contract so process_refund can send them back
        let contract_addr = contract_id.clone();
        sac_client.transfer(&owner, &contract_addr, &500i128);

        // Process refund (owner-authorized)
        client.process_refund(&owner, &rid);

        let refund = client.get_refund(&rid);
        assert!(matches!(refund.status, RefundStatus::Processed));
    }

    #[test]
    fn test_refund_rejects_unauthorized_requester() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let stranger = Address::generate(&env);
        let asset = Address::generate(&env);

        let _ = client.init(&owner);
        let pid = client.record_payment(
            &payer,
            &payee,
            &1000i128,
            &asset,
            &String::from_str(&env, "tx_unauth_refund"),
            &String::from_str(&env, "test"),
        );

        // A stranger (neither payer nor payee) must not be able to request a refund
        let result = client.try_request_refund(
            &stranger,
            &pid,
            &1000i128,
            &asset,
            &String::from_str(&env, "hi"),
            &RefundReasonCode::CustomerRequest,
        );
        assert!(result.is_err());

        // Over-refund (amount > payment.amount) must be rejected
        let result = client.try_request_refund(
            &payer,
            &pid,
            &1001i128,
            &asset,
            &String::from_str(&env, "hi"),
            &RefundReasonCode::CustomerRequest,
        );
        assert!(result.is_err());

        // Asset mismatch must be rejected
        let result = client.try_request_refund(
            &payer,
            &pid,
            &1000i128,
            &Address::generate(&env),
            &String::from_str(&env, "hi"),
            &RefundReasonCode::CustomerRequest,
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_refund_not_found() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);

        let _ = client.init(&owner);
        let result = client.try_get_refund(&999);
        assert!(result.is_err());
    }

    #[test]
    fn test_reason_code_analytics() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);

        let _ = client.init(&owner);
        let asset = Address::generate(&env);
        let pid = client.record_payment(
            &payer,
            &payee,
            &100i128,
            &asset,
            &String::from_str(&env, "tx_analytics"),
            &String::from_str(&env, "test"),
        );

        client.request_refund(
            &payer,
            &pid,
            &100i128,
            &asset,
            &String::from_str(&env, "r1"),
            &RefundReasonCode::DuplicateCharge,
        );

        let analytics = client.get_reason_code_analytics();
        // 6 buckets (ProductDefect..Other), one should have 1
        let mut found = false;
        for (_code, count) in analytics.iter() {
            if count >= 1 {
                found = true;
            }
        }
        assert!(found);
    }

    // ── Orchestration Tests ────────────────────────────────

    #[test]
    fn test_emergency_pause_all() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);

        let _ = client.init(&owner);

        // Pause all (even without emitter linked, pauses OphirPay)
        client.emergency_pause_all(&owner);
        assert!(client.is_paused());

        // Unpause all
        client.emergency_unpause_all(&owner);
        assert!(!client.is_paused());
    }

    #[test]
    fn test_set_and_get_emitter() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let emitter = Address::generate(&env);

        let _ = client.init(&owner);
        client.set_emitter(&owner, &emitter);

        let stored = client.get_emitter();
        assert_eq!(stored.unwrap(), emitter);
    }

    // ── Notification Hook Tests ────────────────────────────

    #[test]
    fn test_register_and_unregister_hook() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let subscriber = Address::generate(&env);

        let _ = client.init(&owner);

        let hid = client.register_hook(
            &subscriber,
            &String::from_str(&env, "payment_recorded"),
            &String::from_str(&env, "https://example.com/webhook"),
        );
        assert_eq!(hid, 1);
        assert_eq!(client.get_hook_count(), 1);

        // Get hooks by event type
        let hooks = client.get_hooks_by_event(&String::from_str(&env, "payment_recorded"));
        assert_eq!(hooks.len(), 1);

        // Get subscriber hooks (#742: bounded, newest-first, with a flag)
        let sub_hooks = client.get_subscriber_hooks(&subscriber);
        assert_eq!(sub_hooks.total, 1);
        assert!(!sub_hooks.truncated);
        assert_eq!(sub_hooks.items.len(), 1);
        assert!(sub_hooks.items.get(0).unwrap().active);

        // Unregister
        client.unregister_hook(&subscriber, &1);

        let sub_hooks = client.get_subscriber_hooks(&subscriber);
        assert!(!sub_hooks.items.get(0).unwrap().active);
    }

    #[test]
    fn test_get_hooks_by_event_empty() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);

        let _ = client.init(&owner);
        let hooks = client.get_hooks_by_event(&String::from_str(&env, "nonexistent"));
        assert_eq!(hooks.len(), 0);
    }

    // ── Policy Versioning Tests ────────────────────────────

    #[test]
    fn test_fee_config_versioning() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);

        let _ = client.init(&owner);

        // Set config twice
        client.set_fee_config(&owner, &100u32, &200u32, &300u32, &10i128, &1i128, &true);
        client.set_fee_config(&owner, &150u32, &250u32, &350u32, &20i128, &2i128, &true);

        // Check current config reflects latest
        let current = client.get_fee_config().unwrap();
        assert_eq!(current.payment_fee_bps, 150);

        // Check version history
        let history = client.get_fee_config_history();
        assert_eq!(history.len(), 2);

        // Check specific version
        let v1 = client.get_fee_config_at_version(&1);
        assert_eq!(v1.unwrap().config.payment_fee_bps, 100);
    }

    #[test]
    fn test_multisig_config_versioning() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let s1 = Address::generate(&env);
        let s2 = Address::generate(&env);
        let s3 = Address::generate(&env);

        let _ = client.init(&owner);

        let signers_v1 = vec![&env, s1.clone(), s2.clone()];
        client.set_multisig_config(&owner, &2u32, &signers_v1, &true);

        let signers_v2 = vec![&env, s1.clone(), s2.clone(), s3.clone()];
        client.set_multisig_config(&owner, &3u32, &signers_v2, &true);

        let history = client.get_multisig_config_history();
        assert_eq!(history.len(), 2);
    }

    // ── Two-Step Ownership Tests ───────────────────────────

    #[test]
    fn test_two_step_ownership_transfer() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let new_owner = Address::generate(&env);

        let now = env.ledger().timestamp();
        let _ = client.init(&owner);

        // Propose transfer
        client.transfer_ownership(&owner, &new_owner);

        // Check pending owner
        let pending = client.get_pending_owner();
        assert!(pending.is_some());

        // Cannot accept before timelock
        // (skip — this panics, test separately)

        // Advance past 24h
        env.ledger().set_timestamp(now + 86401);

        // Accept
        client.accept_ownership(&new_owner);

        // Verify
        assert_eq!(client.get_owner(), new_owner);
        assert!(client.get_pending_owner().is_none());
    }

    #[test]
    #[should_panic]
    fn test_accept_ownership_before_timelock_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let new_owner = Address::generate(&env);

        let _ = client.init(&owner);
        client.transfer_ownership(&owner, &new_owner);
        // Should panic — timelock hasn't elapsed
        client.accept_ownership(&new_owner);
    }

    #[test]
    fn test_cancel_ownership_transfer() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let new_owner = Address::generate(&env);

        let _ = client.init(&owner);
        client.transfer_ownership(&owner, &new_owner);
        assert!(client.get_pending_owner().is_some());

        client.cancel_ownership_transfer(&owner);
        assert!(client.get_pending_owner().is_none());
    }

    // ── Invariant Tests (SPEC.md) ───────────────────────────

    /// INV-3: emergency_withdraw cannot drain locked escrow funds
    #[test]
    fn test_emergency_withdraw_locked_funds_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        let depositor = Address::generate(&env);
        let beneficiary = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);
        let sac_client = token::StellarAssetClient::new(&env, &sac);
        // Fund depositor
        sac_client.mint(&depositor, &10_000i128);
        // Also fund the contract directly (simulates accidentally-sent tokens)
        sac_client.mint(&contract_id, &5_000i128);

        let _ = client.init(&owner);

        // Create an escrow — this locks 1000 tokens
        client.create_escrow(
            &depositor,
            &beneficiary,
            &Option::<Address>::None,
            &1000i128,
            &sac,
            &(env.ledger().timestamp() + 86400),
            &String::from_str(&env, "locked"),
        );

        // The contract has 6000 tokens (5000 direct + 1000 escrowed).
        // Locked = 1000. Unlocked = 5000.
        // Owner tries to withdraw 5500 — should fail (only 5000 unlocked)
        let result = client.try_emergency_withdraw(&owner, &sac, &5_500i128);
        assert!(result.is_err());

        // Owner withdraws 5000 — should succeed (all unlocked)
        let result2 = client.try_emergency_withdraw(&owner, &sac, &5_000i128);
        assert!(result2.is_ok());
    }

    /// INV-4: Escrow cannot be released twice
    #[test]
    fn test_double_release_escrow_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        let depositor = Address::generate(&env);
        let beneficiary = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);
        let sac_client = token::StellarAssetClient::new(&env, &sac);
        sac_client.mint(&depositor, &10_000i128);

        let _ = client.init(&owner);

        client.create_escrow(
            &depositor,
            &beneficiary,
            &Option::<Address>::None,
            &1000i128,
            &sac,
            &(env.ledger().timestamp() + 86400),
            &String::from_str(&env, "test"),
        );

        client.release_escrow(&owner, &1);
        let escrow = client.get_escrow(&1);
        assert!(escrow.released);

        // Second release should fail
        let result = client.try_release_escrow(&owner, &1);
        assert!(result.is_err());
    }

    /// INV-4: Escrow cannot be claimed twice after deadline
    #[test]
    fn test_double_claim_escrow_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        let depositor = Address::generate(&env);
        let beneficiary = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);
        let sac_client = token::StellarAssetClient::new(&env, &sac);
        sac_client.mint(&depositor, &10_000i128);

        let _ = client.init(&owner);

        let deadline = env.ledger().timestamp() + 100;
        client.create_escrow(
            &depositor,
            &beneficiary,
            &Option::<Address>::None,
            &1000i128,
            &sac,
            &deadline,
            &String::from_str(&env, "test"),
        );

        // Advance past deadline
        env.ledger().set_timestamp(deadline + 1);

        // First claim succeeds
        client.claim_escrow(&beneficiary, &1);
        let escrow = client.get_escrow(&1);
        assert!(escrow.claimed);

        // Second claim should fail
        let result = client.try_claim_escrow(&beneficiary, &1);
        assert!(result.is_err());
    }

    /// INV-10: Fee config version history is capped at 100 entries
    #[test]
    fn test_fee_version_history_capped() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        let _ = client.init(&owner);

        // Create 150 fee config changes
        for i in 0u32..150u32 {
            client.set_fee_config(&owner, &(100 + i), &200, &300, &1000i128, &100i128, &true);
        }

        let history = client.get_fee_config_history();
        // Should return at most 100 entries
        assert!(history.len() <= 100);
        // The most recent should have version 150
        assert!(history.len() > 0);
        let latest = history.get(0).unwrap();
        assert_eq!(latest.version, 150);

        // Single-version lookup should still work for older versions
        let old_version = client.get_fee_config_at_version(&10);
        assert!(old_version.is_some());
        assert_eq!(old_version.unwrap().version, 10);
    }

    // ── Refund Tests ────────────────────────────────────────

    #[test]
    fn test_refund_lifecycle() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1000);
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);
        // Fund the contract so process_refund can transfer tokens back
        let sac_client = token::StellarAssetClient::new(&env, &sac);
        sac_client.mint(&contract_id, &10_000i128);

        let _ = client.init(&owner);

        // Record a payment first
        client.record_payment(
            &payer,
            &payee,
            &1000i128,
            &sac,
            &String::from_str(&env, "tx_hash"),
            &String::from_str(&env, "refundable payment"),
        );

        // Request refund
        let refund_id = client.request_refund(
            &payer,
            &1u64,
            &1000i128,
            &sac,
            &String::from_str(&env, "defective item"),
            &RefundReasonCode::ProductDefect,
        );
        assert_eq!(refund_id, 1);
        assert_eq!(client.get_refund_count(), 1);

        let refund = client.get_refund(&1);
        assert_eq!(refund.payment_id, 1);
        assert_eq!(refund.amount, 1000);
        assert_eq!(refund.status, RefundStatus::Requested);
        assert_eq!(refund.reason_code, RefundReasonCode::ProductDefect);

        // Owner approves
        client.approve_refund(&owner, &1);
        let refund2 = client.get_refund(&1);
        assert_eq!(refund2.status, RefundStatus::Approved);

        // Process refund (owner-authorized)
        client.process_refund(&owner, &1);
        let refund3 = client.get_refund(&1);
        assert_eq!(refund3.status, RefundStatus::Processed);
        assert!(refund3.resolved_at > 0);
    }

    #[test]
    fn test_refund_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);

        let _ = client.init(&owner);

        client.record_payment(
            &payer,
            &payee,
            &500i128,
            &sac,
            &String::from_str(&env, "tx"),
            &String::from_str(&env, "test"),
        );

        client.request_refund(
            &payer,
            &1u64,
            &500i128,
            &sac,
            &String::from_str(&env, "changed mind"),
            &RefundReasonCode::CustomerRequest,
        );

        client.reject_refund(&owner, &1);
        let refund = client.get_refund(&1);
        assert_eq!(refund.status, RefundStatus::Rejected);
    }

    // ── Multisig Tests ────────────────────────────────────────

    #[test]
    fn test_multisig_threshold_enforcement() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        let signer1 = Address::generate(&env);
        let signer2 = Address::generate(&env);
        let signer3 = Address::generate(&env);
        let payee = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);

        let _ = client.init(&owner);

        // Configure 2-of-3 multisig
        let signers = vec![&env, signer1.clone(), signer2.clone(), signer3.clone()];
        client.set_multisig_config(&owner, &2u32, &signers, &true);

        let config = client.get_multisig_config();
        assert!(config.is_some());
        let cfg = config.unwrap();
        assert_eq!(cfg.threshold, 2);
        assert!(cfg.enabled);

        // Propose payment
        let proposal_id = client.propose_payment(
            &signer1,
            &payee,
            &1000i128,
            &sac,
            &String::from_str(&env, "tx_proposal_1"),
        );
        assert_eq!(proposal_id, 1);

        // One approval — not enough yet
        let met = client.approve_payment(&signer1, &1);
        assert!(!met);

        // Second approval — threshold met
        let met2 = client.approve_payment(&signer2, &1);
        assert!(met2);

        // Execute
        let pay_id = client.execute_approved_payment(&signer1, &1);
        assert_eq!(pay_id, 1);
        assert_eq!(client.get_payment_count(), 1);
    }

    #[test]
    fn test_multisig_duplicate_approval_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        let signer1 = Address::generate(&env);
        let signer2 = Address::generate(&env);
        let payee = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);

        let _ = client.init(&owner);

        let signers = vec![&env, signer1.clone(), signer2.clone()];
        client.set_multisig_config(&owner, &2u32, &signers, &true);

        client.propose_payment(
            &signer1,
            &payee,
            &500i128,
            &sac,
            &String::from_str(&env, "tx"),
        );

        // First approval
        client.approve_payment(&signer1, &1);

        // Duplicate approval should fail
        let result = client.try_approve_payment(&signer1, &1);
        assert!(result.is_err());
    }

    // ── Spending Limit Tests ──────────────────────────────────

    #[test]
    fn test_spending_limit_expiry_rejects_spend() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);

        let now = env.ledger().timestamp();
        let _ = client.init(&owner);

        // Set spending limit that expires in 100 seconds
        client.set_spending_limit(&owner, &payer, &10000i128, &50000i128, &(now + 100), &true);

        let limit = client.get_spending_limit(&payer);
        assert!(limit.is_some());
        assert!(limit.unwrap().is_active);

        // Spend within expiry — should succeed
        let id = client.atomic_spend(
            &payer,
            &payee,
            &500i128,
            &sac,
            &String::from_str(&env, "tx1"),
            &String::from_str(&env, "valid"),
        );
        assert_eq!(id, 1);

        // Advance past expiry
        env.ledger().set_timestamp(now + 200);

        // Spend after expiry — should fail
        let result = client.try_atomic_spend(
            &payer,
            &payee,
            &500i128,
            &sac,
            &String::from_str(&env, "tx2"),
            &String::from_str(&env, "expired"),
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_atomic_spend_updates_spend_counters() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);

        let _ = client.init(&owner);

        client.set_spending_limit(&owner, &payer, &5000i128, &10000i128, &0, &true);

        // Spend 2000
        client.atomic_spend(
            &payer,
            &payee,
            &2000i128,
            &sac,
            &String::from_str(&env, "tx_a"),
            &String::from_str(&env, "spend 1"),
        );

        let limit = client.get_spending_limit(&payer);
        assert_eq!(limit.unwrap().current_daily_spend, 2000);

        // Spend another 3000 = total 5000 (at limit)
        client.atomic_spend(
            &payer,
            &payee,
            &3000i128,
            &sac,
            &String::from_str(&env, "tx_b"),
            &String::from_str(&env, "spend 2"),
        );

        // Next spend exceeds daily limit — should fail
        let result = client.try_atomic_spend(
            &payer,
            &payee,
            &1i128,
            &sac,
            &String::from_str(&env, "tx_c"),
            &String::from_str(&env, "over limit"),
        );
        assert!(result.is_err());
    }

    // ── New Error Path Tests (governance + reentrancy) ──

    /// GOV-1: Double-voting is rejected with AlreadyVoted error
    #[test]
    fn test_double_vote_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let proposer = Address::generate(&env);
        let voter = Address::generate(&env);

        let _ = client.init(&owner);
        client.configure_governance(&owner, &0i128, &1000u64, &51u32, &true);

        let deposit_asset = Address::generate(&env);
        let _ = client.create_proposal(
            &proposer,
            &String::from_str(&env, "P"),
            &String::from_str(&env, "D"),
            &String::from_str(&env, "upgrade"),
            &String::from_str(&env, "t"),
            &String::from_str(&env, "d"),
            &deposit_asset,
            &0i128,
        );

        // First vote succeeds
        client.vote_on_proposal(&voter, &1, &true);

        // Second vote from same voter should fail with AlreadyVoted
        let result = client.try_vote_on_proposal(&voter, &1, &false);
        assert!(result.is_err());
    }

    /// GOV-2: Proposal creation fails when deposit is below minimum
    #[test]
    fn test_deposit_too_low_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let proposer = Address::generate(&env);

        let _ = client.init(&owner);
        // Set min_proposal_deposit to 100
        client.configure_governance(&owner, &100i128, &1000u64, &51u32, &true);

        let deposit_asset = Address::generate(&env);
        // Try with deposit_amount = 50 (below 100 minimum)
        let result = client.try_create_proposal(
            &proposer,
            &String::from_str(&env, "P"),
            &String::from_str(&env, "D"),
            &String::from_str(&env, "upgrade"),
            &String::from_str(&env, "t"),
            &String::from_str(&env, "d"),
            &deposit_asset,
            &50i128,
        );
        assert!(result.is_err());
    }

    /// REENT-1: Reentrancy lock rejects nested token operations
    #[test]
    fn test_reentrancy_lock_rejects_nested_calls() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let user = Address::generate(&env);
        let payee = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);

        let _ = client.init(&owner);

        assert_eq!(client.is_reentrancy_locked(), false);
        assert_eq!(client.get_locked_balance(), 0);

        // Simulate active reentrancy lock
        env.as_contract(&contract_id, || {
            env.storage().instance().set(&REENTRANCY_LOCK, &true);
        });

        assert_eq!(client.is_reentrancy_locked(), true);

        // Every token-moving operation must return ReentrantCall
        let memo = String::from_str(&env, "memo");
        assert_eq!(
            client.try_create_escrow(
                &user,
                &payee,
                &None::<Address>,
                &1000i128,
                &sac,
                &100_000u64,
                &memo
            ),
            Err(Ok(PaymentError::ReentrantCall))
        );

        assert_eq!(
            client.try_release_escrow(&owner, &1u64),
            Err(Ok(PaymentError::ReentrantCall))
        );

        assert_eq!(
            client.try_release_by_arbiter(&owner, &1u64, &true),
            Err(Ok(PaymentError::ReentrantCall))
        );

        assert_eq!(
            client.try_claim_escrow(&payee, &1u64),
            Err(Ok(PaymentError::ReentrantCall))
        );

        assert_eq!(
            client.try_create_stream(&user, &payee, &1000i128, &sac, &1000u64, &2000u64, &memo),
            Err(Ok(PaymentError::ReentrantCall))
        );

        assert_eq!(
            client.try_claim_stream(&payee, &1u64),
            Err(Ok(PaymentError::ReentrantCall))
        );

        assert_eq!(
            client.try_cancel_stream(&user, &1u64),
            Err(Ok(PaymentError::ReentrantCall))
        );

        assert_eq!(
            client.try_process_refund(&owner, &1u64),
            Err(Ok(PaymentError::ReentrantCall))
        );

        assert_eq!(
            client.try_emergency_withdraw(&owner, &sac, &1000i128),
            Err(Ok(PaymentError::ReentrantCall))
        );
    }

    /// LOCK-1: Multi-operation escrow and stream lifecycle strictly conserves LOCKED_BALANCE
    #[test]
    fn test_locked_balance_conservation_lifecycle() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1_000_000);
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let user = Address::generate(&env);
        let payee1 = Address::generate(&env);
        let payee2 = Address::generate(&env);

        let sac = create_token_contract(&env, &owner);
        let sac_client = token::StellarAssetClient::new(&env, &sac);
        sac_client.mint(&user, &10_000_000i128);

        let _ = client.init(&owner);
        assert_eq!(client.get_locked_balance(), 0);

        // 1. Create Escrow 1 (1_000_000)
        let memo = String::from_str(&env, "e1");
        let e1 = client.create_escrow(
            &user,
            &payee1,
            &None::<Address>,
            &1_000_000i128,
            &sac,
            &1_050_000u64,
            &memo,
        );
        assert_eq!(e1, 1);
        assert_eq!(client.get_locked_balance(), 1_000_000);

        // 2. Create Escrow 2 (2_000_000)
        let e2 = client.create_escrow(
            &user,
            &payee2,
            &None::<Address>,
            &2_000_000i128,
            &sac,
            &1_050_000u64,
            &memo,
        );
        assert_eq!(e2, 2);
        assert_eq!(client.get_locked_balance(), 3_000_000);

        // 3. Create Stream (3_000_000 over 1000s)
        let s1 = client.create_stream(
            &user,
            &payee1,
            &3_000_000i128,
            &sac,
            &1_000_000u64,
            &1_001_000u64,
            &memo,
        );
        assert_eq!(s1, 1);
        assert_eq!(client.get_locked_balance(), 6_000_000);

        // 4. Release Escrow 1
        client.release_escrow(&owner, &e1);
        assert_eq!(client.get_locked_balance(), 5_000_000);

        // 5. Partial Stream Claim at 50% (500s elapsed -> 1_500_000 claimed)
        env.ledger().set_timestamp(1_000_500);
        let claimed = client.claim_stream(&payee1, &s1);
        assert_eq!(claimed, 1_500_000);
        assert_eq!(client.get_locked_balance(), 3_500_000);

        // 6. Cancel remaining Stream (1_500_000 unvested refunded to creator)
        let refunded = client.cancel_stream(&user, &s1);
        assert_eq!(refunded, 1_500_000);
        assert_eq!(client.get_locked_balance(), 2_000_000);

        // 7. Claim Escrow 2 after deadline
        env.ledger().set_timestamp(1_060_000);
        client.claim_escrow(&payee2, &e2);
        assert_eq!(client.get_locked_balance(), 0);
    }

    // ── Storage-Bump Policy Tests ────────────────────────────────

    #[test]
    fn test_get_bump_policy_returns_constants() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let _ = client.init(&owner);

        let (min, max, maintenance) = client.get_bump_policy();
        assert_eq!(min, 5_000);
        assert_eq!(max, 50_000);
        assert_eq!(maintenance, 100_000);
    }

    #[test]
    fn test_bump_storage_noop_on_empty_ranges() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let _ = client.init(&owner);

        let zero = (0u64, 0u64);
        let bumped = client.bump_storage(
            &zero, &zero, &zero, &zero, &zero, &zero, &zero, &zero, &zero,
        );
        // No entries exist yet, so nothing should be bumped.
        assert_eq!(bumped, 0);
    }

    #[test]
    fn test_bump_storage_extends_existing_entries() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1_000_000);
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);

        let _ = client.init(&owner);

        // Record a payment so there's a persistent entry to bump.
        client.record_payment(
            &payer,
            &payee,
            &1000i128,
            &sac,
            &String::from_str(&env, "tx1"),
            &String::from_str(&env, "meta1"),
        );

        // Bump the payment range.
        let bumped = client.bump_storage(
            &(1u64, 1u64),
            &(0u64, 0u64),
            &(0u64, 0u64),
            &(0u64, 0u64),
            &(0u64, 0u64),
            &(0u64, 0u64),
            &(0u64, 0u64),
            &(0u64, 0u64),
            &(0u64, 0u64),
        );
        assert_eq!(bumped, 1);

        // Verify the payment still exists and is readable.
        let p = client.get_payment(&1);
        assert_eq!(p.id, 1);
        assert_eq!(p.amount, 1000);
    }

    #[test]
    fn test_bump_storage_gas_cost_accounting() {
        // Verify that bump_storage is callable and returns without panic.
        // The actual gas cost is bounded by the number of entries scanned;
        // an empty range should cost ~5 000 instructions (instance bump only).
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let _ = client.init(&owner);

        let zero = (0u64, 0u64);
        // Empty ranges — minimal gas.
        let bumped = client.bump_storage(
            &zero, &zero, &zero, &zero, &zero, &zero, &zero, &zero, &zero,
        );
        assert_eq!(bumped, 0);

        // A single-entry bump should also succeed without excessive gas.
        // (If gas exceeds budget the test will panic / OOG.)
        let bumped2 = client.bump_storage(
            &(1u64, 1u64),
            &(1u64, 1u64),
            &(1u64, 1u64),
            &(1u64, 1u64),
            &(1u64, 1u64),
            &(1u64, 1u64),
            &(1u64, 1u64),
            &(1u64, 1u64),
            &(1u64, 1u64),
        );
        // No entries exist, so 0 bumped — but the call succeeded.
        assert_eq!(bumped2, 0);
    }

    #[test]
    fn test_bump_storage_multi_type_entries() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1_000_000);
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);

        let _ = client.init(&owner);

        // Create 2 payments and 1 batch (2 payments in batch).
        client.record_payment(
            &payer,
            &payee,
            &500i128,
            &sac,
            &String::from_str(&env, "tx_a"),
            &String::from_str(&env, "m_a"),
        );
        client.record_payment(
            &payer,
            &payee,
            &300i128,
            &sac,
            &String::from_str(&env, "tx_b"),
            &String::from_str(&env, "m_b"),
        );

        let mut payees = Vec::new(&env);
        payees.push_back(payee.clone());
        let mut amounts = Vec::new(&env);
        amounts.push_back(200i128);
        client.create_batch(
            &payer,
            &payees,
            &amounts,
            &sac,
            &String::from_str(&env, "batch_tx"),
        );

        // Now bump payments 1–2 and batch 1.
        let bumped = client.bump_storage(
            &(1u64, 2u64),  // payments
            &(0u64, 0u64),  // escrows
            &(0u64, 0u64),  // streams
            &(1u64, 1u64),  // batches
            &(0u64, 0u64),  // audit
            &(0u64, 0u64),  // timelocks
            &(0u64, 0u64),  // proposals
            &(0u64, 0u64),  // approvals
            &(0u64, 0u64),  // hooks
        );
        // 2 payments + 1 batch = 3 bumped
        assert_eq!(bumped, 3);

        // Verify data integrity after bump.
        let p1 = client.get_payment(&1);
        assert_eq!(p1.amount, 500);
        let p2 = client.get_payment(&2);
        assert_eq!(p2.amount, 300);
        let b1 = client.get_batch(&1);
        assert_eq!(b1.total_amount, 200);
    }

    // ── Bounded readers (issue #742) ────────────────────────

    /// A subscriber can register an unbounded number of hooks, so the reader
    /// must cap the result and say so rather than walking the whole index.
    #[test]
    fn test_get_subscriber_hooks_caps_and_flags_truncation() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let subscriber = Address::generate(&env);
        let _ = client.init(&owner);

        let overflow_count = MAX_READER_ENTRIES + 5;
        for i in 0..overflow_count {
            let hid = client.register_hook(
                &subscriber,
                &String::from_str(&env, "payment_recorded"),
                &String::from_str(&env, "https://example.com/webhook"),
            );
            assert_eq!(hid, (i + 1) as u64);
        }

        let result = client.get_subscriber_hooks(&subscriber);

        // Cap enforced, truncation reported, and the total stays accurate so a
        // caller can page rather than guess.
        assert_eq!(result.items.len(), MAX_READER_ENTRIES);
        assert_eq!(result.total, overflow_count);
        assert!(result.truncated);

        // Most recent first: the last hook registered leads the list.
        assert_eq!(result.items.get(0).unwrap().id, overflow_count as u64);
        assert_eq!(
            result
                .items
                .get(MAX_READER_ENTRIES - 1)
                .unwrap()
                .id,
            (overflow_count - MAX_READER_ENTRIES + 1) as u64,
        );
    }

    /// Exactly at the cap is a complete list, not a truncated one.
    #[test]
    fn test_get_subscriber_hooks_at_cap_is_not_truncated() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let subscriber = Address::generate(&env);
        let _ = client.init(&owner);

        for _ in 0..MAX_READER_ENTRIES {
            client.register_hook(
                &subscriber,
                &String::from_str(&env, "refund_processed"),
                &String::from_str(&env, "https://example.com/webhook"),
            );
        }

        let result = client.get_subscriber_hooks(&subscriber);
        assert_eq!(result.items.len(), MAX_READER_ENTRIES);
        assert_eq!(result.total, MAX_READER_ENTRIES);
        assert!(!result.truncated);
    }

    /// `create_batch` caps a batch at 100 recipients, but a batch written
    /// before that guard existed can hold more ids than the writer accepts
    /// today — the reader must still bound itself. The oversized record is
    /// injected directly into storage to model exactly that legacy shape.
    #[test]
    fn test_get_payments_by_batch_caps_and_flags_truncation() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1_000_000);
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);
        let _ = client.init(&owner);

        let overflow_count: u64 = (MAX_READER_ENTRIES + 5) as u64;
        for _ in 0..overflow_count {
            client.record_payment(
                &payer,
                &payee,
                &100i128,
                &sac,
                &String::from_str(&env, "tx_legacy"),
                &String::from_str(&env, "legacy batch entry"),
            );
        }

        let mut payment_ids = Vec::new(&env);
        for id in 1..=overflow_count {
            payment_ids.push_back(id);
        }
        let legacy_batch = BatchPayment {
            id: 1,
            creator: owner.clone(),
            total_recipients: overflow_count as u32,
            total_amount: (overflow_count as i128) * 100,
            asset: sac.clone(),
            timestamp: env.ledger().timestamp(),
            tx_hash: String::from_str(&env, "legacy_batch_tx"),
            payment_ids,
        };
        env.as_contract(&contract_id, || {
            env.storage()
                .persistent()
                .set(&(BATCH_KEY, 1u64), &legacy_batch);
        });

        let result = client.get_payments_by_batch(&1);
        assert_eq!(result.items.len(), MAX_READER_ENTRIES);
        assert_eq!(result.total, overflow_count as u32);
        assert!(result.truncated);
        // Newest first: the last payment recorded leads the list.
        assert_eq!(result.items.get(0).unwrap().id, overflow_count);
        assert_eq!(
            result.items.get(MAX_READER_ENTRIES - 1).unwrap().id,
            overflow_count - (MAX_READER_ENTRIES as u64) + 1,
        );
    }

    /// A batch the writer accepted today (≤ 100 recipients) is complete and
    /// must not claim truncation — and an unknown batch must not either.
    #[test]
    fn test_get_payments_by_batch_within_cap_is_not_truncated() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1_000_000);
        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let sac = create_token_contract(&env, &owner);
        let _ = client.init(&owner);

        // The batch record is written straight to storage rather than through
        // `create_batch`: the writer emits one event per recipient and a
        // 100-entry batch trips the *test host's* per-invocation event-size
        // budget (soroban-env-host defaults), which has nothing to do with the
        // reader boundary under test. Each `record_payment` is its own
        // invocation, so the 100 payments themselves fit the budget.
        for _ in 0..MAX_READER_ENTRIES {
            client.record_payment(
                &payer,
                &payee,
                &100i128,
                &sac,
                &String::from_str(&env, "tx_full"),
                &String::from_str(&env, "full batch entry"),
            );
        }

        let mut payment_ids = Vec::new(&env);
        for id in 1..=(MAX_READER_ENTRIES as u64) {
            payment_ids.push_back(id);
        }
        let full_batch = BatchPayment {
            id: 1,
            creator: owner.clone(),
            total_recipients: MAX_READER_ENTRIES,
            total_amount: (MAX_READER_ENTRIES as i128) * 100,
            asset: sac.clone(),
            timestamp: env.ledger().timestamp(),
            tx_hash: String::from_str(&env, "full_batch_tx"),
            payment_ids,
        };
        env.as_contract(&contract_id, || {
            env.storage()
                .persistent()
                .set(&(BATCH_KEY, 1u64), &full_batch);
        });

        let result = client.get_payments_by_batch(&1);
        assert_eq!(result.items.len(), MAX_READER_ENTRIES);
        assert_eq!(result.total, MAX_READER_ENTRIES);
        assert!(!result.truncated);

        let missing = client.get_payments_by_batch(&999);
        assert_eq!(missing.items.len(), 0);
        assert_eq!(missing.total, 0);
        assert!(!missing.truncated);
    }
}

