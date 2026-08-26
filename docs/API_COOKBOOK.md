# OphirPay API Cookbook

A practical, copy-pasteable cookbook for integrating with the **OphirPay REST API** on Stellar / Soroban.
This guide provides runnable `curl` command examples and realistic JSON request and response payloads for every public endpoint documented in the [OpenAPI Specification](./openapi.yaml).

---

## Table of Contents

- [Overview & Authentication](#overview--authentication)
- [Standard Error Responses](#standard-error-responses)
- [1. Payments API](#1-payments-api)
- [2. Batch Payments API](#2-batch-payments-api)
- [3. Escrows API](#3-escrows-api)
- [4. Payment Streams API](#4-payment-streams-api)
- [5. Recurring Payments & Subscriptions API](#5-recurring-payments--subscriptions-api)
- [6. Payment Requests & Links API](#6-payment-requests--links-api)
- [7. Webhooks API](#7-webhooks-api)
- [8. API Keys API](#8-api-keys-api)
- [9. Session & Authentication API](#9-session--authentication-api)
- [10. Multisig Operations API](#10-multisig-operations-api)
- [11. Governance & DAO API](#11-governance--dao-api)
- [12. Refunds API](#12-refunds-api)
- [13. Notification Hooks Registry API](#13-notification-hooks-registry-api)
- [14. Audit Log API](#14-audit-log-api)
- [15. Real-Time Events API](#15-real-time-events-api)
- [16. Analytics API](#16-analytics-api)
- [17. Contract Statistics API](#17-contract-statistics-api)
- [18. Fee Configuration API](#18-fee-configuration-api)
- [19. Policy Versions API](#19-policy-versions-api)
- [20. Contracts Deployment API](#20-contracts-deployment-api)
- [21. Timelock Actions API](#21-timelock-actions-api)
- [22. Role-Based Access Control (RBAC) API](#22-role-based-access-control-rbac-api)
- [23. Health Check API](#23-health-check-api)
- [24. Observability Metrics API](#24-observability-metrics-api)

---

## Overview & Authentication

Base URLs:
- **Local Development:** `http://localhost:3000`
- **Production:** `https://api.ophirpay.com`

OphirPay supports two primary API authentication methods, plus cookie-based authentication for web browser wallet sessions:

1. **Bearer Token Header (Recommended):**
   ```http
   Authorization: Bearer ophir_live_sk_7f8a9b2c3d4e5f6a7b8c9d0e1f2a3b4c
   ```
2. **API Key Header:**
   ```http
   X-API-Key: ophir_live_sk_7f8a9b2c3d4e5f6a7b8c9d0e1f2a3b4c
   ```
3. **Session Cookie:**
   ```http
   Cookie: ophirpay_session=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   ```

---

## 1. Payments API

### List payments (`GET /api/payments`)

#### Request
```bash
curl -X GET "http://localhost:3000/api/payments" \
  -H "Authorization: Bearer ophir_live_sk_test"
```

#### Response
```json
{
  "data": [
    {
      "id": "pay_9a8b7c6d-1234-5678-90ab-cdef12345678",
      "amount": 100.5,
      "assetCode": "USDC",
      "status": "COMPLETED",
      "sourceAddress": "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
      "destinationAddress": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      "memo": "Invoice #1042",
      "txHash": "a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0",
      "createdAt": "2026-08-26T12:00:00.000Z",
      "updatedAt": "2026-08-26T12:01:30.000Z"
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 10,
  "totalPages": 1
}
```

---

### Create a payment (`POST /api/payments`)

#### Request
```bash
curl -X POST "http://localhost:3000/api/payments" \
  -H "Authorization: Bearer ophir_live_sk_test" \
  -H "Content-Type: application/json" \
  -d '{\n    "amount": 50.0,\n    "assetCode": "XLM",\n    "sourceAddress": "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",\n    "destinationAddress": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",\n    "memo": "Payment for software design"\n  }'
```

#### Response
```json
{
  "id": "pay_5f6e7d8c-4321-8765-ba09-fedc87654321",
  "amount": 50.0,
  "assetCode": "XLM",
  "status": "PENDING",
  "sourceAddress": "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
  "destinationAddress": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  "memo": "Payment for software design",
  "txHash": null,
  "createdAt": "2026-08-26T13:00:00.000Z",
  "updatedAt": "2026-08-26T13:00:00.000Z"
}
```

---

### Get a payment by ID (`GET /api/payments/{id}`)

#### Request
```bash
curl -X GET "http://localhost:3000/api/payments/pay_9a8b7c6d" \
  -H "Authorization: Bearer ophir_live_sk_test"
```

#### Response
```json
{
  "data": [
    {
      "id": "pay_9a8b7c6d-1234-5678-90ab-cdef12345678",
      "amount": 100.5,
      "assetCode": "USDC",
      "status": "COMPLETED",
      "sourceAddress": "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
      "destinationAddress": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      "memo": "Invoice #1042",
      "txHash": "a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0",
      "createdAt": "2026-08-26T12:00:00.000Z",
      "updatedAt": "2026-08-26T12:01:30.000Z"
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 10,
  "totalPages": 1
}
```

---

### Update payment status or metadata (`PATCH /api/payments/{id}`)

#### Request
```bash
curl -X PATCH "http://localhost:3000/api/payments/pay_9a8b7c6d" \
  -H "Authorization: Bearer ophir_live_sk_test" \
  -H "Content-Type: application/json" \
  -d '{\n    "status": "COMPLETED"\n  }'
```

#### Response
```json
{
  "success": true
}
```

---

### Delete a payment (`DELETE /api/payments/{id}`)

#### Request
```bash
curl -X DELETE "http://localhost:3000/api/payments/pay_9a8b7c6d" \
  -H "Authorization: Bearer ophir_live_sk_test"
```

#### Response
```json
{
  "success": true,
  "message": "Resource deleted successfully"
}
```

---


## 2. Batch Payments API

### List batches with pagination (`GET /api/batches`)

#### Request
```bash
curl -X GET "http://localhost:3000/api/batches" \
  -H "Authorization: Bearer ophir_live_sk_test"
```

#### Response
```json
{
  "data": [
    {
      "id": "batch_11223344-aabb-ccdd-eeff-001122334455",
      "name": "August Payroll",
      "totalAmount": 12500.0,
      "assetCode": "USDC",
      "totalCount": 25,
      "status": "PROCESSING",
      "createdAt": "2026-08-26T08:00:00.000Z"
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 10
}
```

---

### Create a batch payment (`POST /api/batches`)

#### Request
```bash
curl -X POST "http://localhost:3000/api/batches" \
  -H "Authorization: Bearer ophir_live_sk_test" \
  -H "Content-Type: application/json" \
  -d '{\n    "name": "August Wave 1",\n    "assetCode": "USDC",\n    "payments": [\n      {\n        "destination": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",\n        "amount": 2500.0,\n        "memo": "Milestone #1"\n      },\n      {\n        "destination": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",\n        "amount": 1500.0,\n        "memo": "Milestone #2"\n      }\n    ]\n  }'
```

#### Response
```json
{
  "id": "batch_99887766-5544-3322-1100-aabbccddeeff",
  "name": "Contractor Disbursements Wave 1",
  "totalAmount": 4300.0,
  "assetCode": "USDC",
  "itemCount": 2,
  "status": "PENDING",
  "createdAt": "2026-08-26T13:10:00.000Z"
}
```

---

### Get a batch with its child payments (`GET /api/batches/{id}`)

#### Request
```bash
curl -X GET "http://localhost:3000/api/batches/pay_9a8b7c6d" \
  -H "Authorization: Bearer ophir_live_sk_test"
```

#### Response
```json
{
  "data": [
    {
      "id": "batch_11223344-aabb-ccdd-eeff-001122334455",
      "name": "August Payroll",
      "totalAmount": 12500.0,
      "assetCode": "USDC",
      "totalCount": 25,
      "status": "PROCESSING",
      "createdAt": "2026-08-26T08:00:00.000Z"
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 10
}
```

---


## 3. Escrows API

### List escrows or fetch one by id (`GET /api/escrows`)

#### Request
```bash
curl -X GET "http://localhost:3000/api/escrows" \
  -H "Authorization: Bearer ophir_live_sk_test"
```

#### Response
```json
{
  "escrows": [
    {
      "id": "1",
      "depositor": "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
      "beneficiary": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      "arbiter": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      "amount": "100000000",
      "asset": "native",
      "deadline": 1787800000,
      "status": "ACTIVE",
      "metadata": "App development milestone escrow"
    }
  ]
}
```

---

### Create an on-chain escrow (`POST /api/escrows`)

#### Request
```bash
curl -X POST "http://localhost:3000/api/escrows" \
  -H "Authorization: Bearer ophir_live_sk_test" \
  -H "Content-Type: application/json" \
  -d '{\n    "depositor": "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",\n    "beneficiary": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",\n    "arbiter": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",\n    "amount": "100000000",\n    "asset": "native",\n    "deadline": 1787900000,\n    "metadata": "Security deposit"\n  }'
```

#### Response
```json
{
  "id": "2",
  "status": "PENDING_DEPOSIT",
  "depositor": "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
  "beneficiary": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  "amount": "500000000"
}
```

---

### Get an escrow by id (`GET /api/escrows/{id}`)

#### Request
```bash
curl -X GET "http://localhost:3000/api/escrows/pay_9a8b7c6d" \
  -H "Authorization: Bearer ophir_live_sk_test"
```

#### Response
```json
{
  "escrows": [
    {
      "id": "1",
      "depositor": "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
      "beneficiary": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      "arbiter": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      "amount": "100000000",
      "asset": "native",
      "deadline": 1787800000,
      "status": "ACTIVE",
      "metadata": "App development milestone escrow"
    }
  ]
}
```

---


## 4. Payment Streams API

### List streams or fetch one by id (`GET /api/streams`)

#### Request
```bash
curl -X GET "http://localhost:3000/api/streams" \
  -H "Authorization: Bearer ophir_live_sk_test"
```

#### Response
```json
{
  "streams": [
    {
      "id": "stream_1",
      "sender": "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
      "recipient": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      "ratePerSecond": "115740",
      "remainingBalance": "300000000",
      "startTime": 1787700000,
      "stopTime": 1790292000,
      "status": "STREAMING"
    }
  ]
}
```

---

### Create an on-chain payment stream (`POST /api/streams`)

#### Request
```bash
curl -X POST "http://localhost:3000/api/streams" \
  -H "Authorization: Bearer ophir_live_sk_test" \
  -H "Content-Type: application/json" \
  -d '{\n    "sender": "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",\n    "recipient": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",\n    "totalDeposit": "300000000",\n    "asset": "native",\n    "durationSeconds": 2592000\n  }'
```

#### Response
```json
{
  "id": "stream_2",
  "sender": "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
  "recipient": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  "ratePerSecond": "115740",
  "status": "INITIALIZED"
}
```

---

### Get a stream by id (`GET /api/streams/{id}`)

#### Request
```bash
curl -X GET "http://localhost:3000/api/streams/pay_9a8b7c6d" \
  -H "Authorization: Bearer ophir_live_sk_test"
```

#### Response
```json
{
  "streams": [
    {
      "id": "stream_1",
      "sender": "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
      "recipient": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      "ratePerSecond": "115740",
      "remainingBalance": "300000000",
      "startTime": 1787700000,
      "stopTime": 1790292000,
      "status": "STREAMING"
    }
  ]
}
```

---


## 5. Recurring Payments & Subscriptions API

### List recurring payments (`GET /api/recurring`)

#### Request
```bash
curl -X GET "http://localhost:3000/api/recurring" \
  -H "Authorization: Bearer ophir_live_sk_test"
```

#### Response
```json
{
  "data": [
    {
      "id": "rec_12345678-abcd-ef01-2345-6789abcdef01",
      "destinationAddress": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      "amount": 29.99,
      "assetCode": "USDC",
      "frequency": "MONTHLY",
      "nextExecution": "2026-09-01T00:00:00.000Z",
      "status": "ACTIVE"
    }
  ]
}
```

---

### Create a recurring payment (`POST /api/recurring`)

#### Request
```bash
curl -X POST "http://localhost:3000/api/recurring" \
  -H "Authorization: Bearer ophir_live_sk_test" \
  -H "Content-Type: application/json" \
  -d '{\n    "destinationAddress": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",\n    "amount": 49.00,\n    "assetCode": "USDC",\n    "frequency": "MONTHLY",\n    "startDate": "2026-09-01T00:00:00Z"\n  }'
```

#### Response
```json
{
  "id": "rec_87654321-fedc-ba09-8765-43210fedcba9",
  "destinationAddress": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  "amount": 49.00,
  "assetCode": "USDC",
  "frequency": "MONTHLY",
  "status": "ACTIVE"
}
```

---

### Get a recurring payment by id (`GET /api/recurring/{id}`)

#### Request
```bash
curl -X GET "http://localhost:3000/api/recurring/pay_9a8b7c6d" \
  -H "Authorization: Bearer ophir_live_sk_test"
```

#### Response
```json
{
  "data": [
    {
      "id": "rec_12345678-abcd-ef01-2345-6789abcdef01",
      "destinationAddress": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      "amount": 29.99,
      "assetCode": "USDC",
      "frequency": "MONTHLY",
      "nextExecution": "2026-09-01T00:00:00.000Z",
      "status": "ACTIVE"
    }
  ]
}
```

---


## 6. Payment Requests & Links API

### List payment requests (`GET /api/requests`)

#### Request
```bash
curl -X GET "http://localhost:3000/api/requests" \
  -H "Authorization: Bearer ophir_live_sk_test"
```

#### Response
```json
{
  "requests": [
    {
      "id": "req_abc123",
      "payee": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      "amount": 75.0,
      "assetCode": "USDC",
      "status": "PENDING",
      "checkoutUrl": "https://ophirpay.com/pay/req_abc123"
    }
  ]
}
```

---

### Create a payment request / payment link (`POST /api/requests`)

#### Request
```bash
curl -X POST "http://localhost:3000/api/requests" \
  -H "Authorization: Bearer ophir_live_sk_test" \
  -H "Content-Type: application/json" \
  -d '{\n    "amount": 120.00,\n    "assetCode": "USDC",\n    "description": "Invoice #884",\n    "recipientAddress": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"\n  }'
```

#### Response
```json
{
  "id": "req_xyz789",
  "amount": 120.00,
  "assetCode": "USDC",
  "checkoutUrl": "https://ophirpay.com/pay/req_xyz789",
  "expiresAt": "2026-08-27T13:30:00.000Z"
}
```

---


## 7. Webhooks API

### List registered webhooks (secrets redacted) (`GET /api/webhooks`)

#### Request
```bash
curl -X GET "http://localhost:3000/api/webhooks" \
  -H "Authorization: Bearer ophir_live_sk_test"
```

#### Response
```json
{
  "webhooks": [
    {
      "id": "whk_01",
      "url": "https://api.merchant.com/webhooks/ophirpay",
      "events": ["payment.completed", "batch.completed"],
      "active": true,
      "createdAt": "2026-08-20T10:00:00.000Z"
    }
  ]
}
```

---

### Register a new webhook (`POST /api/webhooks`)

#### Request
```bash
curl -X POST "http://localhost:3000/api/webhooks" \
  -H "Authorization: Bearer ophir_live_sk_test" \
  -H "Content-Type: application/json" \
  -d '{\n    "url": "https://api.merchant.com/webhooks/ophirpay",\n    "events": ["payment.completed", "refund.created"]\n  }'
```

#### Response
```json
{
  "id": "whk_02",
  "url": "https://api.merchant.com/webhooks/ophirpay",
  "secret": "whsec_3a7b9c1d5e6f8a0b2c4d6e8f0a2b4c6d",
  "events": ["payment.completed", "refund.created"],
  "active": true
}
```

---

### Delete a webhook (`DELETE /api/webhooks`)

#### Request
```bash
curl -X DELETE "http://localhost:3000/api/webhooks" \
  -H "Authorization: Bearer ophir_live_sk_test"
```

#### Response
```json
{
  "success": true,
  "message": "Resource deleted successfully"
}
```

---


## 8. API Keys API

### List API keys (hashes hidden) (`GET /api/keys`)

#### Request
```bash
curl -X GET "http://localhost:3000/api/keys" \
  -H "Authorization: Bearer ophir_live_sk_test"
```

#### Response
```json
{
  "keys": [
    {
      "id": "key_01",
      "name": "Backend Service Production",
      "prefix": "ophir_live_sk_7f8a...",
      "createdAt": "2026-08-01T00:00:00.000Z",
      "lastUsedAt": "2026-08-26T12:00:00.000Z"
    }
  ]
}
```

---

### Generate a new API key (raw key shown once) (`POST /api/keys`)

#### Request
```bash
curl -X POST "http://localhost:3000/api/keys" \
  -H "Authorization: Bearer ophir_live_sk_test" \
  -H "Content-Type: application/json" \
  -d '{\n    "name": "Production Server Key"\n  }'
```

#### Response
```json
{
  "id": "key_02",
  "name": "Production Server Key",
  "apiKey": "ophir_live_sk_4b8f1c3d7e9a2b5c8d0e3f6a9b1c4d7e",
  "createdAt": "2026-08-26T13:40:00.000Z"
}
```

---

### Revoke an API key (`DELETE /api/keys`)

#### Request
```bash
curl -X DELETE "http://localhost:3000/api/keys" \
  -H "Authorization: Bearer ophir_live_sk_test"
```

#### Response
```json
{
  "success": true,
  "message": "Resource deleted successfully"
}
```

---


## 9. Session & Authentication API

### Issue a signed session cookie for a connected wallet (`POST /api/auth/session`)

Called by the UI after a successful wallet connect. Sets an HttpOnly
HMAC-signed session cookie carrying the wallet public key.

#### Request
```bash
curl -X POST "http://localhost:3000/api/auth/session" \
  -H "Authorization: Bearer ophir_live_sk_test" \
  -H "Content-Type: application/json" \
  -d '{\n    "publicKey": "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",\n    "signature": "3045022100...abcd...",\n    "challenge": "OphirPay Sign-In: 1787740000"\n  }'
```

#### Response
```json
{
  "success": true,
  "publicKey": "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
  "expiresAt": "2026-08-27T13:45:00.000Z"
}
```

---

### Revoke the session cookie (`DELETE /api/auth/session`)

#### Request
```bash
curl -X DELETE "http://localhost:3000/api/auth/session" \
  -H "Authorization: Bearer ophir_live_sk_test"
```

#### Response
```json
{
  "success": true,
  "message": "Resource deleted successfully"
}
```

---

### Mint a CSRF token for this session (`GET /api/csrf`)

Sets the HttpOnly `__Host-csrf` cookie AND returns the token in the
body so clients can echo it via the `x-csrf-token` header on mutation
requests (double-submit cookie pattern).

#### Request
```bash
curl -X GET "http://localhost:3000/api/csrf" \
  -H "Authorization: Bearer ophir_live_sk_test"
```

#### Response
```json
{
  "csrfToken": "9f8e7d6c5b4a3210fedcba9876543210"
}
```

---


## 10. Multisig Operations API

### Get current multisig configuration (`GET /api/multisig`)

#### Request
```bash
curl -X GET "http://localhost:3000/api/multisig" \
  -H "Authorization: Bearer ophir_live_sk_test"
```

#### Response
```json
{
  "threshold": 2,
  "signers": [
    "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
    "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
  ]
}
```

---

### Configure multisig (owner-only on-chain) (`POST /api/multisig`)

#### Request
```bash
curl -X POST "http://localhost:3000/api/multisig" \
  -H "Authorization: Bearer ophir_live_sk_test" \
  -H "Content-Type: application/json" \
  -d '{\n    "threshold": 2,\n    "signers": ["GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37", "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN", "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"]\n  }'
```

#### Response
```json
{
  "success": true
}
```

---

### Propose a payment for multisig approval (`POST /api/multisig/propose`)

#### Request
```bash
curl -X POST "http://localhost:3000/api/multisig/propose" \
  -H "Authorization: Bearer ophir_live_sk_test" \
  -H "Content-Type: application/json" \
  -d '{\n    "recipient": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",\n    "amount": "5000000000",\n    "asset": "native",\n    "description": "Grant Disbursement"\n  }'
```

#### Response
```json
{
  "proposalId": 12,
  "status": "PENDING_APPROVALS",
  "approvalsCount": 1,
  "requiredThreshold": 2
}
```

---

### Approve a pending multisig proposal (`POST /api/multisig/approve`)

#### Request
```bash
curl -X POST "http://localhost:3000/api/multisig/approve" \
  -H "Authorization: Bearer ophir_live_sk_test" \
  -H "Content-Type: application/json" \
  -d '{\n    "proposalId": 12,\n    "signer": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"\n  }'
```

#### Response
```json
{
  "proposalId": 12,
  "approvalsCount": 2,
  "thresholdMet": true
}
```

---

### Execute a fully approved multisig payment (`POST /api/multisig/execute`)

#### Request
```bash
curl -X POST "http://localhost:3000/api/multisig/execute" \
  -H "Authorization: Bearer ophir_live_sk_test" \
  -H "Content-Type: application/json" \
  -d '{\n    "proposalId": 12\n  }'
```

#### Response
```json
{
  "success": true,
  "proposalId": 12,
  "txHash": "a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0"
}
```

---

### List pending approval requests (`GET /api/multisig/requests`)

#### Request
```bash
curl -X GET "http://localhost:3000/api/multisig/requests" \
  -H "Authorization: Bearer ophir_live_sk_test"
```

#### Response
```json
{
  "pending": [
    {
      "proposalId": 12,
      "recipient": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      "amount": "5000000000",
      "asset": "native",
      "approvals": ["GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37"]
    }
  ]
}
```

---


## 11. Governance & DAO API

### List governance proposals (most recent first) (`GET /api/governance/proposals`)

Enumerates the contract's proposals, capped at the 100 most recent to
bound the N+1 on-chain read cost. `truncated` is true when the chain
holds more proposals than the cap, so callers know the list is partial.

#### Request
```bash
curl -X GET "http://localhost:3000/api/governance/proposals" \
  -H "Authorization: Bearer ophir_live_sk_test"
```

#### Response
```json
{
  "proposals": [
    {
      "id": 1,
      "title": "Lower platform fee to 0.05%",
      "proposer": "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
      "forVotes": "1200000",
      "againstVotes": "45000",
      "status": "ACTIVE",
      "votingEnds": 1788200000
    }
  ]
}
```

---

### Create a governance proposal (on-chain) (`POST /api/governance/proposals`)

#### Request
```bash
curl -X POST "http://localhost:3000/api/governance/proposals" \
  -H "Authorization: Bearer ophir_live_sk_test" \
  -H "Content-Type: application/json" \
  -d '{\n    "title": "Add EURC Token Support",\n    "description": "Integrate Circle EURC stablecoin",\n    "actionContract": "CABC123...",\n    "actionFunction": "add_asset"\n  }'
```

#### Response
```json
{
  "id": 2,
  "title": "Add EURC Token Support",
  "status": "ACTIVE",
  "votingEnds": 1788500000
}
```

---

### Cast a vote on a proposal (on-chain, 1 vote per address) (`POST /api/governance/vote`)

#### Request
```bash
curl -X POST "http://localhost:3000/api/governance/vote" \
  -H "Authorization: Bearer ophir_live_sk_test" \
  -H "Content-Type: application/json" \
  -d '{\n    "proposalId": 1,\n    "support": true\n  }'
```

#### Response
```json
{
  "success": true,
  "proposalId": 1,
  "voter": "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
  "voteWeight": "50000"
}
```

---

### Execute a passed proposal (`POST /api/governance/execute`)

#### Request
```bash
curl -X POST "http://localhost:3000/api/governance/execute" \
  -H "Authorization: Bearer ophir_live_sk_test" \
  -H "Content-Type: application/json" \
  -d '{\n    "proposalId": 1\n  }'
```

#### Response
```json
{
  "success": true,
  "proposalId": 1,
  "executed": true,
  "txHash": "a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0"
}
```

---


## 12. Refunds API

### List refunds or refund analytics (`GET /api/refunds`)

#### Request
```bash
curl -X GET "http://localhost:3000/api/refunds" \
  -H "Authorization: Bearer ophir_live_sk_test"
```

#### Response
```json
{
  "refunds": [
    {
      "id": "ref_01",
      "paymentId": "pay_9a8b7c6d",
      "reasonCode": "DUPLICATE_PAYMENT",
      "status": "APPROVED",
      "amount": 100.5,
      "createdAt": "2026-08-25T15:00:00.000Z"
    }
  ]
}
```

---

### Persist a refund ledger row after an on-chain request_refund (`POST /api/refunds`)

Called by the UI AFTER the on-chain request_refund transaction succeeds.
Stores the contract's refund id (`onChainId`, captured from the tx
return value) so approve/process can later target the right record.

#### Request
```bash
curl -X POST "http://localhost:3000/api/refunds" \
  -H "Authorization: Bearer ophir_live_sk_test" \
  -H "Content-Type: application/json" \
  -d '{\n    "paymentId": "pay_9a8b7c6d",\n    "reasonCode": "SERVICE_NOT_DELIVERED",\n    "reasonDetails": "Order cancelled"\n  }'
```

#### Response
```json
{
  "id": "ref_02",
  "paymentId": "pay_9a8b7c6d",
  "status": "PENDING_REVIEW",
  "reasonCode": "SERVICE_NOT_DELIVERED"
}
```

---

### Update the lifecycle status of a refund ledger row (`PATCH /api/refunds/{id}`)

Mirrors an on-chain transition (approve_refund / process_refund) onto
the ledger row so the list reflects Request → Approve → Process.
Owner-scoped — only the row's user can update it.

#### Request
```bash
curl -X PATCH "http://localhost:3000/api/refunds/pay_9a8b7c6d" \
  -H "Authorization: Bearer ophir_live_sk_test" \
  -H "Content-Type: application/json" \
  -d '{\n    "status": "COMPLETED"\n  }'
```

#### Response
```json
{
  "success": true
}
```

---


## 13. Notification Hooks Registry API

### List notification hooks (`GET /api/hooks`)

#### Request
```bash
curl -X GET "http://localhost:3000/api/hooks" \
  -H "Authorization: Bearer ophir_live_sk_test"
```

#### Response
```json
{
  "hooks": [
    {
      "id": "hook_01",
      "eventType": "payment_recorded",
      "endpointUrl": "https://partner.example.com/ophir-events",
      "active": true
    }
  ]
}
```

---

### Persist a hook ledger row after an on-chain register_hook (`POST /api/hooks`)

Called by the UI AFTER the on-chain register_hook transaction succeeds.
Stores the contract's hook id (`onChainId`, captured from the tx return
value) so Deactivate can later target the right record.

#### Request
```bash
curl -X POST "http://localhost:3000/api/hooks" \
  -H "Authorization: Bearer ophir_live_sk_test" \
  -H "Content-Type: application/json" \
  -d '{\n    "eventType": "payment_recorded",\n    "endpointUrl": "https://api.partner.com/events",\n    "subscriberAddress": "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37"\n  }'
```

#### Response
```json
{
  "id": "hook_02",
  "eventType": "payment_recorded",
  "active": true
}
```

---

### Deactivate a hook ledger row after an on-chain unregister_hook (`PATCH /api/hooks/{id}`)

Owner-scoped — only the row's user can update it.

#### Request
```bash
curl -X PATCH "http://localhost:3000/api/hooks/pay_9a8b7c6d" \
  -H "Authorization: Bearer ophir_live_sk_test" \
  -H "Content-Type: application/json" \
  -d '{\n    "status": "COMPLETED"\n  }'
```

#### Response
```json
{
  "success": true
}
```

---


## 14. Audit Log API

### Query contract audit log (`GET /api/audit-log`)

#### Request
```bash
curl -X GET "http://localhost:3000/api/audit-log" \
  -H "Authorization: Bearer ophir_live_sk_test"
```

#### Response
```json
{
  "records": [
    {
      "id": "log_101",
      "action": "fee_config_updated",
      "actor": "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
      "timestamp": "2026-08-26T11:00:00.000Z"
    }
  ]
}
```

---

### Subscribe to the live audit-log stream (`GET /api/audit-log/sse`)

Server-Sent Events stream that polls the contract audit log every few
seconds and pushes new entries to connected clients.

#### Request
```bash
curl -X GET "http://localhost:3000/api/audit-log/sse" \
  -H "Authorization: Bearer ophir_live_sk_test"
```

#### Response
```json
data: {"id":"log_102","action":"payment_recorded","timestamp":"2026-08-26T13:50:00.000Z"}
```

---


## 15. Real-Time Events API

### Subscribe to real-time payment events (`GET /api/events`)

Server-Sent Events stream. Polls the Stellar emitter contract every 10 seconds.

Events:
- `connected` — stream established
- `heartbeat` — keep-alive every 15s
- `payment:created` — new payment detected from emitter contract

#### Request
```bash
curl -X GET "http://localhost:3000/api/events" \
  -H "Authorization: Bearer ophir_live_sk_test"
```

#### Response
```json
data: {"event":"payment_completed","paymentId":"pay_9a8b7c6d","amount":100.5,"asset":"USDC"}
```

---

### Fetch on-chain payment event history (`GET /api/events/history`)

#### Request
```bash
curl -X GET "http://localhost:3000/api/events/history" \
  -H "Authorization: Bearer ophir_live_sk_test"
```

#### Response
```json
{
  "events": [
    {
      "type": "payment_recorded",
      "ledger": 1284930,
      "txHash": "a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0",
      "timestamp": "2026-08-26T12:00:00.000Z"
    }
  ]
}
```

---


## 16. Analytics API

### Aggregated payment analytics (`GET /api/analytics`)

#### Request
```bash
curl -X GET "http://localhost:3000/api/analytics" \
  -H "Authorization: Bearer ophir_live_sk_test"
```

#### Response
```json
{
  "totalVolumeUSD": 450000.00,
  "paymentsCount": 3840,
  "successfulPayments": 3810,
  "failedPayments": 30,
  "assetBreakdown": {
    "USDC": 320000.00,
    "XLM": 130000.00
  }
}
```

---


## 17. Contract Statistics API

### Aggregate on-chain contract statistics (`GET /api/stats`)

#### Request
```bash
curl -X GET "http://localhost:3000/api/stats" \
  -H "Authorization: Bearer ophir_live_sk_test"
```

#### Response
```json
{
  "totalRecordedPayments": 12500,
  "activeEscrowsCount": 18,
  "activeStreamsCount": 7,
  "contractVersion": "0.1.0"
}
```

---


## 18. Fee Configuration API

### Get the current fee configuration (`GET /api/fee-config`)

#### Request
```bash
curl -X GET "http://localhost:3000/api/fee-config" \
  -H "Authorization: Bearer ophir_live_sk_test"
```

#### Response
```json
{
  "feeBps": 10,
  "minFeeStroops": "1000",
  "maxFeeStroops": "50000000"
}
```

---

### Get the fee collector address (`GET /api/fee-config/collector`)

#### Request
```bash
curl -X GET "http://localhost:3000/api/fee-config/collector" \
  -H "Authorization: Bearer ophir_live_sk_test"
```

#### Response
```json
{
  "feeCollector": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
}
```

---

### Get fee configuration version history (`GET /api/fee-config/history`)

#### Request
```bash
curl -X GET "http://localhost:3000/api/fee-config/history" \
  -H "Authorization: Bearer ophir_live_sk_test"
```

#### Response
```json
{
  "feeBps": 10,
  "minFeeStroops": "1000",
  "maxFeeStroops": "50000000"
}
```

---


## 19. Policy Versions API

### Get fee and multisig config version history (`GET /api/policy-versions`)

#### Request
```bash
curl -X GET "http://localhost:3000/api/policy-versions" \
  -H "Authorization: Bearer ophir_live_sk_test"
```

#### Response
```json
{
  "policies": [
    {
      "policyType": "fee_config",
      "currentVersion": 2,
      "lastUpdated": "2026-08-01T00:00:00.000Z"
    }
  ]
}
```

---


## 20. Contracts Deployment API

### Get contract deployment info and version (`GET /api/contracts`)

#### Request
```bash
curl -X GET "http://localhost:3000/api/contracts" \
  -H "Authorization: Bearer ophir_live_sk_test"
```

#### Response
```json
{
  "network": "testnet",
  "ophirpayContractId": "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  "emitterContractId": "CBRCW7Z46C7E2YQ2MOHW5V2D3VOHK5W5N36C3G7Y7N6O5Z3Y4Z3Y4Z3Y",
  "version": "0.1.0"
}
```

---


## 21. Timelock Actions API

### List pending timelocked actions (`GET /api/timelock`)

#### Request
```bash
curl -X GET "http://localhost:3000/api/timelock" \
  -H "Authorization: Bearer ophir_live_sk_test"
```

#### Response
```json
{
  "actions": [
    {
      "actionId": "tl_01",
      "functionName": "transfer_ownership",
      "targetAddress": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      "unlocksAt": 1787820000,
      "canExecute": false
    }
  ]
}
```

---


## 22. Role-Based Access Control (RBAC) API

### Look up role assignments (`GET /api/rbac`)

#### Request
```bash
curl -X GET "http://localhost:3000/api/rbac" \
  -H "Authorization: Bearer ophir_live_sk_test"
```

#### Response
```json
{
  "address": "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
  "roles": ["OPERATOR", "ARBITER"]
}
```

---


## 23. Health Check API

### Service health check (`GET /api/health`)

#### Request
```bash
curl -X GET "http://localhost:3000/api/health" \
  -H "Authorization: Bearer ophir_live_sk_test"
```

#### Response
```json
{
  "status": "healthy",
  "timestamp": "2026-08-26T13:50:00.000Z",
  "services": {
    "database": "up",
    "stellarRpc": "up"
  },
  "version": "0.1.0"
}
```

---


## 24. Observability Metrics API

### Prometheus metrics endpoint (`GET /api/metrics`)

#### Request
```bash
curl -X GET "http://localhost:3000/api/metrics" \
  -H "Authorization: Bearer ophir_live_sk_test"
```

#### Response
```json
{
  "http_requests_total": 572,
  "http_request_duration_seconds_avg": 0.042
}
```

---

## Standard Error Responses

All API error responses follow a consistent JSON structure:

```json
{
  "error": "Error message description",
  "code": "ERROR_CODE",
  "statusCode": 400
}
```

### Common HTTP Status Codes

| Status Code | Code Identifier | Description |
|---|---|---|
| `400 Bad Request` | `VALIDATION_ERROR` | Malformed request body, invalid Stellar address, or negative amount |
| `401 Unauthorized` | `UNAUTHORIZED` | Missing or invalid API key or session cookie |
| `403 Forbidden` | `FORBIDDEN` | Insufficient permissions for operation or CSRF verification failure |
| `404 Not Found` | `NOT_FOUND` | Resource ID does not exist |
| `409 Conflict` | `CONFLICT` | Unique constraint violation (e.g. duplicate transaction hash) |
| `429 Too Many Requests` | `RATE_LIMITED` | Exceeded rate limit quota |
| `500 Internal Error` | `INTERNAL_ERROR` | Server-side execution exception |
| `503 Service Unavailable` | `SERVICE_UNAVAILABLE` | Database or Stellar RPC connectivity issues |

---

*Authored for the OphirPay Developer Community. For further questions or contract deployment details, see the [Integration Guide](./integration-guide.md) or [OpenAPI Spec](./openapi.yaml).*
