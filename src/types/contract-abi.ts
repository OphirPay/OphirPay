// SPDX-License-Identifier: MIT

/**
 * Contract ABI type definitions for OphirPay Soroban contracts v3.
 * Matches the contracts/ophirpay/src/lib.rs and contracts/emitter/src/lib.rs interfaces.
 *
 * Key features:
 * - Escrow: lock funds with deadline, owner release, beneficiary claim, arbiter
 * - Payment Streaming: linear vesting with overflow-protected math
 * - Batch Payments: atomic multi-recipient recording with partial failure
 * - SAC Token Support: works with any Stellar Asset Contract
 * - Native Soroban Events: env.events().publish()
 * - Emergency pause/unpause circuit breaker
 * - Two-step contract upgrade with 24h timelock
 * - Auth-gated emitter contract
 * - Multisig approvals (N-of-M signers)
 * - Spending limits + escalation tiers
 * - Role-based access control (Admin, Operator, Auditor)
 * - On-chain immutable audit log
 * - Recurring payment scheduler (Daily/Weekly/Monthly)
 * - Fee configuration per operation type
 * - Timelocked admin actions (24h delay)
 * - DAO governance (proposal → vote → execute)
 */

/** Supported Stellar asset types */
export type AssetType = "native" | "credit_alphanum4" | "credit_alphanum12";

// ── Payment Record ──────────────────────────────────────────

export interface OnChainPayment {
  id: number;
  payer: string;
  payee: string;
  amount: bigint;
  asset: string;
  tx_hash: string;
  timestamp: number;
  metadata: string;
  cancelled: boolean;
}

// ── Escrow ──────────────────────────────────────────────────

export interface EscrowData {
  id: number;
  depositor: string;
  beneficiary: string;
  arbiter: string | null;
  amount: bigint;
  asset: string;
  deadline: number;
  released: boolean;
  claimed: boolean;
  metadata: string;
}

// ── Payment Stream ──────────────────────────────────────────

export interface StreamData {
  id: number;
  creator: string;
  recipient: string;
  total_amount: bigint;
  claimed_amount: bigint;
  asset: string;
  start_time: number;
  end_time: number;
  cancelled: boolean;
  metadata: string;
}

// ── Batch ───────────────────────────────────────────────────

export interface BatchData {
  id: number;
  creator: string;
  total_recipients: number;
  total_amount: bigint;
  asset: string;
  timestamp: number;
  tx_hash: string;
  payment_ids: number[];
}

export interface BatchCreateResult {
  batch_id: number;
  total_requests: number;
  successful: number;
  failed: number;
  total_amount: bigint;
}

export interface ContractStats {
  total_payments_recorded: number;
  total_escrows_created: number;
  total_escrows_released: number;
  total_escrows_claimed: number;
  total_streams_created: number;
  total_streams_claimed: number;
  total_streams_cancelled: number;
  total_batches_processed: number;
  total_amount_escrowed: bigint;
  total_amount_streamed: bigint;
  total_amount_batched: bigint;
}

// ── Multisig ────────────────────────────────────────────────

export interface MultisigConfig {
  threshold: number;
  signers: string[];
  enabled: boolean;
}

export interface ApprovalRequest {
  id: number;
  proposer: string;
  payee: string;
  amount: bigint;
  asset: string;
  tx_hash: string;
  approvals: string[];
  executed: boolean;
  created_at: number;
}

// ── Spending Limits & Escalation ────────────────────────────

export interface SpendingLimit {
  daily_limit: bigint;
  monthly_limit: bigint;
  current_daily_spend: bigint;
  current_monthly_spend: bigint;
  last_reset_day: number;
  last_reset_month: number;
  is_active: boolean;
  expires_at: number;
}

export interface EscalationRules {
  small_threshold: bigint;
  medium_threshold: bigint;
  enabled: boolean;
}

export type SpendCheckResult = "Approved" | "Escalated" | "Rejected";

// ── RBAC ────────────────────────────────────────────────────

export type Role = "Admin" | "Operator" | "Auditor";

// ── Audit Log ───────────────────────────────────────────────

export interface AuditEntry {
  id: number;
  timestamp: number;
  action: string;
  actor: string;
  target_id: number;
  details: string;
}

// ── Recurring Payments ─────────────────────────────────────

export type ScheduleType = "Daily" | "Weekly" | "Monthly";

export interface RecurringPayment {
  id: number;
  creator: string;
  payee: string;
  amount: bigint;
  asset: string;
  schedule: ScheduleType;
  next_execution: number;
  remaining: number;
  times_executed: number;
  active: boolean;
  metadata: string;
}

// ── Fee Configuration ──────────────────────────────────────

export interface FeeConfigVersion {
  version: number;
  config: FeeConfig;
  changed_at: number;
  changed_by: string;
}

export interface MultisigVersion {
  version: number;
  config: MultisigConfig;
  changed_at: number;
  changed_by: string;
}

export interface FeeConfig {
  payment_fee_bps: number;
  escrow_fee_bps: number;
  stream_fee_bps: number;
  batch_base_fee: bigint;
  batch_per_item_fee: bigint;
  enabled: boolean;
}

// ── Timelocked Actions ─────────────────────────────────────

export interface TimelockedAction {
  id: number;
  action_type: string;
  target: string;
  data: string;
  proposed_by: string;
  proposed_at: number;
  unlocks_at: number;
  executed: boolean;
}

// ── Governance ──────────────────────────────────────────────

