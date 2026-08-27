# OphirPay API Cookbook

Runnable `curl` examples and realistic sample responses for **every public
endpoint**. The canonical schemas live in [`docs/openapi.yaml`](./openapi.yaml);
this cookbook shows them in action — exact request shapes, auth headers, and
the response envelope you can expect.

---

## Getting started

### Base URL

```text
https://api.ophirpay.com        # production
http://localhost:3000           # local development
```

All examples below use `$BASE` so you can point them at either:

```bash
export BASE=https://api.ophirpay.com
```

### Authentication

Two header styles, both accepted (see `X-API-Key` / `BearerAuth` security
schemes in the OpenAPI spec):

```bash
# Style 1 — API key header
curl -H "X-API-Key: oph_a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890" ...

# Style 2 — same key as a Bearer token
curl -H "Authorization: Bearer oph_a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890" ...
```

Keys are generated once via `POST /api/keys` — the raw value (`oph_...`) is
shown **only at creation time**. Endpoints that require auth return
`401 UNAUTHORIZED` when the header is missing or invalid:

```json
{
  "success": false,
  "error": { "code": "UNAUTHORIZED", "message": "Authentication required. Connect your wallet or provide an API key." },
  "timestamp": "2026-08-26T10:15:30.123Z"
}
```

> **Note:** the browser UI authenticates with a signed wallet session cookie
> instead. The `X-API-Key` / Bearer styles are for machine-to-machine callers.

### Response envelope

Every JSON endpoint returns a uniform envelope:

```json
{
  "success": true,
  "data": { /* resource(s) */ },
  "meta": { "page": 1, "limit": 20, "total": 137, "timestamp": "2026-08-26T10:15:30.123Z" }
}
```

- `data` — the payload (object, array, or `null`).
- `meta` — pagination metadata where applicable, always with a `timestamp`.

### Errors

Errors use the same envelope with `success: false` and an `error` object
carrying a machine-readable `code` from the catalog in `docs/openapi.yaml`
(`VALIDATION_ERROR`, `NOT_FOUND`, `RATE_LIMITED`, …) plus a human `message`.
Status codes follow HTTP conventions: `400` validation, `401` auth, `404`
missing, `429` rate limit, `5xx` server/contract/RPC failures.

### Pagination

List endpoints accept `page` (1-based, default 1) and `limit` (1–100,
default 20) query params:

```bash
curl -G "$BASE/api/payments" \
  -H "X-API-Key: $KEY" \
  --data-urlencode "page=2" \
  --data-urlencode "limit=25"
```

### Streaming endpoints

`/api/events` and `/api/audit-log/sse` are Server-Sent Events streams. Consume
them with `curl -N` (no buffering) and a long timeout:

```bash
curl -N --max-time 60 "$BASE/api/events"
```

### Example values

| Value | Meaning |
| --- | --- |
| `oph_a1b2c3…` | API key (`oph_` + 48 hex chars) |
| `GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U` | Stellar public key (payer/depositor) |
| `GDHJ3K2LQ7F5XQZPX6YWNMYKXWQXVZKBJZQFYX3F6KRLV4WDXHJMB2UY` | Second Stellar public key (payee/beneficiary) |
| `a1b2c3d4…` (64 hex) | Stellar transaction hash |
| `CCQGGUJRRVXMHNEX2RYPODGJE2YRMYY4Y7A3KTJH3QP2LWZLTCOPRPET` | OphirPay contract id |
| `CDAVU2XJ7C2Y52GRJZKRG3HDI7AJ2K2FHAFH5FPDTSUQAV7XNBQNNVAN` | Emitter contract id |
| `cm0py0000000000000000001` | CUID record id (DB-backed rows) |

---

## Payments

### List payments — `GET /api/payments`

Auth: **required**. Returns the authenticated user's payment records, newest
first. Filters: `status` and `search` (matches `description`, `memo`, or
`transactionHash`).

```bash
curl -G "$BASE/api/payments" \
  -H "X-API-Key: $KEY" \
  --data-urlencode "page=1" \
  --data-urlencode "limit=20" \
  --data-urlencode "status=COMPLETED" \
  --data-urlencode "search=invoice"
```

```json
{
  "success": true,
  "data": [
    {
      "id": "cm0py0000000000000000001",
      "userId": "u_01J2K3L4M5N6P7Q8R9S0T1",
      "amount": 100.25,
      "assetCode": "XLM",
      "assetIssuer": null,
      "description": "Invoice #42",
      "memo": "invoice-42",
      "status": "COMPLETED",
      "transactionHash": "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
      "sourceAccountId": "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U",
      "batchId": null,
      "createdAt": "2026-08-24T09:12:00.000Z",
      "completedAt": "2026-08-24T09:12:04.000Z",
      "errorMessage": null
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 137, "timestamp": "2026-08-26T10:15:30.123Z" }
}
```

### Create a payment — `POST /api/payments`

Auth: **required**. Creates a DB record and fires a `payment.created` webhook
for the user's active subscriptions.

```bash
curl -X POST "$BASE/api/payments" \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 25.5,
    "sourceAccountId": "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U",
    "destAddress": "GDHJ3K2LQ7F5XQZPX6YWNMYKXWQXVZKBJZQFYX3F6KRLV4WDXHJMB2UY",
    "assetCode": "XLM",
    "description": "Freelance payout",
    "memo": "payout-jul"
  }'
```

```json
{
  "success": true,
  "data": {
    "id": "cm0py0000000000000000002",
    "userId": "u_01J2K3L4M5N6P7Q8R9S0T1",
    "amount": 25.5,
    "assetCode": "XLM",
    "assetIssuer": null,
    "description": "Freelance payout",
    "memo": "payout-jul",
    "status": "CREATED",
    "transactionHash": null,
    "sourceAccountId": "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U",
    "batchId": null,
    "createdAt": "2026-08-26T10:15:30.000Z",
    "completedAt": null,
    "errorMessage": null
  },
  "meta": { "timestamp": "2026-08-26T10:15:30.123Z" }
}
```

### Get a payment — `GET /api/payments/{id}`

Auth: **required**. Scoped to the authenticated user.

```bash
curl "$BASE/api/payments/cm0py0000000000000000001" -H "X-API-Key: $KEY"
```

```json
{
  "success": true,
  "data": {
    "id": "cm0py0000000000000000001",
    "userId": "u_01J2K3L4M5N6P7Q8R9S0T1",
    "amount": 100.25,
    "assetCode": "XLM",
    "assetIssuer": null,
    "description": "Invoice #42",
    "memo": "invoice-42",
    "status": "COMPLETED",
    "transactionHash": "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
    "sourceAccountId": "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U",
    "batchId": null,
    "createdAt": "2026-08-24T09:12:00.000Z",
    "completedAt": "2026-08-24T09:12:04.000Z",
    "errorMessage": null
  },
  "meta": { "timestamp": "2026-08-26T10:15:30.123Z" }
}
```

