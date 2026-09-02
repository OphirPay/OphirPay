# Soroban Contract Function Reference

Complete reference for every public function of the two OphirPay Soroban
contracts — `OphirPayContract` (the payment orchestration contract) and
`PaymentEventEmitter` (the on-chain event emitter).

- **OphirPay contract:** `contracts/ophirpay/src/lib.rs` — 94 public functions
- **Emitter contract:** `contracts/emitter/src/lib.rs` — 15 public functions
- **SDK:** `soroban-sdk = 27.0.5`
- **Error types:** `PaymentError` (OphirPay) and `EmitterError` (Emitter)

---

## Conventions used in this document

### Access control

All state-changing functions call `require_auth()` on the caller address and
then apply one of these guards:

| Guard | Meaning |
|-------|---------|
| **Owner-only** | Caller must equal the stored `OWNER`. Rejects with `PaymentError::Unauthorized` / `EmitterError::Unauthorized`. |
| **Admin role** | Caller must hold `Role::Admin` (or be the legacy owner). Rejects with `PaymentError::NotARoleHolder`. |
| **Operator role** | Caller must hold `Role::Operator` (or Admin). Rejects with `PaymentError::NotARoleHolder`. |
| **Actor auth** | The named actor (proposer, signer, payer, voter, depositor…) must authorize the call. |
| **Public / read-only** | No auth — any caller may invoke; only reads storage. |
| **Allow-list** | Emitter: caller must be the configured allowed source (or owner). |

OphirPay roles: `Role::Admin`, `Role::Operator`, `Role::Auditor`. `Admin`
may perform every privileged action; `Operator` may perform operational
actions (payment execution, batch creation, refund processing); `Auditor`
is limited to read-only analytics.

### Error handling

Functions return `Result<_, PaymentError>` / `Result<_, EmitterError>`.
Contract errors are 32-bit unsigned integers (see the full code tables
below). Read-only getters that cannot fail return plain values.

### Arguments

All functions take `env: Env` as their first argument (injected by the
Soroban runtime; not passed by callers). `Address` arguments identify
Stellar accounts or contracts and must be valid (`require_auth` enforces
this on write paths). `i128` amounts are in stroops or the token's native
smallest unit. `u64` timestamps are Unix epoch seconds.

---

## PaymentError codes

`PaymentError` is defined in `contracts/ophirpay/src/lib.rs` (line 423).

