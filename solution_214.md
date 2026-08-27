# Solution for #214: API cookbook — curl + response example for every public endpoint

# OphirPay API Cookbook

Runnable `curl` examples and sample responses for every public endpoint of the OphirPay Stellar payment platform. All examples use realistic data and match the current schemas and auth requirements from `docs/openapi.yaml`.

**Base URL (Production)**: `https://api.ophirpay.com`
**Local dev**: `http://localhost:3000`

**Authentication** — two supported modes (see [Authentication](#authentication)):

| Header | Value |
|--------|-------|
| `X-API-Key: <key>` | API key generated via `POST /api/keys` (recommended) |
| `Authorization: Bearer <key>` | Same API key passed as Bearer token |

API keys are shown **only once** at creation — store them securely.

---

## Authentication

### 1. Generate an API key

```bash
curl -X POST https://api.ophirpay.com/api/keys \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "name": "production-bot",
    "userId": "usr_01HZX..."
  }'
```

**Response** (201 Created)
```json
{
  "success": true,
  "data": {
    "id": "key_01J5X...",
    "name": "production-bot",
    "prefix": "oph_live_ab12",
    "key": "oph_live_ab12...full-key-shown-once"
  }
}
```

### 2. List API keys (hashes hidden)

```bash
curl -X GET https://api.ophirpay.com/api/keys \
  -H "X-API-Key: $API_KEY"
```

**Response** (200 OK)
```json
{
  "success": true,
  "data": [
    {
      "id": "key_01J5X...",
      "name": "production-bot",
      "prefix": "oph_live_ab12",
      "createdAt": "2026-08-20T10:15:00.000Z"
    }
  ]
}
```

> Every endpoint below requires one of the two auth headers. Replace `$API_KEY` with your key.

---

## Payments

### 3. List payments (paginated)

```bash
curl -X GET "https://api.ophirpay.com/api/payments?page=1&limit=20&status=COMPLETED" \
  -H "X-API-Key: $API_KEY"
```

**Query parameters**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | integer | 1 | Page number |
| `limit` | integer | 20 | Page size (max 100) |
| `status` | string | — | `CREATED`, `PENDING`, `COMPLETED`, `FAILED`, `CANCELLED` |
| `search` | string | — | Search description, memo, or transaction hash |

**Response** (200 OK)
```json
{
  "success": true,
  "data": [
    {
      "id": "pay_01J6A...",
      "amount": 25000000,
      "assetCode": "XLM",
      "assetIssuer": null,
      "description": "Invoice #1042",
      "memo": "INV-1042",
      "status": "COMPLETED",
      "transactionHash": "a1b2c3d4e5f6...",
      "sourceAccountId": "GDQNY3PBOJNCZPZ...",
      "userId": "usr_01HZX...",
      "batchId": null,
      "createdAt": "2026-08-20T09:00:00.000Z",
      "completedAt": "2026-08-20T09:00:04.000Z",
      "errorMessage": null
    }
  ]
}
```

### 4. Create a payment

```bash
curl -X POST https://api.ophirpay.com/api/payments \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "amount": 25000000,
    "assetCode": "XLM",
    "description": "Invoice #1042",
    "memo": "INV-1042",
    "sourceAccountId": "GDQNY3PBOJNCZPZ...",
    "destAddress": "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUAYASMABEHORP3A"
  }'
```

**Required fields**: `amount`, `sourceAccountId`, `destAddress`
- `amount`: stroops for XLM, or smallest unit for other assets (integer > 0)
- `destAddress`: Stellar address, `^G[A-Z0-9]{55}$`
- `assetCode`: default `XLM`
- `memo`: max 28 chars, `description`: max 200 chars

**Response** (201 Created)
```json
{
  "success": true,
  "data": {
    "id": "pay_01J6A...",
    "amount": 25000000,
    "assetCode": "XLM",
    "assetIssuer": null,
    "description": "Invoice #1042",
    "memo": "INV-1042",
    "status": "PENDING",
    "transactionHash": null,
    "sourceAccountId": "GDQNY3PBOJNCZPZ...",
    "userId": "usr_01HZX...",
    "batchId": null,
    "createdAt": "2026-08-20T09:05:00.000Z",
    "completedAt": null,
    "errorMessage": null
  }
}
```

### 5. Get a payment by ID

```bash
curl -X GET https://api.ophirpay.com/api/payments/pay_01J6A... \
  -H "X-API-Key: $API_KEY"
```

**Response** (200 OK) — same `PaymentResponse` shape as above.

**Error** (404 Not Found)
```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Payment not found"
  }
}
```

---

## Batches

### 6. List batches

```bash
curl -X GET "https://api.ophirpay.com/api/batches?page=1&limit=20" \
  -H "X-API-Key: $API_KEY"
```

### 7. Create a batch payment (1–100 recipients)

```bash
curl -X POST https://api.ophirpay.com/api/batches \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "name": "Payroll Aug 2026",
    "description": "Monthly contractor payroll",
    "sourceAccountId": "GDQNY3PBOJNCZPZ...",
    "recipients": [
      { "address": "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUAYASMABEHORP3A", "amount": 5000000 },
      { "address": "GCK5...", "amount": 7500000 }
    ]
  }'
```

**Required fields**: `name`, `recipients`, `sourceAccountId`
- `recipients`: array of `{address, amount}` — min 1, max 100
- `name`: max 100 chars, `description`: max 500 chars

**Response** (201 Created) — batch object with status `CREATED` / `PENDING` and per-recipient payment IDs.

### 8. Get a batch by ID

```bash
curl -X GET https://api.ophirpay.com/api/batches/bat_01J6B... \
  -H "X-API-Key: $API_KEY"
```

---

## Recurring payments

### 9. Create a recurring payment

```bash
curl -X POST https://api.ophirpay.com/api/recurring \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "name": "Rent — office",
    "frequency": "MONTHLY",
    "amount": 10000000,
    "assetCode": "XLM",
    "destAddress": "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUAYASMABEHORP3A",
    "sourceAccountId": "GDQNY3PBOJNCZPZ..."
  }'
```

**Required fields**: `name`, `frequency`, `amount`, `destAddress`, `sourceAccountId`
- `frequency` enum: `DAILY`, `WEEKLY`, `BIWEEKLY`, `MONTHLY`, `QUARTERLY`, `YEARLY`

### 10. List / get recurring payments

```bash
curl -X GET https://api.ophirpay.com/api/recurring \
  -H "X-API-Key: $API_KEY"

curl -X GET https://api.ophirpay.com/api/recurring/rec_01J6C... \
  -H "X-API-Key: $API_KEY"
```

---

## Payment requests (payment links)

### 11. List payment requests

```bash
curl -X GET https://api.ophirpay.com/api/requests \
  -H "X-API-Key: $API_KEY"
```

### 12. Create a payment request

```bash
curl -X POST https://api.ophirpay.com/api/requests \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "amount": 5000000,
    "assetCode": "XLM",
    "description": "Design retainer — August"
  }'
```

**Response** (201 Created) — request object with a payable link URL.

---

## Webhooks

### 13. Create a webhook subscription

```bash
curl -X POST https://api.ophirpay.com/api/webhooks \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "url": "https://example.com/hooks/ophirpay",
    "events": ["payment.completed", "payment.failed"],
    "isActive": true
  }'
```

**Required fields**: `url` (valid URI), `events` (min 1)
- `isActive` defaults to `true`

**Response** (201 Created)
```json
{
  "success": true,
  "data": {
    "id": "whk_01J6D...",
    "url": "https://example.com/hooks/ophirpay",
    "events": ["payment.completed", "payment.failed"],
    "isActive": true,
    "createdAt": "2026-08-20T10:30:00.000Z"
  }
}
```

### 14. List / delete webhooks

```bash
curl -X GET https://api.ophirpay.com/api/webhooks \
  -H "X-API-Key: $API_KEY"

curl -X DELETE https://api.ophirpay.com/api/webhooks/whk_01J6D... \
  -H "X-API-Key: $API_KEY"
```

---

## On-chain: escrows, streams, multisig, governance

### 15. Escrows

```bash
# List escrows
curl -X GET https://api.ophirpay.com/api/escrows \
  -H "X-API-Key: $API_KEY"

# Get escrow by ID
curl -X GET https://api.ophirpay.com/api/escrows/esc_01J6E... \
  -H "X-API-Key: $API_KEY"
```

### 16. Streams

```bash
curl -X GET https://api.ophirpay.com/api/streams \
  -H "X-API-Key: $API_KEY"

curl -X GET https://api.ophirpay.com/api/streams/str_01J6F... \
  -H "X-API-Key: $API_KEY"
```

### 17. Multisig proposals

```bash
# Propose a multisig action
curl -X POST https://api.ophirpay.com/api/multisig/propose \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "contractId": "CA3...",
    "call": "transfer",
    "args": ["G...", 1000000]
  }'

# Approve / execute
curl -X POST https://api.ophirpay.com/api/multisig/approve \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{ "proposalId": "prop_01J6G..." }'

curl -X POST https://api.ophirpay.com/api/multisig/execute \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{ "proposalId": "prop_01J6G..." }'

# List pending requests
curl -X GET https://api.ophirpay.com/api/multisig/requests \
  -H "X-API-Key: $API_KEY"
```

### 18. Governance

```bash
# List proposals
curl -X GET https://api.ophirpay.com/api/governance/proposals \
  -H "X-API-Key: $API_KEY"

# Vote
curl -X POST https://api.ophirpay.com/api/governance/vote \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{ "proposalId": "prop_01J6H...", "support": true }'

# Execute approved proposal
curl -X POST https://api.ophirpay.com/api/governance/execute \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{ "proposalId": "prop_01J6H..." }'
```

---

## Analytics, refunds, hooks, audit log, events

### 19. Analytics

```bash
curl -X GET https://api.ophirpay.com/api/analytics \
  -H "X-API-Key: $API_KEY"
```

**Response** (200 OK) — aggregated payment metrics (volume, count by status, period totals).

### 20. Refunds

```bash
curl -X GET https://api.ophirpay.com/api/refunds \
  -H "X-API-Key: $API_KEY"

curl -X GET https://api.ophirpay.com/api/refunds/ref_01J6I... \
  -H "X-API-Key: $API_KEY"
```

### 21. Hooks (notification registry)

```bash
curl -X GET https://api.ophirpay.com/api/hooks \
  -H "X-API-Key: $API_KEY"

curl -X GET https://api.ophirpay.com/api/hooks/hook_01J6J... \
  -H "X-API-Key: $API_KEY"
```

### 22. Audit log

```bash
curl -X GET "https://api.ophirpay.com/api/audit-log?limit=50" \
  -H "X-API-Key: $API_KEY"
```

### 23. Events (SSE stream + history)

```bash
# Server-Sent Events stream (real-time)
curl -N https://api.ophirpay.com/api/audit-log/sse \
  -H "X-API-Key: $API_KEY"

# Event history
curl -X GET "https://api.ophirpay.com/api/events/history?limit=50" \
  -H "X-API-Key: $API_KEY"

# Subscribe to the event stream
curl -N https://api.ophirpay.com/api/events \
  -H "X-API-Key: $API_KEY"
```

---

## Auth session, CSRF, contracts, stats, timelock, RBAC, fee config

### 24. Wallet session

```bash
# Issue a wallet session
curl -X POST https://api.ophirpay.com/api/auth/session \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{ "wallet": "GDQNY3PBOJNCZPZ..." }'

# CSRF token
curl -X GET https://api.ophirpay.com/api/csrf \
  -H "X-API-Key: $API_KEY"
```

### 25. Contracts

```bash
curl -X GET https://api.ophirpay.com/api/contracts \
  -H "X-API-Key: $API_KEY"
```

**Response** (200 OK) — deployed contract addresses, versions, and network info.

### 26. Stats

```bash
curl -X GET https://api.ophirpay.com/api/stats \
  -H "X-API-Key: $API_KEY"
```

### 27. Timelock

```bash
curl -X GET https://api.ophirpay.com/api/timelock \
  -H "X-API-Key: $API_KEY"
```

### 28. RBAC lookups

```bash
curl -X GET https://api.ophirpay.com/api/rbac \
  -H "X-API-Key: $API_KEY"
```

### 29. Fee config

```bash
curl -X GET https://api.ophirpay.com/api/fee-config \
  -H "X-API-Key: $API_KEY"

curl -X GET https://api.ophirpay.com/api/fee-config/collector \
  -H "X-API-Key: $API_KEY"

curl -X GET https://api.ophirpay.com/api/fee-config/history \
  -H "X-API-Key: $API_KEY"

curl -X GET https://api.ophirpay.com/api/policy-versions \
  -H "X-API-Key: $API_KEY"
```

---

## Health & metrics (public)

### 30. Health check

```bash
curl -X GET https://api.ophirpay.com/api/health
```

**Response** (200 OK)
```json
{
  "success": true,
  "data": {
    "version": "0.1.0",
    "services": {
      "database": { "status": "ok", "latencyMs": 3 },
      "redis": { "status": "ok", "latencyMs": 1 },
      "stellar": { "status": "ok", "latencyMs": 42 }
    }
  }
}
```

### 31. Metrics (Prometheus)

```bash
curl -X GET https://api.ophirpay.com/metrics
```

**Response** (200 OK) — Prometheus text exposition format.

---

## Error reference

All errors use a consistent shape:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "destAddress must match pattern ^G[A-Z0-9]{55}$",
    "details": [ { "field": "destAddress", "message": "Invalid Stellar address" } ]
  }
}
```

| HTTP | Code | Meaning |
|------|------|---------|
| 400 | `VALIDATION_ERROR` | Request body/query validation failed |
| 401 | `UNAUTHORIZED` | Missing/invalid `X-API-Key` or Bearer token |
| 403 | `FORBIDDEN` | Authenticated but not permitted |
| 404 | `NOT_FOUND` | Resource not found |
| 409 | `CONFLICT` | State conflict (e.g. duplicate webhook) |
| 429 | `RATE_LIMITED` | Too many requests |
| 500 | `SERVER_ERROR` | Internal error |
| 503 | `SERVICE_UNAVAILABLE` | Service temporarily unavailable |

---

## Quick start (copy-paste)

```bash
export API_KEY="oph_live_..."

# Health
curl -s https://api.ophirpay.com/api/health

# List payments
curl -s "https://api.ophirpay.com/api/payments?status=COMPLETED" \
  -H "X-API-Key: $API_KEY"

# Create payment
curl -s -X POST https://api.ophirpay.com/api/payments \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "amount": 25000000,
    "sourceAccountId": "GDQNY3PBOJNCZPZ...",
    "destAddress": "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUAYASMABEHORP3A"
  }'

# Create webhook
curl -s -X POST https://api.ophirpay.com/api/webhooks \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{"url":"https://example.com/hooks","events":["payment.completed"]}'
```

All examples above match `docs/openapi.yaml` — base paths under `/api`, auth via `X-API-Key` or Bearer, and Stellar-based payment schemas (stroops, `G...` addresses).
