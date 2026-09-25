# Automation platform webhook guide

This guide is for no-code and low-code automation tools such as n8n, Make, Zapier, Pipedream and Workato.
It complements the developer signature reference in [`webhook-verification.md`](./webhook-verification.md).

## Webhook delivery shape

OphirPay sends an HTTP `POST` request with JSON content:

```http
POST /ophirpay/webhook HTTP/1.1
Content-Type: application/json
X-OphirPay-Event: payment.created
X-OphirPay-Signature: <hmac-sha256-hex>
```

```json
{
  "event": "payment.created",
  "timestamp": "2026-08-14T10:00:00.000Z",
  "data": {
    "paymentId": "pay_01J8Y6Y8R8V9K4W0T3N5B7C9D2",
    "userId": "usr_01J8Y6Y8R8V9K4W0T3N5B7C9D2",
    "amount": "125.50",
    "assetCode": "USDC",
    "assetIssuer": "GA5ZSEJ4KZ3P4P6XWJLZ4TLQUDV6C6PDU4XJ7BCVQZ4TVPULZNK3WYJ",
    "source": "GB7ZSEJ4KZ3P4P6XWJLZ4TLQUDV6C6PDU4XJ7BCVQZ4TVPULZNK3ABC",
    "destination": "GC6ZSEJ4KZ3P4P6XWJLZ4TLQUDV6C6PDU4XJ7BCVQZ4TVPULZNK3DEF",
    "memo": "invoice-1042",
    "status": "CREATED",
    "createdAt": "2026-08-14T10:00:00.000Z",
    "updatedAt": "2026-08-14T10:00:00.000Z"
  }
}
```

The examples in this document are generated from `src/lib/webhook-examples.ts` and validated by `src/__tests__/webhook-automation-guide.test.ts` so they cannot drift from the supported event list.

## Event catalogue

| Event | Lifecycle stage | Meaning | Idempotency key |
|---|---|---|---|
| `payment.created` | created | A payment row was created but has not been signed yet. | `data.paymentId` + `event` |
| `payment.signed` | signed | The payment transaction was signed by the source wallet. | `data.paymentId` + `event` |
| `payment.submitted` | submitted | The signed payment was submitted to the Stellar network. | `data.paymentId` + `event` |
| `payment.confirmed` | confirmed | The Stellar network confirmed the payment transaction. | `data.paymentId` + `event` |
| `payment.completed` | confirmed | The payment is complete from OphirPay's perspective. | `data.paymentId` + `event` |
| `payment.failed` | failed | The payment failed before completion. | `data.paymentId` + `event` |
| `batch.created` | created | A batch payment was created. | `data.batchId` + `event` |
| `batch.completed` | confirmed | Every payment in the batch completed. | `data.batchId` + `event` |
| `batch.failed` | failed | One or more payments in the batch failed. | `data.batchId` + `event` |
| `recurrence.triggered` | submitted | A recurring payment schedule produced a payment attempt. | `data.recurrenceId` + `event` + `data.runAt` |
| `recurrence.completed` | confirmed | A recurring payment attempt completed. | `data.recurrenceId` + `event` + `data.runAt` |
| `recurrence.failed` | failed | A recurring payment attempt failed. | `data.recurrenceId` + `event` + `data.runAt` |
| `request.created` | created | A shareable payment request was created. | `data.requestId` + `event` |
| `request.paid` | confirmed | A payment request was paid. | `data.requestId` + `event` |
| `request.expired` | failed | A payment request expired before payment. | `data.requestId` + `event` |

## Complete examples by lifecycle stage

### Created: `payment.created`