| Code | Variant | Description |
|------|---------|-------------|
| 1 | `NotInitialized` | Contract storage has no owner — call `init` first. |
| 2 | `AlreadyInitialized` | `init` called a second time. |
| 3 | `PaymentNotFound` | Payment `id` does not exist. |
| 4 | `Unauthorized` | Caller failed an owner/auth guard. |
| 5 | `InvalidAmount` | Amount is zero or negative. |
| 6 | `EscrowNotDue` | Escrow deadline has not been reached. |
| 7 | `EscrowAlreadyReleased` | Escrow already released/claimed. |
| 8 | `EscrowNotFound` | Escrow `id` does not exist. |
| 9 | `StreamNotStarted` | Stream start time is in the future. |
| 10 | `StreamAlreadyCancelled` | Stream already cancelled. |
| 11 | `StreamNotFound` | Stream `id` does not exist. |
| 12 | `StreamFullyClaimed` | No claimable amount remains. |
| 13 | `BatchTooLarge` | Batch exceeds the max recipient count. |
| 14 | `BatchEmpty` | Batch has no recipients. |
| 15 | `TokenTransferFailed` | Underlying token transfer failed. |
| 16 | `InsufficientBalance` | Locked balance insufficient. |
| 17 | `PaymentAlreadyCancelled` | Payment already cancelled. |
| 18 | `ContractPaused` | Contract is paused (emergency pause). |
| 19 | `NoTokensToWithdraw` | No locked balance to withdraw. |
| 20 | `UpgradeNotProposed` | No upgrade proposal pending. |
| 21 | `UpgradeTimelockActive` | Upgrade timelock still active. |
| 22 | `MultisigNotConfigured` | Multisig not configured. |
| 23 | `NotASigner` | Caller is not a multisig signer. |
| 24 | `AlreadyApproved` | Signer already approved this request. |
| 25 | `ThresholdNotMet` | Approval threshold not met. |
| 26 | `AlreadyExecuted` | Action already executed. |
| 27 | `NotARoleHolder` | Caller lacks the required role. |
| 28 | `AuditLogEmpty` | Audit log has no entries. |
| 29 | `AuditEntryNotFound` | Audit entry `id` does not exist. |
| 30 | `RecurringNotFound` | Recurring schedule `id` does not exist. |
| 31 | `RecurringNotDue` | Recurring payment not yet due. |
| 32 | `RecurringAlreadyCancelled` | Recurring schedule already cancelled. |
| 33 | `RecurringExpired` | Recurring schedule exhausted its runs. |
| 34 | `FeeConfigNotFound` | No fee config stored. |
| 35 | `FeeTooHigh` | Fee basis points exceed 1000 (10%). |
| 36 | `TimelockNotFound` | Timelocked action `id` does not exist. |
| 37 | `TimelockNotDue` | Timelock delay not elapsed. |
| 38 | `TimelockAlreadyExecuted` | Timelocked action already executed. |
| 39 | `GovernanceNotConfigured` | Governance not configured. |
| 40 | `ProposalNotFound` | Proposal `id` does not exist. |
| 41 | `VotingPeriodEnded` | Proposal voting period has ended. |
| 42 | `ProposalAlreadyExecuted` | Proposal already executed. |
| 43 | `QuorumNotMet` | Proposal did not reach quorum. |
| 44 | `ProposalDefeated` | Proposal was voted down. |
| 45 | `DepositTooLow` | Proposal deposit below minimum. |
| 46 | `SpendingLimitExpired` | Spending limit has expired. |
| 47 | `RefundNotFound` | Refund `id` does not exist. |
| 48 | `RefundAlreadyProcessed` | Refund already processed. |
| 49 | `PaymentAlreadyRefunded` | Payment already refunded. |
| 50 | `RefundWindowExpired` | Refund window has expired. |
| 51 | `AlreadyVoted` | Voter already voted on proposal. |
| 52 | `ReentrantCall` | Reentrancy guard triggered. |
| 53 | `SpendCapExceeded` | Spend exceeds configured cap. |
| 54 | `DisputeAlreadyFiled` | Dispute already filed. |
| 55 | `DisputeNotFound` | Dispute `id` does not exist. |
| 56 | `DisputeWindowExpired` | Dispute window has expired. |
| 57 | `RefundRejected` | Refund was rejected. |
| 58 | `InsufficientLiquidity` | Not enough liquidity for operation. |
| 59 | `AssetDepegged` | Asset is depegged. |
| 60 | `ProposalNotPassed` | Proposal did not pass. |
| 61 | `InvalidSignature` | Signature invalid. |
| 62 | `HookNotFound` | Notification hook `id` does not exist. |
| 63 | `HookAlreadyExists` | Duplicate hook for subscriber+event. |
| 64 | `RateLimitExceeded` | Rate limit exceeded. |
| 65 | `AssetNotSupported` | Asset not supported. |
| 66 | `InvalidMetadataLength` | Metadata string too long. |
| 67 | `MaxRecipientsExceeded` | Too many recipients. |
| 68 | `DuplicateRecipient` | Duplicate recipient in batch. |
| 69 | `StreamEndBeforeStart` | Stream end time before start. |
| 70 | `EscrowDeadlineInPast` | Escrow deadline in the past. |
| 71 | `PendingOwnershipTransfer` | Ownership transfer pending. |
| 72 | `OwnershipTransferExpired` | Ownership transfer expired. |
| 73 | `InvalidAddressFormat` | Malformed address. |
| 74 | `BatchItemFailed` | One batch item failed. |
| 75 | `RecurringScheduleInvalid` | Invalid recurring schedule. |
| 76 | `FeeCollectorNotSet` | No fee collector configured. |
| 77 | `EmitterNotLinked` | No emitter contract linked. |
| 78 | `ProposalDepositLocked` | Proposal deposit locked. |
| 79 | `MultisigSignerLimit` | Signer limit reached. |
| 80 | `InvalidTokenContract` | Invalid token contract address. |
| 81 | `StorageLimitExceeded` | Storage limit exceeded. |
| 82 | `ContractMigrationRequired` | Contract requires migration. |
| 83 | `InvalidEventType` | Unknown event type. |
| 84 | `WebhookUrlTooLong` | Webhook URL too long. |
| 85 | `MaxHooksExceeded` | Hook limit reached. |
| 86 | `HookNotActive` | Hook is not active. |
| 87 | `CrossContractCallFailed` | Cross-contract call failed. |
| 88 | `InvalidScValEncoding` | Invalid SCVal encoding. |
| 89 | `UnsupportedOperation` | Operation not supported. |
| 90 | `ContractNotLinked` | Contract not linked. |
| 91 | `MaxSignersExceeded` | Max signers exceeded. |
| 92 | `ZeroAddressNotAllowed` | Zero address not allowed. |
| 93 | `InvalidNetwork` | Invalid network. |
| 94 | `StakingNotConfigured` | Staking not configured. |
| 95 | `StakingAlreadyActive` | Staking already active. |
| 96 | `RewardsPoolEmpty` | Rewards pool is empty. |
| 97 | `UnstakingPeriodActive` | Unstaking period active. |
| 98+ | *(reserved)* | Reserved for future expansion. |

## EmitterError codes

`EmitterError` is defined in `contracts/emitter/src/lib.rs` (line 40).

| Code | Variant | Description |
|------|---------|-------------|
| 1 | `NotInitialized` | Emitter not initialized. |
| 2 | `AlreadyInitialized` | `init` called twice. |
| 3 | `EventNotFound` | Event `id` does not exist. |
| 4 | `Unauthorized` | Caller not authorized / not allowed source. |
| 5 | `UpgradeNotProposed` | No upgrade proposed. |
| 6 | `UpgradeTimelockActive` | Upgrade timelock active. |
| 7 | `ContractPaused` | Emitter paused. |
| 8 | `InvalidAmount` | Amount invalid. |
| 9 | `DuplicateEvent` | Duplicate event. |
| 10 | `MaxEventsReached` | Event limit reached. |
| 11 | `ReentrantCall` | Reentrancy guard triggered. |
| 12 | `InvalidTxHash` | Invalid transaction hash. |
| 13 | `EmitFailed` | Event emission failed. |
| 14 | `CrossContractCallFailed` | Cross-contract call failed. |
| 20–99 | *(reserved)* | Reserved for future expansion. |

