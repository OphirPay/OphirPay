# Soroban Contract Function Reference

Complete reference for the OphirPay (`ophirpay-contract`) and PaymentEventEmitter (`ophirpay-emitter`) Soroban smart contracts.

## OphirPay Contract

### Admin Functions

| Function | Args | Access | Returns | Events |
|----------|------|--------|---------|--------|
| `init` | `owner: Address` | Deployer | `Result<u32, PaymentError>` | — |
| `set_emitter` | `caller: Address, emitter: Address` | Admin | `Result<(), PaymentError>` | — |
| `set_fee_config` | `caller: Address, fee_bps: u32, fee_min: i128` | Admin | `()` | `FeeConfigUpdated` |
| `emergency_pause_all` | `caller: Address` | Admin | `Result<(), PaymentError>` | — |
| `emergency_unpause_all` | `caller: Address` | Admin | `Result<(), PaymentError>` | — |

### Payment Functions

| Function | Args | Access | Returns | Events |
|----------|------|--------|---------|--------|
| `record_payment` | `payer: Address, payee: Address, amount: i128, memo: Symbol` | Payer | `Result<u64, PaymentError>` | `PaymentCreated` |
| `create_batch` | `caller: Address, payments: Vec<PaymentInput>` | Payer | `Result<u64, PaymentError>` | `PaymentCreated` (×N) |
| `cancel_payment` | `caller: Address, payment_id: u64` | Payer/Admin | `Result<(), PaymentError>` | `PaymentCancelled` |
| `request_refund` | `caller: Address, payment_id: u64, reason: Symbol` | Payer | `Result<u64, PaymentError>` | `RefundRequested` |

### Read-Only Functions

| Function | Args | Returns | Description |
|----------|------|---------|-------------|
| `get_payment` | `payment_id: u64` | `Result<Payment, PaymentError>` | Full payment record |
| `get_payment_count` | — | `u64` | Total payments recorded |
| `get_payments_range` | `start_id: u64, end_id: u64` | `Vec<Payment>` | Paginated payments by range |
| `get_payments_by_batch` | `batch_id: u64` | `Vec<Payment>` | Payments in a batch |
| `get_owner` | — | `Result<Address, PaymentError>` | Contract owner address |
| `get_fee_config` | — | `Option<FeeConfig>` | Current fee configuration |
| `get_stats` | — | `ContractStats` | Contract statistics |

---

## Emitter Contract

### Event Recording

| Function | Args | Access | Returns | Events |
|----------|------|--------|---------|--------|
| `init` | `owner: Address` | Deployer | `Result<u32, EmitterError>` | — |
| `emit_payment` | `payer: Address, payee: Address, amount: i128, payment_id: u64, status: Symbol` | OphirPay contract | `Result<u64, EmitterError>` | `PaymentEventEmitted` |

### Event Queries

| Function | Args | Returns | Description |
|----------|------|---------|-------------|
| `get_event` | `event_id: u64` | `Result<PaymentEvent, EmitterError>` | Single event by id |
| `get_event_count` | — | `u64` | Total events emitted |
| `get_owner` | — | `Result<Address, EmitterError>` | Emitter owner address |
| `is_paused` | — | `bool` | Whether emitter is paused |

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
           SSE / WebSocket → clients (use WSS in production)
```

---

## See Also

- [SSE Event Schema](./sse-event-schema.md) — Client integration
- [Contract Architecture](./architecture.md) — Design overview
- [Gas Optimization](./GAS.md) — Fee reduction strategies
- [STELLAR_101.md](./STELLAR_101.md) — Stellar fundamentals