```json
{
  "event": "payment.created",
  "timestamp": "2026-08-14T10:00:00.000Z",
  "data": {
    "paymentId": "pay_01J8Y6Y8R8V9K4W0T3N5B7C9D2",
    "userId": "usr_01J8Y6Y8R8V9K4W0T3N5B7C9D2",
    "amount": "125.50",
    "assetCode": "USDC",
    "assetIssuer": "GA5ZSEJ4KZ3P4P6XWJLZ4TLQUDV6C6PDU4XJ7BCVQZ4TVPULZNK3WYJ",
    "source": "GB7ZSEJ4KZ3P4P6XWJLZ4TLQUDV6C6PDU4XJ7BCVQZ4TVPULZNK3ABC",
    "destination": "GC6ZSEJ4KZ3P4P6XWJLZ4TLQUDV6C6PDU4XJ7BCVQZ4TVPULZNK3DEF",
    "memo": "invoice-1042",
    "status": "CREATED",
    "createdAt": "2026-08-14T10:00:00.000Z",
    "updatedAt": "2026-08-14T10:00:00.000Z"
  }
}
```

### Signed: `payment.signed`

```json
{
  "event": "payment.signed",
  "timestamp": "2026-08-14T10:01:00.000Z",
  "data": {
    "paymentId": "pay_01J8Y6Y8R8V9K4W0T3N5B7C9D2",
    "userId": "usr_01J8Y6Y8R8V9K4W0T3N5B7C9D2",
    "amount": "125.50",
    "assetCode": "USDC",
    "assetIssuer": "GA5ZSEJ4KZ3P4P6XWJLZ4TLQUDV6C6PDU4XJ7BCVQZ4TVPULZNK3WYJ",
    "source": "GB7ZSEJ4KZ3P4P6XWJLZ4TLQUDV6C6PDU4XJ7BCVQZ4TVPULZNK3ABC",
    "destination": "GC6ZSEJ4KZ3P4P6XWJLZ4TLQUDV6C6PDU4XJ7BCVQZ4TVPULZNK3DEF",
    "memo": "invoice-1042",
    "status": "SIGNED",
    "createdAt": "2026-08-14T10:00:00.000Z",
    "updatedAt": "2026-08-14T10:01:00.000Z",
    "signedAt": "2026-08-14T10:01:00.000Z"
  }
}
```

### Submitted: `payment.submitted`

```json
{
  "event": "payment.submitted",
  "timestamp": "2026-08-14T10:02:00.000Z",
  "data": {
    "paymentId": "pay_01J8Y6Y8R8V9K4W0T3N5B7C9D2",
    "userId": "usr_01J8Y6Y8R8V9K4W0T3N5B7C9D2",
    "amount": "125.50",
    "assetCode": "USDC",
    "assetIssuer": "GA5ZSEJ4KZ3P4P6XWJLZ4TLQUDV6C6PDU4XJ7BCVQZ4TVPULZNK3WYJ",
    "source": "GB7ZSEJ4KZ3P4P6XWJLZ4TLQUDV6C6PDU4XJ7BCVQZ4TVPULZNK3ABC",
    "destination": "GC6ZSEJ4KZ3P4P6XWJLZ4TLQUDV6C6PDU4XJ7BCVQZ4TVPULZNK3DEF",
    "memo": "invoice-1042",
    "status": "SUBMITTED",
    "createdAt": "2026-08-14T10:00:00.000Z",
    "updatedAt": "2026-08-14T10:02:00.000Z",
    "submittedAt": "2026-08-14T10:02:00.000Z",
    "transactionHash": "8fd3a8f7b4d21678320d8f2f5e5a5b8f9c0d1e2f3a4b5c6d7e8f90123456789a"
  }
}
```

### Confirmed: `payment.confirmed`

```json
{
  "event": "payment.confirmed",
  "timestamp": "2026-08-14T10:03:00.000Z",
  "data": {
    "paymentId": "pay_01J8Y6Y8R8V9K4W0T3N5B7C9D2",
    "userId": "usr_01J8Y6Y8R8V9K4W0T3N5B7C9D2",
    "amount": "125.50",
    "assetCode": "USDC",
    "assetIssuer": "GA5ZSEJ4KZ3P4P6XWJLZ4TLQUDV6C6PDU4XJ7BCVQZ4TVPULZNK3WYJ",
    "source": "GB7ZSEJ4KZ3P4P6XWJLZ4TLQUDV6C6PDU4XJ7BCVQZ4TVPULZNK3ABC",
    "destination": "GC6ZSEJ4KZ3P4P6XWJLZ4TLQUDV6C6PDU4XJ7BCVQZ4TVPULZNK3DEF",
    "memo": "invoice-1042",
    "status": "CONFIRMED",
    "createdAt": "2026-08-14T10:00:00.000Z",
    "updatedAt": "2026-08-14T10:03:00.000Z",
    "confirmedAt": "2026-08-14T10:03:00.000Z",
    "completedAt": "2026-08-14T10:03:00.000Z",
    "transactionHash": "8fd3a8f7b4d21678320d8f2f5e5a5b8f9c0d1e2f3a4b5c6d7e8f90123456789a",
    "ledger": 54123123
  }
}
```

