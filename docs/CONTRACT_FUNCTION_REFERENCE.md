# Soroban Contract Function Reference

This document provides a comprehensive technical reference for all public functions across both Soroban smart contracts in the OphirPay ecosystem:
1. **OphirPay Contract (`OphirPayContract`)** - The main payment orchestrator handling direct payments, escrows, streaming payments, batches, recurring payments, refunds, spending limits, multi-sig approvals, and governance.
2. **Payment Event Emitter (`PaymentEventEmitter`)** - The auxiliary contract dedicated to on-chain and off-chain event publishing with allow-listed sources and upgrade controls.

---

## Table of Contents
1. [Overview & Security Architecture](#1-overview--security-architecture)
2. [Error Code Mappings](#2-error-code-mappings)
   - [OphirPay PaymentError Codes](#ophirpay-paymenterror-codes)
   - [PaymentEventEmitter EmitterError Codes](#paymenteventemitter-emittererror-codes)
3. [OphirPay Contract Functions](#3-ophirpay-contract-functions)
   - [Core & Administrative Functions](#core--administrative-functions)
   - [Payment Recording & Queries](#payment-recording--queries)
   - [Escrow Operations](#escrow-operations)
   - [Streaming Payments](#streaming-payments)
   - [Batch Payments](#batch-payments)
   - [Recurring Payments](#recurring-payments)
   - [Refund Management](#refund-management)
   - [Multisig Approvals](#multisig-approvals)
   - [Spending Limits & Escalation](#spending-limits--escalation)
   - [Role-Based Access Control (RBAC)](#role-based-access-control-rbac)
   - [Governance & Timelock](#governance--timelock)
   - [Notification Hooks & Webhooks](#notification-hooks--webhooks)
   - [Audit Logs & Analytics](#audit-logs--analytics)
4. [Payment Event Emitter Functions](#4-payment-event-emitter-functions)
   - [Lifecycle & Admin](#lifecycle--admin)
   - [Event Emission & Queries](#event-emission--queries)
5. [Invocation Examples (CLI & SDK)](#5-invocation-examples-cli--sdk)

---

## 1. Overview & Security Architecture

Soroban contract calls require explicit authentication semantics (`require_auth()`) to protect asset transfers and administrative changes.
- **Reentrancy Protection**: Token-moving operations enforce internal reentrancy locks (`REENTRANCY_LOCK`).
- **Locked Balance Invariant**: All funds deposited into escrows, streams, or proposals are tracked in `LOCKED_BALANCE` to prevent administrative withdrawal of customer funds.
- **Two-Step Ownership Transfer**: Ownership transfers require a proposal by the current owner followed by an acceptance after a 24-hour timelock.
- **Config Versioning**: Fee and multisig configurations are immutable snapshot series retained up to 100 historical versions.

---

## 2. Error Code Mappings

### OphirPay PaymentError Codes (`PaymentError`)

| Error Code | Identifier | Description |
|---|---|---|
| `1` | `NotInitialized` | Contract has not been initialized yet. |
| `2` | `AlreadyInitialized` | Contract has already been initialized. |
| `3` | `PaymentNotFound` | Payment ID does not exist. |
| `4` | `Unauthorized` | Caller lacks required authorization or ownership. |
| `5` | `InvalidAmount` | Amount must be positive (> 0). |
| `6` | `EscrowNotDue` | Escrow claim attempted before the deadline. |
| `7` | `EscrowAlreadyReleased` | Escrow has already been released or claimed. |
| `8` | `EscrowNotFound` | Escrow ID does not exist. |
| `9` | `StreamNotStarted` | Claim attempted before stream start timestamp. |
| `10` | `StreamAlreadyCancelled`| Stream has already been cancelled. |
| `11` | `StreamNotFound` | Stream ID does not exist. |
| `12` | `StreamFullyClaimed` | All stream funds have already been claimed. |
| `13` | `BatchTooLarge` | Batch size exceeds maximum allowable recipients (50). |
| `14` | `BatchEmpty` | Batch contains zero recipients. |
| `15` | `TokenTransferFailed` | Underlying Soroban SAC token transfer returned an error. |
| `16` | `InsufficientBalance` | Insufficient contract or user balance. |
| `17` | `PaymentAlreadyCancelled` | Payment record is already marked cancelled. |
| `18` | `ContractPaused` | Operations are blocked because contract is paused. |
| `19` | `NoTokensToWithdraw` | Emergency withdraw requested with 0 available balance. |
| `20` | `UpgradeNotProposed` | No upgrade was proposed or timelock record missing. |
| `21` | `UpgradeTimelockActive`| Timelock duration has not elapsed yet (24h required). |
| `22` | `MultisigNotConfigured` | Multisig is disabled or uninitialized. |
| `23` | `NotASigner` | Caller is not a configured multisig signer. |
| `24` | `AlreadyApproved` | Signer has already approved this proposal. |
| `25` | `ThresholdNotMet` | Number of approvals is less than multisig threshold. |
| `26` | `AlreadyExecuted` | Request or proposal has already been executed. |
| `27` | `NotARoleHolder` | Caller lacks the required RBAC role (`Admin`/`Operator`/`Auditor`). |
| `28` | `AuditLogEmpty` | Audit log has no records. |
| `29` | `AuditEntryNotFound` | Audit entry ID not found. |
| `30` | `RecurringNotFound` | Recurring payment ID not found. |
| `31` | `RecurringNotDue` | Execution attempted before next schedule timestamp. |
| `32` | `RecurringAlreadyCancelled` | Recurring payment has already been cancelled. |
| `33` | `RecurringExpired` | No remaining executions left. |
| `34` | `FeeConfigNotFound` | Fee configuration not found. |
| `35` | `FeeTooHigh` | Fee basis points exceed max allowable (500 bps = 5%). |
| `36` | `TimelockNotFound` | Timelocked action ID not found. |
| `37` | `TimelockNotDue` | 24-hour delay has not passed. |
| `38` | `TimelockAlreadyExecuted`| Timelocked action was already executed. |
| `39` | `GovernanceNotConfigured`| Governance module is disabled or not configured. |
| `40` | `ProposalNotFound` | Proposal ID does not exist. |
| `41` | `VotingPeriodEnded` | Proposal voting period has expired. |
| `42` | `ProposalAlreadyExecuted`| Governance proposal was already executed. |
| `43` | `QuorumNotMet` | Quorum basis points not satisfied. |
| `44` | `ProposalDefeated` | Proposal failed (no votes > yes votes). |
| `45` | `DepositTooLow` | Proposal deposit is below `min_proposal_deposit`. |
| `46` | `SpendingLimitExpired` | Configured spending limit timestamp has expired. |
| `47` | `RefundNotFound` | Refund ID does not exist. |
| `48` | `RefundAlreadyProcessed`| Refund was already executed. |
| `49` | `PaymentAlreadyRefunded`| Payment has already been refunded. |
| `50` | `RefundWindowExpired` | Refund window has elapsed (e.g. 30 days). |
| `51` | `AlreadyVoted` | Account has already cast a vote on this proposal. |
| `52` | `ReentrantCall` | Reentrant call detected and blocked. |
| `53` | `SpendCapExceeded` | Daily or monthly spending cap exceeded. |
| `60` | `ProposalNotPassed` | Proposal voting ended without reaching passing threshold. |
| `62` | `HookNotFound` | Notification hook ID not found. |
| `64` | `RateLimitExceeded` | Rate limit breached for action. |
| `70` | `EscrowDeadlineInPast` | Escrow deadline cannot be in the past. |
| `76` | `FeeCollectorNotSet` | Fee collector address is missing. |
| `77` | `EmitterNotLinked` | External event emitter address is not set. |

---

### PaymentEventEmitter EmitterError Codes (`EmitterError`)

| Error Code | Identifier | Description |
|---|---|---|
| `1` | `NotInitialized` | Emitter contract not initialized. |
| `2` | `AlreadyInitialized` | Emitter contract already initialized. |
| `3` | `EventNotFound` | Event ID does not exist. |
| `4` | `Unauthorized` | Caller is not allowed source or owner. |
| `5` | `UpgradeNotProposed` | No contract upgrade was proposed. |
| `6` | `UpgradeTimelockActive`| 24h timelock has not expired. |
| `7` | `ContractPaused` | Emitter is paused. |
| `8` | `InvalidAmount` | Amount must be positive. |
| `9` | `DuplicateEvent` | Event sequence ID already exists. |
| `10` | `MaxEventsReached` | Storage event count bound reached. |
| `11` | `ReentrantCall` | Reentrancy guard triggered. |
| `12` | `InvalidTxHash` | Transaction hash formatting invalid. |
| `13` | `EmitFailed` | Event emission failed. |
| `14` | `CrossContractCallFailed`| Cross-contract invocation failed. |

---

## 3. OphirPay Contract Functions

### Core & Administrative Functions

#### `init(env: Env, owner: Address) -> Result<u32, PaymentError>`
- **Access**: Anyone on deployment (can only be executed once).
- **Arguments**:
  - `owner`: Address designated as primary contract owner.
- **Errors**: `AlreadyInitialized`.

#### `get_owner(env: Env) -> Result<Address, PaymentError>`
- **Access**: Public view.
- **Returns**: Current contract owner `Address`.

#### `get_version(env: Env) -> u32`
- **Access**: Public view.
- **Returns**: Contract schema version integer (`2`).

#### `get_stats(env: Env) -> ContractStats`
- **Access**: Public view.
- **Returns**: Aggregate statistics struct including total payments, escrows, streams, batches, and total amounts.

#### `transfer_ownership(env: Env, caller: Address, new_owner: Address) -> Result<(), PaymentError>`
- **Access**: Owner only (`caller.require_auth()`).
- **Description**: Proposes transfer of ownership with a 24-hour timelock.

#### `accept_ownership(env: Env, caller: Address) -> Result<(), PaymentError>`
- **Access**: New proposed owner only.
- **Errors**: `Unauthorized`, `UpgradeNotProposed`, `UpgradeTimelockActive`.

#### `cancel_ownership_transfer(env: Env, caller: Address) -> Result<(), PaymentError>`
- **Access**: Current owner only. Cancels pending transfer proposal.

#### `get_pending_owner(env: Env) -> Option<(Address, u64)>`
- **Access**: Public view. Returns pending owner address and timestamp proposed.

#### `emergency_pause_all(env: Env, caller: Address) -> Result<(), PaymentError>`
- **Access**: Owner or Admin role. Pauses main contract and linked emitter contract.

#### `emergency_unpause_all(env: Env, caller: Address) -> Result<(), PaymentError>`
- **Access**: Owner or Admin role. Unpauses contracts.

#### `is_paused(env: Env) -> bool`
- **Access**: Public view. Returns pause status.

#### `get_locked_balance(env: Env) -> i128`
- **Access**: Public view. Returns the total locked balance across active escrows, streams, and proposal deposits.

#### `emergency_withdraw(env: Env, caller: Address, asset: Address, amount: i128) -> Result<(), PaymentError>`
- **Access**: Owner only.
- **Constraint**: Cannot withdraw locked user funds (`amount <= contract_balance - LOCKED_BALANCE`).
- **Errors**: `Unauthorized`, `InsufficientBalance`, `ReentrantCall`.

---

### Payment Recording & Queries

#### `record_payment(env: Env, payer: Address, payee: Address, amount: i128, asset: Address, tx_hash: String, metadata: String) -> Result<u64, PaymentError>`
- **Access**: Payer (`payer.require_auth()`).
- **Arguments**:
  - `payer`: Source address.
  - `payee`: Destination address.
  - `amount`: Payment amount in stroops/units (i128 > 0).
  - `asset`: SAC Token contract address.
  - `tx_hash`: Stellar ledger transaction hash.
  - `metadata`: Arbitrary memo/metadata string (max 256 chars).
- **Returns**: Unique `payment_id` (`u64`).

#### `get_payment(env: Env, payment_id: u64) -> Result<Payment, PaymentError>`
- **Access**: Public view.
- **Returns**: `Payment` struct.

#### `get_payment_count(env: Env) -> u64`
- **Access**: Public view. Total recorded payment count.

#### `get_payments_range(env: Env, start_id: u64, end_id: u64) -> Vec<Payment>`
- **Access**: Public view. Returns paginated payment records between `start_id` and `end_id` (max 50 records per call).

#### `cancel_payment(env: Env, caller: Address, payment_id: u64) -> Result<(), PaymentError>`
- **Access**: Payer or Owner. Flags payment record as cancelled.

---

### Escrow Operations

#### `create_escrow(env: Env, depositor: Address, beneficiary: Address, arbiter: Option<Address>, amount: i128, asset: Address, deadline: u64, metadata: String) -> Result<u64, PaymentError>`
- **Access**: Depositor (`depositor.require_auth()`). Transfers tokens to contract storage and increases `LOCKED_BALANCE`.
- **Arguments**:
  - `deadline`: Ledger timestamp after which the beneficiary can unilaterally claim funds.
  - `arbiter`: Optional third-party dispute mediator.
- **Returns**: `escrow_id` (`u64`).

#### `release_escrow(env: Env, owner: Address, escrow_id: u64) -> Result<(), PaymentError>`
- **Access**: Depositor or Contract Owner. Transfers escrowed tokens to beneficiary.
- **Errors**: `EscrowNotFound`, `EscrowAlreadyReleased`, `ReentrantCall`.

#### `release_by_arbiter(env: Env, arbiter: Address, escrow_id: u64, release_to_beneficiary: bool) -> Result<(), PaymentError>`
- **Access**: Designated Arbiter (`arbiter.require_auth()`). Releases funds to beneficiary if `true`, or refunds depositor if `false`.

#### `claim_escrow(env: Env, beneficiary: Address, escrow_id: u64) -> Result<(), PaymentError>`
- **Access**: Beneficiary (`beneficiary.require_auth()`). Callable after `deadline` has elapsed.

#### `get_escrow(env: Env, escrow_id: u64) -> Result<Escrow, PaymentError>`
- **Access**: Public view. Returns `Escrow` details.

#### `get_escrow_count(env: Env) -> u64`
- **Access**: Public view. Returns total escrows created.

---

### Streaming Payments

#### `create_stream(env: Env, creator: Address, recipient: Address, total_amount: i128, asset: Address, start_time: u64, end_time: u64, metadata: String) -> Result<u64, PaymentError>`
- **Access**: Creator (`creator.require_auth()`). Deposits tokens into contract for linear time-based vesting.
- **Returns**: `stream_id` (`u64`).

#### `claim_stream(env: Env, recipient: Address, stream_id: u64) -> Result<i128, PaymentError>`
- **Access**: Recipient (`recipient.require_auth()`). Calculates vested tokens up to current timestamp minus already claimed tokens, transfers amount to recipient.
- **Returns**: Newly claimed amount (`i128`).

#### `cancel_stream(env: Env, creator: Address, stream_id: u64) -> Result<i128, PaymentError>`
- **Access**: Creator (`creator.require_auth()`). Vests accrued tokens to recipient and refunds unvested balance to creator.
- **Returns**: Refunded amount to creator (`i128`).

#### `get_stream(env: Env, stream_id: u64) -> Result<Stream, PaymentError>`
- **Access**: Public view. Returns `Stream` struct.

#### `get_stream_count(env: Env) -> u64`
- **Access**: Public view. Returns total streams count.

---

### Batch Payments

#### `create_batch(env: Env, creator: Address, payees: Vec<Address>, amounts: Vec<i128>, asset: Address, tx_hash: String) -> Result<BatchCreateResult, PaymentError>`
- **Access**: Creator (`creator.require_auth()`).
- **Constraints**: `payees.len() == amounts.len()`, `payees.len() <= 50`.
- **Returns**: `BatchCreateResult { batch_id, total_requests, successful, failed, total_amount }`.

#### `get_batch(env: Env, batch_id: u64) -> Result<BatchPayment, PaymentError>`
- **Access**: Public view. Returns `BatchPayment` metadata.

#### `get_payments_by_batch(env: Env, batch_id: u64) -> Vec<Payment>`
- **Access**: Public view. Returns list of individual payment records created by the batch.

---

### Recurring Payments

#### `create_recurring(env: Env, creator: Address, payee: Address, amount: i128, asset: Address, schedule: ScheduleType, remaining: u32, metadata: String) -> Result<u64, PaymentError>`
- **Access**: Creator (`creator.require_auth()`). Registers automated recurring schedule (`ScheduleType::Daily`, `Weekly`, `Monthly`).

#### `execute_recurring(env: Env, caller: Address, recurring_id: u64) -> Result<u64, PaymentError>`
- **Access**: Anyone (relayer / worker). Executes payment if `ledger.timestamp >= next_execution`.
- **Returns**: Created `payment_id`.

#### `cancel_recurring(env: Env, caller: Address, recurring_id: u64) -> Result<(), PaymentError>`
- **Access**: Creator or Owner. Cancels future execution cycles.

#### `get_recurring(env: Env, recurring_id: u64) -> Result<RecurringPayment, PaymentError>`
- **Access**: Public view.

---

### Refund Management

#### `request_refund(env: Env, requester: Address, payment_id: u64, amount: i128, asset: Address, reason: String, reason_code: RefundReasonCode) -> Result<u64, PaymentError>`
- **Access**: Requester / Payer (`requester.require_auth()`).
- **Reason Codes**: `ProductDefect`, `NonDelivery`, `DuplicateCharge`, `Unauthorized`, `CustomerRequest`, `Other`.

#### `approve_refund(env: Env, caller: Address, refund_id: u64) -> Result<(), PaymentError>`
- **Access**: Merchant / Payee or Admin. Moves status from `Requested` to `Approved`.

#### `reject_refund(env: Env, caller: Address, refund_id: u64) -> Result<(), PaymentError>`
- **Access**: Merchant / Payee or Admin. Moves status to `Rejected`.

#### `process_refund(env: Env, caller: Address, refund_id: u64) -> Result<(), PaymentError>`
- **Access**: Merchant or Admin. Transfers refund tokens back to requester and marks `Processed`.

#### `get_refund(env: Env, refund_id: u64) -> Result<Refund, PaymentError>`
- **Access**: Public view.

#### `get_reason_code_analytics(env: Env) -> Vec<(u32, u64)>`
- **Access**: Public view. Returns aggregate counts for each `RefundReasonCode`.

---

### Multisig Approvals

#### `set_multisig_config(env: Env, caller: Address, threshold: u32, signers: Vec<Address>, enabled: bool) -> Result<(), PaymentError>`
- **Access**: Owner only. Archives previous config version and stores new version.

#### `get_multisig_config(env: Env) -> Option<MultisigConfig>`
- **Access**: Public view. Returns active multisig parameters.

#### `get_multisig_config_history(env: Env) -> Vec<MultisigVersion>`
- **Access**: Public view. Returns version history of changes.

#### `propose_payment(env: Env, proposer: Address, payee: Address, amount: i128, asset: Address, tx_hash: String) -> Result<u64, PaymentError>`
- **Access**: Authorized Signer (`proposer.require_auth()`).

#### `approve_payment(env: Env, signer: Address, request_id: u64) -> Result<bool, PaymentError>`
- **Access**: Authorized Signer. Adds signature. Returns `true` if threshold is reached.

#### `execute_approved_payment(env: Env, caller: Address, request_id: u64) -> Result<u64, PaymentError>`
- **Access**: Authorized Signer. Executes payment once threshold is satisfied.

---

### Spending Limits & Escalation

#### `set_spending_limit(env: Env, caller: Address, user: Address, daily_limit: i128, monthly_limit: i128, expires_at: u64, is_active: bool) -> Result<(), PaymentError>`
- **Access**: Owner or Admin role. Configures spend caps with optional expiration timestamp.

#### `get_spending_limit(env: Env, user: Address) -> Option<SpendingLimit>`
- **Access**: Public view.

#### `configure_escalation(env: Env, caller: Address, small_threshold: i128, medium_threshold: i128, enabled: bool) -> Result<(), PaymentError>`
- **Access**: Owner only. Configures automatic vs approval tiers.

#### `check_spending(env: Env, user: Address, amount: i128) -> SpendCheckResult`
- **Access**: Public view (`Approved`, `Escalated`, `Rejected`).

#### `atomic_spend(env: Env, payer: Address, payee: Address, amount: i128, asset: Address, tx_hash: String, metadata: String) -> Result<u64, PaymentError>`
- **Access**: Payer (`payer.require_auth()`). Verifies and updates daily/monthly spend limits atomically before recording payment.

---

### Role-Based Access Control (RBAC)

#### `grant_role(env: Env, caller: Address, grantee: Address, role: Role) -> Result<(), PaymentError>`
- **Access**: Owner only. Roles: `Admin`, `Operator`, `Auditor`.

#### `revoke_role(env: Env, caller: Address, grantee: Address) -> Result<(), PaymentError>`
- **Access**: Owner only. Revokes role from grantee.

#### `get_role(env: Env, addr: Address) -> Option<Role>`
- **Access**: Public view. Returns role assigned to address.

---

### Governance & Timelock

#### `configure_governance(env: Env, caller: Address, min_proposal_deposit: i128, voting_period: u64, quorum_bps: u32, enabled: bool) -> Result<(), PaymentError>`
- **Access**: Owner only.

#### `create_proposal(env: Env, proposer: Address, title: String, description: String, action_type: String, target: String, data: String, deposit_asset: Address, deposit_amount: i128) -> Result<u64, PaymentError>`
- **Access**: Proposer. Locks `deposit_amount >= min_proposal_deposit`.

#### `vote_on_proposal(env: Env, voter: Address, proposal_id: u64, support: bool) -> Result<(), PaymentError>`
- **Access**: Voter (`voter.require_auth()`). Enforces single vote per address (`AlreadyVoted`).

#### `execute_proposal(env: Env, proposal_id: u64) -> Result<bool, PaymentError>`
- **Access**: Anyone after voting period ends. Verifies quorum and majority before executing.

#### `propose_timelocked_action(env: Env, caller: Address, action_type: String, target: String, data: String) -> Result<u64, PaymentError>`
- **Access**: Owner/Admin. Locks action for 24h.

#### `execute_timelocked_action(env: Env, action_id: u64) -> Result<(), PaymentError>`
- **Access**: Anyone after 24h delay.

---

### Notification Hooks & Webhooks

#### `register_hook(env: Env, subscriber: Address, event_type: String, webhook_url: String) -> Result<u64, PaymentError>`
- **Access**: Subscriber (`subscriber.require_auth()`). Registers on-chain webhook endpoint.

#### `unregister_hook(env: Env, caller: Address, hook_id: u64) -> Result<(), PaymentError>`
- **Access**: Subscriber or Owner. Deactivates webhook hook.

#### `get_hooks_by_event(env: Env, event_type: String) -> Vec<(u64, String)>`
- **Access**: Public view for off-chain event relayers.

#### `get_subscriber_hooks(env: Env, subscriber: Address) -> Vec<NotificationHook>`
- **Access**: Public view.

---

### Audit Logs & Analytics

#### `get_audit_log_count(env: Env) -> u64`
- **Access**: Public view.

#### `get_audit_entry(env: Env, entry_id: u64) -> Result<AuditEntry, PaymentError>`
- **Access**: Public view.

#### `get_audit_log_range(env: Env, start_id: u64, end_id: u64) -> Vec<AuditEntry>`
- **Access**: Public view. Returns batch of audit entries.

---

## 4. Payment Event Emitter Functions

### Lifecycle & Admin

#### `init(env: Env, owner: Address) -> Result<u32, EmitterError>`
- **Access**: Initial deployer (once only).
- **Arguments**: `owner`: designated owner address.

#### `set_allowed_source(env: Env, caller: Address, source: Option<Address>) -> Result<(), EmitterError>`
- **Access**: Emitter Owner (`caller.require_auth()`).
- **Description**: Sets allow-listed contract address (e.g. OphirPay main contract). When set, only this address and the owner can emit events.

#### `get_allowed_source(env: Env) -> Option<Address>`
- **Access**: Public view.

#### `pause(env: Env, caller: Address) -> Result<(), EmitterError>` / `unpause(env: Env, caller: Address) -> Result<(), EmitterError>`
- **Access**: Emitter Owner only.

#### `is_paused(env: Env) -> bool`
- **Access**: Public view.

#### `transfer_ownership(env: Env, caller: Address, new_owner: Address) -> Result<(), EmitterError>`
- **Access**: Current Owner. Two-step transfer proposal.

#### `accept_ownership(env: Env, caller: Address) -> Result<(), EmitterError>`
- **Access**: Proposed Owner after 24h timelock.

---

### Event Emission & Queries

#### `emit_payment(env: Env, caller: Address, source: String, payer: Address, payee: Address, amount: i128, tx_hash: String) -> Result<u64, EmitterError>`
- **Access**: Allow-listed source contract or Emitter Owner.
- **Description**: Records persistent `PaymentEvent` and publishes native Soroban event `(payment_event, payer, payee) -> (amount, tx_hash)`.
- **Returns**: Unique event sequence ID (`u64`).

#### `get_event(env: Env, event_id: u64) -> Result<PaymentEvent, EmitterError>`
- **Access**: Public view.
- **Returns**: `PaymentEvent` struct with fields `id`, `source`, `payer`, `payee`, `amount`, `tx_hash`, `timestamp`.

#### `get_event_count(env: Env) -> u64`
- **Access**: Public view. Total emitted events.

---

## 5. Invocation Examples (CLI & SDK)

### Stellar CLI Examples

#### 1. Record Direct Payment
```bash
soroban contract invoke \
  --id <OPHIRPAY_CONTRACT_ID> \
  --source-account <PAYER_SECRET_OR_IDENTITY> \
  --network testnet \
  -- \
  record_payment \
  --payer <PAYER_ADDRESS> \
  --payee <PAYEE_ADDRESS> \
  --amount 10000000 \
  --asset <SAC_TOKEN_ADDRESS> \
  --tx_hash "0x3a4b...c7d8" \
  --metadata "Invoice #1042"
```

#### 2. Create Escrow
```bash
soroban contract invoke \
  --id <OPHIRPAY_CONTRACT_ID> \
  --source-account <DEPOSITOR_IDENTITY> \
  --network testnet \
  -- \
  create_escrow \
  --depositor <DEPOSITOR_ADDRESS> \
  --beneficiary <BENEFICIARY_ADDRESS> \
  --arbiter <ARBITER_ADDRESS_OR_NONE> \
  --amount 50000000 \
  --asset <SAC_TOKEN_ADDRESS> \
  --deadline 1787990000 \
  --metadata "Milestone 1 Escrow"
```

#### 3. Release Escrow
```bash
soroban contract invoke \
  --id <OPHIRPAY_CONTRACT_ID> \
  --source-account <OWNER_OR_DEPOSITOR_IDENTITY> \
  --network testnet \
  -- \
  release_escrow \
  --owner <CALLER_ADDRESS> \
  --escrow_id 1
```

#### 4. Register Webhook Notification Hook
```bash
soroban contract invoke \
  --id <OPHIRPAY_CONTRACT_ID> \
  --source-account <SUBSCRIBER_IDENTITY> \
  --network testnet \
  -- \
  register_hook \
  --subscriber <SUBSCRIBER_ADDRESS> \
  --event_type "payment_recorded" \
  --webhook_url "https://api.merchant.com/webhooks/ophirpay"
```

---

### JavaScript / TypeScript Client SDK Example

```typescript
import { Contract, Address, nativeToScVal } from "@stellar/stellar-sdk";

// Initialize contract instance
const contract = new Contract(OPHIRPAY_CONTRACT_ID);

// 1. Query Payment Record
async function fetchPayment(paymentId: bigint) {
  const tx = contract.call("get_payment", nativeToScVal(paymentId, { type: "u64" }));
  // simulate and decode response using Server / rpc
}

// 2. Query Contract Stats
async function fetchStats() {
  const tx = contract.call("get_stats");
  // returns { total_payments_recorded, total_escrows_created, total_amount_escrowed, ... }
}
```