### Update a payment — `PATCH /api/payments/{id}`

Auth: **required**. Update `status`, `description`, or `memo`.

```bash
curl -X PATCH "$BASE/api/payments/cm0py0000000000000000002" \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{ "status": "PENDING", "memo": "payout-jul-revised" }'
```

```json
{
  "success": true,
  "data": {
    "id": "cm0py0000000000000000002",
    "amount": 25.5,
    "assetCode": "XLM",
    "status": "PENDING",
    "memo": "payout-jul-revised",
    "transactionHash": null,
    "sourceAccountId": "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U",
    "batchId": null,
    "createdAt": "2026-08-26T10:15:30.000Z",
    "updatedAt": "2026-08-26T10:20:01.000Z"
  },
  "meta": { "timestamp": "2026-08-26T10:20:01.123Z" }
}
```

### Delete a payment — `DELETE /api/payments/{id}`

Auth: **required**.

```bash
curl -X DELETE "$BASE/api/payments/cm0py0000000000000000002" -H "X-API-Key: $KEY"
```

```json
{
  "success": true,
  "data": { "deleted": true },
  "meta": { "timestamp": "2026-08-26T10:21:00.000Z" }
}
```

### Export payments to CSV — `GET /api/payments/export`

Auth: **required**. Applies the same `status` / `search` filters as the list
endpoint to the **full** record set (not just the current page) and returns a
dated CSV attachment with all key fields plus memo and transaction hash. Rows
are capped at 10,000; when the cap is hit the `X-Export-Truncated: true`
header is set so truncation is never silent.

```bash
curl -G "$BASE/api/payments/export" \
  -H "X-API-Key: $KEY" \
  --data-urlencode "status=COMPLETED" \
  --data-urlencode "search=invoice" \
  -o ophirpay-payments-2026-08-26.csv
```

```text
Payment ID,Amount,Asset Code,Asset Issuer,Description,Memo,Status,Transaction Hash,Source Account,Destination Account,Created At
cm0py0000000000000000001,100.2500000,XLM,,Invoice #42,invoice-42,COMPLETED,a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90,GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U,,2026-08-24T09:12:00.000Z
cm0py0000000000000000003,25.5000000,XLM,,Freelance payout,payout-jul,COMPLETED,b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9012,GDHJ3K2LQ7F5XQZPX6YWNMYKXWQXVZKBJZQFYX3F6KRLV4WDXHJMB2UY,,2026-08-26T10:15:30.000Z
```

> Response header when the result set exceeds the cap:
> `X-Export-Truncated: true` — download and page through the filters instead
> if you need the full history.

### Retry a failed payment — `POST /api/payments/retry`

Auth: **required**. Retries a FAILED payment in place: the original amount,
recipient, and memo are reused from the row, and the attempt is stamped with a
NEW idempotency key so the previous failed attempt is never duplicated. The row
returns to `PENDING` and flows through the normal submit path.

```bash
curl -X POST "$BASE/api/payments/retry" \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{ "id": "cm0py0000000000000000009" }'
```

```json
{
  "success": true,
  "data": {
    "id": "cm0py0000000000000000009",
    "amount": 100.25,
    "assetCode": "XLM",
    "status": "PENDING",
    "memo": "invoice-42",
    "transactionHash": null,
    "sourceAccountId": "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U",
    "batchId": null,
    "createdAt": "2026-08-24T09:12:00.000Z",
    "updatedAt": "2026-08-26T10:30:00.000Z"
  },
  "meta": { "timestamp": "2026-08-26T10:30:00.123Z" }
}
```

> Returns `409 CONFLICT` when the payment is not in a retryable (FAILED) state.

---

## Batches

### List batches — `GET /api/batches`

Auth: **required**. Paginated, with `status` and `search` (name/description)
filters.

```bash
curl -G "$BASE/api/batches" \
  -H "X-API-Key: $KEY" \
  --data-urlencode "page=1" \
  --data-urlencode "limit=20" \
  --data-urlencode "status=COMPLETED"
```

```json
{
  "success": true,
  "data": [
    {
      "id": "cm0bt0000000000000000001",
      "userId": "u_01J2K3L4M5N6P7Q8R9S0T1",
      "name": "August payroll",
      "description": "Monthly contractor payouts",
      "status": "COMPLETED",
      "createdAt": "2026-08-01T08:00:00.000Z",
      "updatedAt": "2026-08-01T08:02:00.000Z"
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 3, "timestamp": "2026-08-26T10:15:30.123Z" }
}
```

### Create a batch — `POST /api/batches`

Auth: **required**. Validates up to 100 recipients, creates the batch and its
child payments.

```bash
curl -X POST "$BASE/api/batches" \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "August payroll",
    "description": "Monthly contractor payouts",
    "sourceAccountId": "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U",
    "recipients": [
      {
        "address": "GDHJ3K2LQ7F5XQZPX6YWNMYKXWQXVZKBJZQFYX3F6KRLV4WDXHJMB2UY",
        "amount": 1200,
        "assetCode": "XLM",
        "memo": "aug-1"
      },
      {
        "address": "GC5QHJ2KJ7E6XW9Y3B4N8M1P2Q7R5T9U1V3W6X8Y2Z4A7C9D1E3F5G7H9J2K4",
        "amount": 800,
        "assetCode": "XLM",
        "memo": "aug-2"
      }
    ]
  }'
```

```json
{
  "success": true,
  "data": {
    "batch": {
      "id": "cm0bt0000000000000000001",
      "userId": "u_01J2K3L4M5N6P7Q8R9S0T1",
      "name": "August payroll",
      "status": "CREATED",
      "createdAt": "2026-08-26T10:30:00.000Z"
    },
    "payments": [
      { "id": "cm0py0000000000000000010", "amount": 1200, "status": "CREATED" },
      { "id": "cm0py0000000000000000011", "amount": 800, "status": "CREATED" }
    ]
  },
  "meta": { "timestamp": "2026-08-26T10:30:00.123Z" }
}
```

### Get a batch — `GET /api/batches/{id}`

Auth: **required**. Returns the batch with its child payments (on-chain
records when available).

```bash
curl "$BASE/api/batches/cm0bt0000000000000000001" -H "X-API-Key: $KEY"
```

```json
{
  "success": true,
  "data": {
    "id": "cm0bt0000000000000000001",
    "name": "August payroll",
    "status": "COMPLETED",
    "createdAt": "2026-08-01T08:00:00.000Z",
    "payments": [
      {
        "id": 41,
        "creator": "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U",
        "total_recipients": 2,
        "total_amount": 2000000000,
        "asset": "native",
        "timestamp": 1754064000,
        "tx_hash": "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
        "payment_ids": [39, 40]
      }
    ]
  },
  "meta": { "timestamp": "2026-08-26T10:15:30.123Z" }
}
```

