# API Cookbook

This document provides working `curl` examples and sample responses for every public
endpoint exposed by the OphirPay API. All examples use the production base URL and
the authentication scheme described below.

## Base URL

```
https://api.ophirpay.com/api
```

## Authentication

The API uses **X-API-Key** authentication for programmatic access and **Bearer JWT**
for user-facing operations.

### Obtain a JWT

```bash
curl -X POST https://api.ophirpay.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "your-password"
  }'
```

**Response:**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 3600,
  "user": {
    "id": "usr_abc123",
    "email": "user@example.com"
  }
}
```

### Use API Key

```bash
curl -H "X-API-Key: your-api-key" \
  https://api.ophirpay.com/api/v1/payments
```

---

## Payments

### List Payments

```bash
curl -H "Authorization: Bearer <token>" \
  https://api.ophirpay.com/api/payments?limit=20&offset=0
```

**Response:**

```json
{
  "data": [
    {
      "id": "pay_abc123",
      "amount": "150.00",
      "currency": "USDC",
      "status": "completed",
      "createdAt": "2026-08-27T10:00:00Z"
    }
  ],
  "meta": {
    "total": 1,
    "limit": 20,
    "offset": 0
  }
}
```

### Create Payment

```bash
curl -X POST https://api.ophirpay.com/api/payments \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": "150.00",
    "currency": "USDC",
    "recipient": "0xRecipientAddress",
    "network": "base"
  }'
```

**Response (201):**

```json
{
  "id": "pay_def456",
  "amount": "150.00",
  "currency": "USDC",
  "status": "pending",
  "createdAt": "2026-08-27T10:05:00Z"
}
```

---

## Batches

### Create Batch Payment

```bash
curl -X POST https://api.ophirpay.com/api/batches \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "payments": [
      {"recipient": "0xAddr1", "amount": "50.00", "currency": "USDC"},
      {"recipient": "0xAddr2", "amount": "75.00", "currency": "USDC"}
    ],
    "network": "base"
  }'
```

**Response (201):**

```json
{
  "id": "batch_ghi789",
  "status": "pending",
  "totalAmount": "125.00",
  "paymentCount": 2,
  "createdAt": "2026-08-27T10:10:00Z"
}
```

### Get Batch Status

```bash
curl -H "Authorization: Bearer <token>" \
  https://api.ophirpay.com/api/batches/batch_ghi789
```

**Response:**

```json
{
  "id": "batch_ghi789",
  "status": "completed",
  "totalAmount": "125.00",
  "completedCount": 2,
  "failedCount": 0
}
```

---

## Recurring Payments

### Create Recurring Payment

```bash
curl -X POST https://api.ophirpay.com/api/recurring \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": "10.00",
    "currency": "USDC",
    "recipient": "0xRecipient",
    "frequency": "weekly",
    "interval": 1,
    "network": "base"
  }'
```

**Response (201):**

```json
{
  "id": "rec_jkl012",
  "amount": "10.00",
  "frequency": "weekly",
  "nextPayment": "2026-09-03T10:15:00Z",
  "status": "active"
}
```

---

## Webhooks

### List Webhooks

```bash
curl -H "Authorization: Bearer <token>" \
  https://api.ophirpay.com/api/webhooks
```

### Register Webhook

```bash
curl -X POST https://api.ophirpay.com/api/webhooks \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://myapp.com/webhooks/ophirpay",
    "events": ["payment.completed", "payment.failed"],
    "secret": "whsec_your_webhook_secret"
  }'
```

---

## Escrows

### Create Escrow

```bash
curl -X POST https://api.ophirpay.com/api/escrows \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": "500.00",
    "currency": "USDC",
    "seller": "0xSellerAddress",
    "buyer": "0xBuyerAddress",
    "network": "base",
    "conditions": "delivery_confirmed"
  }'
```

### Release Escrow

```bash
curl -X POST https://api.ophirpay.com/api/escrows/esc_mno345/release \
  -H "Authorization: Bearer <token>"
```

---

## Streams

### Create Payment Stream

```bash
curl -X POST https://api.ophirpay.com/api/streams \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "recipient": "0xRecipient",
    "rate": "0.01",
    "currency": "USDC",
    "duration": 86400,
    "network": "base"
  }'
```

---

## Health

```bash
curl https://api.ophirpay.com/api/health
```

**Response:**

```json
{
  "status": "ok",
  "timestamp": "2026-08-27T10:00:00Z",
  "version": "1.0.0",
  "uptime": 3600
}
```

---

## Error Responses

All endpoints return errors in a consistent format:

```json
{
  "error": {
    "code": "INSUFFICIENT_FUNDS",
    "message": "Insufficient balance to complete this transaction.",
    "requestId": "req_pqr678"
  }
}
```

Common HTTP status codes:
- `200` — Success
- `201` — Created
- `400` — Bad Request (validation error)
- `401` — Unauthorized (missing/invalid auth)
- `403` — Forbidden (insufficient permissions)
- `404` — Not Found
- `429` — Rate Limited
- `500` — Internal Server Error