# Soroban Smart Contract Event Emission & SSE Integration Reference

## Overview

This specification details how OphirPay's **Soroban Smart Contracts** (Rust / Stellar VM) emit on-chain ledger events, and how off-chain indexing services translate these events into **Server-Sent Events (SSE)** broadcast via `/api/events`.

---

## 1. On-Chain Soroban Event Architecture

Soroban contracts emit structured events composed of **Topics** (filtering keys) and **Data** (payload values):

```rust
// Soroban Event Emission Pattern
env.events().publish(
    (Symbol::new(&env, "payment"), Symbol::new(&env, "status_changed")), // Topics
    (payment_id, new_status, amount, asset)                              // Data
);
```

### Event Topics Structure

| Topic Index | Symbol / Type | Description |
| :--- | :--- | :--- |
| **Topic 0** | `Symbol` | Primary domain namespace: `"payment"`, `"escrow"`, `"stream"`, `"batch"` |
| **Topic 1** | `Symbol` | Action identifier: `"recorded"`, `"settled"`, `"refunded"`, `"cancelled"` |
| **Topic 2** | `Address` (Optional) | Payer or Payee account address for indexed horizon filtering |

---

## 2. Event Signatures & Payload Mappings

### Payment Status Transition Event

* **Contract Function:** `record_payment(...)` / `settle_payment(...)`
* **Topics:** `("payment", "settled")`
* **Contract Payload (ScVal):**
  * `payment_id`: `u64`
  * `payer`: `Address`
  * `payee`: `Address`
  * `amount`: `i128` (stroops)
  * `asset`: `Address` (Stellar Asset Contract)

#### Off-Chain SSE JSON Translation:

```json
{
  "event": "payment_status_update",
  "data": {
    "paymentId": "482019",
    "status": "COMPLETED",
    "payer": "GBXXX...",
    "payee": "GDYYY...",
    "amount": "500.0000000",
    "asset": "XLM",
    "ledgerSequence": 52910400
  }
}
```

---

### Batch Execution Event

* **Contract Function:** `process_batch(...)`
* **Topics:** `("batch", "processed")`
* **Contract Payload:**
  * `batch_id`: `u64`
  * `total_count`: `u32`
  * `total_amount`: `i128`
  * `asset`: `Address`

---

## 3. Off-Chain Ingest & SSE Relayer Flow

```
┌─────────────────────────┐
│ Stellar / Soroban State │
└───────────┬─────────────┘
            │ On-Chain env.events().publish(...)
            ▼
┌─────────────────────────┐
│  Stellar RPC Indexer    │ ──> Polls getEvents filtered by ContractId & Topics
└───────────┬─────────────┘
            │ Decodes ScVal to JSON Event DTO
            ▼
┌─────────────────────────┐
│   OphirPay SSE Gateway  │ ──> Pushes to active HTTP client streams (/api/events)
└─────────────────────────┘
```