## Recurring payments

### List recurring payments — `GET /api/recurring`

Auth: **required**. Paginated.

```bash
curl -G "$BASE/api/recurring" -H "X-API-Key: $KEY" --data-urlencode "page=1" --data-urlencode "limit=20"
```

```json
{
  "success": true,
  "data": [
    {
      "id": "cm0rc0000000000000000001",
      "userId": "u_01J2K3L4M5N6P7Q8R9S0T1",
      "name": "Office rent",
      "frequency": "MONTHLY",
      "amount": 2500,
      "assetCode": "XLM",
      "assetIssuer": null,
      "destAddress": "GDHJ3K2LQ7F5XQZPX6YWNMYKXWQXVZKBJZQFYX3F6KRLV4WDXHJMB2UY",
      "description": "Monthly rent",
      "isActive": true,
      "nextRunAt": "2026-09-01T09:00:00.000Z",
      "lastRunAt": "2026-08-01T09:00:00.000Z",
      "createdAt": "2026-01-15T10:00:00.000Z",
      "updatedAt": "2026-08-01T09:00:00.000Z"
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 4, "timestamp": "2026-08-26T10:15:30.123Z" }
}
```

### Create a recurring payment — `POST /api/recurring`

Auth: **required**.

```bash
curl -X POST "$BASE/api/recurring" \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Office rent",
    "frequency": "MONTHLY",
    "amount": 2500,
    "assetCode": "XLM",
    "destAddress": "GDHJ3K2LQ7F5XQZPX6YWNMYKXWQXVZKBJZQFYX3F6KRLV4WDXHJMB2UY",
    "description": "Monthly rent",
    "sourceAccountId": "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U"
  }'
```

```json
{
  "success": true,
  "data": {
    "id": "cm0rc0000000000000000001",
    "userId": "u_01J2K3L4M5N6P7Q8R9S0T1",
    "name": "Office rent",
    "frequency": "MONTHLY",
    "amount": 2500,
    "assetCode": "XLM",
    "destAddress": "GDHJ3K2LQ7F5XQZPX6YWNMYKXWQXVZKBJZQFYX3F6KRLV4WDXHJMB2UY",
    "isActive": true,
    "nextRunAt": "2026-09-01T09:00:00.000Z",
    "createdAt": "2026-08-26T10:40:00.000Z"
  },
  "meta": { "timestamp": "2026-08-26T10:40:00.123Z" }
}
```

### Get a recurring payment — `GET /api/recurring/{id}`

Auth: **required**.

```bash
curl "$BASE/api/recurring/cm0rc0000000000000000001" -H "X-API-Key: $KEY"
```

```json
{
  "success": true,
  "data": {
    "id": "cm0rc0000000000000000001",
    "name": "Office rent",
    "frequency": "MONTHLY",
    "amount": 2500,
    "assetCode": "XLM",
    "destAddress": "GDHJ3K2LQ7F5XQZPX6YWNMYKXWQXVZKBJZQFYX3F6KRLV4WDXHJMB2UY",
    "isActive": true,
    "nextRunAt": "2026-09-01T09:00:00.000Z",
    "lastRunAt": "2026-08-01T09:00:00.000Z",
    "createdAt": "2026-01-15T10:00:00.000Z"
  },
  "meta": { "timestamp": "2026-08-26T10:15:30.123Z" }
}
```

---

## Payment requests

### List payment requests — `GET /api/requests`

Auth: **required**.

```bash
curl "$BASE/api/requests" -H "X-API-Key: $KEY"
```

```json
{
  "success": true,
  "data": [
    {
      "id": "cm0rq0000000000000000001",
      "userId": "u_01J2K3L4M5N6P7Q8R9S0T1",
      "amount": 99,
      "assetCode": "XLM",
      "assetIssuer": null,
      "description": "Design retainer — August",
      "recipientAddress": "GDHJ3K2LQ7F5XQZPX6YWNMYKXWQXVZKBJZQFYX3F6KRLV4WDXHJMB2UY",
      "status": "PENDING",
      "transactionHash": null,
      "createdAt": "2026-08-20T14:00:00.000Z",
      "updatedAt": "2026-08-20T14:00:00.000Z"
    }
  ],
  "meta": { "timestamp": "2026-08-26T10:15:30.123Z" }
}
```

### Create a payment request — `POST /api/requests`

Auth: **required**. Creates a shareable payment link / request.

```bash
curl -X POST "$BASE/api/requests" \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 99,
    "assetCode": "XLM",
    "description": "Design retainer — August",
    "recipientAddress": "GDHJ3K2LQ7F5XQZPX6YWNMYKXWQXVZKBJZQFYX3F6KRLV4WDXHJMB2UY"
  }'
```

```json
{
  "success": true,
  "data": {
    "id": "cm0rq0000000000000000001",
    "amount": 99,
    "assetCode": "XLM",
    "description": "Design retainer — August",
    "status": "PENDING",
    "createdAt": "2026-08-26T10:45:00.000Z"
  },
  "meta": { "timestamp": "2026-08-26T10:45:00.123Z" }
}
```

---

## Escrows

### List escrows or fetch one — `GET /api/escrows`

Auth: **required**. Without `?id=`, returns the on-chain escrow count. Pass
`?id=<u64>` for a single escrow.

```bash
curl "$BASE/api/escrows" -H "X-API-Key: $KEY"
```

```json
{
  "success": true,
  "data": { "count": 12 },
  "meta": { "timestamp": "2026-08-26T10:15:30.123Z" }
}
```

```bash
curl "$BASE/api/escrows?id=3" -H "X-API-Key: $KEY"
```

```json
{
  "success": true,
  "data": {
    "id": 3,
    "depositor": "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U",
    "beneficiary": "GDHJ3K2LQ7F5XQZPX6YWNMYKXWQXVZKBJZQFYX3F6KRLV4WDXHJMB2UY",
    "arbiter": null,
    "amount": 500000000,
    "asset": "native",
    "deadline": 1785600000,
    "released": false,
    "claimed": false,
    "metadata": "deal-escrow-2026"
  },
  "meta": { "timestamp": "2026-08-26T10:15:30.123Z" }
}
```

### Create an escrow — `POST /api/escrows`

Auth: **required**. Amounts are in stroops (1 XLM = 10,000,000 stroops).

```bash
curl -X POST "$BASE/api/escrows" \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "payee": "GDHJ3K2LQ7F5XQZPX6YWNMYKXWQXVZKBJZQFYX3F6KRLV4WDXHJMB2UY",
    "amount": 500000000,
    "assetCode": "XLM",
    "releaseAfter": 1785600000,
    "memo": "deal-escrow-2026"
  }'
```