export interface GovernanceConfig {
  min_proposal_deposit: bigint;
  voting_period: number;
  quorum_bps: number;
  enabled: boolean;
}

export interface Proposal {
  id: number;
  proposer: string;
  title: string;
  description: string;
  action_type: string;
  target: string;
  data: string;
  yes_votes: bigint;
  no_votes: bigint;
  voting_ends_at: number;
  executed: boolean;
  created_at: number;
}

// ── Notification Hooks ──────────────────────────────────────

export interface NotificationHook {
  id: number;
  subscriber: string;
  event_type: string;
  webhook_url: string;
  active: boolean;
  created_at: number;
}

// ── Refund System ───────────────────────────────────────────

export type RefundReasonCode =
  | "ProductDefect"
  | "NonDelivery"
  | "DuplicateCharge"
  | "Unauthorized"
  | "CustomerRequest"
  | "Other";

export type RefundStatus = "Requested" | "Approved" | "Rejected" | "Processed";

export interface Refund {
  id: number;
  payment_id: number;
  requester: string;
  amount: bigint;
  asset: string;
  reason: string;
  reason_code: RefundReasonCode;
  status: RefundStatus;
  requested_at: number;
  resolved_at: number;
}

// ── Payment Event (Emitter Contract) ────────────────────────

export interface PaymentEvent {
  id: number;
  source: string;
  payer: string;
  payee: string;
  amount: bigint;
  tx_hash: string;
  timestamp: number;
}

// ── Contract Errors ─────────────────────────────────────────

export enum PaymentErrorCode {
  NotInitialized = 1,
  AlreadyInitialized = 2,
  PaymentNotFound = 3,
  Unauthorized = 4,
  InvalidAmount = 5,
  EscrowNotDue = 6,
  EscrowAlreadyReleased = 7,
  EscrowNotFound = 8,
  StreamNotStarted = 9,
  StreamAlreadyCancelled = 10,
  StreamNotFound = 11,
  StreamFullyClaimed = 12,
  BatchTooLarge = 13,
  BatchEmpty = 14,
  TokenTransferFailed = 15,
  InsufficientBalance = 16,
  PaymentAlreadyCancelled = 17,
  ContractPaused = 18,
  NoTokensToWithdraw = 19,
  UpgradeNotProposed = 20,
  UpgradeTimelockActive = 21,
  MultisigNotConfigured = 22,
  NotASigner = 23,
  AlreadyApproved = 24,
  ThresholdNotMet = 25,
  AlreadyExecuted = 26,
  NotARoleHolder = 27,
  AuditLogEmpty = 28,
  AuditEntryNotFound = 29,
  RecurringNotFound = 30,
  RecurringNotDue = 31,
  RecurringAlreadyCancelled = 32,
  RecurringExpired = 33,
  FeeConfigNotFound = 34,
  FeeTooHigh = 35,
  TimelockNotFound = 36,
  TimelockNotDue = 37,
  TimelockAlreadyExecuted = 38,
  GovernanceNotConfigured = 39,
  ProposalNotFound = 40,
  VotingPeriodEnded = 41,
  ProposalAlreadyExecuted = 42,
  QuorumNotMet = 43,
  ProposalDefeated = 44,
  DepositTooLow = 45,
  SpendingLimitExpired = 46,
  RefundNotFound = 47,
  RefundAlreadyProcessed = 48,
  PaymentAlreadyRefunded = 49,
  RefundWindowExpired = 50,
}

export const PAYMENT_ERROR_MESSAGES: Record<number, string> = {
  1: "Contract not initialized",
  2: "Contract already initialized",
  3: "Payment record not found",
  4: "Unauthorized caller",
  5: "Invalid payment amount",
  6: "Escrow not yet due for claiming",
  7: "Escrow already released",
  8: "Escrow not found",
  9: "Payment stream has not started yet",
  10: "Payment stream is already cancelled",
  11: "Payment stream not found",
  12: "All tokens already claimed from stream",
  13: "Batch exceeds maximum of 100 recipients",
  14: "Batch is empty",
  15: "Token transfer failed",
  16: "Insufficient balance",
  17: "Payment already cancelled",
  18: "Contract is paused — all writes are blocked",
  19: "No tokens to withdraw — amount must be positive",
  20: "No upgrade has been proposed",
  21: "Upgrade timelock is still active — wait 24 hours",
  22: "Multisig is not configured or not enabled",
  23: "Caller is not a multisig signer",
  24: "Signer has already approved this request",
  25: "Threshold not met — need more approvals",
  26: "This action has already been executed",
  27: "Caller does not hold the required role",
  28: "Audit log is empty",
  29: "Audit entry not found",
  30: "Recurring payment schedule not found",
  31: "Recurring payment is not yet due",
  32: "Recurring payment already cancelled",
  33: "Recurring payment has expired",
  34: "Fee configuration not found",
  35: "Fee exceeds maximum 10% (1000 bps)",
  36: "Timelocked action not found",
  37: "Timelock period has not elapsed — wait 24 hours",
  38: "Timelocked action already executed",
  39: "Governance is not configured or not enabled",
  40: "Proposal not found",
  41: "Voting period has ended",
  42: "Proposal already executed",
  43: "Quorum not met",
  44: "Proposal was defeated (no > yes)",
  45: "Deposit too low to create a proposal",
  46: "Spending limit expired or exceeded — atomic check-and-spend rejected",
  47: "Refund request not found",
  48: "Refund has already been processed or approved",
  49: "This payment has already been refunded",
  50: "Refund window has expired — no longer eligible",
};