### Failed: `payment.failed`

```json
{
  "event": "payment.failed",
  "timestamp": "2026-08-14T10:04:00.000Z",
  "data": {
    "paymentId": "pay_01J8Y6Y8R8V9K4W0T3N5B7C9D2",
    "userId": "usr_01J8Y6Y8R8V9K4W0T3N5B7C9D2",
    "amount": "125.50",
    "assetCode": "USDC",
    "assetIssuer": "GA5ZSEJ4KZ3P4P6XWJLZ4TLQUDV6C6PDU4XJ7BCVQZ4TVPULZNK3WYJ",
    "source": "GB7ZSEJ4KZ3P4P6XWJLZ4TLQUDV6C6PDU4XJ7BCVQZ4TVPULZNK3ABC",
    "destination": "GC6ZSEJ4KZ3P4P6XWJLZ4TLQUDV6C6PDU4XJ7BCVQZ4TVPULZNK3DEF",
    "memo": "invoice-1042",
    "status": "FAILED",
    "createdAt": "2026-08-14T10:00:00.000Z",
    "updatedAt": "2026-08-14T10:04:00.000Z",
    "failedAt": "2026-08-14T10:04:00.000Z",
    "failureReason": "Destination account lacks the required trustline",
    "failureCode": "DESTINATION_TRUSTLINE_MISSING"
  }
}
```

## Idempotent consumption

OphirPay retries webhook delivery after transient failures. Treat every handler as **at-least-once delivery**:

1. Compute an idempotency key before doing side effects.
2. Store the key in your destination system.
3. If the same key arrives again, return HTTP 200 and skip duplicate work.

Recommended keys:

- Payments: `event + ':' + data.paymentId`
- Batches: `event + ':' + data.batchId`
- Recurrences: `event + ':' + data.recurrenceId + ':' + data.runAt`
- Requests: `event + ':' + data.requestId`

If you need byte-level dedupe across retries, hash the canonical body as described in [`webhook-verification.md`](./webhook-verification.md).

## Platform notes

### n8n

1. Use a **Webhook** trigger node.
2. Add an **IF** node to branch on `{{$json.event}}`.
3. Save the idempotency key in your database, Google Sheet or Airtable before triggering downstream side effects.
4. Use a **Code** node for HMAC verification if your workflow can store a secret and run JavaScript crypto safely. If not, put a small verified endpoint in front of n8n and forward only verified payloads.

### Make

1. Use **Webhooks > Custom webhook**.
2. Add a filter on the `event` field for each route.
3. Use a Data Store keyed by the idempotency key to skip retries.
4. Make does not provide a universal constant-time HMAC verifier in every plan/module combination. If you cannot verify `X-OphirPay-Signature`, receive the payload through a small verification endpoint first.

### Zapier

1. Use **Webhooks by Zapier > Catch Hook**.
2. Add a Filter step for `event`.
3. Store processed idempotency keys in Storage by Zapier or your app database.
4. Zapier is not the right place to hand-roll cryptographic verification. Prefer a lightweight verified relay endpoint, then trigger Zapier after verification.

## Signature verification guidance

If your platform cannot compute HMAC-SHA256 over the exact canonical JSON body, do **not** skip verification for production money movement. Use one of these patterns:

- Put a small serverless function in front of the automation tool and forward only verified payloads.
- Use the reference verifier in [`examples/webhook-verification/`](../examples/webhook-verification/).
- Keep unverified automation flows read-only and manually reconcile before moving funds or updating accounting state.
