# Automation Platform Integration Guide: n8n, Zapier & Make

This guide details how to integrate OphirPay webhooks and payment event streams into no-code and low-code workflow automation platforms including **n8n**, **Zapier**, and **Make.com**.

---

## 1. Supported Event Types & Lifecycle Stages

OphirPay payment lifecycles transition through five deterministic stages. Webhooks are dispatched at each stage:

| Event Type | Lifecycle Stage | Description | Critical Fields |
| :--- | :--- | :--- | :--- |
| `payment.created` | Initialized | Intent registered; awaiting signature or funding | `id`, `amount`, `asset`, `source` |
| `payment.signed` | Authorized | Multi-sig / signer approved the payload | `id`, `signer`, `signature_hash` |
| `payment.submitted` | Broadcast | Transaction broadcast to Stellar Horizon / Soroban | `id`, `tx_hash`, `sequence_number` |
| `payment.confirmed` | Finalized | Ledger closed; transaction finalized on-chain | `id`, `tx_hash`, `ledger_sequence`, `fee_charged` |
| `payment.failed` | Terminated | Failed preflight, simulation, or transaction drop | `id`, `error_code`, `error_message` |

---

## 2. Field Meanings & Schema

Every webhook payload delivered to an automation endpoint adheres to the following envelope:

| Field | Type | Description |
| :--- | :--- | :--- |
| `event` | String | Event identifier (`payment.created`, `payment.confirmed`, etc.) |
| `timestamp` | String (ISO 8601) | Canonical delivery timestamp in UTC (e.g. `2026-09-26T00:00:00.000Z`) |
| `idempotency_key` | String (UUID) | Unique identifier for the specific event instance to prevent double-processing |
| `signature` | String (Hex) | HMAC-SHA256 signature calculated over `<timestamp>.<canonical_json_body>` |
| `data` | Object | Event-specific payload containing payment details |
| `data.id` | String | Unique payment ID (e.g., `pay_982fbc14`) |
| `data.amount` | String | Scaled decimal or integer amount of payment asset |
| `data.asset` | String | Asset code (e.g., `USDC:GA5Z...` or `XLM`) |
| `data.source` | String | Source Stellar account public key (G...) |
| `data.destination` | String | Destination Stellar account public key (G...) |
| `data.tx_hash` | String | Transaction hash on Stellar ledger (when submitted/confirmed) |
| `data.status` | String | Current status (`CREATED`, `SIGNED`, `SUBMITTED`, `CONFIRMED`, `FAILED`) |

---

## 3. Full Payload Examples by Lifecycle Stage

### 3.1 `payment.created`
```json
{
  "event": "payment.created",
  "timestamp": "2026-09-26T00:00:00.000Z",
  "idempotency_key": "a1b2c3d4-e5f6-7890-abcd-ef0123456789",
  "signature": "83ab64c58dadec406835ebd9b907b579cb89132098823ec66f2b96dd1ad84258",
  "data": {
    "id": "pay_982fbc14",
    "amount": "250.00",
    "asset": "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    "source": "GBXGQJWVLWOYHFLVTKWV5FGHA3LNYY2JQKM7IB4HXZP7WVQJXZK36AEL",
    "destination": "GDZX4MVL67QYPVQXYAHR6F477Z42DF4XGTV3L75XW4Y5A2G34XJ6D77P",
    "status": "CREATED",
    "metadata": {
      "invoice_id": "INV-2026-0042",
      "client": "Acme Corp"
    }
  }
}
```

### 3.2 `payment.signed`
```json
{
  "event": "payment.signed",
  "timestamp": "2026-09-26T00:00:04.120Z",
  "idempotency_key": "b2c3d4e5-f6a7-8901-bcde-f0123456789a",
  "signature": "45cd67e89ab01234cdef5678901234567890abcdef1234567890abcdef123456",
  "data": {
    "id": "pay_982fbc14",
    "status": "SIGNED",
    "signer": "GBXGQJWVLWOYHFLVTKWV5FGHA3LNYY2JQKM7IB4HXZP7WVQJXZK36AEL",
    "signatures_collected": 1,
    "signatures_required": 1
  }
}
```