```json
{
  "success": true,
  "data": {
    "txHash": "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
    "escrowId": 3,
    "status": "SUBMITTED"
  },
  "meta": { "timestamp": "2026-08-26T10:50:00.123Z" }
}
```

### Get an escrow — `GET /api/escrows/{id}`

Auth: **required**.

```bash
curl "$BASE/api/escrows/3" -H "X-API-Key: $KEY"
```

```json
{
  "success": true,
  "data": {
    "id": 3,
    "depositor": "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U",
    "beneficiary": "GDHJ3K2LQ7F5XQZPX6YWNMYKXWQXVZKBJZQFYX3F6KRLV4WDXHJMB2UY",
    "amount": 500000000,
    "asset": "native",
    "deadline": 1785600000,
    "released": false,
    "claimed": false,
    "metadata": "deal-escrow-2026"
  },
  "meta": { "timestamp": "2026-08-26T10:15:30.123Z" }
}
```

---

## Streams

### List streams or fetch one — `GET /api/streams`

Auth: **required**. Without `?id=`, returns the on-chain stream count.

```bash
curl "$BASE/api/streams" -H "X-API-Key: $KEY"
```

```json
{
  "success": true,
  "data": { "count": 5 },
  "meta": { "timestamp": "2026-08-26T10:15:30.123Z" }
}
```

```bash
curl "$BASE/api/streams?id=2" -H "X-API-Key: $KEY"
```

```json
{
  "success": true,
  "data": {
    "id": 2,
    "creator": "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U",
    "recipient": "GDHJ3K2LQ7F5XQZPX6YWNMYKXWQXVZKBJZQFYX3F6KRLV4WDXHJMB2UY",
    "total_amount": 1000000000,
    "claimed_amount": 400000000,
    "asset": "native",
    "start_time": 1754064000,
    "end_time": 1785686400,
    "cancelled": false,
    "metadata": "salary-stream-q3"
  },
  "meta": { "timestamp": "2026-08-26T10:15:30.123Z" }
}
```

### Create a stream — `POST /api/streams`

Auth: **required**. Amounts in stroops.

```bash
curl -X POST "$BASE/api/streams" \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "payee": "GDHJ3K2LQ7F5XQZPX6YWNMYKXWQXVZKBJZQFYX3F6KRLV4WDXHJMB2UY",
    "amount": 1000000000,
    "assetCode": "XLM",
    "startTime": 1754064000,
    "endTime": 1785686400,
    "memo": "salary-stream-q3"
  }'
```

```json
{
  "success": true,
  "data": {
    "txHash": "b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9012",
    "streamId": 2,
    "status": "SUBMITTED"
  },
  "meta": { "timestamp": "2026-08-26T10:55:00.123Z" }
}
```

### Get a stream — `GET /api/streams/{id}`

Auth: **required**.

```bash
curl "$BASE/api/streams/2" -H "X-API-Key: $KEY"
```

```json
{
  "success": true,
  "data": {
    "id": 2,
    "creator": "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U",
    "recipient": "GDHJ3K2LQ7F5XQZPX6YWNMYKXWQXVZKBJZQFYX3F6KRLV4WDXHJMB2UY",
    "total_amount": 1000000000,
    "claimed_amount": 400000000,
    "asset": "native",
    "start_time": 1754064000,
    "end_time": 1785686400,
    "cancelled": false,
    "metadata": "salary-stream-q3"
  },
  "meta": { "timestamp": "2026-08-26T10:15:30.123Z" }
}
```

---

## Webhooks

### List webhooks — `GET /api/webhooks`

Auth: **required**. Secrets are redacted (`hasSecret` tells you a secret
exists).

```bash
curl "$BASE/api/webhooks" -H "X-API-Key: $KEY"
```

```json
{
  "success": true,
  "data": [
    {
      "id": "cm0wh0000000000000000001",
      "userId": "u_01J2K3L4M5N6P7Q8R9S0T1",
      "url": "https://api.example.com/webhooks/ophirpay",
      "events": "[\"payment.completed\",\"payment.failed\",\"batch.completed\"]",
      "isActive": true,
      "hasSecret": true,
      "createdAt": "2026-08-01T09:00:00.000Z",
      "updatedAt": "2026-08-01T09:00:00.000Z"
    }
  ],
  "meta": { "timestamp": "2026-08-26T10:15:30.123Z" }
}
```

### Register a webhook — `POST /api/webhooks`

Auth: **required**. The `secret` is returned **only once** — use it to verify
`OphirPay-Signature` headers on deliveries (HMAC-SHA256 over the raw body).

```bash
curl -X POST "$BASE/api/webhooks" \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://api.example.com/webhooks/ophirpay",
    "events": ["payment.completed", "payment.failed"],
    "isActive": true
  }'
```

```json
{
  "success": true,
  "data": {
    "id": "cm0wh0000000000000000001",
    "url": "https://api.example.com/webhooks/ophirpay",
    "events": "[\"payment.completed\",\"payment.failed\"]",
    "isActive": true,
    "secret": "whsec_9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    "createdAt": "2026-08-26T11:00:00.000Z"
  },
  "meta": { "timestamp": "2026-08-26T11:00:00.123Z" }
}
```

### Delete a webhook — `DELETE /api/webhooks?id={id}`

Auth: **required**.

```bash
curl -X DELETE "$BASE/api/webhooks?id=cm0wh0000000000000000001" -H "X-API-Key: $KEY"
```

```json
{
  "success": true,
  "data": { "deleted": true },
  "meta": { "timestamp": "2026-08-26T11:05:00.123Z" }
}
```

---

## API keys

### List API keys — `GET /api/keys`

Auth: **required**. Hashes are never returned.

```bash
curl "$BASE/api/keys" -H "X-API-Key: $KEY"
```

```json
{
  "success": true,
  "data": [
    {
      "id": "cm0ak0000000000000000001",
      "name": "production",
      "prefix": "oph_a1b2",
      "lastUsed": "2026-08-25T22:10:00.000Z",
      "createdAt": "2026-07-01T08:00:00.000Z",
      "expiresAt": null
    }
  ],
  "meta": { "timestamp": "2026-08-26T10:15:30.123Z" }
}
```

### Generate an API key — `POST /api/keys`

Auth: **required**. The raw key is shown once — store it immediately.

```bash
curl -X POST "$BASE/api/keys" \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{ "name": "production" }'
```

```json
{
  "success": true,
  "data": {
    "id": "cm0ak0000000000000000002",
    "name": "production",
    "prefix": "oph_c3d4",
    "key": "oph_c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9012"
  },
  "meta": { "timestamp": "2026-08-26T11:10:00.123Z" }
}
```

### Revoke an API key — `DELETE /api/keys?id={id}`

Auth: **required**.

```bash
curl -X DELETE "$BASE/api/keys?id=cm0ak0000000000000000002" -H "X-API-Key: $KEY"
```

