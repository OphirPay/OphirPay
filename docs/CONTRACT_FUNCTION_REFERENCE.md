# Soroban Smart Contract Function Reference

This reference document provides a complete technical specification of every public entry point, data structure, access control policy, error code, and interaction flow across both Soroban smart contracts in the OphirPay ecosystem:

1. **`OphirPayContract`** (`contracts/ophirpay/src/lib.rs`): The primary orchestrator handling direct payments, batch settlements, linear streaming, arbitrated escrows, recurring subscriptions, structured refunds, multisig approvals, spending limits, RBAC, timelocks, DAO governance, on-chain audit trails, and notification hooks.
2. **`PaymentEventEmitter`** (`contracts/emitter/src/lib.rs`): A decoupled event logging and persistence contract queried by off-chain real-time streaming engines (SSE / WebSockets) with allow-listed emission authorization.

---

## 📑 Table of Contents

1. [Architectural Overview & Security Model](#1-architectural-overview--security-model)
2. [Data Types & Structs](#2-data-types--structs)
3. [OphirPayContract Function Reference](#3-ophirpaycontract-function-reference)
   - [3.1 Core Lifecycle, Admin & Emergency Controls](#31-core-lifecycle-admin--emergency-controls)
   - [3.2 Direct Payments & Settlements](#32-direct-payments--settlements)
   - [3.3 Batch Payments](#33-batch-payments)
   - [3.4 Escrows & Dispute Resolution](#34-escrows--dispute-resolution)
   - [3.5 Payment Streams & Vesting](#35-payment-streams--vesting)
   - [3.6 Recurring Payments & Schedules](#36-recurring-payments--schedules)
   - [3.7 Multisig Approvals & Versioning](#37-multisig-approvals--versioning)
   - [3.8 Fee Management & Calculations](#38-fee-management--calculations)
   - [3.9 Spending Limits, Escalation & Atomic Spend](#39-spending-limits-escalation--atomic-spend)
   - [3.10 Role-Based Access Control (RBAC)](#310-role-based-access-control-rbac)
   - [3.11 Timelocked Admin Actions](#311-timelocked-admin-actions)
   - [3.12 DAO Governance Proposals & Voting](#312-dao-governance-proposals--voting)
   - [3.13 Structured Refund Management & Analytics](#313-structured-refund-management--analytics)
   - [3.14 Notification Hooks & Webhooks](#314-notification-hooks--webhooks)
   - [3.15 On-Chain Audit Trail](#315-on-chain-audit-trail)
4. [PaymentEventEmitter Function Reference](#4-paymenteventemitter-function-reference)
   - [4.1 Lifecycle & Configuration](#41-lifecycle--configuration)
   - [4.2 Event Emission & Queries](#42-event-emission--queries)
   - [4.3 Emitter Circuit Breakers & Upgrades](#43-emitter-circuit-breakers--upgrades)
5. [Complete Error Code Reference](#5-complete-error-code-reference)
   - [5.1 PaymentError (Codes 1–300)](#51-paymenterror-codes-1300)
   - [5.2 EmitterError (Codes 1–14)](#52-emittererror-codes-114)
6. [CLI & TypeScript SDK Invocation Examples](#6-cli--typescript-sdk-invocation-examples)
   - [6.1 Stellar CLI Invocations](#61-stellar-cli-invocations)
   - [6.2 TypeScript Client SDK Invocations](#62-typescript-client-sdk-invocations)

---

## 1. Architectural Overview & Security Model

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    OphirPay Architecture                                     │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
                                           │
                    ┌──────────────────────┴──────────────────────┐
                    ▼                                             ▼
        ┌───────────────────────┐                     ┌───────────────────────┐
        │   OphirPayContract    │──Cross-Contract────▶│  PaymentEventEmitter  │
        │  (Main Orchestrator)  │   Emit / Pause      │  (SSE / Event Store)  │
        └───────────────────────┘                     └───────────────────────┘
          │        │        │                                     │
          ▼        ▼        ▼                                     ▼
      [Escrows] [Streams] [Multisig]                     [Real-Time SSE Stream]
      [Batches] [Refunds] [RBAC]                         (GET /api/events)
```

### Security & Invariant Guarantees
- **Authorization (`require_auth`)**: Every state-modifying function enforces strict signature checks on the initiating caller or specified participant (e.g. `payer.require_auth()`, `creator.require_auth()`, `owner.require_auth()`).
- **Circuit Breaker (`PAUSED`)**: All mutating operations query `require_not_paused(env)` prior to executing business logic. When `emergency_pause_all` is triggered, an atomic cross-contract call freezes both `OphirPayContract` and `PaymentEventEmitter`.
- **Reentrancy Protection (`REENTRANCY_LOCK`)**: Token-moving methods execute inside a reentrancy guard (`reentrancy_guard(env, || { ... })`) to eliminate reentrancy vulnerabilities across external Stellar Asset Contract (SAC) transfers.
- **Locked Balance Conservation (`LOCKED_BALANCE`)**: Funds deposited for active escrows, linear streams, and governance proposal deposits are tracked in instance storage. The admin `emergency_withdraw` operation strictly guarantees:
  $$\text{withdraw\_amount} \le \text{contract\_balance} - \text{LOCKED\_BALANCE}$$
- **Two-Step Ownership Transfer with Timelock**: Ownership changes require a two-stage handshake (`transfer_ownership` -> 24-hour delay -> `accept_ownership`).
- **Immutable Policy Versioning**: Config updates (`FeeConfig`, `MultisigConfig`) append to historical snapshots (capped at 100 entries per query).

---

## 2. Data Types & Structs

### 2.1 Core Types (`OphirPayContract`)

```rust
pub struct Payment {
    pub id: u64,
    pub payer: Address,
    pub payee: Address,
    pub amount: i128,
    pub asset: Address,
    pub tx_hash: String,
    pub timestamp: u64,
    pub metadata: String,
    pub cancelled: bool,
}

pub struct Escrow {
    pub id: u64,
    pub depositor: Address,
    pub beneficiary: Address,
    pub arbiter: Option<Address>,
    pub amount: i128,
    pub asset: Address,
    pub deadline: u64,
    pub released: bool,
    pub claimed: bool,
    pub metadata: String,
}

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

pub struct BatchCreateResult {
    pub batch_id: u64,
    pub total_requests: u32,
    pub successful: u32,
    pub failed: u32,
    pub total_amount: i128,
}

pub struct RecurringPayment {
    pub id: u64,
    pub creator: Address,
    pub payee: Address,
    pub amount: i128,
    pub asset: Address,
    pub schedule: ScheduleType,
    pub next_execution: u64,
    pub remaining: u32,
    pub times_executed: u32,
    pub active: bool,
    pub metadata: String,
}

pub struct Refund {
    pub id: u64,
    pub payment_id: u64,
    pub requester: Address,
    pub amount: i128,
    pub asset: Address,
    pub reason: String,
    pub reason_code: RefundReasonCode,
    pub status: RefundStatus,
    pub requested_at: u64,
    pub resolved_at: u64,
}

pub struct MultisigConfig {
    pub threshold: u32,
    pub signers: Vec<Address>,
    pub enabled: bool,
}

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

pub struct SpendingLimit {
    pub daily_limit: i128,
    pub monthly_limit: i128,
    pub current_daily_spend: i128,
    pub current_monthly_spend: i128,
    pub last_reset_day: u64,
    pub last_reset_month: u64,
    pub is_active: bool,
    pub expires_at: u64,
}

pub struct GovernanceConfig {
    pub min_proposal_deposit: i128,
    pub voting_period: u64,
    pub quorum_bps: u32,
    pub enabled: bool,
}

pub struct Proposal {
    pub id: u64,
    pub proposer: Address,
    pub title: String,
    pub description: String,
    pub action_type: String,
    pub target: String,
    pub data: String,
    pub yes_votes: i128,
    pub no_votes: i128,
    pub voting_ends_at: u64,
    pub executed: bool,
    pub created_at: u64,
    pub deposit_asset: Address,
    pub deposit_amount: i128,
}

pub struct TimelockedAction {
    pub id: u64,
    pub action_type: String,
    pub target: String,
    pub data: String,
    pub proposed_by: Address,
    pub proposed_at: u64,
    pub unlocks_at: u64,
    pub executed: bool,
}

pub struct FeeConfig {
    pub payment_fee_bps: u32,
    pub escrow_fee_bps: u32,
    pub stream_fee_bps: u32,
    pub batch_base_fee: i128,
    pub batch_per_item_fee: i128,
    pub enabled: bool,
}

pub struct AuditEntry {
    pub id: u64,
    pub timestamp: u64,
    pub action: String,
    pub actor: Address,
    pub target_id: u64,
    pub details: String,
}

pub struct NotificationHook {
    pub id: u64,
    pub subscriber: Address,
    pub event_type: String,
    pub webhook_url: String,
    pub active: bool,
    pub created_at: u64,
}

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
```

### 2.2 Enums

```rust
pub enum Role {
    Admin,
    Operator,
    Auditor,
}

pub enum ScheduleType {
    Daily,
    Weekly,
    Monthly,
}

pub enum RefundReasonCode {
    ProductDefect,
    NonDelivery,
    DuplicateCharge,
    Unauthorized,
    CustomerRequest,
    Other,
}

pub enum RefundStatus {
    Requested,
    Approved,
    Rejected,
    Processed,
}

pub enum SpendCheckResult {
    Approved,
    Escalated,
    Rejected,
}
```

### 2.3 Emitter Types (`PaymentEventEmitter`)

```rust
pub struct PaymentEvent {
    pub id: u64,
    pub source: String,
    pub payer: Address,
    pub payee: Address,
    pub amount: i128,
    pub tx_hash: String,
    pub timestamp: u64,
}
```

---

## 3. OphirPayContract Function Reference

### Summary Navigation Table

| Module | Function Count | Key Methods |
|---|---|---|
| 3.1 Lifecycle & Emergency | 19 | `init`, `emergency_pause_all`, `emergency_withdraw`, `propose_upgrade`, `transfer_ownership` |
| 3.2 Direct Payments | 5 | `record_payment`, `get_payment`, `cancel_payment`, `get_payments_range` |
| 3.3 Batch Payments | 4 | `create_batch`, `get_batch`, `get_payments_by_batch` |
| 3.4 Escrows & Arbiter | 6 | `create_escrow`, `release_escrow`, `release_by_arbiter`, `claim_escrow` |
| 3.5 Payment Streams | 5 | `create_stream`, `claim_stream`, `cancel_stream`, `get_stream` |
| 3.6 Recurring Payments | 5 | `create_recurring`, `execute_recurring`, `cancel_recurring` |
| 3.7 Multisig Approvals | 7 | `set_multisig_config`, `propose_payment`, `approve_payment`, `execute_approved_payment` |
| 3.8 Fee Management | 7 | `set_fee_config`, `get_fee_config_history`, `calculate_fee`, `set_fee_collector` |
| 3.9 Spending Limits | 5 | `set_spending_limit`, `check_spending`, `atomic_spend`, `configure_escalation` |
| 3.10 RBAC Access Control | 4 | `grant_role`, `revoke_role`, `get_role`, `require_role` |
| 3.11 Timelocked Actions | 5 | `propose_timelocked_action`, `execute_timelocked_action`, `cancel_timelocked_action` |
| 3.12 DAO Governance | 7 | `configure_governance`, `create_proposal`, `vote_on_proposal`, `execute_proposal` |
| 3.13 Refund Management | 7 | `request_refund`, `approve_refund`, `reject_refund`, `process_refund`, `get_reason_code_analytics` |
| 3.14 Notification Hooks | 5 | `register_hook`, `unregister_hook`, `get_hooks_by_event`, `get_subscriber_hooks` |
| 3.15 Audit Trail | 3 | `get_audit_log_count`, `get_audit_entry`, `get_audit_log_range` |

---

### 3.1 Core Lifecycle, Admin & Emergency Controls

#### `init(env: Env, owner: Address) -> Result<u32, PaymentError>`
- **Description**: Initializes contract state, sets the contract owner, establishes baseline version `2`, initializes statistic counters, and extends storage TTL.
- **Access Control**: Public on initial deployment; cannot be re-invoked.
- **Errors**: `PaymentError::AlreadyInitialized` (2) if the contract has already been initialized.

#### `get_owner(env: Env) -> Result<Address, PaymentError>`
- **Description**: Queries the primary contract owner address.
- **Access Control**: Public Read.
- **Errors**: `PaymentError::NotInitialized` (1) if contract has not been initialized.

#### `get_version(env: Env) -> u32`
- **Description**: Returns the contract semantic version integer (currently `2`).
- **Access Control**: Public Read.
- **Errors**: None.

#### `get_stats(env: Env) -> ContractStats`
- **Description**: Returns an aggregate summary struct of all contract statistics (payments, escrows, streams, batches, and amounts).
- **Access Control**: Public Read.
- **Errors**: None.

#### `set_emitter(env: Env, caller: Address, emitter: Address) -> Result<(), PaymentError>`
- **Description**: Configures the cross-contract `PaymentEventEmitter` contract address used for atomic circuit breaking and payment notifications.
- **Access Control**: Contract Owner (`caller.require_auth()`).
- **Errors**: `PaymentError::Unauthorized` (4) if caller is not the owner; `PaymentError::NotInitialized` (1).

#### `get_emitter(env: Env) -> Option<Address>`
- **Description**: Retrieves the configured address of the `PaymentEventEmitter` contract.
- **Access Control**: Public Read.
- **Errors**: None.

#### `emergency_pause_all(env: Env, caller: Address) -> Result<(), PaymentError>`
- **Description**: Activates the emergency circuit breaker across both contracts (`PAUSED = true`), halting all state-mutating operations on `OphirPayContract` and cross-contract invoking `pause()` on `PaymentEventEmitter`.
- **Access Control**: Contract Owner (`caller.require_auth()`).
- **Errors**: `PaymentError::Unauthorized` (4), `PaymentError::NotInitialized` (1).

#### `emergency_unpause_all(env: Env, caller: Address) -> Result<(), PaymentError>`
- **Description**: Resumes normal operations by clearing the pause flag (`PAUSED = false`) on both `OphirPayContract` and cross-contract invoking `unpause()` on `PaymentEventEmitter`.
- **Access Control**: Contract Owner (`caller.require_auth()`).
- **Errors**: `PaymentError::Unauthorized` (4), `PaymentError::NotInitialized` (1).

#### `is_paused(env: Env) -> bool`
- **Description**: Returns boolean status indicating whether the contract circuit breaker is currently active.
- **Access Control**: Public Read.
- **Errors**: None.

#### `get_locked_balance(env: Env) -> i128`
- **Description**: Queries the total volume of user tokens currently locked inside active escrows, vesting streams, and governance deposits.
- **Access Control**: Public Read.
- **Errors**: None.

#### `is_reentrancy_locked(env: Env) -> bool`
- **Description**: Returns boolean status indicating if the internal reentrancy mutex is currently held.
- **Access Control**: Public Read.
- **Errors**: None.

#### `emergency_withdraw(env: Env, caller: Address, asset: Address, amount: i128) -> Result<(), PaymentError>`
- **Description**: Allows the contract owner to withdraw unlocked/surplus tokens while strictly enforcing the locked funds invariant: $\text{amount} \le \text{balance} - \text{LOCKED\_BALANCE}$.
- **Access Control**: Contract Owner (`caller.require_auth()`).
- **Errors**: `PaymentError::Unauthorized` (4), `PaymentError::NotInitialized` (1), `PaymentError::InvalidAmount` (5), `PaymentError::NoTokensToWithdraw` (19) if attempted withdrawal exceeds unlocked balance.

#### `propose_upgrade(env: Env, caller: Address, new_wasm_hash: soroban_sdk::BytesN<32>) -> Result<(), PaymentError>`
- **Description**: Proposes a new contract WASM bytecode hash and initiates a mandatory 24-hour (86,400 ledger seconds) timelock.
- **Access Control**: Contract Owner (`caller.require_auth()`).
- **Errors**: `PaymentError::Unauthorized` (4), `PaymentError::NotInitialized` (1).

#### `execute_upgrade(env: Env) -> Result<(), PaymentError>`
- **Description**: Deploys the pending WASM bytecode hash via `env.deployer().update_current_contract_wasm` once the 24-hour timelock has elapsed.
- **Access Control**: Anyone (permissionless execution after timelock expiry).
- **Errors**: `PaymentError::UpgradeNotProposed` (20), `PaymentError::UpgradeTimelockActive` (21).

#### `cancel_upgrade(env: Env, caller: Address) -> Result<(), PaymentError>`
- **Description**: Cancels a pending WASM upgrade and clears the timelock.
- **Access Control**: Contract Owner (`caller.require_auth()`).
- **Errors**: `PaymentError::Unauthorized` (4), `PaymentError::NotInitialized` (1).

#### `transfer_ownership(env: Env, caller: Address, new_owner: Address) -> Result<(), PaymentError>`
- **Description**: Proposes an ownership transfer to `new_owner` and records the proposal timestamp.
- **Access Control**: Contract Owner (`caller.require_auth()`).
- **Errors**: `PaymentError::Unauthorized` (4), `PaymentError::NotInitialized` (1).

#### `accept_ownership(env: Env, caller: Address) -> Result<(), PaymentError>`
- **Description**: Completes the two-step ownership rotation after the 24-hour timelock has elapsed.
- **Access Control**: Proposed New Owner (`caller.require_auth()`).
- **Errors**: `PaymentError::UpgradeNotProposed` (20) if no transfer pending, `PaymentError::Unauthorized` (4) if caller is not the pending owner, `PaymentError::UpgradeTimelockActive` (21) if 24 hours have not elapsed.

#### `cancel_ownership_transfer(env: Env, caller: Address) -> Result<(), PaymentError>`
- **Description**: Cancels an active pending ownership transfer.
- **Access Control**: Contract Owner (`caller.require_auth()`).
- **Errors**: `PaymentError::Unauthorized` (4), `PaymentError::NotInitialized` (1).

#### `get_pending_owner(env: Env) -> Option<(Address, u64)>`
- **Description**: Returns the pending owner address and proposal timestamp (if any).
- **Access Control**: Public Read.
- **Errors**: None.

---

### 3.2 Direct Payments & Settlements

#### `record_payment(env: Env, payer: Address, payee: Address, amount: i128, asset: Address, tx_hash: String, metadata: String) -> Result<u64, PaymentError>`
- **Description**: Records a confirmed payment, collects platform fees if configured, persists the `Payment` struct, logs an audit trail record, increments payment counters, and publishes the native Soroban `("payment", payer, payee)` event.
- **Access Control**: Payer (`payer.require_auth()`). Guarded by `require_not_paused` and `reentrancy_guard`.
- **Arguments**:
  - `payer`: Originating payer address.
  - `payee`: Destination recipient address.
  - `amount`: Payment amount ($> 0$).
  - `asset`: SAC token contract address.
  - `tx_hash`: Stellar ledger transaction hash string.
  - `metadata`: Arbitrary context/memo string (e.g. invoice ID).
- **Returns**: `Ok(payment_id: u64)`
- **Errors**: `PaymentError::ContractPaused` (18), `PaymentError::InvalidAmount` (5) if $\le 0$, `PaymentError::ReentrantCall` (52).

#### `get_payment(env: Env, payment_id: u64) -> Result<Payment, PaymentError>`
- **Description**: Retrieves a recorded `Payment` record by its unique ID.
- **Access Control**: Public Read.
- **Errors**: `PaymentError::PaymentNotFound` (3).

#### `get_payment_count(env: Env) -> u64`
- **Description**: Returns the total number of payments recorded.
- **Access Control**: Public Read.
- **Errors**: None.

#### `get_payments_range(env: Env, start_id: u64, end_id: u64) -> Vec<Payment>`
- **Description**: Returns an array of payment records within the inclusive range `[start_id, end_id]`.
- **Access Control**: Public Read.
- **Errors**: None.

#### `cancel_payment(env: Env, caller: Address, payment_id: u64) -> Result<(), PaymentError>`
- **Description**: Marks an existing payment record as cancelled (`cancelled = true`).
- **Access Control**: Contract Owner or Payer (`caller.require_auth()`).
- **Errors**: `PaymentError::PaymentNotFound` (3), `PaymentError::Unauthorized` (4), `PaymentError::PaymentAlreadyCancelled` (17).

---

### 3.3 Batch Payments

#### `create_batch(env: Env, creator: Address, payees: Vec<Address>, amounts: Vec<i128>, asset: Address, tx_hash: String) -> Result<BatchCreateResult, PaymentError>`
- **Description**: Processes multi-recipient batch payments atomically. Validates matching vector lengths, deduplicates recipients, collects batch fees, transfers tokens to payees, records child `Payment` entries, and creates a `BatchPayment` index.
- **Access Control**: Creator (`creator.require_auth()`). Guarded by `require_not_paused` and `reentrancy_guard`.
- **Arguments**:
  - `creator`: Funding address.
  - `payees`: List of recipient addresses (max 100).
  - `amounts`: List of corresponding amounts ($> 0$).
  - `asset`: SAC token contract address.
  - `tx_hash`: Transaction hash string.
- **Returns**: `Ok(BatchCreateResult { batch_id, total_requests, successful, failed, total_amount })`
- **Errors**: `PaymentError::ContractPaused` (18), `PaymentError::BatchEmpty` (14), `PaymentError::BatchTooLarge` (13), `PaymentError::InvalidAmount` (5), `PaymentError::ReentrantCall` (52).

#### `get_batch(env: Env, batch_id: u64) -> Result<BatchPayment, PaymentError>`
- **Description**: Retrieves `BatchPayment` metadata and child payment ID list.
- **Access Control**: Public Read.
- **Errors**: `PaymentError::PaymentNotFound` (3) if batch does not exist.

#### `get_batch_count(env: Env) -> u64`
- **Description**: Returns total count of batch operations created.
- **Access Control**: Public Read.
- **Errors**: None.

#### `get_payments_by_batch(env: Env, batch_id: u64) -> Vec<Payment>`
- **Description**: Retrieves all child `Payment` records belonging to a batch.
- **Access Control**: Public Read.
- **Errors**: None.

---

### 3.4 Escrows & Dispute Resolution

#### `create_escrow(env: Env, depositor: Address, beneficiary: Address, arbiter: Option<Address>, amount: i128, asset: Address, deadline: u64, metadata: String) -> Result<u64, PaymentError>`
- **Description**: Locks `amount` tokens into contract custody with an optional third-party `arbiter` and a ledger timestamp `deadline`. Increases `LOCKED_BALANCE`.
- **Access Control**: Depositor (`depositor.require_auth()`). Guarded by `require_not_paused` and `reentrancy_guard`.
- **Returns**: `Ok(escrow_id: u64)`
- **Errors**: `PaymentError::ContractPaused` (18), `PaymentError::InvalidAmount` (5), `PaymentError::ReentrantCall` (52).

#### `release_escrow(env: Env, owner: Address, escrow_id: u64) -> Result<(), PaymentError>`
- **Description**: Releases locked escrow funds to the `beneficiary`. Can be executed by the depositor, contract owner, or designated arbiter. Decrements `LOCKED_BALANCE`.
- **Access Control**: Depositor, Contract Owner, or Arbiter (`owner.require_auth()`).
- **Errors**: `PaymentError::ContractPaused` (18), `PaymentError::EscrowNotFound` (8), `PaymentError::Unauthorized` (4), `PaymentError::EscrowAlreadyReleased` (7).

#### `release_by_arbiter(env: Env, arbiter: Address, escrow_id: u64, release_to_beneficiary: bool) -> Result<(), PaymentError>`
- **Description**: Allows the designated third-party arbiter to resolve an escrow dispute, sending funds either to the beneficiary (`true`) or returning funds to the depositor (`false`).
- **Access Control**: Designated Arbiter (`arbiter.require_auth()`).
- **Errors**: `PaymentError::EscrowNotFound` (8), `PaymentError::Unauthorized` (4) if caller is not the assigned arbiter, `PaymentError::EscrowAlreadyReleased` (7).

#### `claim_escrow(env: Env, beneficiary: Address, escrow_id: u64) -> Result<(), PaymentError>`
- **Description**: Allows the beneficiary to claim escrow funds after the `deadline` has elapsed (`now >= deadline`).
- **Access Control**: Beneficiary (`beneficiary.require_auth()`).
- **Errors**: `PaymentError::EscrowNotFound` (8), `PaymentError::Unauthorized` (4), `PaymentError::EscrowNotDue` (6), `PaymentError::EscrowAlreadyReleased` (7).

#### `get_escrow(env: Env, escrow_id: u64) -> Result<Escrow, PaymentError>`
- **Description**: Fetches an escrow record by ID.
- **Access Control**: Public Read.
- **Errors**: `PaymentError::EscrowNotFound` (8).

#### `get_escrow_count(env: Env) -> u64`
- **Description**: Returns total count of escrows created.
- **Access Control**: Public Read.
- **Errors**: None.

---

### 3.5 Payment Streams & Vesting

#### `create_stream(env: Env, creator: Address, recipient: Address, total_amount: i128, asset: Address, start_time: u64, end_time: u64, metadata: String) -> Result<u64, PaymentError>`
- **Description**: Initializes a linear token vesting stream from `creator` to `recipient` between `start_time` and `end_time`. Locks funds and increases `LOCKED_BALANCE`.
- **Access Control**: Creator (`creator.require_auth()`). Guarded by `require_not_paused` and `reentrancy_guard`.
- **Returns**: `Ok(stream_id: u64)`
- **Errors**: `PaymentError::InvalidAmount` (5), `PaymentError::StreamEndBeforeStart` (69) if `end_time <= start_time`.

#### `claim_stream(env: Env, recipient: Address, stream_id: u64) -> Result<i128, PaymentError>`
- **Description**: Calculates vested amount linearly according to elapsed ledger time:
  $$\text{vested} = \min\left(\text{total}, \frac{\text{now} - \text{start}}{\text{end} - \text{start}} \times \text{total}\right)$$
  Transfers uncollected vested tokens to `recipient` and decrements `LOCKED_BALANCE`.
- **Access Control**: Recipient (`recipient.require_auth()`).
- **Returns**: `Ok(claimed_amount: i128)`
- **Errors**: `PaymentError::StreamNotFound` (11), `PaymentError::Unauthorized` (4), `PaymentError::StreamNotStarted` (9), `PaymentError::StreamFullyClaimed` (12).

#### `cancel_stream(env: Env, creator: Address, stream_id: u64) -> Result<i128, PaymentError>`
- **Description**: Cancels an active stream, immediately transferring any accrued vested tokens to the recipient and refunding remaining unvested tokens to the creator. Decrements `LOCKED_BALANCE`.
- **Access Control**: Creator or Contract Owner (`creator.require_auth()`).
- **Returns**: `Ok(unvested_refunded_amount: i128)`
- **Errors**: `PaymentError::StreamNotFound` (11), `PaymentError::Unauthorized` (4), `PaymentError::StreamAlreadyCancelled` (10).

#### `get_stream(env: Env, stream_id: u64) -> Result<Stream, PaymentError>`
- **Description**: Retrieves a stream by ID.
- **Access Control**: Public Read.
- **Errors**: `PaymentError::StreamNotFound` (11).

#### `get_stream_count(env: Env) -> u64`
- **Description**: Returns total count of streams created.
- **Access Control**: Public Read.
- **Errors**: None.

---

### 3.6 Recurring Payments & Schedules

#### `create_recurring(env: Env, creator: Address, payee: Address, amount: i128, asset: Address, schedule: ScheduleType, remaining: u32, metadata: String) -> Result<u64, PaymentError>`
- **Description**: Establishes a recurring payment schedule (`Daily`, `Weekly`, or `Monthly`) executed periodically.
- **Access Control**: Creator (`creator.require_auth()`).
- **Returns**: `Ok(recurring_id: u64)`
- **Errors**: `PaymentError::InvalidAmount` (5).

#### `execute_recurring(env: Env, caller: Address, recurring_id: u64) -> Result<u64, PaymentError>`
- **Description**: Triggers an execution cycle for a recurring payment once `now >= next_execution`. Transfers tokens from creator to payee, updates schedule interval, decrements `remaining`, and records a payment ID.
- **Access Control**: Anyone (`caller.require_auth()`).
- **Returns**: `Ok(payment_id: u64)`
- **Errors**: `PaymentError::RecurringNotFound` (30), `PaymentError::RecurringAlreadyCancelled` (32), `PaymentError::RecurringNotDue` (31), `PaymentError::RecurringExpired` (33).

#### `cancel_recurring(env: Env, caller: Address, recurring_id: u64) -> Result<(), PaymentError>`
- **Description**: Deactivates a recurring payment schedule (`active = false`).
- **Access Control**: Creator or Contract Owner (`caller.require_auth()`).
- **Errors**: `PaymentError::RecurringNotFound` (30), `PaymentError::Unauthorized` (4), `PaymentError::RecurringAlreadyCancelled` (32).

#### `get_recurring(env: Env, recurring_id: u64) -> Result<RecurringPayment, PaymentError>`
- **Description**: Retrieves a recurring payment record by ID.
- **Access Control**: Public Read.
- **Errors**: `PaymentError::RecurringNotFound` (30).

#### `get_recurring_count(env: Env) -> u64`
- **Description**: Returns total count of recurring payments registered.
- **Access Control**: Public Read.
- **Errors**: None.

---

### 3.7 Multisig Approvals & Versioning

#### `set_multisig_config(env: Env, caller: Address, threshold: u32, signers: Vec<Address>, enabled: bool) -> Result<(), PaymentError>`
- **Description**: Configures M-of-N multisig policy for high-value operations and saves an immutable `MultisigVersion` record.
- **Access Control**: Contract Owner (`caller.require_auth()`).
- **Errors**: `PaymentError::Unauthorized` (4), `PaymentError::InvalidAmount` (5) if `threshold == 0` or `threshold > signers.len()`.

#### `get_multisig_config(env: Env) -> Option<MultisigConfig>`
- **Description**: Retrieves current multisig configuration.
- **Access Control**: Public Read.
- **Errors**: None.

#### `get_multisig_config_history(env: Env) -> Vec<MultisigVersion>`
- **Description**: Returns historical multisig versions (capped at latest 100 entries).
- **Access Control**: Public Read.
- **Errors**: None.

#### `propose_payment(env: Env, proposer: Address, payee: Address, amount: i128, asset: Address, tx_hash: String) -> Result<u64, PaymentError>`
- **Description**: Creates a new multisig approval request requiring threshold signers.
- **Access Control**: Authorized Signer (`proposer.require_auth()`).
- **Returns**: `Ok(request_id: u64)`
- **Errors**: `PaymentError::MultisigNotConfigured` (22), `PaymentError::NotASigner` (23), `PaymentError::InvalidAmount` (5).

#### `approve_payment(env: Env, signer: Address, request_id: u64) -> Result<bool, PaymentError>`
- **Description**: Adds signer's approval to a proposal. Returns `true` if threshold is met.
- **Access Control**: Authorized Signer (`signer.require_auth()`).
- **Errors**: `PaymentError::MultisigNotConfigured` (22), `PaymentError::NotASigner` (23), `PaymentError::PaymentNotFound` (3), `PaymentError::AlreadyApproved` (24), `PaymentError::AlreadyExecuted` (26).

#### `execute_approved_payment(env: Env, caller: Address, request_id: u64) -> Result<u64, PaymentError>`
- **Description**: Executes a payment request that has gathered >= threshold approvals.
- **Access Control**: Authorized Signer (`caller.require_auth()`).
- **Returns**: `Ok(payment_id: u64)`
- **Errors**: `PaymentError::PaymentNotFound` (3), `PaymentError::ThresholdNotMet` (25), `PaymentError::AlreadyExecuted` (26).

#### `get_approval_request(env: Env, request_id: u64) -> Option<ApprovalRequest>`
- **Description**: Fetches multisig approval request by ID.
- **Access Control**: Public Read.
- **Errors**: None.

---

### 3.8 Fee Management & Calculations

#### `set_fee_config(env: Env, caller: Address, payment_fee_bps: u32, escrow_fee_bps: u32, stream_fee_bps: u32, batch_base_fee: i128, batch_per_item_fee: i128, enabled: bool) -> Result<(), PaymentError>`
- **Description**: Sets per-operation fee basis points (max 1,000 bps / 10%) and archives previous config as a `FeeConfigVersion`.
- **Access Control**: Contract Owner (`caller.require_auth()`).
- **Errors**: `PaymentError::Unauthorized` (4), `PaymentError::FeeTooHigh` (35) if any bps > 1000.

#### `get_fee_config(env: Env) -> Option<FeeConfig>`
- **Description**: Returns active fee configuration.
- **Access Control**: Public Read.
- **Errors**: None.

#### `get_fee_config_history(env: Env) -> Vec<FeeConfigVersion>`
- **Description**: Returns history of fee configuration versions (capped at latest 100).
- **Access Control**: Public Read.
- **Errors**: None.

#### `get_fee_config_at_version(env: Env, version: u32) -> Option<FeeConfigVersion>`
- **Description**: Fetches fee configuration snapshot for a specific version number.
- **Access Control**: Public Read.
- **Errors**: None.

#### `set_fee_collector(env: Env, caller: Address, collector: Address) -> Result<(), PaymentError>`
- **Description**: Designates recipient address for platform fees.
- **Access Control**: Contract Owner (`caller.require_auth()`).
- **Errors**: `PaymentError::Unauthorized` (4).

#### `get_fee_collector(env: Env) -> Option<Address>`
- **Description**: Returns active fee collector address.
- **Access Control**: Public Read.
- **Errors**: None.

#### `calculate_fee(amount: i128, fee_bps: u32) -> i128`
- **Description**: Pure arithmetic utility calculating fee: floor((amount * fee_bps) / 10000).
- **Access Control**: Pure function (no state or auth).
- **Errors**: None.

---

### 3.9 Spending Limits, Escalation & Atomic Spend

#### `set_spending_limit(env: Env, caller: Address, user: Address, daily_limit: i128, monthly_limit: i128, expires_at: u64, is_active: bool) -> Result<(), PaymentError>`
- **Description**: Configures daily/monthly spend limits with optional expiration timestamp for a user.
- **Access Control**: Contract Owner or Admin Role (`caller.require_auth()`).
- **Errors**: `PaymentError::Unauthorized` (4).

#### `get_spending_limit(env: Env, user: Address) -> Option<SpendingLimit>`
- **Description**: Fetches spending limit and current period utilization for a user.
- **Access Control**: Public Read.
- **Errors**: None.

#### `configure_escalation(env: Env, caller: Address, small_threshold: i128, medium_threshold: i128, enabled: bool) -> Result<(), PaymentError>`
- **Description**: Sets thresholds for automatic approval vs admin escalation.
- **Access Control**: Contract Owner (`caller.require_auth()`).
- **Errors**: `PaymentError::Unauthorized` (4), `PaymentError::InvalidAmount` (5) if `small_threshold >= medium_threshold`.

#### `check_spending(env: Env, user: Address, amount: i128) -> SpendCheckResult`
- **Description**: Simulates whether a spend of `amount` is `Approved`, `Escalated`, or `Rejected`.
- **Access Control**: Public Read.
- **Errors**: None.

#### `atomic_spend(env: Env, payer: Address, payee: Address, amount: i128, asset: Address, tx_hash: String, metadata: String) -> Result<u64, PaymentError>`
- **Description**: Verifies spend limit, auto-resets day/month counters if epoch elapsed, updates spent amounts, and executes payment atomically.
- **Access Control**: Payer (`payer.require_auth()`). Guarded by `require_not_paused` and `reentrancy_guard`.
- **Returns**: `Ok(payment_id: u64)`
- **Errors**: `PaymentError::SpendingLimitExpired` (46), `PaymentError::SpendCapExceeded` (53), `PaymentError::InvalidAmount` (5).

---

### 3.10 Role-Based Access Control (RBAC)

#### `grant_role(env: Env, caller: Address, grantee: Address, role: Role) -> Result<(), PaymentError>`
- **Description**: Assigns `Admin`, `Operator`, or `Auditor` role to `grantee`.
- **Access Control**: Contract Owner (`caller.require_auth()`).
- **Errors**: `PaymentError::Unauthorized` (4).

#### `revoke_role(env: Env, caller: Address, grantee: Address) -> Result<(), PaymentError>`
- **Description**: Removes assigned role from `grantee`.
- **Access Control**: Contract Owner (`caller.require_auth()`).
- **Errors**: `PaymentError::Unauthorized` (4).

#### `get_role(env: Env, addr: Address) -> Option<Role>`
- **Description**: Retrieves assigned role for address.
- **Access Control**: Public Read.
- **Errors**: None.

#### `require_role(env: &Env, caller: Address, required: Role) -> Result<(), PaymentError>`
- **Description**: Internal/public validation helper verifying caller holds `required` role or is Owner.
- **Access Control**: Caller validation.
- **Errors**: `PaymentError::NotARoleHolder` (27).

---

### 3.11 Timelocked Admin Actions

#### `propose_timelocked_action(env: Env, caller: Address, action_type: String, target: String, data: String) -> Result<u64, PaymentError>`
- **Description**: Schedules sensitive admin action with mandatory 24-hour execution timelock.
- **Access Control**: Contract Owner (`caller.require_auth()`).
- **Returns**: `Ok(action_id: u64)`
- **Errors**: `PaymentError::Unauthorized` (4).

#### `execute_timelocked_action(env: Env, action_id: u64) -> Result<(), PaymentError>`
- **Description**: Executes timelocked action once delay has passed (`now >= unlocks_at`).
- **Access Control**: Anyone (permissionless post-unlock).
- **Errors**: `PaymentError::TimelockNotFound` (36), `PaymentError::TimelockNotDue` (37), `PaymentError::TimelockAlreadyExecuted` (38).

#### `cancel_timelocked_action(env: Env, caller: Address, action_id: u64) -> Result<(), PaymentError>`
- **Description**: Cancels a pending timelocked action.
- **Access Control**: Contract Owner (`caller.require_auth()`).
- **Errors**: `PaymentError::Unauthorized` (4), `PaymentError::TimelockNotFound` (36), `PaymentError::TimelockAlreadyExecuted` (38).

#### `get_timelocked_action(env: Env, action_id: u64) -> Result<TimelockedAction, PaymentError>`
- **Description**: Queries timelocked action details.
- **Access Control**: Public Read.
- **Errors**: `PaymentError::TimelockNotFound` (36).

#### `get_timelock_count(env: Env) -> u64`
- **Description**: Returns total timelocked actions proposed.
- **Access Control**: Public Read.
- **Errors**: None.

---

### 3.12 DAO Governance Proposals & Voting

#### `configure_governance(env: Env, caller: Address, min_proposal_deposit: i128, voting_period: u64, quorum_bps: u32, enabled: bool) -> Result<(), PaymentError>`
- **Description**: Sets DAO governance parameters (deposit, voting duration, quorum basis points).
- **Access Control**: Contract Owner (`caller.require_auth()`).
- **Errors**: `PaymentError::Unauthorized` (4), `PaymentError::InvalidAmount` (5).

#### `get_governance_config(env: Env) -> Option<GovernanceConfig>`
- **Description**: Fetches governance parameters.
- **Access Control**: Public Read.
- **Errors**: None.

#### `create_proposal(env: Env, proposer: Address, title: String, description: String, action_type: String, target: String, data: String, deposit_asset: Address, deposit_amount: i128) -> Result<u64, PaymentError>`
- **Description**: Creates a proposal, locking `deposit_amount >= min_proposal_deposit` in contract escrow (`LOCKED_BALANCE`).
- **Access Control**: Proposer (`proposer.require_auth()`).
- **Returns**: `Ok(proposal_id: u64)`
- **Errors**: `PaymentError::GovernanceNotConfigured` (39), `PaymentError::DepositTooLow` (45).

#### `vote_on_proposal(env: Env, voter: Address, proposal_id: u64, support: bool) -> Result<(), PaymentError>`
- **Description**: Casts 1-address-1-vote on active proposal (`support = true` for YES, `false` for NO).
- **Access Control**: Voter (`voter.require_auth()`).
- **Errors**: `PaymentError::ProposalNotFound` (40), `PaymentError::VotingPeriodEnded` (41), `PaymentError::ProposalAlreadyExecuted` (42), `PaymentError::AlreadyVoted` (51).

#### `execute_proposal(env: Env, proposal_id: u64) -> Result<bool, PaymentError>`
- **Description**: Closes and executes a passed proposal after voting ends. Refunds deposit if passed; burns/forfeits if defeated. Decrements `LOCKED_BALANCE`.
- **Access Control**: Anyone after voting period.
- **Returns**: `Ok(passed: bool)`
- **Errors**: `PaymentError::ProposalNotFound` (40), `PaymentError::ProposalAlreadyExecuted` (42), `PaymentError::QuorumNotMet` (43), `PaymentError::ProposalDefeated` (44).

#### `get_proposal(env: Env, proposal_id: u64) -> Result<Proposal, PaymentError>`
- **Description**: Queries proposal details and vote tallies.
- **Access Control**: Public Read.
- **Errors**: `PaymentError::ProposalNotFound` (40).

#### `get_proposal_count(env: Env) -> u64`
- **Description**: Returns total governance proposals created.
- **Access Control**: Public Read.
- **Errors**: None.

---

### 3.13 Structured Refund Management & Analytics

#### `request_refund(env: Env, requester: Address, payment_id: u64, amount: i128, asset: Address, reason: String, reason_code: RefundReasonCode) -> Result<u64, PaymentError>`
- **Description**: Opens a structured refund request associated with a recorded payment and categorized reason code.
- **Access Control**: Payer (`requester.require_auth()`).
- **Returns**: `Ok(refund_id: u64)`
- **Errors**: `PaymentError::PaymentNotFound` (3), `PaymentError::Unauthorized` (4), `PaymentError::InvalidAmount` (5), `PaymentError::PaymentAlreadyRefunded` (49).

#### `approve_refund(env: Env, caller: Address, refund_id: u64) -> Result<(), PaymentError>`
- **Description**: Sets refund status to `Approved`.
- **Access Control**: Payee or Contract Owner (`caller.require_auth()`).
- **Errors**: `PaymentError::RefundNotFound` (47), `PaymentError::Unauthorized` (4), `PaymentError::RefundAlreadyProcessed` (48).

#### `reject_refund(env: Env, caller: Address, refund_id: u64) -> Result<(), PaymentError>`
- **Description**: Rejects a requested refund (`status = Rejected`).
- **Access Control**: Payee or Contract Owner (`caller.require_auth()`).
- **Errors**: `PaymentError::RefundNotFound` (47), `PaymentError::Unauthorized` (4), `PaymentError::RefundAlreadyProcessed` (48).

#### `process_refund(env: Env, caller: Address, refund_id: u64) -> Result<(), PaymentError>`
- **Description**: Transfers refund tokens from payee back to requester and marks `status = Processed`.
- **Access Control**: Payee, Requester, or Contract Owner (`caller.require_auth()`).
- **Errors**: `PaymentError::RefundNotFound` (47), `PaymentError::RefundRejected` (57), `PaymentError::RefundAlreadyProcessed` (48).

#### `get_refund(env: Env, refund_id: u64) -> Result<Refund, PaymentError>`
- **Description**: Fetches refund struct by ID.
- **Access Control**: Public Read.
- **Errors**: `PaymentError::RefundNotFound` (47).

#### `get_refund_count(env: Env) -> u64`
- **Description**: Returns total refunds created.
- **Access Control**: Public Read.
- **Errors**: None.

#### `get_reason_code_analytics(env: Env) -> Vec<(u32, u64)>`
- **Description**: Aggregates refund frequencies by `RefundReasonCode` variant integer for merchant analytics.
- **Access Control**: Public Read.
- **Errors**: None.

---

### 3.14 Notification Hooks & Webhooks

#### `register_hook(env: Env, subscriber: Address, event_type: String, webhook_url: String) -> Result<u64, PaymentError>`
- **Description**: Registers an on-chain webhook URL to receive off-chain notifications for events (`payment_recorded`, `refund_processed`, `escrow_created`).
- **Access Control**: Subscriber (`subscriber.require_auth()`).
- **Returns**: `Ok(hook_id: u64)`
- **Errors**: `PaymentError::InvalidAmount` (5) if URL empty.

#### `unregister_hook(env: Env, caller: Address, hook_id: u64) -> Result<(), PaymentError>`
- **Description**: Deactivates a notification hook.
- **Access Control**: Subscriber or Owner (`caller.require_auth()`).
- **Errors**: `PaymentError::AuditEntryNotFound` (29) / HookNotFound, `PaymentError::Unauthorized` (4).

#### `get_hooks_by_event(env: Env, event_type: String) -> Vec<(u64, String)>`
- **Description**: Returns all active webhook URLs subscribed to `event_type` for off-chain relayers.
- **Access Control**: Public Read.
- **Errors**: None.

#### `get_subscriber_hooks(env: Env, subscriber: Address) -> Vec<NotificationHook>`
- **Description**: Queries all hooks owned by subscriber address.
- **Access Control**: Public Read.
- **Errors**: None.

#### `get_hook_count(env: Env) -> u64`
- **Description**: Total registered notification hooks.
- **Access Control**: Public Read.
- **Errors**: None.

---

### 3.15 On-Chain Audit Trail

#### `get_audit_log_count(env: Env) -> u64`
- **Description**: Returns total immutable audit log entries recorded.
- **Access Control**: Public Read.
- **Errors**: None.

#### `get_audit_entry(env: Env, entry_id: u64) -> Result<AuditEntry, PaymentError>`
- **Description**: Retrieves audit record containing timestamp, action name, actor, target ID, and details.
- **Access Control**: Public Read.
- **Errors**: `PaymentError::AuditEntryNotFound` (29).

#### `get_audit_log_range(env: Env, start_id: u64, end_id: u64) -> Vec<AuditEntry>`
- **Description**: Fetches contiguous block of audit entries.
- **Access Control**: Public Read.
- **Errors**: None.

---

## 4. PaymentEventEmitter Function Reference

### 4.1 Lifecycle & Configuration

#### `init(env: Env, owner: Address) -> Result<u32, EmitterError>`
- **Description**: Initializes event emitter storage and sets owner.
- **Access Control**: Owner (`owner.require_auth()`). Can only be run once.
- **Errors**: `EmitterError::AlreadyInitialized` (2).

#### `get_owner(env: Env) -> Result<Address, EmitterError>`
- **Description**: Returns emitter contract owner address.
- **Access Control**: Public Read.
- **Errors**: `EmitterError::NotInitialized` (1).

#### `set_allowed_source(env: Env, caller: Address, source: Option<Address>) -> Result<(), EmitterError>`
- **Description**: Configures allow-listed source contract (e.g. `OphirPayContract`). When set, only this address or owner may emit events (MEDIUM-3 audit protection against fabricated events).
- **Access Control**: Emitter Owner (`caller.require_auth()`).
- **Errors**: `EmitterError::Unauthorized` (4), `EmitterError::NotInitialized` (1).

#### `get_allowed_source(env: Env) -> Option<Address>`
- **Description**: Queries configured allow-listed source address.
- **Access Control**: Public Read.
- **Errors**: None.

---

### 4.2 Event Emission & Queries

#### `emit_payment(env: Env, caller: Address, source: String, payer: Address, payee: Address, amount: i128, tx_hash: String) -> Result<u64, EmitterError>`
- **Description**: Stores a persistent `PaymentEvent` record queried by SSE stream and publishes native Soroban event `(payment_event, payer, payee) -> (amount, tx_hash)`.
- **Access Control**: Allow-listed source contract or Emitter Owner (`caller.require_auth()`).
- **Returns**: `Ok(event_id: u64)`
- **Errors**: `EmitterError::Unauthorized` (4), `EmitterError::ContractPaused` (7), `EmitterError::NotInitialized` (1).

#### `get_event(env: Env, event_id: u64) -> Result<PaymentEvent, EmitterError>`
- **Description**: Fetches emitted payment event by sequence ID.
- **Access Control**: Public Read.
- **Errors**: `EmitterError::EventNotFound` (3).

#### `get_event_count(env: Env) -> u64`
- **Description**: Returns total event count.
- **Access Control**: Public Read.
- **Errors**: None.

---

### 4.3 Emitter Circuit Breakers & Upgrades

#### `pause(env: Env, caller: Address) -> Result<(), EmitterError>` / `unpause(env: Env, caller: Address) -> Result<(), EmitterError>`
- **Description**: Freezes or unfreezes event emission. Called by orchestrator during `emergency_pause_all`.
- **Access Control**: Emitter Owner (`caller.require_auth()`).
- **Errors**: `EmitterError::Unauthorized` (4), `EmitterError::NotInitialized` (1).

#### `is_paused(env: Env) -> bool`
- **Description**: Checks if emitter is paused.
- **Access Control**: Public Read.
- **Errors**: None.

#### `propose_upgrade(env: Env, caller: Address, new_wasm_hash: soroban_sdk::BytesN<32>) -> Result<(), EmitterError>`
- **Description**: Proposes emitter WASM upgrade with 24h timelock.
- **Access Control**: Emitter Owner (`caller.require_auth()`).
- **Errors**: `EmitterError::Unauthorized` (4), `EmitterError::NotInitialized` (1).

#### `execute_upgrade(env: Env) -> Result<(), EmitterError>`
- **Description**: Executes upgrade after 24 hours.
- **Access Control**: Permissionless after timelock.
- **Errors**: `EmitterError::UpgradeNotProposed` (5), `EmitterError::UpgradeTimelockActive` (6).

#### `cancel_upgrade(env: Env, caller: Address) -> Result<(), EmitterError>`
- **Description**: Cancels pending emitter upgrade.
- **Access Control**: Emitter Owner (`caller.require_auth()`).
- **Errors**: `EmitterError::Unauthorized` (4).

#### `transfer_ownership(env: Env, caller: Address, new_owner: Address) -> Result<(), EmitterError>` / `accept_ownership(env: Env, caller: Address) -> Result<(), EmitterError>`
- **Description**: Two-step 24-hour timelocked ownership transfer.
- **Access Control**: Current Owner (propose) / Proposed Owner (accept).
- **Errors**: `EmitterError::Unauthorized` (4), `EmitterError::UpgradeTimelockActive` (6).

---

## 5. Complete Error Code Reference

### 5.1 PaymentError (Codes 1–300)

| Code | Variant Name | Category | Operational Meaning & Trigger Precondition |
|---|---|---|---|
| `1` | `NotInitialized` | Core Protocol | Contract has not been initialized yet (`init()` required). |
| `2` | `AlreadyInitialized` | Core Protocol | Contract already initialized; reinitialization forbidden (INV-1). |
| `3` | `PaymentNotFound` | Core Protocol | Specified payment ID was not found in persistent storage. |
| `4` | `Unauthorized` | Core Protocol | Caller lacks required authorization or ownership credentials. |
| `5` | `InvalidAmount` | Core Protocol | Amount parameter is invalid (e.g. <= 0, zero fee calculation, or invalid bounds). |
| `6` | `EscrowNotDue` | Core Protocol | Escrow cannot be claimed by beneficiary before deadline timestamp. |
| `7` | `EscrowAlreadyReleased` | Core Protocol | Escrow funds have already been released or claimed (INV-4 single release). |
| `8` | `EscrowNotFound` | Core Protocol | Specified escrow ID not found. |
| `9` | `StreamNotStarted` | Core Protocol | Stream start timestamp is in the future; vesting has not begun. |
| `10` | `StreamAlreadyCancelled` | Core Protocol | Stream has already been cancelled. |
| `11` | `StreamNotFound` | Streams & Batches | Specified stream ID not found. |
| `12` | `StreamFullyClaimed` | Streams & Batches | Stream has zero unvested claimable balance remaining. |
| `13` | `BatchTooLarge` | Streams & Batches | Batch recipients count exceeds maximum allowed limit (100). |
| `14` | `BatchEmpty` | Streams & Batches | Batch recipients list is empty. |
| `15` | `TokenTransferFailed` | Streams & Batches | Underlying SAC token transfer invocation failed. |
| `16` | `InsufficientBalance` | Streams & Batches | Payer or contract has insufficient token balance for operation. |
| `17` | `PaymentAlreadyCancelled` | Streams & Batches | Payment record was already marked cancelled. |
| `18` | `ContractPaused` | Streams & Batches | Contract is in emergency paused state; write operations rejected (INV-7). |
| `19` | `NoTokensToWithdraw` | Streams & Batches | Attempted emergency withdrawal exceeds unlocked balance (INV-3 locked funds protection). |
| `20` | `UpgradeNotProposed` | Streams & Batches | WASM upgrade has not been proposed. |
| `21` | `UpgradeTimelockActive` | Multisig & Upgrades | 24-hour timelock delay has not yet elapsed. |
| `22` | `MultisigNotConfigured` | Multisig & Upgrades | Multisig configuration is disabled or not configured. |
| `23` | `NotASigner` | Multisig & Upgrades | Caller is not in the configured multisig signers list. |
| `24` | `AlreadyApproved` | Multisig & Upgrades | Caller has already signed/approved this payment proposal. |
| `25` | `ThresholdNotMet` | Multisig & Upgrades | Approval threshold has not been reached. |
| `26` | `AlreadyExecuted` | Multisig & Upgrades | Approval request or action has already been executed. |
| `27` | `NotARoleHolder` | Multisig & Upgrades | Caller does not possess the required RBAC role (Admin/Operator/Auditor). |
| `28` | `AuditLogEmpty` | Multisig & Upgrades | Audit log contains no entries. |
| `29` | `AuditEntryNotFound` | Multisig & Upgrades | Specified audit log entry ID not found. |
| `30` | `RecurringNotFound` | Multisig & Upgrades | Specified recurring payment schedule ID not found. |
| `31` | `RecurringNotDue` | Recurring & Fees | Recurring payment is not due yet (`now < next_execution`). |
| `32` | `RecurringAlreadyCancelled` | Recurring & Fees | Recurring payment schedule has been cancelled. |
| `33` | `RecurringExpired` | Recurring & Fees | Recurring payment schedule has completed all configured iterations. |
| `34` | `FeeConfigNotFound` | Recurring & Fees | Fee configuration is not set. |
| `35` | `FeeTooHigh` | Recurring & Fees | Fee basis points exceed maximum allowed cap (1000 bps / 10%). |
| `36` | `TimelockNotFound` | Recurring & Fees | Specified timelocked action ID not found. |
| `37` | `TimelockNotDue` | Recurring & Fees | Timelocked action execution attempted before unlock timestamp. |
| `38` | `TimelockAlreadyExecuted` | Recurring & Fees | Timelocked action has already been executed. |
| `39` | `GovernanceNotConfigured` | Recurring & Fees | DAO governance configuration is disabled or missing. |
| `40` | `ProposalNotFound` | Recurring & Fees | Specified governance proposal ID not found. |
| `41` | `VotingPeriodEnded` | Governance & Limits | Voting period for proposal has ended. |
| `42` | `ProposalAlreadyExecuted` | Governance & Limits | Governance proposal has already been executed. |
| `43` | `QuorumNotMet` | Governance & Limits | Proposal failed to meet minimum voter quorum threshold. |
| `44` | `ProposalDefeated` | Governance & Limits | Proposal received majority NO votes or failed acceptance criteria. |
| `45` | `DepositTooLow` | Governance & Limits | Proposal deposit is below configured `min_proposal_deposit`. |
| `46` | `SpendingLimitExpired` | Governance & Limits | User spending limit configuration has expired. |
| `47` | `RefundNotFound` | Governance & Limits | Specified refund ID not found. |
| `48` | `RefundAlreadyProcessed` | Governance & Limits | Refund request has already been processed or finalized. |
| `49` | `PaymentAlreadyRefunded` | Governance & Limits | Payment has already had a refund request opened or processed. |
| `50` | `RefundWindowExpired` | Governance & Limits | Refund window has expired. |
| `51` | `AlreadyVoted` | Governance & Limits | Address has already voted on this governance proposal. |
| `52` | `ReentrantCall` | Governance & Limits | Reentrant call detected; operation rejected by reentrancy mutex. |
| `53` | `SpendCapExceeded` | Disputes & Liquidity | Transaction amount exceeds daily or monthly user spending cap. |
| `54` | `DisputeAlreadyFiled` | Disputes & Liquidity | Dispute already active for target payment or escrow. |
| `55` | `DisputeNotFound` | Disputes & Liquidity | Dispute record not found. |
| `56` | `DisputeWindowExpired` | Disputes & Liquidity | Dispute filing window has elapsed. |
| `57` | `RefundRejected` | Disputes & Liquidity | Refund request was rejected and cannot be processed. |
| `58` | `InsufficientLiquidity` | Disputes & Liquidity | Insufficient liquidity available for automated routing. |
| `59` | `AssetDepegged` | Disputes & Liquidity | Asset depegged beyond allowable price oracle tolerance band. |
| `60` | `ProposalNotPassed` | Extended Protocols | Guards against proposalnotpassed condition during extended protocols operations. |
| `61` | `InvalidSignature` | Extended Protocols | Guards against invalidsignature condition during extended protocols operations. |
| `62` | `HookNotFound` | Extended Protocols | Guards against hooknotfound condition during extended protocols operations. |
| `63` | `HookAlreadyExists` | Extended Protocols | Guards against hookalreadyexists condition during extended protocols operations. |
| `64` | `RateLimitExceeded` | Extended Protocols | Guards against ratelimitexceeded condition during extended protocols operations. |
| `65` | `AssetNotSupported` | Extended Protocols | Guards against assetnotsupported condition during extended protocols operations. |
| `66` | `InvalidMetadataLength` | Extended Protocols | Guards against invalidmetadatalength condition during extended protocols operations. |
| `67` | `MaxRecipientsExceeded` | Extended Protocols | Guards against maxrecipientsexceeded condition during extended protocols operations. |
| `68` | `DuplicateRecipient` | Extended Protocols | Guards against duplicaterecipient condition during extended protocols operations. |
| `69` | `StreamEndBeforeStart` | Extended Protocols | Guards against streamendbeforestart condition during extended protocols operations. |
| `70` | `EscrowDeadlineInPast` | Extended Protocols | Guards against escrowdeadlineinpast condition during extended protocols operations. |
| `71` | `PendingOwnershipTransfer` | Extended Protocols | Guards against pendingownershiptransfer condition during extended protocols operations. |
| `72` | `OwnershipTransferExpired` | Extended Protocols | Guards against ownershiptransferexpired condition during extended protocols operations. |
| `73` | `InvalidAddressFormat` | Extended Protocols | Guards against invalidaddressformat condition during extended protocols operations. |
| `74` | `BatchItemFailed` | Extended Protocols | Guards against batchitemfailed condition during extended protocols operations. |
| `75` | `RecurringScheduleInvalid` | Extended Protocols | Guards against recurringscheduleinvalid condition during extended protocols operations. |
| `76` | `FeeCollectorNotSet` | Extended Protocols | Guards against feecollectornotset condition during extended protocols operations. |
| `77` | `EmitterNotLinked` | Extended Protocols | Guards against emitternotlinked condition during extended protocols operations. |
| `78` | `ProposalDepositLocked` | Extended Protocols | Guards against proposaldepositlocked condition during extended protocols operations. |
| `79` | `MultisigSignerLimit` | Extended Protocols | Guards against multisigsignerlimit condition during extended protocols operations. |
| `80` | `InvalidTokenContract` | Extended Protocols | Guards against invalidtokencontract condition during extended protocols operations. |
| `81` | `StorageLimitExceeded` | Extended Protocols | Guards against storagelimitexceeded condition during extended protocols operations. |
| `82` | `ContractMigrationRequired` | Extended Protocols | Guards against contractmigrationrequired condition during extended protocols operations. |
| `83` | `InvalidEventType` | Extended Protocols | Guards against invalideventtype condition during extended protocols operations. |
| `84` | `WebhookUrlTooLong` | Extended Protocols | Guards against webhookurltoolong condition during extended protocols operations. |
| `85` | `MaxHooksExceeded` | Extended Protocols | Guards against maxhooksexceeded condition during extended protocols operations. |
| `86` | `HookNotActive` | Extended Protocols | Guards against hooknotactive condition during extended protocols operations. |
| `87` | `CrossContractCallFailed` | Extended Protocols | Guards against crosscontractcallfailed condition during extended protocols operations. |
| `88` | `InvalidScValEncoding` | Extended Protocols | Guards against invalidscvalencoding condition during extended protocols operations. |
| `89` | `UnsupportedOperation` | Extended Protocols | Guards against unsupportedoperation condition during extended protocols operations. |
| `90` | `ContractNotLinked` | Extended Protocols | Guards against contractnotlinked condition during extended protocols operations. |
| `91` | `MaxSignersExceeded` | Extended Protocols | Guards against maxsignersexceeded condition during extended protocols operations. |
| `92` | `ZeroAddressNotAllowed` | Extended Protocols | Guards against zeroaddressnotallowed condition during extended protocols operations. |
| `93` | `InvalidNetwork` | Extended Protocols | Guards against invalidnetwork condition during extended protocols operations. |
| `94` | `StakingNotConfigured` | Staking & Rewards | Guards against stakingnotconfigured condition during staking & rewards operations. |
| `95` | `StakingAlreadyActive` | Staking & Rewards | Guards against stakingalreadyactive condition during staking & rewards operations. |
| `96` | `RewardsPoolEmpty` | Staking & Rewards | Guards against rewardspoolempty condition during staking & rewards operations. |
| `97` | `UnstakingPeriodActive` | Staking & Rewards | Guards against unstakingperiodactive condition during staking & rewards operations. |
| `98` | `MinimumStakeNotMet` | Staking & Rewards | Guards against minimumstakenotmet condition during staking & rewards operations. |
| `99` | `MaximumStakeExceeded` | Staking & Rewards | Guards against maximumstakeexceeded condition during staking & rewards operations. |
| `100` | `RewardsAlreadyClaimed` | Staking & Rewards | Guards against rewardsalreadyclaimed condition during staking & rewards operations. |
| `101` | `DelegationNotAllowed` | Staking & Rewards | Guards against delegationnotallowed condition during staking & rewards operations. |
| `102` | `ValidatorNotActive` | Staking & Rewards | Guards against validatornotactive condition during staking & rewards operations. |
| `103` | `SlashingConditionMet` | Staking & Rewards | Guards against slashingconditionmet condition during staking & rewards operations. |
| `104` | `StakingPaused` | Staking & Rewards | Guards against stakingpaused condition during staking & rewards operations. |
| `105` | `CompoundRewardsFailed` | Staking & Rewards | Guards against compoundrewardsfailed condition during staking & rewards operations. |
| `106` | `YieldTooLow` | Staking & Rewards | Guards against yieldtoolow condition during staking & rewards operations. |
| `107` | `StakingPeriodNotEnded` | Staking & Rewards | Guards against stakingperiodnotended condition during staking & rewards operations. |
| `108` | `RewardDistributionFailed` | Staking & Rewards | Guards against rewarddistributionfailed condition during staking & rewards operations. |
| `109` | `UnauthorizedDelegator` | Staking & Rewards | Guards against unauthorizeddelegator condition during staking & rewards operations. |
| `110` | `BridgeNotConfigured` | Cross-Chain & Bridges | Guards against bridgenotconfigured condition during cross-chain & bridges operations. |
| `111` | `BridgePaused` | Cross-Chain & Bridges | Guards against bridgepaused condition during cross-chain & bridges operations. |
| `112` | `InvalidSourceChain` | Cross-Chain & Bridges | Guards against invalidsourcechain condition during cross-chain & bridges operations. |
| `113` | `InvalidDestinationChain` | Cross-Chain & Bridges | Guards against invaliddestinationchain condition during cross-chain & bridges operations. |
| `114` | `CrossChainProofInvalid` | Cross-Chain & Bridges | Guards against crosschainproofinvalid condition during cross-chain & bridges operations. |
| `115` | `BridgeRelayerNotSet` | Cross-Chain & Bridges | Guards against bridgerelayernotset condition during cross-chain & bridges operations. |
| `116` | `BridgeAmountTooLow` | Cross-Chain & Bridges | Guards against bridgeamounttoolow condition during cross-chain & bridges operations. |
| `117` | `BridgeAmountTooHigh` | Cross-Chain & Bridges | Guards against bridgeamounttoohigh condition during cross-chain & bridges operations. |
| `118` | `BridgeTransactionExpired` | Cross-Chain & Bridges | Guards against bridgetransactionexpired condition during cross-chain & bridges operations. |
| `119` | `UnsupportedTokenPair` | Cross-Chain & Bridges | Guards against unsupportedtokenpair condition during cross-chain & bridges operations. |
| `120` | `InsuranceFundNotConfigured` | Insurance & Risk | Guards against insurancefundnotconfigured condition during insurance & risk operations. |
| `121` | `InsuranceFundEmpty` | Insurance & Risk | Guards against insurancefundempty condition during insurance & risk operations. |
| `122` | `InsuranceClaimAlreadyFiled` | Insurance & Risk | Guards against insuranceclaimalreadyfiled condition during insurance & risk operations. |
| `123` | `InsuranceClaimRejected` | Insurance & Risk | Guards against insuranceclaimrejected condition during insurance & risk operations. |
| `124` | `InsuranceClaimWindowExpired` | Insurance & Risk | Guards against insuranceclaimwindowexpired condition during insurance & risk operations. |
| `125` | `CoverageLimitExceeded` | Insurance & Risk | Guards against coveragelimitexceeded condition during insurance & risk operations. |
| `126` | `PremiumNotPaid` | Insurance & Risk | Guards against premiumnotpaid condition during insurance & risk operations. |
| `127` | `RiskScoreTooHigh` | Insurance & Risk | Guards against riskscoretoohigh condition during insurance & risk operations. |
| `128` | `UnderwritingFailed` | Insurance & Risk | Guards against underwritingfailed condition during insurance & risk operations. |
| `129` | `InsurancePaused` | Insurance & Risk | Guards against insurancepaused condition during insurance & risk operations. |
| `130` | `KYCNotCompleted` | Identity & Compliance | Guards against kycnotcompleted condition during identity & compliance operations. |
| `131` | `KYCTierTooLow` | Identity & Compliance | Guards against kyctiertoolow condition during identity & compliance operations. |
| `132` | `AMLFlagRaised` | Identity & Compliance | Guards against amlflagraised condition during identity & compliance operations. |
| `133` | `SanctionsListMatch` | Identity & Compliance | Guards against sanctionslistmatch condition during identity & compliance operations. |
| `134` | `IdentityVerificationFailed` | Identity & Compliance | Guards against identityverificationfailed condition during identity & compliance operations. |
| `135` | `TravelRuleViolation` | Identity & Compliance | Guards against travelruleviolation condition during identity & compliance operations. |
| `136` | `JurisdictionNotSupported` | Identity & Compliance | Guards against jurisdictionnotsupported condition during identity & compliance operations. |
| `137` | `ResidencyCheckFailed` | Identity & Compliance | Guards against residencycheckfailed condition during identity & compliance operations. |
| `138` | `AccreditationRequired` | Identity & Compliance | Guards against accreditationrequired condition during identity & compliance operations. |
| `139` | `AgeVerificationFailed` | Identity & Compliance | Guards against ageverificationfailed condition during identity & compliance operations. |
| `140` | `PaymentRouteNotFound` | Routing & Splitting | Guards against paymentroutenotfound condition during routing & splitting operations. |
| `141` | `PaymentSplitFailed` | Routing & Splitting | Guards against paymentsplitfailed condition during routing & splitting operations. |
| `142` | `SplitPercentageInvalid` | Routing & Splitting | Guards against splitpercentageinvalid condition during routing & splitting operations. |
| `143` | `RouteHopLimitExceeded` | Routing & Splitting | Guards against routehoplimitexceeded condition during routing & splitting operations. |
| `144` | `PathPaymentTooExpensive` | Routing & Splitting | Guards against pathpaymenttooexpensive condition during routing & splitting operations. |
| `145` | `LiquidityPoolNotFound` | Routing & Splitting | Guards against liquiditypoolnotfound condition during routing & splitting operations. |
| `146` | `SlippageExceeded` | Routing & Splitting | Guards against slippageexceeded condition during routing & splitting operations. |
| `147` | `DeadlineExceeded` | Routing & Splitting | Guards against deadlineexceeded condition during routing & splitting operations. |
| `148` | `PriceOracleStale` | Routing & Splitting | Guards against priceoraclestale condition during routing & splitting operations. |
| `149` | `FlashLoanNotRepaid` | Routing & Splitting | Guards against flashloannotrepaid condition during routing & splitting operations. |
| `150` | `OutOfGas` | Gas & Resources | Guards against outofgas condition during gas & resources operations. |
| `151` | `GasPriceTooLow` | Gas & Resources | Guards against gaspricetoolow condition during gas & resources operations. |
| `152` | `GasRefundFailed` | Gas & Resources | Guards against gasrefundfailed condition during gas & resources operations. |
| `153` | `MemoryLimitExceeded` | Gas & Resources | Guards against memorylimitexceeded condition during gas & resources operations. |
| `154` | `StackDepthExceeded` | Gas & Resources | Guards against stackdepthexceeded condition during gas & resources operations. |
| `155` | `InstructionBudgetExceeded` | Gas & Resources | Guards against instructionbudgetexceeded condition during gas & resources operations. |
| `156` | `ReadBudgetExceeded` | Gas & Resources | Guards against readbudgetexceeded condition during gas & resources operations. |
| `157` | `WriteBudgetExceeded` | Gas & Resources | Guards against writebudgetexceeded condition during gas & resources operations. |
| `158` | `TTLTooLow` | Gas & Resources | Guards against ttltoolow condition during gas & resources operations. |
| `159` | `LedgerEntryLimitReached` | Gas & Resources | Guards against ledgerentrylimitreached condition during gas & resources operations. |
| `160` | `OracleNotConfigured` | Oracles & Price Feeds | Guards against oraclenotconfigured condition during oracles & price feeds operations. |
| `161` | `OracleTimeout` | Oracles & Price Feeds | Guards against oracletimeout condition during oracles & price feeds operations. |
| `162` | `OraclePriceDeviation` | Oracles & Price Feeds | Guards against oraclepricedeviation condition during oracles & price feeds operations. |
| `163` | `DataFeedUnavailable` | Oracles & Price Feeds | Guards against datafeedunavailable condition during oracles & price feeds operations. |
| `164` | `DataFeedTampered` | Oracles & Price Feeds | Guards against datafeedtampered condition during oracles & price feeds operations. |
| `165` | `OracleAlreadyActive` | Oracles & Price Feeds | Guards against oraclealreadyactive condition during oracles & price feeds operations. |
| `166` | `PriceFeedStale` | Oracles & Price Feeds | Guards against pricefeedstale condition during oracles & price feeds operations. |
| `167` | `ConfidenceIntervalTooWide` | Oracles & Price Feeds | Guards against confidenceintervaltoowide condition during oracles & price feeds operations. |
| `168` | `OracleSignatureInvalid` | Oracles & Price Feeds | Guards against oraclesignatureinvalid condition during oracles & price feeds operations. |
| `169` | `MaxPriceAgeExceeded` | Oracles & Price Feeds | Guards against maxpriceageexceeded condition during oracles & price feeds operations. |
| `170` | `BatchExecutionTimeout` | Advanced Batches | Guards against batchexecutiontimeout condition during advanced batches operations. |
| `171` | `BatchPartialFailure` | Advanced Batches | Guards against batchpartialfailure condition during advanced batches operations. |
| `172` | `StreamRateInvalid` | Advanced Batches | Guards against streamrateinvalid condition during advanced batches operations. |
| `173` | `StreamTooLong` | Advanced Batches | Guards against streamtoolong condition during advanced batches operations. |
| `174` | `StreamClaimTooEarly` | Advanced Batches | Guards against streamclaimtooearly condition during advanced batches operations. |
| `175` | `BatchAuthorizationFailed` | Advanced Batches | Guards against batchauthorizationfailed condition during advanced batches operations. |
| `176` | `BatchDuplicateId` | Advanced Batches | Guards against batchduplicateid condition during advanced batches operations. |
| `177` | `StreamBeneficiaryUnchanged` | Advanced Batches | Guards against streambeneficiaryunchanged condition during advanced batches operations. |
| `178` | `StreamTransferNotAllowed` | Advanced Batches | Guards against streamtransfernotallowed condition during advanced batches operations. |
| `179` | `BatchCleanupFailed` | Advanced Batches | Guards against batchcleanupfailed condition during advanced batches operations. |
| `180` | `DisputeNotOpen` | Dispute Resolution | Guards against disputenotopen condition during dispute resolution operations. |
| `181` | `DisputeArbiterNotSet` | Dispute Resolution | Guards against disputearbiternotset condition during dispute resolution operations. |
| `182` | `DisputeEvidenceRequired` | Dispute Resolution | Guards against disputeevidencerequired condition during dispute resolution operations. |
| `183` | `DisputeAlreadyResolved` | Dispute Resolution | Guards against disputealreadyresolved condition during dispute resolution operations. |
| `184` | `DisputeResolutionTimedOut` | Dispute Resolution | Guards against disputeresolutiontimedout condition during dispute resolution operations. |
| `185` | `ArbiterNotAuthorized` | Dispute Resolution | Guards against arbiternotauthorized condition during dispute resolution operations. |
| `186` | `MediationFailed` | Dispute Resolution | Guards against mediationfailed condition during dispute resolution operations. |
| `187` | `AppealWindowClosed` | Dispute Resolution | Guards against appealwindowclosed condition during dispute resolution operations. |
| `188` | `DisputeBondInsufficient` | Dispute Resolution | Guards against disputebondinsufficient condition during dispute resolution operations. |
| `189` | `DisputeEscalationFailed` | Dispute Resolution | Guards against disputeescalationfailed condition during dispute resolution operations. |
| `190` | `MaxStorageEntriesReached` | System & Storage Guards | Guards against maxstorageentriesreached condition during system & storage guards operations. |
| `191` | `StorageFeeNotPaid` | System & Storage Guards | Guards against storagefeenotpaid condition during system & storage guards operations. |
| `192` | `ArchiveEntryNotFound` | System & Storage Guards | Guards against archiveentrynotfound condition during system & storage guards operations. |
| `193` | `StateSyncMismatch` | System & Storage Guards | Guards against statesyncmismatch condition during system & storage guards operations. |
| `194` | `MigrationInProgress` | System & Storage Guards | Guards against migrationinprogress condition during system & storage guards operations. |
| `195` | `RollbackDetected` | System & Storage Guards | Guards against rollbackdetected condition during system & storage guards operations. |
| `196` | `SnapshotVerificationFailed` | System & Storage Guards | Guards against snapshotverificationfailed condition during system & storage guards operations. |
| `197` | `ContractDeprecated` | System & Storage Guards | Guards against contractdeprecated condition during system & storage guards operations. |
| `198` | `EmergencyShutdownActive` | System & Storage Guards | Guards against emergencyshutdownactive condition during system & storage guards operations. |
| `199` | `SystemOverloaded` | System & Storage Guards | Guards against systemoverloaded condition during system & storage guards operations. |
| `200` | `DelegateNotActive` | Advanced Governance | Guards against delegatenotactive condition during advanced governance operations. |
| `201` | `DelegationExpired` | Advanced Governance | Guards against delegationexpired condition during advanced governance operations. |
| `202` | `VoteDelegationMismatch` | Advanced Governance | Guards against votedelegationmismatch condition during advanced governance operations. |
| `203` | `ProposalCancelled` | Advanced Governance | Guards against proposalcancelled condition during advanced governance operations. |
| `204` | `ProposalQuorumChanged` | Advanced Governance | Guards against proposalquorumchanged condition during advanced governance operations. |
| `205` | `EmergencyGovernancePaused` | Advanced Governance | Guards against emergencygovernancepaused condition during advanced governance operations. |
| `206` | `GovernanceTokenLocked` | Advanced Governance | Guards against governancetokenlocked condition during advanced governance operations. |
| `207` | `VotingPowerFrozen` | Advanced Governance | Guards against votingpowerfrozen condition during advanced governance operations. |
| `208` | `ProposalExecutionFailed` | Advanced Governance | Guards against proposalexecutionfailed condition during advanced governance operations. |
| `209` | `GovernanceUpgradePending` | Advanced Governance | Guards against governanceupgradepending condition during advanced governance operations. |
| `210` | `TreasuryNotConfigured` | Treasury & Reserves | Guards against treasurynotconfigured condition during treasury & reserves operations. |
| `211` | `TreasuryWithdrawalPending` | Treasury & Reserves | Guards against treasurywithdrawalpending condition during treasury & reserves operations. |
| `212` | `ReserveRequirementNotMet` | Treasury & Reserves | Guards against reserverequirementnotmet condition during treasury & reserves operations. |
| `213` | `TreasuryMultisigRequired` | Treasury & Reserves | Guards against treasurymultisigrequired condition during treasury & reserves operations. |
| `214` | `ReserveAssetUnavailable` | Treasury & Reserves | Guards against reserveassetunavailable condition during treasury & reserves operations. |
| `215` | `TreasuryReportMismatch` | Treasury & Reserves | Guards against treasuryreportmismatch condition during treasury & reserves operations. |
| `216` | `ReserveRatioBreached` | Treasury & Reserves | Guards against reserveratiobreached condition during treasury & reserves operations. |
| `217` | `TreasuryAuditFailed` | Treasury & Reserves | Guards against treasuryauditfailed condition during treasury & reserves operations. |
| `218` | `ReserveRebalanceFailed` | Treasury & Reserves | Guards against reserverebalancefailed condition during treasury & reserves operations. |
| `219` | `TreasuryAccessRevoked` | Treasury & Reserves | Guards against treasuryaccessrevoked condition during treasury & reserves operations. |
| `220` | `TokenAlreadyListed` | Token Management | Guards against tokenalreadylisted condition during token management operations. |
| `221` | `TokenDelistingPending` | Token Management | Guards against tokendelistingpending condition during token management operations. |
| `222` | `AssetPairNotFound` | Token Management | Guards against assetpairnotfound condition during token management operations. |
| `223` | `TokenSupplyCapExceeded` | Token Management | Guards against tokensupplycapexceeded condition during token management operations. |
| `224` | `MintingPaused` | Token Management | Guards against mintingpaused condition during token management operations. |
| `225` | `BurningPaused` | Token Management | Guards against burningpaused condition during token management operations. |
| `226` | `TokenFrozen` | Token Management | Guards against tokenfrozen condition during token management operations. |
| `227` | `AssetTrustlineMissing` | Token Management | Guards against assettrustlinemissing condition during token management operations. |
| `228` | `TokenMetadataInvalid` | Token Management | Guards against tokenmetadatainvalid condition during token management operations. |
| `229` | `AssetMigrationPending` | Token Management | Guards against assetmigrationpending condition during token management operations. |
| `230` | `LendingPoolNotConfigured` | Lending & Credit | Guards against lendingpoolnotconfigured condition during lending & credit operations. |
| `231` | `LoanNotFound` | Lending & Credit | Guards against loannotfound condition during lending & credit operations. |
| `232` | `LoanAlreadyRepaid` | Lending & Credit | Guards against loanalreadyrepaid condition during lending & credit operations. |
| `233` | `CollateralInsufficient` | Lending & Credit | Guards against collateralinsufficient condition during lending & credit operations. |
| `234` | `LiquidationPending` | Lending & Credit | Guards against liquidationpending condition during lending & credit operations. |
| `235` | `InterestRateInvalid` | Lending & Credit | Guards against interestrateinvalid condition during lending & credit operations. |
| `236` | `CreditLimitExceeded` | Lending & Credit | Guards against creditlimitexceeded condition during lending & credit operations. |
| `237` | `LoanMaturityReached` | Lending & Credit | Guards against loanmaturityreached condition during lending & credit operations. |
| `238` | `CollateralFrozen` | Lending & Credit | Guards against collateralfrozen condition during lending & credit operations. |
| `239` | `LendingPaused` | Lending & Credit | Guards against lendingpaused condition during lending & credit operations. |
| `240` | `SubscriptionNotFound` | Subscriptions | Guards against subscriptionnotfound condition during subscriptions operations. |
| `241` | `SubscriptionAlreadyCancelled` | Subscriptions | Guards against subscriptionalreadycancelled condition during subscriptions operations. |
| `242` | `SubscriptionRenewalFailed` | Subscriptions | Guards against subscriptionrenewalfailed condition during subscriptions operations. |
| `243` | `BillingCycleInvalid` | Subscriptions | Guards against billingcycleinvalid condition during subscriptions operations. |
| `244` | `SubscriptionPaused` | Subscriptions | Guards against subscriptionpaused condition during subscriptions operations. |
| `245` | `TrialPeriodExpired` | Subscriptions | Guards against trialperiodexpired condition during subscriptions operations. |
| `246` | `PaymentMethodInvalid` | Subscriptions | Guards against paymentmethodinvalid condition during subscriptions operations. |
| `247` | `SubscriptionTierNotAllowed` | Subscriptions | Guards against subscriptiontiernotallowed condition during subscriptions operations. |
| `248` | `UsageQuotaExceeded` | Subscriptions | Guards against usagequotaexceeded condition during subscriptions operations. |
| `249` | `SubscriptionUpgradePending` | Subscriptions | Guards against subscriptionupgradepending condition during subscriptions operations. |
| `250` | `ZkProofInvalid` | Privacy & ZK | Guards against zkproofinvalid condition during privacy & zk operations. |
| `251` | `PrivacyPoolNotConfigured` | Privacy & ZK | Guards against privacypoolnotconfigured condition during privacy & zk operations. |
| `252` | `CommitmentAlreadySpent` | Privacy & ZK | Guards against commitmentalreadyspent condition during privacy & zk operations. |
| `253` | `NullifierAlreadyUsed` | Privacy & ZK | Guards against nullifieralreadyused condition during privacy & zk operations. |
| `254` | `MerklePathInvalid` | Privacy & ZK | Guards against merklepathinvalid condition during privacy & zk operations. |
| `255` | `PrivacyDepositTooLow` | Privacy & ZK | Guards against privacydeposittoolow condition during privacy & zk operations. |
| `256` | `PrivacyWithdrawalPending` | Privacy & ZK | Guards against privacywithdrawalpending condition during privacy & zk operations. |
| `257` | `StealthAddressInvalid` | Privacy & ZK | Guards against stealthaddressinvalid condition during privacy & zk operations. |
| `258` | `ConfidentialTransferFailed` | Privacy & ZK | Guards against confidentialtransferfailed condition during privacy & zk operations. |
| `259` | `PrivacyPaused` | Privacy & ZK | Guards against privacypaused condition during privacy & zk operations. |
| `260` | `NotificationServiceDown` | Messaging & Hooks | Guards against notificationservicedown condition during messaging & hooks operations. |
| `261` | `MessageTooLong` | Messaging & Hooks | Guards against messagetoolong condition during messaging & hooks operations. |
| `262` | `RecipientUnsubscribed` | Messaging & Hooks | Guards against recipientunsubscribed condition during messaging & hooks operations. |
| `263` | `NotificationDeliveryFailed` | Messaging & Hooks | Guards against notificationdeliveryfailed condition during messaging & hooks operations. |
| `264` | `NotificationRateLimited` | Messaging & Hooks | Guards against notificationratelimited condition during messaging & hooks operations. |
| `265` | `MessageSignatureInvalid` | Messaging & Hooks | Guards against messagesignatureinvalid condition during messaging & hooks operations. |
| `266` | `InboxFull` | Messaging & Hooks | Guards against inboxfull condition during messaging & hooks operations. |
| `267` | `NotificationTemplateInvalid` | Messaging & Hooks | Guards against notificationtemplateinvalid condition during messaging & hooks operations. |
| `268` | `MessageExpired` | Messaging & Hooks | Guards against messageexpired condition during messaging & hooks operations. |
| `269` | `NotificationChannelClosed` | Messaging & Hooks | Guards against notificationchannelclosed condition during messaging & hooks operations. |
| `270` | `ReportGenerationFailed` | Analytics & Metrics | Guards against reportgenerationfailed condition during analytics & metrics operations. |
| `271` | `AnalyticsDataMissing` | Analytics & Metrics | Guards against analyticsdatamissing condition during analytics & metrics operations. |
| `272` | `MetricOutOfRange` | Analytics & Metrics | Guards against metricoutofrange condition during analytics & metrics operations. |
| `273` | `ReportTooLarge` | Analytics & Metrics | Guards against reporttoolarge condition during analytics & metrics operations. |
| `274` | `SnapshotNotFound` | Analytics & Metrics | Guards against snapshotnotfound condition during analytics & metrics operations. |
| `275` | `AggregationWindowInvalid` | Analytics & Metrics | Guards against aggregationwindowinvalid condition during analytics & metrics operations. |
| `276` | `DataRetentionExpired` | Analytics & Metrics | Guards against dataretentionexpired condition during analytics & metrics operations. |
| `277` | `ReportAccessDenied` | Analytics & Metrics | Guards against reportaccessdenied condition during analytics & metrics operations. |
| `278` | `AnalyticsQuotaExceeded` | Analytics & Metrics | Guards against analyticsquotaexceeded condition during analytics & metrics operations. |
| `279` | `ExportFormatUnsupported` | Analytics & Metrics | Guards against exportformatunsupported condition during analytics & metrics operations. |
| `280` | `SepProtocolViolation` | Standards & Interop | Guards against sepprotocolviolation condition during standards & interop operations. |
| `281` | `AssetNotSepCompliant` | Standards & Interop | Guards against assetnotsepcompliant condition during standards & interop operations. |
| `282` | `CrossContractVersionMismatch` | Standards & Interop | Guards against crosscontractversionmismatch condition during standards & interop operations. |
| `283` | `InterfaceNotImplemented` | Standards & Interop | Guards against interfacenotimplemented condition during standards & interop operations. |
| `284` | `StandardsComplianceFailed` | Standards & Interop | Guards against standardscompliancefailed condition during standards & interop operations. |
| `285` | `ProtocolUpgradeRequired` | Standards & Interop | Guards against protocolupgraderequired condition during standards & interop operations. |
| `286` | `InteropHandshakeFailed` | Standards & Interop | Guards against interophandshakefailed condition during standards & interop operations. |
| `287` | `NamespaceCollision` | Standards & Interop | Guards against namespacecollision condition during standards & interop operations. |
| `288` | `ExternalSystemUnavailable` | Standards & Interop | Guards against externalsystemunavailable condition during standards & interop operations. |
| `289` | `InteropRateLimitExceeded` | Standards & Interop | Guards against interopratelimitexceeded condition during standards & interop operations. |
| `290` | `ContractUpgradeScheduled` | System Fatal & Protocol | Guards against contractupgradescheduled condition during system fatal & protocol operations. |
| `291` | `MaintenanceModeActive` | System Fatal & Protocol | Guards against maintenancemodeactive condition during system fatal & protocol operations. |
| `292` | `CircuitBreakerTripped` | System Fatal & Protocol | Guards against circuitbreakertripped condition during system fatal & protocol operations. |
| `293` | `EmergencyFreezeActive` | System Fatal & Protocol | Guards against emergencyfreezeactive condition during system fatal & protocol operations. |
| `294` | `SystemClockDriftDetected` | System Fatal & Protocol | Guards against systemclockdriftdetected condition during system fatal & protocol operations. |
| `295` | `LedgerVersionUnsupported` | System Fatal & Protocol | Guards against ledgerversionunsupported condition during system fatal & protocol operations. |
| `296` | `NetworkPartitionDetected` | System Fatal & Protocol | Guards against networkpartitiondetected condition during system fatal & protocol operations. |
| `297` | `ResourceExhaustionWarning` | System Fatal & Protocol | Guards against resourceexhaustionwarning condition during system fatal & protocol operations. |
| `298` | `GracePeriodActive` | System Fatal & Protocol | Guards against graceperiodactive condition during system fatal & protocol operations. |
| `299` | `ConfigurationInvalid` | System Fatal & Protocol | Guards against configurationinvalid condition during system fatal & protocol operations. |
| `300` | `SystemFatalError` | System Fatal & Protocol | Guards against systemfatalerror condition during system fatal & protocol operations. |

---

### 5.2 EmitterError (Codes 1–14)

| Code | Variant Name | Operational Meaning & Trigger Precondition |
|---|---|---|
| `1` | `NotInitialized` | Event emitter storage has not been initialized. |
| `2` | `AlreadyInitialized` | Emitter already initialized; reinitialization forbidden. |
| `3` | `EventNotFound` | Specified event ID does not exist in persistent storage. |
| `4` | `Unauthorized` | Caller is neither the allow-listed orchestrator source nor the contract owner. |
| `5` | `UpgradeNotProposed` | No WASM upgrade or pending ownership proposal is registered. |
| `6` | `UpgradeTimelockActive` | 24-hour timelock delay has not expired. |
| `7` | `ContractPaused` | Emitter circuit breaker is active; event emission rejected. |
| `8` | `InvalidAmount` | Event amount argument is invalid. |
| `9` | `DuplicateEvent` | Attempted duplicate event emission for identical sequence. |
| `10` | `MaxEventsReached` | Storage event sequence capacity limit reached. |
| `11` | `ReentrantCall` | Nested cross-contract reentrancy call detected. |
| `12` | `InvalidTxHash` | Transaction hash format invalid. |
| `13` | `EmitFailed` | Persistent event write failed. |
| `14` | `CrossContractCallFailed` | Invocation from calling contract failed. |

---

## 6. CLI & TypeScript SDK Invocation Examples

### 6.1 Stellar CLI Invocations

#### 1. Record a Direct Payment
```bash
soroban contract invoke \
  --id CCQGGUJRRVXMHNEX2RYPODGJE2YRMYY4Y7A3KTJH3QP2LWZLTCOPRPET \
  --source-account alice \
  --network testnet \
  -- \
  record_payment \
  --payer GBYO...ALICE \
  --payee GBYO...BOB \
  --amount 10000000 \
  --asset CDLZ...USDC \
  --tx_hash "a1b2c3d4e5f67890abcdef1234567890abcdef1234567890abcdef1234567890" \
  --metadata '{"invoice_id": "INV-2026-001", "memo": "Design sprint delivery"}'
```

#### 2. Create and Release an Escrow
```bash
# Create Escrow (Locks 500 XLM / 5,000,000,000 stroops until timestamp 1787990000)
soroban contract invoke \
  --id CCQGGUJRRVXMHNEX2RYPODGJE2YRMYY4Y7A3KTJH3QP2LWZLTCOPRPET \
  --source-account depositor \
  --network testnet \
  -- \
  create_escrow \
  --depositor GBYO...DEPOSITOR \
  --beneficiary GBYO...BENEFICIARY \
  --arbiter '{"some": "GBYO...ARBITER"}' \
  --amount 5000000000 \
  --asset CAS3...NATIVE \
  --deadline 1787990000 \
  --metadata "Milestone 1 Deliverable"

# Release Escrow (Authorized by depositor or arbiter)
soroban contract invoke \
  --id CCQGGUJRRVXMHNEX2RYPODGJE2YRMYY4Y7A3KTJH3QP2LWZLTCOPRPET \
  --source-account depositor \
  --network testnet \
  -- \
  release_escrow \
  --owner GBYO...DEPOSITOR \
  --escrow_id 1
```

#### 3. Linear Payment Stream (Vesting)
```bash
# Create Stream (Vesting 1,000 tokens linearly over 30 days)
soroban contract invoke \
  --id CCQGGUJRRVXMHNEX2RYPODGJE2YRMYY4Y7A3KTJH3QP2LWZLTCOPRPET \
  --source-account employer \
  --network testnet \
  -- \
  create_stream \
  --creator GBYO...EMPLOYER \
  --recipient GBYO...CONTRACTOR \
  --total_amount 10000000000 \
  --asset CDLZ...USDC \
  --start_time 1756454400 \
  --end_time 1759046400 \
  --metadata "September 2026 Salary Stream"

# Contractor Claims Vested Tokens
soroban contract invoke \
  --id CCQGGUJRRVXMHNEX2RYPODGJE2YRMYY4Y7A3KTJH3QP2LWZLTCOPRPET \
  --source-account contractor \
  --network testnet \
  -- \
  claim_stream \
  --recipient GBYO...CONTRACTOR \
  --stream_id 1
```

#### 4. Emergency Cross-Contract Circuit Breaker
```bash
# Emergency Pause Both Contracts
soroban contract invoke \
  --id CCQGGUJRRVXMHNEX2RYPODGJE2YRMYY4Y7A3KTJH3QP2LWZLTCOPRPET \
  --source-account owner \
  --network testnet \
  -- \
  emergency_pause_all \
  --caller GBYO...OWNER
```

---

### 6.2 TypeScript Client SDK Invocations

```typescript
import {
  Contract,
  Address,
  nativeToScVal,
  scValToNative,
  rpc,
  TransactionBuilder,
  Networks,
  Keypair,
} from "@stellar/stellar-sdk";

const CONTRACT_ID = "CCQGGUJRRVXMHNEX2RYPODGJE2YRMYY4Y7A3KTJH3QP2LWZLTCOPRPET";
const server = new rpc.Server("https://soroban-testnet.stellar.org");
const contract = new Contract(CONTRACT_ID);

/**
 * 1. Query aggregate statistics
 */
export async function getContractStats() {
  const op = contract.call("get_stats");
  const sim = await server.simulateTransaction(
    new TransactionBuilder(new Keypair().account(), {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    }).addOperation(op).setTimeout(30).build()
  );
  if (sim.result?.retval) {
    return scValToNative(sim.result.retval);
  }
  throw new Error("Simulation failed");
}

/**
 * 2. Record Payment with TypeScript SDK
 */
export async function recordPayment(
  payerKeypair: Keypair,
  payeeAddress: string,
  amountStroops: bigint,
  assetAddress: string,
  txHash: string,
  metadata: string
) {
  const account = await server.getAccount(payerKeypair.publicKey());
  const tx = new TransactionBuilder(account, {
    fee: "10000",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      contract.call(
        "record_payment",
        new Address(payerKeypair.publicKey()).toScVal(),
        new Address(payeeAddress).toScVal(),
        nativeToScVal(amountStroops, { type: "i128" }),
        new Address(assetAddress).toScVal(),
        nativeToScVal(txHash, { type: "string" }),
        nativeToScVal(metadata, { type: "string" })
      )
    )
    .setTimeout(30)
    .build();

  const preparedTx = await server.prepareTransaction(tx);
  preparedTx.sign(payerKeypair);
  const response = await server.sendTransaction(preparedTx);
  return response;
}

/**
 * 3. Propose and Execute Timelocked Action
 */
export async function proposeTimelockedAction(
  ownerKeypair: Keypair,
  actionType: string,
  target: string,
  data: string
) {
  const account = await server.getAccount(ownerKeypair.publicKey());
  const tx = new TransactionBuilder(account, {
    fee: "10000",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      contract.call(
        "propose_timelocked_action",
        new Address(ownerKeypair.publicKey()).toScVal(),
        nativeToScVal(actionType, { type: "string" }),
        nativeToScVal(target, { type: "string" }),
        nativeToScVal(data, { type: "string" })
      )
    )
    .setTimeout(30)
    .build();

  const prepared = await server.prepareTransaction(tx);
  prepared.sign(ownerKeypair);
  return await server.sendTransaction(prepared);
}
```
