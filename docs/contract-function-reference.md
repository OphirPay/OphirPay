# Soroban Contract Function Reference

Complete reference for the OphirPay (`ophirpay`) and PaymentEventEmitter (`emitter`) Soroban smart contracts.

## OphirPay Contract

### Admin Functions

| Function | Args | Access | Returns | Events |
|----------|------|--------|---------|--------|
| `initialize` | `admin: Address, gateway: Address, token: Address` | Deployer | `()` | — |
| `set_ratio` | `program_id: u64, maintainer: Address, reward_per_point: i128` | Maintainer | `()` | `RatioUpdated` |
| `set_fee_config` | `program_id: u64, maintainer: Address, fee_bps: u32, fee_min: i128` | Maintainer | `()` | `FeeConfigUpdated` |
| `pause` | `program_id: u64, maintainer: Address` | Maintainer | `()` | `ProgramPaused` |
| `resume` | `program_id: u64, maintainer: Address` | Maintainer | `()` | `ProgramResumed` |

### Payment Functions

| Function | Args | Access | Returns | Events |
|----------|------|--------|---------|--------|
| `create_payment` | `payer: Address, payee: Address, amount: i128, memo: Symbol` | Payer | `u64` (payment_id) | `PaymentCreated` |
| `batch_create_payments` | `payer: Address, payments: Vec<PaymentInput>` | Payer | `Vec<u64>` | `PaymentCreated` (×N) |
| `cancel_payment` | `payment_id: u64, caller: Address` | Payer/Admin | `()` | `PaymentCancelled` |
| `refund_payment` | `payment_id: u64, reason: Symbol, admin: Address` | Admin | `()` | `PaymentRefunded` |

### Read-Only Functions

| Function | Args | Returns | Description |
|----------|------|---------|-------------|
| `get_payment` | `payment_id: u64` | `Payment` | Full payment record |
| `get_payment_status` | `payment_id: u64` | `PaymentStatus` | `Pending`, `Processing`, `Completed`, `Failed`, `Cancelled`, `Refunded` |
| `get_payer_payments` | `payer: Address, cursor: u64, limit: u32` | `Vec<Payment>` | Paginated payments by payer |
| `get_program_config` | `program_id: u64` | `ProgramConfig` | Reward ratio, fee config, escrow |
| `admin` | — | `Address` | Contract admin address |

---

## Emitter Contract

### Event Recording

| Function | Args | Access | Returns | Events |
|----------|------|--------|---------|--------|
| `initialize` | `admin: Address` | Deployer | `()` | — |
| `emit_payment_event` | `payer: Address, payee: Address, amount: i128, payment_id: u64, status: Symbol` | OphirPay contract | `u64` (event_id) | `PaymentEventEmitted` |

### Event Queries

| Function | Args | Returns | Description |
|----------|------|---------|-------------|
| `get_event` | `event_id: u64` | `PaymentEvent` | Single event by id |
| `get_events` | `start_id: u64, limit: u32` | `Vec<PaymentEvent>` | Paginated events for SSE |
| `last_event_id` | — | `u64` | Latest emitted event id |
| `total_events` | — | `u64` | Total events emitted |

---

## Error Codes

| Code | Name | Description |
|------|------|-------------|
| 1 | `AlreadyInitialized` | Contract already initialized |
| 2 | `NotInitialized` | Contract not yet initialized |
| 3 | `Unauthorized` | Caller lacks required authorization |
| 4 | `PaymentNotFound` | Payment ID does not exist |
| 5 | `InsufficientBalance` | Payer has insufficient funds |
| 6 | `InvalidAmount` | Amount is zero or negative |
| 7 | `InvalidMemo` | Memo exceeds length or charset limits |
| 8 | `PaymentAlreadyProcessed` | Payment is in a final state |
| 9 | `ProgramPaused` | Program paused; payments disabled |
| 10 | `Overflow` | Arithmetic overflow |

---

## Storage Types

### Payment

```
struct Payment {
    id: u64,
    payer: Address,
    payee: Address,
    amount: i128,
    memo: BytesN<64>,
    status: PaymentStatus,
    created_at: u64,
    tx_hash: Option<BytesN<32>>,
}
```

### PaymentEvent

```
struct PaymentEvent {
    id: u64,
    event_type: Symbol,
    payment_id: u64,
    payer: Address,
    payee: Address,
    amount: i128,
    status: Symbol,
    timestamp: u64,
}
```

---

## Gas Estimates

| Function | Estimated Gas | Notes |
|----------|---------------|-------|
| `create_payment` | ~15,000 | Single payment with 1 write + 1 event |
| `batch_create_payments` | ~15,000 + N×12,000 | Per-item cost |
| `emit_payment_event` | ~8,000 | Single event emission |
| `get_events` | 0 | Simulated (no on-chain cost) |
| All read-only functions | 0 | Simulated via Soroban RPC |

---

## Cross-Contract Flow

```
OphirPay.create_payment()
    │
    ├─ writes Payment record
    ├─ transfers tokens (payer → contract)
    └─ calls Emitter.emit_payment_event()
           │
           └─ writes PaymentEvent record
                  │
                  ▼
           Event Source polls get_events()
                  │
                  ▼
           SSE / WebSocket → clients
```

---

## See Also

- [SSE Event Schema](./sse-event-schema.md) — Client integration
- [Contract Architecture](./architecture.md) — Design overview
- [Gas Optimization](./GAS.md) — Fee reduction strategies
- [STELLAR_101.md](./STELLAR_101.md) — Stellar fundamentals