---

# OphirPayContract

## Initialization & identity

### `init(owner: Address) -> Result<u32, PaymentError>`

Initializes the contract with `owner` as the owner. Owner must authorize.

- **Access:** owner auth (the new owner).
- **Errors:** `AlreadyInitialized` (2).
- **Example:**
  ```bash
  stellar contract invoke --id $CONTRACT --source $OWNER \
    -- init --owner $OWNER
  ```

### `get_owner() -> Result<Address, PaymentError>`

Returns the stored owner.

- **Access:** public read.
- **Errors:** `NotInitialized` (1).

### `get_version() -> u32`

Returns the contract version constant.

- **Access:** public read.
- **Errors:** none.

### `get_stats() -> ContractStats`

Returns aggregate statistics (payment count, escrow count, stream count,
etc. as defined by `ContractStats`).

- **Access:** public read.
- **Errors:** none.

---

## Multisig

### `set_multisig_config(caller: Address, threshold: u32, signers: Vec<Address>, enabled: bool) -> Result<(), PaymentError>`

Configures the multisig approval policy.

- **Access:** owner-only (`caller.require_auth()` + `require_owner`).
- **Errors:** `NotInitialized` (1), `Unauthorized` (4), `MultisigSignerLimit` (79), `MaxSignersExceeded` (91).

### `get_multisig_config() -> Option<MultisigConfig>`

Returns the current multisig configuration, if set.

- **Access:** public read.

### `get_multisig_config_history() -> Vec<MultisigVersion>`

Returns every historical multisig configuration version.

- **Access:** public read.

### `propose_payment(proposer: Address, payee: Address, amount: i128, asset: Address, tx_hash: String) -> Result<u64, PaymentError>`

Creates a multisig payment approval request; returns the request ID.

- **Access:** actor auth (`proposer.require_auth()`).
- **Errors:** `MultisigNotConfigured` (22), `InvalidAmount` (5), `ContractPaused` (18), `InvalidTokenContract` (80).

### `approve_payment(signer: Address, request_id: u64) -> Result<bool, PaymentError>`

Approves a pending multisig request; returns `true` when the threshold is
met and the request is executable.

- **Access:** actor auth (`signer.require_auth()`).
- **Errors:** `NotASigner` (23), `AlreadyApproved` (24), `PaymentNotFound` (3), `MultisigNotConfigured` (22).

### `execute_approved_payment(caller: Address, request_id: u64) -> Result<u64, PaymentError>`

Executes an approved multisig payment; returns the payment ID.

- **Access:** actor auth (`caller.require_auth()`); threshold must be met.
- **Errors:** `ThresholdNotMet` (25), `AlreadyExecuted` (26), `PaymentNotFound` (3), `TokenTransferFailed` (15).

### `get_approval_request(request_id: u64) -> Option<ApprovalRequest>`

Returns a multisig approval request, if present.

- **Access:** public read.

---

## Fee configuration

### `set_fee_config(caller: Address, payment_fee_bps: u32, escrow_fee_bps: u32, stream_fee_bps: u32, batch_base_fee: i128, batch_per_item_fee: i128, enabled: bool) -> Result<(), PaymentError>`

Sets the fee schedule. All `*_bps` values are basis points (max 1000 = 10%).

- **Access:** owner-only (`caller.require_auth()` + `require_owner`).
- **Errors:** `NotInitialized` (1), `Unauthorized` (4), `FeeTooHigh` (35).

### `get_fee_config() -> Option<FeeConfig>`

Returns the current fee config, if set.

- **Access:** public read.

### `get_fee_config_history() -> Vec<FeeConfigVersion>`

Returns all historical fee config versions.

- **Access:** public read.

### `get_fee_config_at_version(version: u32) -> Option<FeeConfigVersion>`

Returns the fee config at a specific version.

- **Access:** public read.

### `set_fee_collector(caller: Address, collector: Address) -> Result<(), PaymentError>`

Sets the fee collector address.

- **Access:** owner-only (`caller.require_auth()` + `require_owner`).
- **Errors:** `NotInitialized` (1), `Unauthorized` (4), `ZeroAddressNotAllowed` (92).

### `get_fee_collector() -> Option<Address>`

Returns the fee collector, if set.

- **Access:** public read.

### `calculate_fee(amount: i128, fee_bps: u32) -> i128`

Pure function: computes `amount * fee_bps / 10_000` (integer math).

- **Access:** public read (no auth).
- **Errors:** none (pure computation).

---

## Timelock

### `propose_timelocked_action(caller: Address, action_type: String, target: String, data: String) -> Result<u64, PaymentError>`

Queues a timelocked action; returns the action ID.

- **Access:** owner-only (`caller.require_auth()` + `require_owner`).
- **Errors:** `NotInitialized` (1), `Unauthorized` (4), `InvalidMetadataLength` (66).

### `execute_timelocked_action(action_id: u64) -> Result<(), PaymentError>`

Executes a timelocked action once its delay has elapsed.