```json
{
  "success": true,
  "data": { "deleted": true },
  "meta": { "timestamp": "2026-08-26T11:15:00.123Z" }
}
```

---

## Session & CSRF

### Issue a session — `POST /api/auth/session`

No API key needed — called by the UI after a wallet connect. Sets an HttpOnly,
HMAC-signed session cookie (`ophirpay_session`) on success. Cookie-based
requests must include cookies, not `X-API-Key`.

```bash
curl -X POST "$BASE/api/auth/session" \
  -H "Content-Type: application/json" \
  -c cookies.txt \
  -d '{
    "publicKey": "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U",
    "signature": "c2lnbmVkLWNoYWxsZW5nZS1wYXlsb2FkLWZyb20tdGhlLXdhbGxldA=="
  }'
```

```json
{
  "success": true,
  "data": { "authenticated": true, "publicKey": "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U", "network": "TESTNET" },
  "meta": { "timestamp": "2026-08-26T11:20:00.123Z" }
}
```

### Revoke a session — `DELETE /api/auth/session`

Clears the session cookie.

```bash
curl -X DELETE "$BASE/api/auth/session" -b cookies.txt
```

```json
{
  "success": true,
  "data": { "authenticated": false },
  "meta": { "timestamp": "2026-08-26T11:21:00.123Z" }
}
```

### Mint a CSRF token — `GET /api/csrf`

Sets the HttpOnly `__Host-csrf` cookie **and** returns the token. Mutation
requests from the browser must echo it via the `x-csrf-token` header
(double-submit cookie pattern).

```bash
curl -c cookies.txt "$BASE/api/csrf"
```

```json
{ "token": "8f14e45fceea167a5a36dedd4bea2543" }
```

```bash
# Then, for a browser mutation:
curl -X POST "$BASE/api/webhooks" \
  -b cookies.txt \
  -H "x-csrf-token: 8f14e45fceea167a5a36dedd4bea2543" \
  -H "Content-Type: application/json" \
  -d '{ "url": "https://api.example.com/webhooks/ophirpay", "events": ["payment.completed"] }'
```

## Multisig

### Get multisig configuration — `GET /api/multisig`

Auth: **required**. Reads the on-chain threshold/signers configuration.

```bash
curl "$BASE/api/multisig" -H "X-API-Key: $KEY"
```

```json
{
  "success": true,
  "data": {
    "threshold": 2,
    "signers": [
      "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U",
      "GDHJ3K2LQ7F5XQZPX6YWNMYKXWQXVZKBJZQFYX3F6KRLV4WDXHJMB2UY",
      "GC5QHJ2KJ7E6XW9Y3B4N8M1P2Q7R5T9U1V3W6X8Y2Z4A7C9D1E3F5G7H9J2K4"
    ],
    "enabled": true
  },
  "meta": { "timestamp": "2026-08-26T10:15:30.123Z" }
}
```

### Configure multisig — `POST /api/multisig`

Auth: **required**. Owner-only, on-chain.

```bash
curl -X POST "$BASE/api/multisig" \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "threshold": 2,
    "signers": [
      "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U",
      "GDHJ3K2LQ7F5XQZPX6YWNMYKXWQXVZKBJZQFYX3F6KRLV4WDXHJMB2UY",
      "GC5QHJ2KJ7E6XW9Y3B4N8M1P2Q7R5T9U1V3W6X8Y2Z4A7C9D1E3F5G7H9J2K4"
    ],
    "enabled": true
  }'
```

```json
{
  "success": true,
  "data": {
    "txHash": "c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f901234",
    "threshold": 2,
    "signers": 3,
    "enabled": true
  },
  "meta": { "timestamp": "2026-08-26T11:30:00.123Z" }
}
```

### Propose a payment — `POST /api/multisig/propose`

Auth: **required**.

```bash
curl -X POST "$BASE/api/multisig/propose" \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "payee": "GDHJ3K2LQ7F5XQZPX6YWNMYKXWQXVZKBJZQFYX3F6KRLV4WDXHJMB2UY",
    "amount": 1000000000,
    "assetCode": "XLM",
    "memo": "treasury-payout"
  }'
```

```json
{
  "success": true,
  "data": {
    "txHash": "d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90123456",
    "proposalId": 7
  },
  "meta": { "timestamp": "2026-08-26T11:35:00.123Z" }
}
```

### Approve a proposal — `POST /api/multisig/approve`

Auth: **required**.

```bash
curl -X POST "$BASE/api/multisig/approve" \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{ "requestId": 7 }'
```

```json
{
  "success": true,
  "data": {
    "approved": true,
    "requestId": 7,
    "txHash": "e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9012345678"
  },
  "meta": { "timestamp": "2026-08-26T11:40:00.123Z" }
}
```

### Execute a proposal — `POST /api/multisig/execute`

Auth: **required**. Requires the approval threshold to be met.

```bash
curl -X POST "$BASE/api/multisig/execute" \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{ "requestId": 7 }'
```

```json
{
  "success": true,
  "data": {
    "executed": true,
    "requestId": 7,
    "txHash": "f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f901234567890"
  },
  "meta": { "timestamp": "2026-08-26T11:45:00.123Z" }
}
```

### List approval requests — `GET /api/multisig/requests`

Auth: **required**.

```bash
curl "$BASE/api/multisig/requests" -H "X-API-Key: $KEY"
```

```json
{
  "success": true,
  "data": {
    "requests": [
      {
        "id": 7,
        "proposer": "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U",
        "payee": "GDHJ3K2LQ7F5XQZPX6YWNMYKXWQXVZKBJZQFYX3F6KRLV4WDXHJMB2UY",
        "amount": 1000000000,
        "asset": "native",
        "tx_hash": "d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90123456",
        "approvals": [
          "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U",
          "GDHJ3K2LQ7F5XQZPX6YWNMYKXWQXVZKBJZQFYX3F6KRLV4WDXHJMB2UY"
        ],
        "executed": false,
        "created_at": 1785249000
      }
    ]
  },
  "meta": { "timestamp": "2026-08-26T11:35:00.123Z" }
}
```

---

## Governance

### List proposals — `GET /api/governance/proposals`

Auth: **required**. Most recent first, capped at 100; `truncated` is `true`
when older proposals were dropped.

