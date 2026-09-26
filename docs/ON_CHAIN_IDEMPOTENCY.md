# On-Chain Idempotency Architecture & Reference

## Overview

OphirPay guarantees end-to-end idempotency for payment recording across both the database application layer and the Soroban smart contract layer.

Previously, idempotency keys were tracked only in the database (migrations `20260826140000_add_payment_idempotency_key` and `20260827000000_add_batch_idempotency_key`). The Soroban contract's `record_payment` function was unkeyed, meaning a duplicated or retried transaction at the blockchain level produced duplicate payment records with distinct payment IDs, complicating reconciliation between the database and the ledger.

This subsystem extends idempotency down to the smart contract runtime, ensuring exact agreement between the database and on-chain records.

---

## Smart Contract Specification

### 1. Storage Key

The contract uses persistent storage indexed by the `IDEM_KEY` symbol:

```rust
const IDEMPOTENCY_KEY: Symbol = symbol_short!("IDEM_KEY");
// Storage tuple: (IDEMPOTENCY_KEY, idempotency_key: String) -> u64 (payment_id)
```

Each idempotency mapping is bumped with `BUMP_MIN_TTL` (5,000 ledgers) and `BUMP_MAX_TTL` (50,000 ledgers) alongside the payment record.

### 2. `record_payment` Function Signature

```rust
pub fn record_payment(
    env: Env,
    payer: Address,
    payee: Address,
    amount: i128,
    asset: Address,
    tx_hash: String,
    metadata: String,
    idempotency_key: Option<String>,
) -> Result<u64, PaymentError>
```

#### Lifecycle & Behavior:
1. **Authorization & Paused Check**: `payer.require_auth()` and `require_not_paused(&env)` are verified.
2. **Deduplication Check**: If `idempotency_key` is `Some(key)` and non-empty:
   - Queries `env.storage().persistent().get(&(IDEMPOTENCY_KEY, key.clone()))`.
   - If an existing payment ID is found, returns `Ok(existing_id)` immediately.
   - **Crucial**: Protocol fee collection (`collect_fee`) is bypassed on duplicates, preventing double-charging.
3. **Fee Collection & State Creation**: If first submission:
   - Collects protocol fee.
   - Increments payment counter.
   - Stores `Payment` record with `idempotency_key: Some(key)`.
   - Stores `(IDEMPOTENCY_KEY, key) -> count` mapping.
4. **Event Emission**: Publishes the native Soroban event containing the idempotency key in its data payload.

### 3. Emitted Event Format

The Soroban payment event surfaces the idempotency key directly:

- **Topics**: `(Symbol::new(env, "payment"), payer: Address, payee: Address)`
- **Data Payload**: `(amount: i128, idempotency_key: Option<String>)`

Indexers and webhooks can inspect the data payload to instantly deduplicate incoming ledger events without an extra contract invocation.

### 4. Query Functions

- `get_payment_id_by_idempotency(env: Env, idempotency_key: String) -> Option<u64>`: Returns the payment ID associated with the idempotency key, or `None` (named within Soroban's 32-character symbol limit).
- `get_payment_by_idempotency_key(env: Env, idempotency_key: String) -> Result<Payment, PaymentError>`: Returns the full `Payment` struct, or `PaymentError::PaymentNotFound`.

---

## PaymentEventEmitter Support

The `PaymentEventEmitter` contract (`contracts/emitter/src/lib.rs`) includes corresponding idempotent entrypoints:

- `emit_payment_idempotent(env, caller, source, payer, payee, amount, tx_hash, idempotency_key: Option<String>) -> Result<u64, EmitterError>`: Deduplicates external payment events using `symbol_short!("EVT_IDEM")`.
- `get_event_id_by_idempotency_key(env, idempotency_key: String) -> Option<u64>`: Query function for event idempotency.
- `emit_payment(...)`: Backward-compatible wrapper delegating to `emit_payment_idempotent(..., None)`.

---

## Application Layer Integration

### 1. Send Page Flow (`src/app/send/page.tsx`)

When a user submits an off-chain transaction to Horizon:
1. The frontend generates a client idempotency key: `const idempotencyKey = crypto.randomUUID()`.
2. The frontend invokes `recordPaymentOnChain({ ..., idempotencyKey })` with this key.
3. The frontend simultaneously records the database row via `recordPaymentMutation.mutateAsync({ ..., idempotencyKey })`.
4. Both layers share the exact same key.

### 2. Payments API Route (`src/app/api/payments/route.ts`)

- Accepts `Idempotency-Key` HTTP header or body `idempotencyKey`.
- Checks for an existing payment for the authenticated user with that key (`prisma.payment.findFirst`).
- If found, returns HTTP `200` with `{ data: existing, meta: { deduplicated: true } }`.
- If new, stores the key on `Payment.idempotencyKey` and returns HTTP `201`.

### 3. Database Indexing (`prisma/schema.prisma`)

```prisma
model Payment {
  ...
  idempotencyKey    String?
  ...
  @@index([idempotencyKey])
}
```

Indexed via migration `20260924110000_add_payment_idempotency_index/migration.sql` for high-throughput lookup during payment creation and webhook reconciliation.
