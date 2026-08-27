# API Cookbook

This document provides working `curl` examples and sample responses for the
public OphirPay API. Examples follow the schemas in `docs/openapi.yaml`.

All endpoints return a shared envelope:

```json
{ "success": true, "data": { ... }, "meta": { ... } }
```

## Base URL

```
https://api.ophirpay.com/api
```

## Authentication

Authenticated endpoints accept a Bearer token in the `Authorization` header.

```bash
curl https://api.ophirpay.com/api/health \
  -H "Authorization: Bearer <REPLACE_WITH_TOKEN>"
```

Use `<REPLACE_WITH_TOKEN>` as a placeholder — never commit a real JWT.

---

## Payments

### Create Payment

**Endpoint:** `POST /api/payments`

**Request body** (per `CreatePaymentRequest` schema):

```json
{
  "amount": 150.5,
  "sourceAccountId": "acc_123",
  "destAddress": "GBCRVYEXAMPLEADDRESS",
  "assetCode": "USDC",
  "description": "Invoice #1042"
}
```

**curl:**

```bash
curl -X POST https://api.ophirpay.com/api/payments \
  -H "Authorization: Bearer <REPLACE_WITH_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 150.5,
    "sourceAccountId": "acc_123",
    "destAddress": "GBCRVYEXAMPLEADDRESS",
    "assetCode": "USDC",
    "description": "Invoice #1042"
  }'
```

**Response (201):**

```json
{
  "success": true,
  "data": {
    "id": "pay_abc123",
    "amount": 150.5,
    "assetCode": "USDC",
    "sourceAccountId": "acc_123",
    "destAddress": "GBCRVYEXAMPLEADDRESS",
    "status": "pending",
    "createdAt": "2026-08-27T10:00:00Z"
  },
  "meta": {
    "timestamp": "2026-08-27T10:00:00Z"
  }
}
```

### List Payments

**Endpoint:** `GET /api/payments?limit=20&offset=0`

```bash
curl "https://api.ophirpay.com/api/payments?limit=20&offset=0" \
  -H "Authorization: Bearer <REPLACE_WITH_TOKEN>"
```

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "pay_abc123",
      "amount": 150.5,
      "status": "pending",
      "createdAt": "2026-08-27T10:00:00Z"
    }
  ],
  "meta": { "total": 1, "limit": 20, "offset": 0, "timestamp": "2026-08-27T10:00:00Z" }
}
```

---

## Batches

### Create Batch Payment

**Endpoint:** `POST /api/batches`

```bash
curl -X POST https://api.ophirpay.com/api/batches \
  -H "Authorization: Bearer <REPLACE_WITH_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "sourceAccountId": "acc_123",
    "payments": [
      { "destAddress": "GBCRVYEXAMPLEADDRESS1", "amount": 50 },
      { "destAddress": "GBCRVYEXAMPLEADDRESS2", "amount": 75 }
    ],
    "assetCode": "USDC"
  }'
```

### Get Batch

**Endpoint:** `GET /api/batches/{id}`

```bash
curl https://api.ophirpay.com/api/batches/batch_ghi789 \
  -H "Authorization: Bearer <REPLACE_WITH_TOKEN>"
```

---

## Recurring Payments

### Create Recurring Payment

**Endpoint:** `POST /api/recurring`

```bash
curl -X POST https://api.ophirpay.com/api/recurring \
  -H "Authorization: Bearer <REPLACE_WITH_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 10,
    "sourceAccountId": "acc_123",
    "destAddress": "GBCRVYEXAMPLEADDRESS",
    "assetCode": "USDC",
    "frequency": "weekly",
    "interval": 1
  }'
```

---

## Webhooks

### List Webhooks

**Endpoint:** `GET /api/webhooks`

### Register Webhook

**Endpoint:** `POST /api/webhooks`

```bash
curl -X POST https://api.ophirpay.com/api/webhooks \
  -H "Authorization: Bearer <REPLACE_WITH_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://myapp.com/webhooks/ophirpay",
    "events": ["payment.completed", "payment.failed"]
  }'
```

---

## Escrows

### Create Escrow

**Endpoint:** `POST /api/escrows`

```bash
curl -X POST https://api.ophirpay.com/api/escrows \
  -H "Authorization: Bearer <REPLACE_WITH_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 500,
    "sourceAccountId": "acc_123",
    "sellerAddress": "GBCRVYEXAMPLEADDRESS1",
    "buyerAddress": "GBCRVYEXAMPLEADDRESS2",
    "assetCode": "USDC"
  }'
```

### Release Escrow

**Endpoint:** `POST /api/escrows/{id}/release`

```bash
curl -X POST https://api.ophirpay.com/api/escrows/esc_mno345/release \
  -H "Authorization: Bearer <REPLACE_WITH_TOKEN>"
```

---

## Streams

### Create Payment Stream

**Endpoint:** `POST /api/streams`

```bash
curl -X POST https://api.ophirpay.com/api/streams \
  -H "Authorization: Bearer <REPLACE_WITH_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "amountPerPeriod": 0.01,
    "sourceAccountId": "acc_123",
    "destAddress": "GBCRVYEXAMPLEADDRESS",
    "assetCode": "USDC",
    "periodSeconds": 3600
  }'
```

---

## Health

**Endpoint:** `GET /api/health`

```bash
curl https://api.ophirpay.com/api/health
```

**Response:**

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "version": "1.0.0",
    "timestamp": "2026-08-27T10:00:00Z"
  }
}
```

---

## Error Responses

Errors follow the shared envelope:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "amount must be a number"
  },
  "meta": { "timestamp": "2026-08-27T10:00:00Z" }
}
```

Common HTTP status codes:
- `200` — Success
- `201` — Created
- `400` — Bad Request (validation error)
- `401` — Unauthorized (missing/invalid token)
- `403` — Forbidden (insufficient permissions)
- `404` — Not Found
- `429` — Rate Limited
- `500` — Internal Server Error