### 3.3 `payment.submitted`
```json
{
  "event": "payment.submitted",
  "timestamp": "2026-09-26T00:00:07.450Z",
  "idempotency_key": "c3d4e5f6-a7b8-9012-cdef-0123456789ab",
  "signature": "67ef890123456789abcdef0123456789abcdef0123456789abcdef0123456789",
  "data": {
    "id": "pay_982fbc14",
    "status": "SUBMITTED",
    "tx_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "sequence_number": "489218491823"
  }
}
```

### 3.4 `payment.confirmed`
```json
{
  "event": "payment.confirmed",
  "timestamp": "2026-09-26T00:00:12.890Z",
  "idempotency_key": "d4e5f6a7-b8c9-0123-def0-123456789abc",
  "signature": "890123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd",
  "data": {
    "id": "pay_982fbc14",
    "status": "CONFIRMED",
    "tx_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "ledger_sequence": 54201948,
    "fee_charged": "100",
    "confirmed_at": "2026-09-26T00:00:12.800Z"
  }
}
```

### 3.5 `payment.failed`
```json
{
  "event": "payment.failed",
  "timestamp": "2026-09-26T00:00:08.200Z",
  "idempotency_key": "e5f6a7b8-c9d0-1234-ef01-23456789abcd",
  "signature": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "data": {
    "id": "pay_982fbc14",
    "status": "FAILED",
    "error_code": "op_underfunded",
    "error_message": "Source account does not have sufficient balance for amount plus transaction fee.",
    "failed_at": "2026-09-26T00:00:08.150Z"
  }
}
```

---

## 4. Idempotency & Deduplication Guidance

Automation engines can receive duplicate webhook deliveries due to network retries, timeouts, or platform reconnects. 

### Best Practices:
1. **Always Deduplicate on `idempotency_key` or `data.id + event`:** Store processed `idempotency_key` values in an in-memory cache, Redis, or platform data store (e.g. Make Data Store, Zapier Storage) with a 24-hour TTL.
2. **Atomic Status Progression:** Ignore events whose status is earlier than the currently recorded status in your system. For example, do not transition an order back to `CREATED` if already marked `CONFIRMED`.

---

## 5. Platform-Specific Setup Notes

### 5.1 n8n
1. **Webhook Trigger:** Add a `Webhook` node configured to `POST` with `Respond Immediately`.
2. **Signature Verification (Crypto Node):**
   - Extract header `X-OphirPay-Signature` and `X-OphirPay-Timestamp`.
   - Use the **Crypto** node with `HMAC-SHA256`, using your secret key over `<timestamp>.<raw_body>`.
   - Branch execution: Proceed if computed HMAC matches `X-OphirPay-Signature`; otherwise return HTTP 401.

### 5.2 Make.com (Integromat)
1. **Custom Webhook:** Create a Custom Webhook with IP filtering enabled.
2. **Deduplication:** Use the **Data Store** module:
   - Check if `idempotency_key` exists.
   - If found, stop workflow (deduplicated).
   - If new, insert `idempotency_key` and proceed with payment actions.

### 5.3 Zapier
Standard Zapier "Catch Hook" triggers do not support raw byte-level HMAC computation out of the box.
- **Recommended Setup:** Add a **Code by Zapier (JavaScript or Python)** step immediately after the trigger:
  ```javascript
  const crypto = require('crypto');
  const signature = inputData.signature;
  const timestamp = inputData.timestamp;
  const secret = inputData.secret;
  
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(timestamp + '.' + inputData.rawBody);
  const expected = hmac.digest('hex');
  
  output = { isValid: crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) };
  ```
- **Zero-Code Alternative:** If no-code step is strictly required, configure an endpoint token parameter (e.g., `https://hooks.zapier.com/hooks/catch/123/abc/?token=YOUR_SECRET_TOKEN`) and assert token equality in a Zapier Filter step.
