# Automation Platform Integration Guide (n8n, Zapier, Make)

This guide explains how to consume OphirPay payment webhooks within no-code and low-code workflow automation platforms such as **n8n**, **Zapier**, and **Make (Integromat)**.

---

## 1. Supported Event Types & Field Meanings

OphirPay broadcasts events corresponding to distinct states in payment and batch orchestration:

| Event Type | Lifecycle Stage | Description |
| :--- | :--- | :--- |
| `payment.created` | Initialization | Payment intent registered; awaiting required approvals or signatures |
| `payment.signed` | Authorization | Multisig or threshold signatures collected |
| `payment.submitted` | Mempool Broadcast | Transaction submitted to the Soroban RPC / Stellar network |
| `payment.confirmed` | Final Settlement | Ledger inclusion confirmed; funds transferred |
| `payment.failed` | Terminal Failure | Transaction rejected (insufficient funds, bad sequence, expired) |
| `batch.created` | Batch Queue | Group of payments queued for bulk settlement |
| `batch.completed` | Batch Final | All payments in batch successfully executed |
| `batch.failed` | Batch Failure | One or more critical batch items failed |

### Common Payload Fields

- **`event`** *(string)*: The event identifier (e.g. `payment.confirmed`).
- **`timestamp`** *(ISO-8601 string)*: UTC time the event occurred.
- **`idempotency_key`** *(string)*: Unique key per business operation (`idem_...`). Use this to deduplicate actions in your workflow.
- **`data`** *(object)*:
  - `id`: Unique OphirPay payment identifier (`pay_...`).
  - `amount`: Numeric transaction value.
  - `asset`: Currency symbol (`USDC`, `XLM`, or custom SAC).
  - `sender`: Stellar public key of the sending account.
  - `recipient`: Stellar public key or federated address of the destination.
  - `status`: Current lifecycle state name.
  - `tx_hash` *(optional)*: Stellar transaction hash once submitted to ledger.
  - `memo` *(optional)*: Text or ID memo associated with payment.
  - `error_code` *(on failure)*: Machine-readable error identifier (e.g. `INSUFFICIENT_BALANCE`).
  - `error_message` *(on failure)*: Human-readable diagnostic description.
- **`signature`** *(string)*: HMAC-SHA256 signature for verification.

---

## 2. Complete Lifecycle Payloads

Generated example payloads are stored under [`examples/automation-payloads/`](../examples/automation-payloads/):

### Stage 1: Created (`payment.created`)
```json
{
  "event": "payment.created",
  "timestamp": "2026-09-24T10:00:00Z",
  "idempotency_key": "idem_pay_8f29d102",
  "data": {
    "id": "pay_01HF9A7BC001",
    "amount": 100.0,
    "asset": "USDC",
    "sender": "GBEXAMPLE...SENDER1",
    "recipient": "GCRECEIVER...ORG2",
    "status": "pending_signature",
    "memo": "Invoice #1042"
  },
  "signature": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
}
```

### Stage 2: Signed (`payment.signed`)
```json
{
  "event": "payment.signed",
  "timestamp": "2026-09-24T10:01:15Z",
  "idempotency_key": "idem_pay_8f29d102",
  "data": {
    "id": "pay_01HF9A7BC001",
    "amount": 100.0,
    "asset": "USDC",
    "sender": "GBEXAMPLE...SENDER1",
    "recipient": "GCRECEIVER...ORG2",
    "status": "signed",
    "memo": "Invoice #1042"
  },
  "signature": "a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0"
}
```

### Stage 3: Submitted (`payment.submitted`)
```json
{
  "event": "payment.submitted",
  "timestamp": "2026-09-24T10:01:20Z",
  "idempotency_key": "idem_pay_8f29d102",
  "data": {
    "id": "pay_01HF9A7BC001",
    "amount": 100.0,
    "asset": "USDC",
    "sender": "GBEXAMPLE...SENDER1",
    "recipient": "GCRECEIVER...ORG2",
    "status": "submitted",
    "tx_hash": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    "memo": "Invoice #1042"
  },
  "signature": "7c98b6b19a3b8d1d8a4f9b2c3e4d5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f"
}
```

### Stage 4: Confirmed (`payment.confirmed`)
```json
{
  "event": "payment.confirmed",
  "timestamp": "2026-09-24T10:01:25Z",
  "idempotency_key": "idem_pay_8f29d102",
  "data": {
    "id": "pay_01HF9A7BC001",
    "amount": 100.0,
    "asset": "USDC",
    "sender": "GBEXAMPLE...SENDER1",
    "recipient": "GCRECEIVER...ORG2",
    "status": "confirmed",
    "tx_hash": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    "memo": "Invoice #1042"
  },
  "signature": "647945219590e65b3f903bdd28baeabdc5ce3915cc9a8a497bfcba9ed2802b64"
}
```

### Stage 5: Failed (`payment.failed`)
```json
{
  "event": "payment.failed",
  "timestamp": "2026-09-24T10:01:30Z",
  "idempotency_key": "idem_pay_8f29d102",
  "data": {
    "id": "pay_01HF9A7BC001",
    "amount": 100.0,
    "asset": "USDC",
    "sender": "GBEXAMPLE...SENDER1",
    "recipient": "GCRECEIVER...ORG2",
    "status": "failed",
    "error_code": "INSUFFICIENT_BALANCE",
    "error_message": "Sender account does not hold sufficient trustline balance",
    "memo": "Invoice #1042"
  },
  "signature": "f4b5e6d7c8b9a0123456789abcdef0123456789abcdef0123456789abcdef012"
}
```

---

## 3. Idempotent Consumption Guidance

Webhook deliveries may be retried upon network timeouts or transient 5xx errors. To avoid double-crediting users or duplicating downstream actions:

1. **Store Processed Keys:** When receiving a webhook, extract `idempotency_key` or `data.id` + `event`.
2. **Check for Existence:** Query your database (or KV store like Redis / Airtable / Supabase) before performing business logic:
   - If the key exists: Return HTTP 200 immediately without executing side effects.
   - If new: Store the key with a TTL (e.g. 7 days) and proceed with workflow execution.
3. **Safe Retries:** OphirPay guarantees that retried deliveries for the same event preserve the exact same `idempotency_key`.

---

## 4. Platform-Specific Setup Notes

### n8n
- Use the **Webhook Trigger Node** set to HTTP POST and JSON format.
- To verify signatures in n8n, use a **Code Node (JavaScript)** with Node's native `crypto` module:
  ```js
  const crypto = require('crypto');
  const secret = $env.OPHIRPAY_WEBHOOK_SECRET;
  const canonical = JSON.stringify({ ...$input.first().json, signature: "" });
  const expected = crypto.createHmac('sha256', secret).update(canonical).digest('hex');
  const signature = $input.first().headers['x-ophirpay-signature'];
  if (signature !== expected) throw new Error("Invalid signature");
  return $input.all();
  ```

### Zapier & Make
- Standard Catch Hook triggers in Zapier and Make **cannot natively compute HMAC-SHA256 signatures**.
- **Recommended Architecture:** Deploy a lightweight verification proxy (e.g. using Cloudflare Workers or the [Relay Adapter](../examples/notification-templates/relay-adapter.ts)) that validates the HMAC before routing the clean payload into Zapier/Make.