- **Access:** public (any caller may trigger; auth enforced by the action).
- **Errors:** `TimelockNotFound` (36), `TimelockNotDue` (37), `TimelockAlreadyExecuted` (38).

### `cancel_timelocked_action(caller: Address, action_id: u64) -> Result<(), PaymentError>`

Cancels a pending timelocked action.

- **Access:** owner-only (`caller.require_auth()` + `require_owner`).
- **Errors:** `NotInitialized` (1), `Unauthorized` (4), `TimelockNotFound` (36), `AlreadyExecuted` (26).

### `get_timelocked_action(action_id: u64) -> Result<TimelockedAction, PaymentError>`

Returns a timelocked action.

- **Access:** public read.
- **Errors:** `TimelockNotFound` (36).

### `get_timelock_count() -> u64`

Returns the number of timelocked actions.

- **Access:** public read.

---

## Governance

### `configure_governance(caller: Address, min_proposal_deposit: i128, voting_period: u64, quorum_bps: u32, enabled: bool) -> Result<(), PaymentError>`

Configures DAO-style governance.

- **Access:** owner-only (`caller.require_auth()` + `require_owner`).
- **Errors:** `NotInitialized` (1), `Unauthorized` (4), `DepositTooLow` (45).

### `get_governance_config() -> Option<GovernanceConfig>`

Returns the governance config, if set.

- **Access:** public read.

### `create_proposal(proposer: Address, title: String, description: String, action_type: String, target: String, data: String, deposit_asset: Address, deposit_amount: i128) -> Result<u64, PaymentError>`

Creates a proposal with a deposit; returns the proposal ID.

- **Access:** actor auth (`proposer.require_auth()`); deposit transferred.
- **Errors:** `GovernanceNotConfigured` (39), `DepositTooLow` (45), `TokenTransferFailed` (15), `ProposalDepositLocked` (78).

### `vote_on_proposal(voter: Address, proposal_id: u64, support: bool) -> Result<(), PaymentError>`

Votes yes/no on an open proposal.

- **Access:** actor auth (`voter.require_auth()`).
- **Errors:** `ProposalNotFound` (40), `VotingPeriodEnded` (41), `AlreadyVoted` (51).

### `execute_proposal(proposal_id: u64) -> Result<bool, PaymentError>`

Executes a passed proposal; returns `true` on success.

- **Access:** public (any caller may execute after voting closes).
- **Errors:** `ProposalNotFound` (40), `ProposalNotPassed` (60), `QuorumNotMet` (43), `ProposalAlreadyExecuted` (42).

### `get_proposal(proposal_id: u64) -> Result<Proposal, PaymentError>`

Returns a proposal.

- **Access:** public read.
- **Errors:** `ProposalNotFound` (40).

### `get_proposal_count() -> u64`

Returns the number of proposals.

- **Access:** public read.

---

## Spending limits & escalation

### `set_spending_limit(caller: Address, user: Address, daily_limit: i128, monthly_limit: i128, expires_at: u64, is_active: bool) -> Result<(), PaymentError>`

Sets a spending limit for `user`.

- **Access:** owner-only (`caller.require_auth()` + `require_owner`).
- **Errors:** `NotInitialized` (1), `Unauthorized` (4), `InvalidAmount` (5).

### `get_spending_limit(user: Address) -> Option<SpendingLimit>`

Returns `user`'s spending limit, if set.

- **Access:** public read.

### `configure_escalation(caller: Address, small_threshold: i128, medium_threshold: i128, enabled: bool) -> Result<(), PaymentError>`

Configures escalation thresholds.

- **Access:** owner-only (`caller.require_auth()` + `require_owner`).
- **Errors:** `NotInitialized` (1), `Unauthorized` (4), `InvalidAmount` (5).

### `check_spending(user: Address, amount: i128) -> SpendCheckResult`

Checks whether `amount` is within `user`'s limits. Returns a
`SpendCheckResult` (allowed / over limit / no limit).

- **Access:** public read.
- **Errors:** none (returns result enum).

### `atomic_spend(payer: Address, payee: Address, amount: i128, asset: Address, tx_hash: String, metadata: String) -> Result<u64, PaymentError>`

Executes a single atomic spend with spending-limit enforcement; returns the
payment ID.

- **Access:** actor auth (`payer.require_auth()`); `require_not_paused`.
- **Errors:** `ContractPaused` (18), `InvalidAmount` (5), `SpendCapExceeded` (53), `TokenTransferFailed` (15), `ReentrantCall` (52).

---

## RBAC

### `grant_role(caller: Address, grantee: Address, role: Role) -> Result<(), PaymentError>`

Grants `grantee` the given role.

- **Access:** Admin role (`caller.require_auth()` + `require_role(Admin)`).
- **Errors:** `NotInitialized` (1), `NotARoleHolder` (27), `ZeroAddressNotAllowed` (92).

### `revoke_role(caller: Address, grantee: Address) -> Result<(), PaymentError>`

Revokes `grantee`'s role.

- **Access:** Admin role (`caller.require_auth()` + `require_role(Admin)`).
- **Errors:** `NotInitialized` (1), `NotARoleHolder` (27).

### `get_role(addr: Address) -> Option<Role>`

Returns the role held by `addr`, if any.

- **Access:** public read.