```bash
curl "$BASE/api/governance/proposals" -H "X-API-Key: $KEY"
```

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": 3,
        "title": "Raise escrow fee cap to 50 bps",
        "description": "Adjust the platform escrow fee from 25 to 50 basis points.",
        "action_type": "set_fee_config",
        "yes_votes": 12,
        "no_votes": 2,
        "voting_ends_at": 1785600000,
        "executed": false,
        "proposer": "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U"
      }
    ],
    "total": 9,
    "truncated": false
  },
  "meta": { "timestamp": "2026-08-26T10:15:30.123Z" }
}
```

### Create a proposal — `POST /api/governance/proposals`

Auth: **required**. Requires a deposit `>= min_proposal_deposit` when the
governance config requires it.

```bash
curl -X POST "$BASE/api/governance/proposals" \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "proposer": "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U",
    "title": "Raise escrow fee cap to 50 bps",
    "description": "Adjust the platform escrow fee from 25 to 50 basis points.",
    "actionType": "set_fee_config",
    "target": "set_fee_config",
    "depositAsset": "native",
    "depositAmount": 5000000
  }'
```

```json
{
  "success": true,
  "data": {
    "txHash": "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
    "proposalId": 3
  },
  "meta": { "timestamp": "2026-08-26T11:50:00.123Z" }
}
```

### Cast a vote — `POST /api/governance/vote`

Auth: **required**. One vote per address per proposal.

```bash
curl -X POST "$BASE/api/governance/vote" \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "proposalId": 3,
    "voter": "GDHJ3K2LQ7F5XQZPX6YWNMYKXWQXVZKBJZQFYX3F6KRLV4WDXHJMB2UY",
    "support": true
  }'
```

```json
{
  "success": true,
  "data": {
    "voted": true,
    "proposalId": 3,
    "txHash": "b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9012"
  },
  "meta": { "timestamp": "2026-08-26T11:55:00.123Z" }
}
```

### Execute a passed proposal — `POST /api/governance/execute`

Auth: **required**.

```bash
curl -X POST "$BASE/api/governance/execute" \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{ "proposalId": 1 }'
```

```json
{
  "success": true,
  "data": {
    "executed": true,
    "proposalId": 1,
    "txHash": "c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f901234"
  },
  "meta": { "timestamp": "2026-08-26T12:00:00.123Z" }
}
```

---

## Analytics

### Get payment analytics — `GET /api/analytics`

Auth: **required**. Aggregates the authenticated user's payment records.

```bash
curl "$BASE/api/analytics" -H "X-API-Key: $KEY"
```

```json
{
  "success": true,
  "data": {
    "totalPayments": 137,
    "completedPayments": 121,
    "failedPayments": 3,
    "totalVolume": 18426.75,
    "averageAmount": 134.5,
    "successRate": 88,
    "volumeByDay": [
      { "date": "2026-08-24", "volume": 320.5, "count": 4 },
      { "date": "2026-08-25", "volume": 210.0, "count": 3 },
      { "date": "2026-08-26", "volume": 540.25, "count": 6 }
    ]
  },
  "meta": { "timestamp": "2026-08-26T10:15:30.123Z" }
}
```

---

## Refunds

### List refunds — `GET /api/refunds`

Auth: **required**. Pass `?analytics=true` for reason-code buckets instead of
the record list.

```bash
curl "$BASE/api/refunds" -H "X-API-Key: $KEY"
```

```json
{
  "success": true,
  "data": [
    {
      "id": "cm0rf0000000000000000001",
      "userId": "u_01J2K3L4M5N6P7Q8R9S0T1",
      "paymentId": "cm0py0000000000000000003",
      "amount": 25.5,
      "asset": "native",
      "reason": "Duplicate charge",
      "reasonCode": 2,
      "status": "APPROVED",
      "onChainId": 4,
      "requestedAt": "2026-08-25T16:20:00.000Z",
      "resolvedAt": "2026-08-26T09:00:00.000Z"
    }
  ],
  "meta": { "timestamp": "2026-08-26T10:15:30.123Z" }
}
```

```bash
curl "$BASE/api/refunds?analytics=true" -H "X-API-Key: $KEY"
```

```json
{
  "success": true,
  "data": [
    { "code": 0, "count": 1 },
    { "code": 1, "count": 2 },
    { "code": 2, "count": 5 },
    { "code": 3, "count": 0 },
    { "code": 4, "count": 1 },
    { "code": 5, "count": 3 }
  ],
  "meta": { "timestamp": "2026-08-26T10:15:30.123Z" }
}
```

### Persist a refund record — `POST /api/refunds`

Auth: **required**. Call **after** the on-chain `request_refund` succeeds;
`onChainId` comes from the transaction return value.

```bash
curl -X POST "$BASE/api/refunds" \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "paymentId": 42,
    "amount": 25500000,
    "asset": "native",
    "reason": "Duplicate charge",
    "reasonCode": 2,
    "onChainId": 4
  }'
```

```json
{
  "success": true,
  "data": {
    "id": "cm0rf0000000000000000001",
    "paymentId": "cm0py0000000000000000003",
    "amount": 25.5,
    "asset": "native",
    "reason": "Duplicate charge",
    "reasonCode": 2,
    "status": "REQUESTED",
    "onChainId": 4,
    "requestedAt": "2026-08-26T12:10:00.000Z"
  },
  "meta": { "timestamp": "2026-08-26T12:10:00.123Z" }
}
```

### Update refund status — `PATCH /api/refunds/{id}`

Auth: **required**. Mirrors an on-chain approve/process onto the ledger row.
Owner-scoped.

```bash
curl -X PATCH "$BASE/api/refunds/cm0rf0000000000000000001" \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{ "status": "PROCESSED" }'
```

```json
{
  "success": true,
  "data": { "updated": true },
  "meta": { "timestamp": "2026-08-26T12:15:00.123Z" }
}
```

---

## Hooks

### List notification hooks — `GET /api/hooks`

Auth: **required**. Optional `event_type` filter.

```bash
curl "$BASE/api/hooks?event_type=payment.created" -H "X-API-Key: $KEY"
```

```json
{
  "success": true,
  "data": [
    {
      "id": "cm0hk0000000000000000001",
      "userId": "u_01J2K3L4M5N6P7Q8R9S0T1",
      "eventType": "payment.created",
      "webhookUrl": "https://api.example.com/hooks/payment-created",
      "active": true,
      "onChainId": 2,
      "createdAt": "2026-08-10T12:00:00.000Z"
    }
  ],
  "meta": { "timestamp": "2026-08-26T10:15:30.123Z" }
}
```

### Persist a hook record — `POST /api/hooks`

Auth: **required**. Call **after** the on-chain `register_hook` succeeds;
`onChainId` comes from the transaction return value.

```bash
curl -X POST "$BASE/api/hooks" \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "eventType": "payment.created",
    "webhookUrl": "https://api.example.com/hooks/payment-created",
    "onChainId": 2
  }'
