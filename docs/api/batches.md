# Batch Payment Submission API

The OphirPay Batch Payment API enables external applications, automated systems, and backend services to submit atomic multi-recipient disbursements in a single transaction on the Stellar network.

---

## Endpoint Overview

```http
POST /api/batches
```

Submits a new batch payment request containing up to 100 individual payment recipients. All child payments are created atomically in a single database transaction.

### Authentication & Permissions

- **Authentication**: Requires an API Key or an authenticated wallet session.
  ```http
  Authorization: Bearer <API_KEY>
  ```
  or via custom header:
  ```http
  X-API-Key: <API_KEY>
  ```
- **Required Scope**: When using API keys, the key must have the `batches:create` permission scope. Browser wallet sessions are account-owner sessions and are exempt from API key scope restrictions.

### Required Headers

| Header            | Type   | Description                                                                                                |
| ----------------- | ------ | ---------------------------------------------------------------------------------------------------------- |
| `Authorization`   | String | Bearer token formatted as `Bearer <API_KEY>`.                                                              |
| `Content-Type`    | String | Must be `application/json`.                                                                                |
| `Idempotency-Key` | String | **Required.** Unique client-generated key (min 8, max 255 chars) guaranteeing exactly-once batch creation. |

---

## Request Body Schema

The request payload is validated against [`createBatchSchema`](../../src/lib/validation-schemas.ts) using Zod.

| Field             | Type   | Required | Constraints & Description                                                                                           |
| ----------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------- |
| `name`            | string | **Yes**  | 1 to 100 characters. Descriptive label for the batch (e.g., `"March Contributor Payouts"`).                         |
| `description`     | string | No       | Optional notes up to 500 characters.                                                                                |
| `sourceAccountId` | string | **Yes**  | Stellar public address or source account ID funding the batch disbursements.                                        |
| `recipients`      | Array  | **Yes**  | Array of recipient payment objects. Minimum **1**, maximum **100** recipients (enforced by `MAX_BATCH_RECIPIENTS`). |
| `idempotencyKey`  | string | No       | Optional body fallback; callers should supply the `Idempotency-Key` HTTP header.                                    |

### Recipient Object Schema

Each entry in `recipients` is validated against [`batchRecipientSchema`](../../src/lib/validation-schemas.ts):

| Field       | Type   | Required | Description                                                                                                                  |
| ----------- | ------ | -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `address`   | string | **Yes**  | Valid 56-character Stellar public address starting with `G` (validated via `stellarAddress` regex).                          |
| `amount`    | number | **Yes**  | Positive numeric payment amount (> 0).                                                                                       |
| `assetCode` | string | No       | Asset identifier. Defaults to `"XLM"`. Supported assets include `"XLM"`, `"USDC"`, or registered Soroban token contract IDs. |
| `memo`      | string | No       | Optional memo text (maximum 28 UTF-8 bytes for text memos). Control characters and bidirectional overrides are rejected.     |
| `memoType`  | string | No       | Memo type: `"text"`, `"id"`, `"hash"`, or `"return"`. Defaults to `"text"`.                                                  |

> **Schema Reference:** Review the full Zod definitions and memo validation rules in [`src/lib/validation-schemas.ts`](../../src/lib/validation-schemas.ts).

---

## Code Examples

### 1. cURL Example

A standalone shell script is available in [`docs/examples/create-batch.sh`](../examples/create-batch.sh).

```bash
curl -X POST "https://api.ophirpay.com/api/batches" \
  -H "Authorization: Bearer ophir_live_your_api_key_here" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: idem_batch_2026_03_01_contributor_payouts" \
  -d '{
    "name": "Contributor Rewards - March 2026",
    "description": "Monthly developer compensation and grant disbursement",
    "sourceAccountId": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    "recipients": [
      {
        "address": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        "amount": 250.50,
        "assetCode": "XLM",
        "memo": "Dev reward #101",
        "memoType": "text"
      },
      {
        "address": "GCGNWKCJ3KHRLPM3TMVCUIYKAQUTVCC52UKNO5ZXOSIWBZMLGLBKIA21",
        "amount": 175.00,
        "assetCode": "USDC",
        "memo": "Grant payout #42",
        "memoType": "text"
      }
    ]
  }'
```

### 2. TypeScript SDK / Fetch Example

A runnable TypeScript implementation is available in [`examples/create-batch.ts`](../../examples/create-batch.ts) and [`docs/examples/create-batch.ts`](../examples/create-batch.ts).

