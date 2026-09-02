# Smart Contract Reference: SSE Event Emission

This document describes how the OphirPay `PaymentEventEmitter` Soroban smart contract emits events that power the Server-Sent Events (SSE) stream consumed by clients.

## Contract

- **Contract:** `PaymentEventEmitter`
- **Source:** `contracts/emitter/src/lib.rs`
- **Event topic:** `payment_event`

## Data Model

### `PaymentEvent`

Stored permanently by event ID.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `u64` | Monotonic event identifier (1-based). |
| `source` | `String` | Human-readable source label, e.g. `"OphirPay"`. |
| `payer` | `Address` | Stellar account or contract that initiated the payment. |
| `payee` | `Address` | Stellar account or contract receiving the payment. |
| `amount` | `i128` | Payment amount in stroops or token-specific units. |
| `tx_hash` | `String` | On-chain transaction hash. |
| `timestamp` | `u64` | Ledger timestamp when the event was recorded. |

## Contract Functions

### Initialization

```rust
pub fn init(env: Env, owner: Address) -> Result<u32, EmitterError>
```

- Must be called once before any event can be emitted.
- `owner` authorizes and becomes the contract owner.
- Sets `EVENT_COUNT` to `0`.

**Errors:**
- `AlreadyInitialized` — contract already initialized.

### Emit a Payment Event

```rust
pub fn emit_payment(
    env: Env,
    caller: Address,
    source: String,
    payer: Address,
    payee: Address,
    amount: i128,
    tx_hash: String,
) -> Result<u64, EmitterError>
```

- `caller` must authorize the transaction.
- If an allow-listed source is configured, `caller` must be that source or the owner.
- Rejects emits while the contract is paused.
- Increments `EVENT_COUNT`, persists the `PaymentEvent`, and emits a native contract event.
- Returns the newly assigned event ID.

**Authorization:**
- `caller.require_auth()` is enforced.
- Allow-list check prevents unauthorized accounts from fabricating events.

**Errors:**
- `Unauthorized` — caller is not the owner or allow-listed source.
- `ContractPaused` — emits are currently paused.
- `InvalidAmount` — amount validation failed (if enabled).
- `DuplicateEvent` — event already exists.
- `MaxEventsReached` — storage limit reached.

### Read Functions

```rust
pub fn get_event(env: Env, event_id: u64) -> Result<PaymentEvent, EmitterError>
pub fn get_event_count(env: Env) -> u64
pub fn get_owner(env: Env) -> Result<Address, EmitterError>
pub fn get_allowed_source(env: Env) -> Option<Address>
```

## Native Event Emission

When `emit_payment` succeeds, the contract publishes a native Soroban event:

```rust
env.events().publish(
    (Symbol::new(&env, "payment_event"), payer, payee),
    (amount, tx_hash),
);
```

### Event Topics

| Topic Index | Type | Value |
|-------------|------|-------|
| 0 | `Symbol` | `"payment_event"` |
| 1 | `Address` | `payer` |
| 2 | `Address` | `payee` |

### Event Data

| Data Index | Type | Value |
|------------|------|-------|
| 0 | `i128` | `amount` |
| 1 | `String` | `tx_hash` |

## SSE Integration Flow

```
┌─────────────────┐     emit_payment      ┌─────────────────────┐
│  OphirPay       │ ─────────────────────>│  PaymentEventEmitter  │
│  orchestrator   │                       │  contract             │
└─────────────────┘                       └─────────────────────┘
                                                   │
                                                   │ native event
                                                   │ payment_event
                                                   ▼
                                          ┌─────────────────────┐
                                          │  Backend indexer    │
                                          │  listens to events  │
                                          └─────────────────────┘
                                                   │
                                                   │ normalized payload
                                                   ▼
                                          ┌─────────────────────┐
                                          │  SSE endpoint       │
                                          │  /api/events        │
                                          └─────────────────────┘
```

## Allow-List Management

```rust
pub fn set_allowed_source(
    env: Env,
    caller: Address,
    source: Option<Address>,
) -> Result<(), EmitterError>
```

- Owner-only function.
- Sets the only non-owner address that may call `emit_payment`.
- Pass `None` to clear the allow-list (not recommended in production).

## Pause / Upgrade

| Function | Access | Purpose |
|----------|--------|---------|
| `propose_upgrade` | owner | Set new WASM hash with 24-hour timelock. |
| `execute_upgrade` | anyone | Execute upgrade after timelock expires. |
| `cancel_upgrade` | owner | Cancel pending upgrade. |

The contract rejects `emit_payment` while paused (pause is controlled by the orchestrator via a separate admin path).

## Error Codes

| Code | Error | Meaning |
|------|-------|---------|
| 1 | `NotInitialized` | Contract has not been initialized. |
| 2 | `AlreadyInitialized` | Contract already initialized. |
| 3 | `EventNotFound` | Requested event ID does not exist. |
| 4 | `Unauthorized` | Caller lacks permission. |
| 5 | `UpgradeNotProposed` | No upgrade has been proposed. |
| 6 | `UpgradeTimelockActive` | Upgrade timelock has not expired. |
| 7 | `ContractPaused` | Contract is paused. |
| 8 | `InvalidAmount` | Invalid payment amount. |
| 9 | `DuplicateEvent` | Duplicate event ID. |
| 10 | `MaxEventsReached` | Maximum event count reached. |
| 11 | `ReentrantCall` | Reentrant call detected. |
| 12 | `InvalidTxHash` | Invalid transaction hash. |
| 13 | `EmitFailed` | Generic emit failure. |
| 14 | `CrossContractCallFailed` | Cross-contract call failed. |

## Related Documentation

- `docs/SSE.md` — normalized SSE payloads delivered to clients.
- `docs/SSE_DOCUMENTATION.md` — client integration, reconnection, and endpoint guidance.
- `docs/integration-guide.md` — end-to-end integration overview.