### `require_role(caller: Address, required: Role) -> Result<(), PaymentError>`

Checks that `caller` holds `required` (Admin passes all checks; legacy owner
falls back to Admin).

- **Access:** internal/public helper (may be called cross-contract).
- **Errors:** `NotARoleHolder` (27).

---

## Audit log

### `get_audit_log_count() -> u64`

Returns the number of audit entries.

- **Access:** public read.

### `get_audit_entry(entry_id: u64) -> Result<AuditEntry, PaymentError>`

Returns an audit entry.

- **Access:** public read.
- **Errors:** `AuditEntryNotFound` (29).

### `get_audit_log_range(start_id: u64, end_id: u64) -> Vec<AuditEntry>`

Returns audit entries in `[start_id, end_id]`.

- **Access:** public read.
- **Errors:** none (empty vec out of range).

---

## Emitter linkage & emergency controls

### `set_emitter(caller: Address, emitter: Address) -> Result<(), PaymentError>`

Links the emitter contract address used for event emission.

- **Access:** owner-only (`caller.require_auth()` + `require_owner`).
- **Errors:** `NotInitialized` (1), `Unauthorized` (4), `ZeroAddressNotAllowed` (92).

### `get_emitter() -> Option<Address>`

Returns the linked emitter address, if any.

- **Access:** public read.

### `emergency_pause_all(caller: Address) -> Result<(), PaymentError>`

Pauses all state-changing operations.

- **Access:** owner-only (`caller.require_auth()` + `require_owner`).
- **Errors:** `NotInitialized` (1), `Unauthorized` (4).

### `emergency_unpause_all(caller: Address) -> Result<(), PaymentError>`

Unpauses the contract.

- **Access:** owner-only (`caller.require_auth()` + `require_owner`).
- **Errors:** `NotInitialized` (1), `Unauthorized` (4).

### `is_paused() -> bool`

Returns whether the contract is paused.

- **Access:** public read.

### `get_locked_balance() -> i128`

Returns the total locked balance.

- **Access:** public read.

### `is_reentrancy_locked() -> bool`

Returns whether the reentrancy guard is currently set.

- **Access:** public read.

### `emergency_withdraw(caller: Address, asset: Address, amount: i128) -> Result<(), PaymentError>`

Withdraws locked funds in an emergency.

- **Access:** owner-only (`caller.require_auth()` + `require_owner`).
- **Errors:** `NotInitialized` (1), `Unauthorized` (4), `NoTokensToWithdraw` (19), `TokenTransferFailed` (15).

---

## Upgrade & ownership

### `propose_upgrade(caller: Address, new_wasm_hash: BytesN<32>) -> Result<(), PaymentError>`

Proposes a contract upgrade to `new_wasm_hash`.

- **Access:** owner-only (`caller.require_auth()` + `require_owner`).
- **Errors:** `NotInitialized` (1), `Unauthorized` (4).

### `execute_upgrade() -> Result<(), PaymentError>`

Executes the pending upgrade after the timelock.

- **Access:** public (any caller may trigger).
- **Errors:** `UpgradeNotProposed` (20), `UpgradeTimelockActive` (21).

### `cancel_upgrade(caller: Address) -> Result<(), PaymentError>`

Cancels a pending upgrade.

- **Access:** owner-only (`caller.require_auth()` + `require_owner`).
- **Errors:** `NotInitialized` (1), `Unauthorized` (4), `UpgradeNotProposed` (20).

### `transfer_ownership(caller: Address, new_owner: Address) -> Result<(), PaymentError>`

Initiates a two-step ownership transfer.

- **Access:** owner-only (`caller.require_auth()` + `require_owner`).
- **Errors:** `NotInitialized` (1), `Unauthorized` (4), `PendingOwnershipTransfer` (71), `ZeroAddressNotAllowed` (92).

### `accept_ownership(caller: Address) -> Result<(), PaymentError>`

Accepts a pending ownership transfer (new owner authorizes).

- **Access:** actor auth (`caller.require_auth()`); caller must be pending owner.
- **Errors:** `OwnershipTransferExpired` (72), `Unauthorized` (4).

### `cancel_ownership_transfer(caller: Address) -> Result<(), PaymentError>`

Cancels a pending ownership transfer.

- **Access:** owner-only (`caller.require_auth()` + `require_owner`).
- **Errors:** `NotInitialized` (1), `Unauthorized` (4), `PendingOwnershipTransfer` (71).

### `get_pending_owner() -> Option<(Address, u64)>`

Returns the pending owner and expiry timestamp, if any.

- **Access:** public read.

---

## Payments

### `record_payment(payer: Address, payee: Address, amount: i128, asset: Address, tx_hash: String, metadata: String) -> Result<u64, PaymentError>`