```

```json
{
  "success": true,
  "data": {
    "id": "cm0hk0000000000000000001",
    "eventType": "payment.created",
    "webhookUrl": "https://api.example.com/hooks/payment-created",
    "active": true,
    "onChainId": 2,
    "createdAt": "2026-08-26T12:20:00.000Z"
  },
  "meta": { "timestamp": "2026-08-26T12:20:00.123Z" }
}
```

### Deactivate a hook — `PATCH /api/hooks/{id}`

Auth: **required**. Owner-scoped.

```bash
curl -X PATCH "$BASE/api/hooks/cm0hk0000000000000000001" \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{ "active": false }'
```

```json
{
  "success": true,
  "data": { "updated": true },
  "meta": { "timestamp": "2026-08-26T12:25:00.123Z" }
}
```

## Audit log

### Query the audit log — `GET /api/audit-log`

Auth: **required**. Filters: `actor` (Stellar address), `action`, `since`
(unix timestamp).

```bash
curl -G "$BASE/api/audit-log" \
  -H "X-API-Key: $KEY" \
  --data-urlencode "page=1" \
  --data-urlencode "limit=20" \
  --data-urlencode "action=payment_recorded"
```

```json
{
  "success": true,
  "data": [
    {
      "id": 1042,
      "timestamp": 1785168000,
      "action": "payment_recorded",
      "actor": "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U",
      "target_id": 42,
      "details": "Payment 42: 25.5 XLM to GDHJ3K2LQ7F5XQZPX6YWNMYKXWQXVZKBJZQFYX3F6KRLV4WDXHJMB2UY"
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 1042, "timestamp": "2026-08-26T10:15:30.123Z" }
}
```

### Subscribe to the live audit-log stream — `GET /api/audit-log/sse`

No auth required. Server-Sent Events; new on-chain audit entries are pushed
as they appear.

```bash
curl -N --max-time 60 "$BASE/api/audit-log/sse"
```

```text
id: 1042
event: audit.entry
data: {"id":1042,"action":"payment_recorded","actor":"GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U","target_id":42,"timestamp":1785168000}

id: 1043
event: audit.entry
data: {"id":1043,"action":"escrow_created","actor":"GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U","target_id":3,"timestamp":1785168300}

```

---

## Events

### Subscribe to real-time payment events — `GET /api/events`

No auth required. Server-Sent Events polling the emitter contract:
`connected` on connect, `heartbeat` every 15s, `payment:created` per new
on-chain payment.

```bash
curl -N --max-time 60 "$BASE/api/events"
```

```text
event: connected
data: {"message":"SSE stream connected to emitter contract"}

event: payment:created
data: {"id":42,"payer":"GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U","payee":"GDHJ3K2LQ7F5XQZPX6YWNMYKXWQXVZKBJZQFYX3F6KRLV4WDXHJMB2UY","amount":25500000,"txHash":"a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90"}

event: heartbeat
data: {"timestamp":1785241100000}

```

### Fetch event history — `GET /api/events/history`

No auth required. Returns recent on-chain payment events (`limit` 1–200,
default 50).

```bash
curl "$BASE/api/events/history?limit=10"
```

```json
{
  "success": true,
  "data": {
    "events": [
      {
        "id": "evt_42",
        "type": "payment.created",
        "payer": "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U",
        "payee": "GDHJ3K2LQ7F5XQZPX6YWNMYKXWQXVZKBJZQFYX3F6KRLV4WDXHJMB2UY",
        "amount": 25500000,
        "txHash": "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90"
      }
    ]
  },
  "meta": { "timestamp": "2026-08-26T10:15:30.123Z" }
}
```

---

## Timelock

### List timelocked actions — `GET /api/timelock`

Auth: **required**. Returns pending timelocked admin actions; pass `?id=<u64>`
for a single action.

```bash
curl "$BASE/api/timelock" -H "X-API-Key: $KEY"
```

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "action_type": "set_fee_config",
      "target": "set_fee_config",
      "data": "{\"payment_fee_bps\":15}",
      "proposed_by": "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U",
      "proposed_at": 1785168000,
      "unlocks_at": 1785254400,
      "executed": false
    }
  ],
  "meta": { "timestamp": "2026-08-26T10:15:30.123Z" }
}
```

---

## RBAC

### Look up roles — `GET /api/rbac`

Auth: **required**. Pass `?addr=<G...>` for a single address; omit it for the
role map summary.

```bash
curl "$BASE/api/rbac?addr=GDHJ3K2LQ7F5XQZPX6YWNMYKXWQXVZKBJZQFYX3F6KRLV4WDXHJMB2UY" -H "X-API-Key: $KEY"
```

```json
{
  "success": true,
  "data": {
    "address": "GDHJ3K2LQ7F5XQZPX6YWNMYKXWQXVZKBJZQFYX3F6KRLV4WDXHJMB2UY",
    "role": { "admin": false, "operator": true, "auditor": false }
  },
  "meta": { "timestamp": "2026-08-26T10:15:30.123Z" }
}
```

```bash
curl "$BASE/api/rbac" -H "X-API-Key: $KEY"
```

```json
{
  "success": true,
  "data": {
    "available": true,
    "message": "Provide ?addr=G... to look up a specific address role"
  },
  "meta": { "timestamp": "2026-08-26T10:15:30.123Z" }
}
```

---

## Fee configuration

### Get the current fee config — `GET /api/fee-config`

Auth: **required**.

```bash
curl "$BASE/api/fee-config" -H "X-API-Key: $KEY"
```

```json
{
  "success": true,
  "data": {
    "payment_fee_bps": 10,
    "escrow_fee_bps": 25,
    "stream_fee_bps": 15,
    "batch_base_fee": 1000000,
    "batch_per_item_fee": 100000,
    "enabled": true
  },
  "meta": { "timestamp": "2026-08-26T10:15:30.123Z" }
}
```

### Get the fee collector — `GET /api/fee-config/collector`

Auth: **required**.

```bash
curl "$BASE/api/fee-config/collector" -H "X-API-Key: $KEY"
```

```json
{
  "success": true,
  "data": { "collector": "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U" },
  "meta": { "timestamp": "2026-08-26T10:15:30.123Z" }
}
```

### Get fee config history — `GET /api/fee-config/history`

Auth: **required**.

```bash
curl "$BASE/api/fee-config/history" -H "X-API-Key: $KEY"
```

```json
{
  "success": true,
  "data": [
    {
      "version": 2,
      "payment_fee_bps": 10,
      "escrow_fee_bps": 25,
      "stream_fee_bps": 15,
      "batch_base_fee": 1000000,
      "batch_per_item_fee": 100000,
      "enabled": true,
      "updated_at": 1785168000
    }
  ],
  "meta": { "timestamp": "2026-08-26T10:15:30.123Z" }
}
```

---

## Policy versions

### Get config version history — `GET /api/policy-versions`

Auth: **required**.

```bash
curl "$BASE/api/policy-versions" -H "X-API-Key: $KEY"
```

```json
{
  "success": true,
  "data": {
    "feeConfigHistory": [
      {
        "version": 2,
        "payment_fee_bps": 10,
        "escrow_fee_bps": 25,
        "stream_fee_bps": 15,
        "batch_base_fee": 1000000,
        "batch_per_item_fee": 100000,
        "enabled": true,
        "updated_at": 1785168000
      }
    ],
    "multisigHistory": [
      {
        "version": 1,
        "threshold": 1,
        "signers": ["GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U"],
        "enabled": false,
        "updated_at": 1784563200
      }
    ]
  },
  "meta": { "timestamp": "2026-08-26T10:15:30.123Z" }
}
```

---

## Contracts

### Get contract info — `GET /api/contracts`

Auth: **required**. Reads version and owner from the OphirPay contract.

```bash
curl "$BASE/api/contracts" -H "X-API-Key: $KEY"
```

```json
{
  "success": true,
  "data": {
    "network": "TESTNET",
    "rpcUrl": "https://soroban-testnet.stellar.org",
    "reachable": true,
    "contracts": {
      "ophirpay": {
        "id": "CCQGGUJRRVXMHNEX2RYPODGJE2YRMYY4Y7A3KTJH3QP2LWZLTCOPRPET",
        "version": "0.1.0",
        "owner": "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U"
      },
      "emitter": {
        "id": "CDAVU2XJ7C2Y52GRJZKRG3HDI7AJ2K2FHAFH5FPDTSUQAV7XNBQNNVAN"
      }
    }
  },
  "meta": { "timestamp": "2026-08-26T10:15:30.123Z" }
}
```

---

## Stats

### Get on-chain stats — `GET /api/stats`

Auth: **required**. Returns the contract's aggregate counters.

```bash
curl "$BASE/api/stats" -H "X-API-Key: $KEY"
```

```json
{
  "success": true,
  "data": {
    "total_payments_recorded": 137,
    "total_escrows_created": 12,
    "total_escrows_released": 8,
    "total_escrows_claimed": 4,
    "total_streams_created": 5,
    "total_streams_claimed": 2,
    "total_streams_cancelled": 0,
    "total_batches_processed": 9,
    "total_amount_escrowed": 2500000000,
    "total_amount_streamed": 1000000000,
    "total_amount_batched": 4000000000
  },
  "meta": { "timestamp": "2026-08-26T10:15:30.123Z" }
}
```

---

## Health

### Service health — `GET /api/health`

No auth required. Returns `200` when the database is healthy, `503`
otherwise.

```bash
curl "$BASE/api/health"
```

```json
{
  "success": true,
  "data": {
    "version": "0.1.0",
    "services": {
      "database": { "status": "ok", "latencyMs": 4 },
      "redis": { "status": "disabled", "latencyMs": null },
      "stellar": {
        "network": "TESTNET",
        "rpcUrl": "https://soroban-testnet.stellar.org",
        "rpc": { "status": "ok", "latencyMs": 120 }
      }
    },
    "uptime": 86400
  },
  "meta": { "timestamp": "2026-08-26T10:15:30.123Z" }
}
```

---

## Metrics

### Prometheus metrics — `GET /api/metrics`

No auth required. Returns Prometheus text format — scrape this endpoint from
your monitoring stack.

```bash
curl "$BASE/api/metrics"
```

```text
# HELP ophirpay_http_requests_total Total HTTP requests served
# TYPE ophirpay_http_requests_total counter
ophirpay_http_requests_total 12840

# HELP ophirpay_payments_created_total Total payments created
# TYPE ophirpay_payments_created_total counter
ophirpay_payments_created_total 137

# HELP ophirpay_webhooks_delivered_total Total webhooks delivered
# TYPE ophirpay_webhooks_delivered_total counter
ophirpay_webhooks_delivered_total 118

# HELP ophirpay_webhooks_failed_total Total webhooks that failed delivery
# TYPE ophirpay_webhooks_failed_total counter
ophirpay_webhooks_failed_total 2
```

---

## Endpoint index

| Endpoint | Method(s) | Auth | Section |
| --- | --- | --- | --- |
| `/api/payments` | GET, POST | ✅ | Payments |
| `/api/payments/{id}` | GET, PATCH, DELETE | ✅ | Payments |
| `/api/payments/export` | GET | ✅ | Payments |
| `/api/batches` | GET, POST | ✅ | Batches |
| `/api/batches/{id}` | GET | ✅ | Batches |
| `/api/recurring` | GET, POST | ✅ | Recurring payments |
| `/api/recurring/{id}` | GET | ✅ | Recurring payments |
| `/api/requests` | GET, POST | ✅ | Payment requests |
| `/api/escrows` | GET, POST | ✅ | Escrows |
| `/api/escrows/{id}` | GET | ✅ | Escrows |
| `/api/streams` | GET, POST | ✅ | Streams |
| `/api/streams/{id}` | GET | ✅ | Streams |
| `/api/webhooks` | GET, POST, DELETE | ✅ | Webhooks |
| `/api/keys` | GET, POST, DELETE | ✅ | API keys |
| `/api/auth/session` | POST, DELETE | ❌ | Session & CSRF |
| `/api/csrf` | GET | ❌ | Session & CSRF |
| `/api/multisig` | GET, POST | ✅ | Multisig |
| `/api/multisig/propose` | POST | ✅ | Multisig |
| `/api/multisig/approve` | POST | ✅ | Multisig |
| `/api/multisig/execute` | POST | ✅ | Multisig |
| `/api/multisig/requests` | GET | ✅ | Multisig |
| `/api/governance/proposals` | GET, POST | ✅ | Governance |
| `/api/governance/vote` | POST | ✅ | Governance |
| `/api/governance/execute` | POST | ✅ | Governance |
| `/api/analytics` | GET | ✅ | Analytics |
| `/api/refunds` | GET, POST | ✅ | Refunds |
| `/api/refunds/{id}` | PATCH | ✅ | Refunds |
| `/api/hooks` | GET, POST | ✅ | Hooks |
| `/api/hooks/{id}` | PATCH | ✅ | Hooks |
| `/api/audit-log` | GET | ✅ | Audit log |
| `/api/audit-log/sse` | GET | ❌ | Audit log |
| `/api/events` | GET (SSE) | ❌ | Events |
| `/api/events/history` | GET | ❌ | Events |
| `/api/timelock` | GET | ✅ | Timelock |
| `/api/rbac` | GET | ✅ | RBAC |
| `/api/fee-config` | GET | ✅ | Fee configuration |
| `/api/fee-config/collector` | GET | ✅ | Fee configuration |
| `/api/fee-config/history` | GET | ✅ | Fee configuration |
| `/api/policy-versions` | GET | ✅ | Policy versions |
| `/api/contracts` | GET | ✅ | Contracts |
| `/api/stats` | GET | ✅ | Stats |
| `/api/health` | GET | ❌ | Health |
| `/api/metrics` | GET | ❌ | Metrics |



