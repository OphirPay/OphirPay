# OphirPay API Cookbook

Runnable `curl` examples and realistic response payloads for all public endpoints of the OphirPay Stellar payment orchestration layer.

---

## 🔑 Authentication

OphirPay supports two equivalent authentication headers for authenticated routes:

1. **Bearer Token (Recommended)**:
   ```bash
   -H "Authorization: Bearer ophir_live_sk_8f7b2c9e4a1d0f"
   ```
2. **Custom API Key Header**:
   ```bash
   -H "X-API-Key: ophir_live_sk_8f7b2c9e4a1d0f"
   ```

*Base URLs:*
* **Local Development**: `http://localhost:3000`
* **Production**: `https://api.ophirpay.com`

---

## Table of Contents
1. [Authentication & API Keys](#1-authentication--api-keys)
2. [Payments](#2-payments)
3. [Batch Payments](#3-batch-payments)
4. [Recurring Payments & Subscriptions](#4-recurring-payments--subscriptions)
5. [Payment Requests & Invoicing](#5-payment-requests--invoicing)
6. [On-Chain Escrows](#6-on-chain-escrows)
7. [On-Chain Payment Streams](#7-on-chain-payment-streams)
8. [Webhooks & Notification Hooks](#8-webhooks--notification-hooks)
9. [Multisig & Governance](#9-multisig--governance)
10. [Analytics & Refunds](#10-analytics--refunds)
11. [Audit Logs & Real-Time Events](#11-audit-logs--real-time-events)
12. [System Health & Metrics](#12-system-health--metrics)

---

## 1. Authentication & API Keys

### Generate a New API Key
```bash
curl -X POST "https://api.ophirpay.com/api/keys" \
  -H "Authorization: Bearer <master-session-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Production Backend Worker",
    "expiresInDays": 90,
    "scopes": ["payments:read", "payments:write", "webhooks:manage"]
  }'
```
**Response (`201 Created`):**
```json
{
  "id": "key_01hv89q7a4mpx3n",
  "name": "Production Backend Worker",
  "key": "ophir_live_sk_8f7b2c9e4a1d0f62b8e3c1a9",
  "prefix": "ophir_live_sk_8f",
  "scopes": ["payments:read", "payments:write", "webhooks:manage"],
  "expiresAt": "2026-11-24T18:00:00.000Z",
  "createdAt": "2026-08-26T18:00:00.000Z"
}
```
> ⚠️ **Note:** The full secret key is returned **only once** upon generation.

### List Active API Keys
```bash
curl -X GET "https://api.ophirpay.com/api/keys" \
  -H "Authorization: Bearer ophir_live_sk_8f7b2c9e4a1d0f62b8e3c1a9"
```
**Response (`200 OK`):**
```json
[
  {
    "id": "key_01hv89q7a4mpx3n",
    "name": "Production Backend Worker",
    "prefix": "ophir_live_sk_8f",
    "scopes": ["payments:read", "payments:write", "webhooks:manage"],
    "lastUsedAt": "2026-08-26T18:15:22.000Z",
    "expiresAt": "2026-11-24T18:00:00.000Z",
    "createdAt": "2026-08-26T18:00:00.000Z"
  }
]
```

### Revoke an API Key
```bash
curl -X DELETE "https://api.ophirpay.com/api/keys/key_01hv89q7a4mpx3n" \
  -H "Authorization: Bearer ophir_live_sk_8f7b2c9e4a1d0f62b8e3c1a9"
```
**Response (`200 OK`):**
```json
{
  "success": true,
  "message": "API key revoked successfully."
}
```

---

## 2. Payments

### Create a Single Payment
```bash
curl -X POST "https://api.ophirpay.com/api/payments" \
  -H "Authorization: Bearer ophir_live_sk_8f7b2c9e4a1d0f62b8e3c1a9" \
  -H "Content-Type: application/json" \
  -d '{
    "recipient": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    "asset": "USDC",
    "issuer": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    "amount": "250.00",
    "memo": "INV-2026-0881",
    "memoType": "text",
    "description": "Consulting invoice payout #0881"
  }'
```
**Response (`201 Created`):**
```json
{
  "id": "pay_98234ab1c09d",
  "status": "PENDING",
  "recipient": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  "sender": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  "asset": "USDC",
  "amount": "250.00",
  "fee": "0.01",
  "memo": "INV-2026-0881",
  "transactionHash": null,
  "createdAt": "2026-08-26T18:20:00.000Z"
}
```

### List Payments (with Pagination & Filters)
```bash
curl -X GET "https://api.ophirpay.com/api/payments?page=1&limit=20&status=COMPLETED&search=INV-2026" \
  -H "Authorization: Bearer ophir_live_sk_8f7b2c9e4a1d0f62b8e3c1a9"
```
**Response (`200 OK`):**
```json
{
  "page": 1,
  "limit": 20,
  "total": 1,
  "totalPages": 1,
  "data": [
    {
      "id": "pay_98234ab1c09d",
      "status": "COMPLETED",
      "recipient": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      "asset": "USDC",
      "amount": "250.00",
      "memo": "INV-2026-0881",
      "transactionHash": "9b12a84efc713b194d3f5481d9f8e4c3a2105e6b7d8c9a0f1e2d3c4b5a6f7e8d",
      "createdAt": "2026-08-26T18:20:00.000Z",
      "completedAt": "2026-08-26T18:20:04.000Z"
    }
  ]
}
```

### Retrieve Payment Details
```bash
curl -X GET "https://api.ophirpay.com/api/payments/pay_98234ab1c09d" \
  -H "Authorization: Bearer ophir_live_sk_8f7b2c9e4a1d0f62b8e3c1a9"
```
**Response (`200 OK`):**
```json
{
  "id": "pay_98234ab1c09d",
  "status": "COMPLETED",
  "recipient": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  "sender": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  "asset": "USDC",
  "amount": "250.00",
  "fee": "0.01",
  "memo": "INV-2026-0881",
  "transactionHash": "9b12a84efc713b194d3f5481d9f8e4c3a2105e6b7d8c9a0f1e2d3c4b5a6f7e8d",
  "ledgerNumber": 51204881,
  "createdAt": "2026-08-26T18:20:00.000Z",
  "completedAt": "2026-08-26T18:20:04.000Z"
}
```

---

## 3. Batch Payments

### Create a Multi-Recipient Batch Payment
```bash
curl -X POST "https://api.ophirpay.com/api/batches" \
  -H "Authorization: Bearer ophir_live_sk_8f7b2c9e4a1d0f62b8e3c1a9" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "August Payroll Distribution",
    "asset": "USDC",
    "recipients": [
      {
        "address": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
        "amount": "3200.00",
        "memo": "PAYROLL-ENG-01"
      },
      {
        "address": "GCKIK6UJJ5GDRV47Z2P3N2V376P5Y4G6Z66N2BJZP3M2M2N2M2N2M2N2",
        "amount": "2850.00",
        "memo": "PAYROLL-ENG-02"
      }
    ]
  }'
```
**Response (`201 Created`):**
```json
{
  "id": "batch_7710a9c82e",
  "title": "August Payroll Distribution",
  "status": "DRAFT",
  "asset": "USDC",
  "totalAmount": "6050.00",
  "recipientCount": 2,
  "createdAt": "2026-08-26T18:30:00.000Z"
}
```

### Execute a Batch Payment
```bash
curl -X POST "https://api.ophirpay.com/api/batches/batch_7710a9c82e/execute" \
  -H "Authorization: Bearer ophir_live_sk_8f7b2c9e4a1d0f62b8e3c1a9"
```
**Response (`200 OK`):**
```json
{
  "id": "batch_7710a9c82e",
  "status": "PROCESSING",
  "transactionHash": "8f33190e21a8b94ec174591a2bc0d8e12a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d",
  "submittedAt": "2026-08-26T18:31:00.000Z"
}
```

---

## 4. Recurring Payments & Subscriptions

### Create a Recurring Subscription Schedule
```bash
curl -X POST "https://api.ophirpay.com/api/recurring" \
  -H "Authorization: Bearer ophir_live_sk_8f7b2c9e4a1d0f62b8e3c1a9" \
  -H "Content-Type: application/json" \
  -d '{
    "recipient": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    "asset": "USDC",
    "amount": "49.00",
    "interval": "MONTHLY",
    "startDate": "2026-09-01T00:00:00.000Z",
    "description": "Pro Tier API SaaS Plan"
  }'
```
**Response (`201 Created`):**
```json
{
  "id": "rec_009941a8",
  "status": "ACTIVE",
  "recipient": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  "asset": "USDC",
  "amount": "49.00",
  "interval": "MONTHLY",
  "nextPaymentDate": "2026-09-01T00:00:00.000Z",
  "createdAt": "2026-08-26T18:35:00.000Z"
}
```

---

## 5. Payment Requests & Invoicing

### Create a Payment Request Link
```bash
curl -X POST "https://api.ophirpay.com/api/requests" \
  -H "Authorization: Bearer ophir_live_sk_8f7b2c9e4a1d0f62b8e3c1a9" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Hardware Prototyping Milestone 1",
    "requestedAmount": "1500.00",
    "asset": "USDC",
    "expiresInHours": 72,
    "recipient": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
  }'
```
**Response (`201 Created`):**
```json
{
  "id": "req_88194fbc",
  "paymentUrl": "https://ophirpay.com/pay/req_88194fbc",
  "status": "OPEN",
  "requestedAmount": "1500.00",
  "asset": "USDC",
  "expiresAt": "2026-08-29T18:40:00.000Z",
  "createdAt": "2026-08-26T18:40:00.000Z"
}
```

---

## 6. On-Chain Escrows

### Create a Smart Contract Escrow
```bash
curl -X POST "https://api.ophirpay.com/api/escrows" \
  -H "Authorization: Bearer ophir_live_sk_8f7b2c9e4a1d0f62b8e3c1a9" \
  -H "Content-Type: application/json" \
  -d '{
    "beneficiary": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    "arbiter": "GCKIK6UJJ5GDRV47Z2P3N2V376P5Y4G6Z66N2BJZP3M2M2N2M2N2M2N2",
    "amount": "5000.00",
    "asset": "USDC",
    "releaseTimeoutDays": 14,
    "conditions": "Completion of security audit milestone"
  }'
```
**Response (`201 Created`):**
```json
{
  "id": "escrow_019a48f2",
  "contractAddress": "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  "status": "FUNDED",
  "amount": "5000.00",
  "asset": "USDC",
  "beneficiary": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  "createdAt": "2026-08-26T18:45:00.000Z"
}
```

### Release Escrow Funds to Beneficiary
```bash
curl -X POST "https://api.ophirpay.com/api/escrows/escrow_019a48f2/release" \
  -H "Authorization: Bearer ophir_live_sk_8f7b2c9e4a1d0f62b8e3c1a9"
```
**Response (`200 OK`):**
```json
{
  "id": "escrow_019a48f2",
  "status": "RELEASED",
  "transactionHash": "5a1982fc44e0b3c8917d23a1ef90c8b7412e0f5a6b7c8d9e0f1a2b3c4d5e6f7a",
  "releasedAt": "2026-08-26T18:46:00.000Z"
}
```

---

## 7. On-Chain Payment Streams

### Initialize a Continuous Payment Stream
```bash
curl -X POST "https://api.ophirpay.com/api/streams" \
  -H "Authorization: Bearer ophir_live_sk_8f7b2c9e4a1d0f62b8e3c1a9" \
  -H "Content-Type: application/json" \
  -d '{
    "recipient": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    "depositAmount": "1000.00",
    "asset": "USDC",
    "ratePerSecond": "0.0003858",
    "startTime": "2026-09-01T00:00:00.000Z",
    "stopTime": "2026-10-01T00:00:00.000Z"
  }'
```
**Response (`201 Created`):**
```json
{
  "id": "stream_4418a99b",
  "status": "ACTIVE",
  "streamAddress": "CCQ75YJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC019",
  "totalDeposit": "1000.00",
  "ratePerSecond": "0.0003858",
  "withdrawnAmount": "0.00",
  "createdAt": "2026-08-26T18:50:00.000Z"
}
```

---

## 8. Webhooks & Notification Hooks

### Register an Outgoing Webhook Endpoint
```bash
curl -X POST "https://api.ophirpay.com/api/webhooks" \
  -H "Authorization: Bearer ophir_live_sk_8f7b2c9e4a1d0f62b8e3c1a9" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://backend.example.com/api/webhooks/ophirpay",
    "events": ["payment.completed", "payment.failed", "escrow.released"],
    "secret": "whsec_9941a8c0e21b74f39281a"
  }'
```
**Response (`201 Created`):**
```json
{
  "id": "wh_019a99824c",
  "url": "https://backend.example.com/api/webhooks/ophirpay",
  "events": ["payment.completed", "payment.failed", "escrow.released"],
  "active": true,
  "createdAt": "2026-08-26T18:55:00.000Z"
}
```

---

## 9. Multisig & Governance

### Propose a Multisig Transaction
```bash
curl -X POST "https://api.ophirpay.com/api/multisig/propose" \
  -H "Authorization: Bearer ophir_live_sk_8f7b2c9e4a1d0f62b8e3c1a9" \
  -H "Content-Type: application/json" \
  -d '{
    "target": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    "amount": "25000.00",
    "asset": "USDC",
    "description": "Treasury Allocation for Q4 Liquidity Provision"
  }'
```
**Response (`201 Created`):**
```json
{
  "proposalId": "prop_ms_08819",
  "requiredSignatures": 3,
  "currentSignatures": 1,
  "status": "PENDING_APPROVAL",
  "proposer": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  "createdAt": "2026-08-26T19:00:00.000Z"
}
```

---

## 10. Analytics & Refunds

### Query Aggregated Analytics
```bash
curl -X GET "https://api.ophirpay.com/api/analytics?timeframe=30d" \
  -H "Authorization: Bearer ophir_live_sk_8f7b2c9e4a1d0f62b8e3c1a9"
```
**Response (`200 OK`):**
```json
{
  "totalVolumeUsd": "1428500.00",
  "totalTransactions": 3840,
  "successRate": 0.9984,
  "averageProcessingTimeMs": 240,
  "topAssets": [
    { "asset": "USDC", "volumeUsd": "1280000.00", "share": 0.896 },
    { "asset": "XLM", "volumeUsd": "148500.00", "share": 0.104 }
  ]
}
```

### Issue a Payment Refund
```bash
curl -X POST "https://api.ophirpay.com/api/refunds" \
  -H "Authorization: Bearer ophir_live_sk_8f7b2c9e4a1d0f62b8e3c1a9" \
  -H "Content-Type: application/json" \
  -d '{
    "paymentId": "pay_98234ab1c09d",
    "amount": "250.00",
    "reason": "Customer cancellation within policy window"
  }'
```
**Response (`201 Created`):**
```json
{
  "refundId": "ref_001948ba",
  "paymentId": "pay_98234ab1c09d",
  "status": "COMPLETED",
  "amount": "250.00",
  "asset": "USDC",
  "transactionHash": "3f9821a0b4e5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1",
  "createdAt": "2026-08-26T19:05:00.000Z"
}
```

---

## 11. Audit Logs & Real-Time Events

### Query Contract Audit Logs
```bash
curl -X GET "https://api.ophirpay.com/api/audit-log?page=1&limit=10&action=ESCROW_RELEASED" \
  -H "Authorization: Bearer ophir_live_sk_8f7b2c9e4a1d0f62b8e3c1a9"
```
**Response (`200 OK`):**
```json
{
  "page": 1,
  "limit": 10,
  "total": 1,
  "entries": [
    {
      "id": "audit_88194a",
      "actor": "GCKIK6UJJ5GDRV47Z2P3N2V376P5Y4G6Z66N2BJZP3M2M2N2M2N2M2N2",
      "action": "ESCROW_RELEASED",
      "targetContract": "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
      "timestamp": 1787770000,
      "details": { "escrowId": "escrow_019a48f2", "amount": "5000.00", "asset": "USDC" }
    }
  ]
}
```

### Listen to Real-Time Payment Events (Server-Sent Events)
```bash
curl -N -X GET "https://api.ophirpay.com/api/events" \
  -H "Authorization: Bearer ophir_live_sk_8f7b2c9e4a1d0f62b8e3c1a9" \
  -H "Accept: text/event-stream"
```
**Response Stream:**
```text
event: payment.created
data: {"id":"pay_98234ab1c09d","amount":"250.00","asset":"USDC","status":"PENDING"}

event: payment.completed
data: {"id":"pay_98234ab1c09d","amount":"250.00","asset":"USDC","status":"COMPLETED","transactionHash":"9b12a84efc713b194d3f5481d9f8e4c3a2105e6b7d8c9a0f1e2d3c4b5a6f7e8d"}
```

---

## 12. System Health & Metrics

### Check System Health
```bash
curl -X GET "https://api.ophirpay.com/api/health"
```
**Response (`200 OK`):**
```json
{
  "status": "healthy",
  "version": "0.1.0",
  "stellarHorizon": "connected",
  "sorobanRpc": "connected",
  "database": "connected",
  "timestamp": "2026-08-26T19:10:00.000Z"
}
```

### Prometheus Metrics Endpoint
```bash
curl -X GET "https://api.ophirpay.com/api/metrics"
```
**Response (`200 OK` - Text/Plain Prometheus format):**
```text
# HELP ophirpay_http_requests_total Total number of HTTP requests
# TYPE ophirpay_http_requests_total counter
ophirpay_http_requests_total{method="POST",route="/api/payments",status="201"} 1420
ophirpay_http_requests_total{method="GET",route="/api/payments",status="200"} 8940

# HELP ophirpay_active_streams_count Current number of active payment streams
# TYPE ophirpay_active_streams_count gauge
ophirpay_active_streams_count 84
```