Records an off-chain payment (typically called by the backend with the
payer's auth). Returns the payment ID.

- **Access:** actor auth (`payer.require_auth()`); `require_not_paused`.
- **Errors:** `ContractPaused` (18), `InvalidAmount` (5), `TokenTransferFailed` (15), `InvalidTokenContract` (80).

### `get_payment(payment_id: u64) -> Result<Payment, PaymentError>`

Returns a payment record.

- **Access:** public read.
- **Errors:** `PaymentNotFound` (3).

### `get_payment_count() -> u64`

Returns the number of payments.

- **Access:** public read.

### `get_payments_range(start_id: u64, end_id: u64) -> Vec<Payment>`

Returns payments in `[start_id, end_id]`.

- **Access:** public read.

### `cancel_payment(caller: Address, payment_id: u64) -> Result<(), PaymentError>`

Cancels a pending payment.

- **Access:** actor auth (`caller.require_auth()`); caller must own the payment.
- **Errors:** `PaymentNotFound` (3), `PaymentAlreadyCancelled` (17), `Unauthorized` (4).

---

## Escrows

### `create_escrow(depositor: Address, beneficiary: Address, arbiter: Option<Address>, amount: i128, asset: Address, deadline: u64, metadata: String) -> Result<u64, PaymentError>`

Creates an escrow; returns the escrow ID.

- **Access:** actor auth (`depositor.require_auth()`); deposit transferred.
- **Errors:** `ContractPaused` (18), `InvalidAmount` (5), `EscrowDeadlineInPast` (70), `TokenTransferFailed` (15).

### `release_escrow(owner: Address, escrow_id: u64) -> Result<(), PaymentError>`

Releases an escrow to the beneficiary once due.

- **Access:** actor auth (`owner.require_auth()`); owner must be depositor or beneficiary.
- **Errors:** `EscrowNotFound` (8), `EscrowNotDue` (6), `EscrowAlreadyReleased` (7), `Unauthorized` (4).

### `release_by_arbiter(arbiter: Address, escrow_id: u64, release_to_beneficiary: bool) -> Result<(), PaymentError>`

Arbiter releases an escrow to either party.

- **Access:** actor auth (`arbiter.require_auth()`); must be the configured arbiter.
- **Errors:** `EscrowNotFound` (8), `EscrowAlreadyReleased` (7), `Unauthorized` (4).

### `claim_escrow(beneficiary: Address, escrow_id: u64) -> Result<(), PaymentError>`

Beneficiary claims a released escrow.

- **Access:** actor auth (`beneficiary.require_auth()`).
- **Errors:** `EscrowNotFound` (8), `EscrowAlreadyReleased` (7), `Unauthorized` (4).

### `get_escrow(escrow_id: u64) -> Result<Escrow, PaymentError>`

Returns an escrow.

- **Access:** public read.
- **Errors:** `EscrowNotFound` (8).

### `get_escrow_count() -> u64`

Returns the number of escrows.

- **Access:** public read.

---

## Streams

### `create_stream(creator: Address, recipient: Address, total_amount: i128, asset: Address, start_time: u64, end_time: u64, metadata: String) -> Result<u64, PaymentError>`

Creates a payment stream; returns the stream ID.

- **Access:** actor auth (`creator.require_auth()`); funds deposited.
- **Errors:** `ContractPaused` (18), `InvalidAmount` (5), `StreamEndBeforeStart` (69), `TokenTransferFailed` (15).

### `claim_stream(recipient: Address, stream_id: u64) -> Result<i128, PaymentError>`

Claims the accrued stream amount; returns the claimed amount.

- **Access:** actor auth (`recipient.require_auth()`).
- **Errors:** `StreamNotFound` (11), `StreamNotStarted` (9), `StreamFullyClaimed` (12), `Unauthorized` (4).

### `cancel_stream(creator: Address, stream_id: u64) -> Result<i128, PaymentError>`

Cancels a stream and returns the unclaimed remainder to the creator.

- **Access:** actor auth (`creator.require_auth()`).
- **Errors:** `StreamNotFound` (11), `StreamAlreadyCancelled` (10), `Unauthorized` (4).

### `get_stream(stream_id: u64) -> Result<Stream, PaymentError>`

Returns a stream.

- **Access:** public read.
- **Errors:** `StreamNotFound` (11).

### `get_stream_count() -> u64`

Returns the number of streams.

- **Access:** public read.

---

## Recurring payments

### `create_recurring(creator: Address, payee: Address, amount: i128, asset: Address, schedule: ScheduleType, remaining: u32, metadata: String) -> Result<u64, PaymentError>`

Creates a recurring payment schedule; returns the recurring ID.

- **Access:** actor auth (`creator.require_auth()`); `require_not_paused`.
- **Errors:** `ContractPaused` (18), `InvalidAmount` (5), `RecurringScheduleInvalid` (75), `TokenTransferFailed` (15).

### `execute_recurring(caller: Address, recurring_id: u64) -> Result<u64, PaymentError>`

Executes the next due recurring payment; returns the payment ID.

- **Access:** actor auth (`caller.require_auth()`); anyone may trigger a due payment.
- **Errors:** `RecurringNotFound` (30), `RecurringNotDue` (31), `RecurringExpired` (33), `TokenTransferFailed` (15).

### `cancel_recurring(caller: Address, recurring_id: u64) -> Result<(), PaymentError>`

Cancels a recurring schedule.

- **Access:** actor auth (`caller.require_auth()`); creator only.
- **Errors:** `RecurringNotFound` (30), `RecurringAlreadyCancelled` (32), `Unauthorized` (4).

### `get_recurring(recurring_id: u64) -> Result<RecurringPayment, PaymentError>`

Returns a recurring schedule.

- **Access:** public read.
- **Errors:** `RecurringNotFound` (30).

### `get_recurring_count() -> u64`

Returns the number of recurring schedules.

- **Access:** public read.

---

## Refunds

### `request_refund(requester: Address, payment_id: u64, amount: i128, asset: Address, reason: String, reason_code: RefundReasonCode) -> Result<u64, PaymentError>`

Requests a refund; returns the refund ID.

- **Access:** actor auth (`requester.require_auth()`); within refund window.
- **Errors:** `PaymentNotFound` (3), `PaymentAlreadyRefunded` (49), `RefundWindowExpired` (50), `InvalidAmount` (5).

### `approve_refund(caller: Address, refund_id: u64) -> Result<(), PaymentError>`

Approves a refund request.

- **Access:** Operator role (`caller.require_auth()` + `require_role(Operator)`).
- **Errors:** `RefundNotFound` (47), `NotARoleHolder` (27), `RefundAlreadyProcessed` (48).

### `reject_refund(caller: Address, refund_id: u64) -> Result<(), PaymentError>`

Rejects a refund request.

- **Access:** Operator role (`caller.require_auth()` + `require_role(Operator)`).
- **Errors:** `RefundNotFound` (47), `NotARoleHolder` (27), `RefundRejected` (57).

### `process_refund(caller: Address, refund_id: u64) -> Result<(), PaymentError>`

Processes (disburses) an approved refund.

- **Access:** Operator role (`caller.require_auth()` + `require_role(Operator)`).
- **Errors:** `RefundNotFound` (47), `NotARoleHolder` (27), `RefundAlreadyProcessed` (48), `TokenTransferFailed` (15).

### `get_refund(refund_id: u64) -> Result<Refund, PaymentError>`

Returns a refund record.

- **Access:** public read.
- **Errors:** `RefundNotFound` (47).

### `get_refund_count() -> u64`

Returns the number of refunds.

- **Access:** public read.

### `get_reason_code_analytics() -> Vec<(u32, u64)>`

Returns refund counts grouped by reason code.

- **Access:** public read (Auditor-friendly).

---

## Webhooks / notification hooks

### `register_hook(subscriber: Address, event_type: String, webhook_url: String) -> Result<u64, PaymentError>`

Registers a webhook subscription; returns the hook ID.

- **Access:** actor auth (`subscriber.require_auth()`); `require_not_paused`.
- **Errors:** `ContractPaused` (18), `InvalidEventType` (83), `WebhookUrlTooLong` (84), `HookAlreadyExists` (63), `MaxHooksExceeded` (85).

### `unregister_hook(caller: Address, hook_id: u64) -> Result<(), PaymentError>`

Removes a webhook subscription.

- **Access:** actor auth (`caller.require_auth()`); subscriber only.
- **Errors:** `HookNotFound` (62), `Unauthorized` (4).

### `get_hooks_by_event(event_type: String) -> Vec<(u64, String)>`

Returns `(hook_id, url)` pairs for an event type.

- **Access:** public read.

### `get_subscriber_hooks(subscriber: Address) -> Vec<NotificationHook>`

Returns all hooks for a subscriber.

- **Access:** public read.

### `get_hook_count() -> u64`

Returns the number of hooks.

- **Access:** public read.

---

## Batches

### `create_batch(creator: Address, payees: Vec<Address>, amounts: Vec<i128>, asset: Address, tx_hash: String) -> Result<BatchCreateResult, PaymentError>`

Creates a batch of payments; returns a `BatchCreateResult` (batch ID +
per-payment results).

- **Access:** actor auth (`creator.require_auth()`); `require_not_paused`.
- **Errors:** `ContractPaused` (18), `BatchEmpty` (14), `BatchTooLarge` (13), `MaxRecipientsExceeded` (67), `DuplicateRecipient` (68), `BatchItemFailed` (74), `TokenTransferFailed` (15).

### `get_batch(batch_id: u64) -> Result<BatchPayment, PaymentError>`

Returns a batch record.

- **Access:** public read.
- **Errors:** *(batch missing)*.

### `get_batch_count() -> u64`

Returns the number of batches.

- **Access:** public read.

### `get_payments_by_batch(batch_id: u64) -> Vec<Payment>`

Returns the payments belonging to a batch.

- **Access:** public read.

---

# PaymentEventEmitter

## Initialization & identity

### `init(owner: Address) -> Result<u32, EmitterError>`

Initializes the emitter with `owner`.

- **Access:** owner auth (the new owner).
- **Errors:** `AlreadyInitialized` (2).
- **Example:**
  ```bash
  stellar contract invoke --id $EMITTER --source $OWNER \
    -- init --owner $OWNER
  ```

### `get_owner() -> Result<Address, EmitterError>`

Returns the emitter owner.

- **Access:** public read.
- **Errors:** `NotInitialized` (1).

---

## Event emission

### `emit_payment(caller: Address, source: String, payer: Address, payee: Address, amount: i128, tx_hash: String) -> Result<u64, EmitterError>`

Records a payment event and publishes it; returns the event ID.

- **Access:** actor auth (`caller.require_auth()`) **and** allow-list: caller
  must equal the configured allowed source (or the owner). Rejects with
  `Unauthorized` otherwise.
- **Errors:** `NotInitialized` (1), `Unauthorized` (4), `ContractPaused` (7),
  `InvalidAmount` (8), `InvalidTxHash` (12), `MaxEventsReached` (10),
  `EmitFailed` (13).
- **Example (source contract call):**
  ```rust
  emitter_client.emit_payment(&env.current_contract_address(), &source,
      &payer, &payee, &amount, &tx_hash);
  ```

### `get_event(event_id: u64) -> Result<PaymentEvent, EmitterError>`

Returns a stored payment event.

- **Access:** public read.
- **Errors:** `EventNotFound` (3).

### `get_event_count() -> u64`

Returns the number of emitted events.

- **Access:** public read.

---

## Allow-list

### `set_allowed_source(caller: Address, source: Option<Address>) -> Result<(), EmitterError>`

Sets (or clears, with `None`) the allow-listed source contract. When set,
only this address may call `emit_payment`.

- **Access:** owner-only (`caller.require_auth()` + owner check).
- **Errors:** `NotInitialized` (1), `Unauthorized` (4).

### `get_allowed_source() -> Option<Address>`

Returns the allow-listed source, if set.

- **Access:** public read.

---

## Upgrade & ownership

### `propose_upgrade(caller: Address, new_wasm_hash: BytesN<32>) -> Result<(), EmitterError>`

Proposes an upgrade to `new_wasm_hash`.

- **Access:** owner-only (`caller.require_auth()` + owner check).
- **Errors:** `NotInitialized` (1), `Unauthorized` (4).

### `execute_upgrade() -> Result<(), EmitterError>`

Executes the pending upgrade after the timelock.

- **Access:** public.
- **Errors:** `UpgradeNotProposed` (5), `UpgradeTimelockActive` (6).

### `cancel_upgrade(caller: Address) -> Result<(), EmitterError>`

Cancels a pending upgrade.

- **Access:** owner-only (`caller.require_auth()` + owner check).
- **Errors:** `NotInitialized` (1), `Unauthorized` (4), `UpgradeNotProposed` (5).

### `transfer_ownership(caller: Address, new_owner: Address) -> Result<(), EmitterError>`

Initiates a two-step ownership transfer.

- **Access:** owner-only (`caller.require_auth()` + owner check).
- **Errors:** `NotInitialized` (1), `Unauthorized` (4), `PendingOwnershipTransfer` (71).

### `accept_ownership(caller: Address) -> Result<(), EmitterError>`

Accepts a pending ownership transfer.

- **Access:** actor auth; caller must be pending owner.
- **Errors:** `Unauthorized` (4), `OwnershipTransferExpired` (72).

---

## Pause controls

### `pause(caller: Address) -> Result<(), EmitterError>`

Pauses event emission.

- **Access:** owner-only (`caller.require_auth()` + owner check).
- **Errors:** `NotInitialized` (1), `Unauthorized` (4).

### `unpause(caller: Address) -> Result<(), EmitterError>`

Unpauses event emission.

- **Access:** owner-only (`caller.require_auth()` + owner check).
- **Errors:** `NotInitialized` (1), `Unauthorized` (4).

### `is_paused() -> bool`

Returns whether the emitter is paused.

- **Access:** public read.

---

# Common call examples

### Off-chain payment record (OphirPay)

```bash
stellar contract invoke --id $CONTRACT --source $PAYER \
  -- record_payment \
  --payer $PAYER \
  --payee $PAYEE \
  --amount 10000000 \
  --asset $ASSET \
  --tx_hash "deadbeef" \
  --metadata "invoice-1234"
```

### Multisig flow (OphirPay)

```bash
# 1. Configure (owner)
stellar contract invoke --id $CONTRACT --source $OWNER \
  -- set_multisig_config --caller $OWNER --threshold 2 \
  --signers '["GAAA…1", "GAAA…2", "GAAA…3"]' --enabled true

# 2. Propose (proposer)
stellar contract invoke --id $CONTRACT --source $PROPOSER \
  -- propose_payment --proposer $PROPOSER --payee $PAYEE \
  --amount 5000000 --asset $ASSET --tx_hash "abc123"

# 3. Approve (signer)
stellar contract invoke --id $CONTRACT --source $SIGNER \
  -- approve_payment --signer $SIGNER --request_id 1

# 4. Execute
stellar contract invoke --id $CONTRACT --source $SIGNER \
  -- execute_approved_payment --caller $SIGNER --request_id 1
```

### Emitter allow-list + emit

```bash
# Owner sets the orchestrator as allowed source
stellar contract invoke --id $EMITTER --source $OWNER \
  -- set_allowed_source --caller $OWNER --source $ORCHESTRATOR

# Orchestrator emits an event
stellar contract invoke --id $EMITTER --source $ORCHESTRATOR \
  -- emit_payment --caller $ORCHESTRATOR --source "OphirPay" \
  --payer $PAYER --payee $PAYEE --amount 1000000 --tx_hash "0x1234"
```

### Read a payment (any caller)

```bash
stellar contract invoke --id $CONTRACT --source $ANY \
  -- get_payment --payment_id 1
```

---

# Maintenance

When a function's signature, access guard, or error set changes, update this
document in the same commit. The source of truth is the `#[contractimpl]`
blocks in `contracts/ophirpay/src/lib.rs` and
`contracts/emitter/src/lib.rs`.