```typescript
import { createBatch, type CreateBatchRequest } from "./examples/create-batch";

const batchPayload: CreateBatchRequest = {
  name: "Contributor Rewards - March 2026",
  description: "Monthly developer compensation and grant disbursement",
  sourceAccountId: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  recipients: [
    {
      address: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      amount: 250.5,
      assetCode: "XLM",
      memo: "Dev reward #101",
      memoType: "text",
    },
    {
      address: "GCGNWKCJ3KHRLPM3TMVCUIYKAQUTVCC52UKNO5ZXOSIWBZMLGLBKIA21",
      amount: 175.0,
      assetCode: "USDC",
      memo: "Grant payout #42",
      memoType: "text",
    },
  ],
};

const result = await createBatch(batchPayload, {
  apiUrl: "https://api.ophirpay.com",
  apiKey: process.env.OPHIRPAY_API_KEY,
  idempotencyKey: "idem_batch_2026_03_01_contributor_payouts",
});

console.log("Created batch ID:", result.data.id);
console.log("Batch Status:", result.data.status);
```

---

## Response Payloads

### 201 Created (Initial Success)

When the batch is successfully created:

```json
{
  "success": true,
  "data": {
    "id": "clx8q1b9a000108l4f1h7a3d9",
    "name": "Contributor Rewards - March 2026",
    "description": "Monthly developer compensation and grant disbursement",
    "status": "PENDING",
    "userId": "usr_9f8e7d6c5b4a",
    "idempotencyKey": "idem_batch_2026_03_01_contributor_payouts",
    "createdAt": "2026-03-01T12:00:00.000Z",
    "updatedAt": "2026-03-01T12:00:00.000Z",
    "payments": [
      {
        "id": "pay_clx8q1b9a000208l41234abcd",
        "batchId": "clx8q1b9a000108l4f1h7a3d9",
        "userId": "usr_9f8e7d6c5b4a",
        "amount": 250.5,
        "assetCode": "XLM",
        "memo": "Dev reward #101",
        "status": "CREATED",
        "createdAt": "2026-03-01T12:00:00.000Z",
        "updatedAt": "2026-03-01T12:00:00.000Z"
      },
      {
        "id": "pay_clx8q1b9a000308l45678efgh",
        "batchId": "clx8q1b9a000108l4f1h7a3d9",
        "userId": "usr_9f8e7d6c5b4a",
        "amount": 175.0,
        "assetCode": "USDC",
        "memo": "Grant payout #42",
        "status": "CREATED",
        "createdAt": "2026-03-01T12:00:00.000Z",
        "updatedAt": "2026-03-01T12:00:00.000Z"
      }
    ]
  },
  "meta": {
    "timestamp": "2026-03-01T12:00:00.000Z"
  }
}
```

### Idempotency & Deduplication Semantics

- **Duplicate Request (In-flight / Replay)**:
  - If a request is received with an identical `Idempotency-Key` while the original is processing, the server returns `409 Conflict` with a `Retry-After: 2` header.
  - If the previous request has completed, the server replays the stored response with `Idempotency-Replay: true` and `X-Original-Status: 201`.
  - Replayed database matches return HTTP `200 OK` with `meta.deduplicated: true`:
    ```json
    {
      "success": true,
      "data": { ... },
      "meta": {
        "deduplicated": true,
        "timestamp": "2026-03-01T12:00:05.000Z"
      }
    }
    ```

---

## Error Responses

OphirPay formats client and server errors following the [RFC 7807 Problem Details](https://datatracker.ietf.org/doc/html/rfc7807) standard.

### 400 Bad Request (Validation Error)

```json
{
  "type": "https://api.ophirpay.com/errors/validation-failed",
  "title": "Validation Failed",
  "status": 400,
  "detail": "Request payload failed schema validation",
  "instance": "/api/batches",
  "errors": {
    "recipients": [
      {
        "message": "Batches are limited to 100 recipients per submission"
      }
    ]
  }
}
```

### 401 Unauthorized

```json
{
  "type": "https://api.ophirpay.com/errors/unauthorized",
  "title": "Unauthorized",
  "status": 401,
  "detail": "Authentication required. Connect your wallet or provide an API key.",
  "instance": "/api/batches"
}
```

### 403 Forbidden (Missing Scope)

```json
{
  "type": "https://api.ophirpay.com/errors/forbidden",
  "title": "Forbidden",
  "status": 403,
  "detail": "API key lacks required scope: batches:create",
  "instance": "/api/batches"
}
```

### 429 Too Many Requests

See the [Rate Limiting Guide](rate-limiting.md) for tier limits and header details (`X-RateLimit-*`).

```json
{
  "type": "https://api.ophirpay.com/errors/rate-limited",
  "title": "Too Many Requests",
  "status": 429,
  "detail": "Rate limit exceeded. Please wait 10 seconds before retrying.",
  "instance": "/api/batches"
}
```

---

## Related Endpoints & Guides

- [**API Overview & Collection Imports**](README.md): Postman/Insomnia imports and authentication methods.
- [**CORS Policy & Allowed Headers**](cors.md): Browser origin settings and preflight rules.
- [**Rate Limiting Specifications**](rate-limiting.md): Quota ceilings, sliding windows, and jitter backoff.
- `GET /api/batches`: List historical batches with cursor pagination.
- `GET /api/batches/[id]`: Retrieve single batch details and per-item progress.
- `GET /api/batches/summary`: Aggregated rollups of batch statuses and counts.
