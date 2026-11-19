# OphirPay for Automation Platforms (n8n, Zapier, Make)

> Integration guide for no-code and low-code platforms. Covers every webhook
> event type, what the payload looks like at each lifecycle stage, how to
> handle signature verification when your platform cannot compute an HMAC,
> and how to consume deliveries idempotently.
>
> Developer-focused documentation (REST + SDK) lives in
> [`integration-guide.md`](integration-guide.md); the real-time browser
> stream is covered in [`SSE.md`](SSE.md). The receiver-side HMAC recipe is
> specified in [`webhook-verification.md`](webhook-verification.md).

OphirPay pushes a signed JSON payload to your endpoint every time a payment,
batch, recurrence or payment request changes state. Automation platforms can
consume these deliveries with a single "Webhook" trigger node — no code, no
polling, and no API-key management on the receiving side.

## How delivery works

| Property      | Value                                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------- |
| Method        | `POST` (application/json)                                                                       |
| Headers       | `X-OphirPay-Signature`, `X-OphirPay-Timestamp`, `X-OphirPay-Event`                              |
| Retries       | 3 attempts with exponential backoff (1s → 2s → 4s)                                              |
| Success       | Any 2xx status code                                                                             |
| Failure       | Non-2xx, timeout (5s per attempt) or unreachable target                                         |
| Replay window | Delivery is rejected as stale only on _your_ side (see [Idempotency](#idempotency-and-retries)) |

Subscribe by registering your endpoint in **Webhooks** (dashboard) or via
`POST /api/webhooks`, passing the event types you want in `events`.
**An empty `events` array subscribes to everything** — the simplest choice for
an automation user who wants all lifecycle updates.

## Event types

Every event is delivered in the same envelope: `event`, `timestamp` (ISO 8601
UTC, when the event was produced), `data` (event-specific), and `signature`
(the HMAC — see [Signature verification](#signature-verification)).

### Payments (`payment.*`)

| Event               | Fired when                              | `data` fields                                                         |
| ------------------- | --------------------------------------- | --------------------------------------------------------------------- |
| `payment.created`   | A payment record is created             | `paymentId`, `amount`, `assetCode`, `status` (`CREATED`), `createdAt` |
| `payment.signed`    | The payment transaction has been signed | `paymentId`, `amount`, `assetCode`, `status` (`SIGNED`), `signedAt`   |
| `payment.submitted` | The signed transaction hit the network  | `paymentId`, `amount`, `assetCode`, `transactionHash`, `submittedAt`  |
| `payment.confirmed` | The transaction is confirmed on-chain   | `paymentId`, `amount`, `assetCode`, `transactionHash`, `confirmedAt`  |
| `payment.completed` | The payment is fully settled            | `paymentId`, `amount`, `assetCode`, `transactionHash`, `completedAt`  |
| `payment.failed`    | The payment failed at any stage         | `paymentId`, `amount`, `assetCode`, `errorMessage`, `failedAt`        |

Field meanings:

- **`paymentId`** — stable application id of the payment. Use it as the
  correlation key across the whole lifecycle.
- **`amount`** — decimal string in display units (e.g. `"25.50"`), not stroops.
- **`assetCode`** — asset the payment moves (`XLM` for native lumens, or an
  issued-asset code such as `USDC`).
- **`transactionHash`** — Stellar transaction hash; present from
  `payment.submitted` onward. Absent before that (the transaction does not
  exist yet) and on `payment.failed` before submission.
- **`status`** — the payment's state at the time the event was produced
  (`CREATED`, `SIGNED`, …). Prefer the event name itself for branching; the
  field is informational.
- **`errorMessage`** — human-readable failure reason, only on
  `payment.failed`.

### Batches (`batch.*`)

| Event             | Fired when                          | `data` fields                                                                                      |
| ----------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------- |
| `batch.created`   | A batch payment starts processing   | `batchId`, `itemCount`, `totalAmount`, `assetCode`, `status`, `createdAt`                          |
| `batch.completed` | Every item reached a terminal state | `batchId`, `itemCount`, `succeeded`, `failed`, `totalAmount`, `assetCode`, `status`, `completedAt` |
| `batch.failed`    | The batch was aborted               | `batchId`, `itemCount`, `succeeded`, `failed`, `assetCode`, `errorMessage`, `failedAt`             |

`batch.completed` is the "normal end" event — check `failed` for partial
failures. `batch.failed` means the batch aborted early; `succeeded` counts the
items that went through before the abort. Field meanings:

- **`batchId`** — stable id of the batch; the correlation key for `batch.*`
  events.
- **`itemCount`** — number of recipients the batch was created with.
- **`succeeded`** / **`failed`** — terminal per-item counts, present on the
  closing (`completed`/`failed`) events only.
- **`totalAmount`** — decimal string sum of all item amounts.

### Recurrences (`recurrence.*`)

| Event                  | Fired when                    | `data` fields                                                                        |
| ---------------------- | ----------------------------- | ------------------------------------------------------------------------------------ |
| `recurrence.triggered` | A scheduled payment fires     | `recurrenceId`, `paymentId`, `amount`, `assetCode`, `interval`, `triggeredAt`        |
| `recurrence.completed` | The triggered payment settled | `recurrenceId`, `paymentId`, `amount`, `assetCode`, `transactionHash`, `completedAt` |
| `recurrence.failed`    | The triggered payment failed  | `recurrenceId`, `paymentId`, `amount`, `assetCode`, `errorMessage`, `failedAt`       |

`recurrence.triggered` carries the freshly created `paymentId`; subscribe to
the `payment.*` events as well if you want the payment's own lifecycle.
Field meanings:

- **`recurrenceId`** — stable id of the schedule; the correlation key for
  `recurrence.*` events.
- **`paymentId`** — the payment created by this trigger (link it to the
  matching `payment.*` events).
- **`interval`** — schedule cadence string (e.g. `monthly`).

### Payment requests (`request.*`)

| Event             | Fired when                         | `data` fields                                                                        |
| ----------------- | ---------------------------------- | ------------------------------------------------------------------------------------ |
| `request.created` | A payment request is published     | `requestId`, `amount`, `assetCode`, `description`, `status` (`PENDING`), `createdAt` |
| `request.paid`    | Someone paid the request           | `requestId`, `amount`, `assetCode`, `paymentId`, `transactionHash`, `paidAt`         |
| `request.expired` | The request deadline passed unpaid | `requestId`, `amount`, `assetCode`, `description`, `status` (`EXPIRED`), `expiredAt` |

Field meanings:

- **`requestId`** — stable id of the payment request; the correlation key
  for `request.*` events.
- **`description`** — free-text label shown to the payer (e.g. an invoice
  reference).
- **`paymentId`** — on `request.paid`, the payment that settled the request
  (link it to the matching `payment.*` events).

All the `*At` fields (`createdAt`, `signedAt`, `submittedAt`, `confirmedAt`,
`completedAt`, `failedAt`, `triggeredAt`, `paidAt`, `expiredAt`) are ISO 8601
UTC timestamps of the moment the transition happened; use them for ordering,
never as uniqueness keys (see [Idempotency](#idempotency-and-retries)).
The `status` field on `batch.*`/`request.*` events mirrors the record's
state at send time (`PROCESSING`, `COMPLETED`, `PENDING`, `EXPIRED`).

## Full payload per lifecycle stage

The following payloads are **really signed** with the documentation secret
`test-secret-0123456789`, so you can use them to test a receiver end to end.
The signed files also live under [`examples/automation-payloads/`](../examples/automation-payloads/)
and are validated by the test suite so they cannot drift from the schema.

### Created

```json
{
  "event": "payment.created",
  "timestamp": "2026-09-01T10:00:00.000Z",
  "data": {
    "paymentId": "p_9f2c81ab34d74e0f",
    "amount": "25.50",
    "assetCode": "USDC",
    "status": "CREATED",
    "createdAt": "2026-09-01T10:00:00.000Z"
  },
  "signature": "7c430ad30879f72b3d4255509739fc084433943c3e73c87d8518c525b6c7339e"
}
```

### Signed

```json
{
  "event": "payment.signed",
  "timestamp": "2026-09-01T10:00:04.000Z",
  "data": {
    "paymentId": "p_9f2c81ab34d74e0f",
    "amount": "25.50",
    "assetCode": "USDC",
    "status": "SIGNED",
    "signedAt": "2026-09-01T10:00:04.000Z"
  },
  "signature": "8d911220e8843cdbbc24c8b6794e7dd009c3076c9e3afeb5be915b44f6d5ded8"
}
```

### Submitted

```json
{
  "event": "payment.submitted",
  "timestamp": "2026-09-01T10:00:06.000Z",
  "data": {
    "paymentId": "p_9f2c81ab34d74e0f",
    "amount": "25.50",
    "assetCode": "USDC",
    "transactionHash": "a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00",
    "submittedAt": "2026-09-01T10:00:06.000Z"
  },
  "signature": "6ce35e192db731f82fb4ebb6798bd513ca3f7aef9db8e3bfe13d6f16b90087b2"
}
```

### Confirmed

```json
{
  "event": "payment.confirmed",
  "timestamp": "2026-09-01T10:00:11.000Z",
  "data": {
    "paymentId": "p_9f2c81ab34d74e0f",
    "amount": "25.50",
    "assetCode": "USDC",
    "transactionHash": "a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00",
    "confirmedAt": "2026-09-01T10:00:11.000Z"
  },
  "signature": "552f764591d98b5a488e00f9420aaede81a78cd6ecc451828a442751b07ead31"
}
```

### Completed

```json
{
  "event": "payment.completed",
  "timestamp": "2026-09-01T10:00:12.000Z",
  "data": {
    "paymentId": "p_9f2c81ab34d74e0f",
    "amount": "25.50",
    "assetCode": "USDC",
    "transactionHash": "a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00",
    "completedAt": "2026-09-01T10:00:12.000Z"
  },
  "signature": "def2d4ca60b3a40f104e0a25bf6a2cbca103bc0aa906d5fc94674bf5d4ff7598"
}
```

### Failed

```json
{
  "event": "payment.failed",
  "timestamp": "2026-09-01T10:00:09.000Z",
  "data": {
    "paymentId": "p_9f2c81ab34d74e0f",
    "amount": "25.50",
    "assetCode": "USDC",
    "errorMessage": "Transaction simulation failed: insufficient trustline for USDC",
    "failedAt": "2026-09-01T10:00:09.000Z"
  },
  "signature": "e38b8216d2bc0a920663600d07fa275823b9cea7c039eb0dd345f56129daa136"
}
```

## Signature verification

Each delivery carries:

- `X-OphirPay-Signature` — HMAC-SHA256 (hex) over
  `<X-OphirPay-Timestamp>.<canonical body>`;
- `X-OphirPay-Timestamp` — the timestamp that is bound into that HMAC.

The _canonical body_ is the JSON with the `signature` field emptied (the key
stays, set to `""`) re-serialized exactly like Node's `JSON.stringify`: no
whitespace, keys in received order. See
[`webhook-verification.md`](webhook-verification.md) for the exact recipe and
[`examples/webhook-verification/`](../examples/webhook-verification/README.md)
for runnable Node, Python and Go verifiers.

### When your platform cannot compute an HMAC

n8n, Zapier and Make **do not** let a plain Webhook trigger recompute an
HMAC-SHA256 over a re-serialized body (the canonicalization is not expressible
in their trigger steps). Do **not** try to approximate it. Instead:

1. **Run the tiny relay.** Deploy
   [`examples/notification-templates/relay-adapter.ts`](../examples/notification-templates/relay-adapter.ts)
   (Vercel Edge / Cloudflare Workers / any serverless runtime) in front of the
   platform. The relay verifies the signature with the reference code, then
   forwards the body over an authenticated or secret-scoped URL. This is the
   only option that keeps end-to-end authenticity.
2. **Restrict the channel.** If a relay is out of scope, treat the webhook URL
   as a bearer capability: use an unguessable path (OphirPay webhook URLs may
   embed a random token), keep it private, and accept that anyone who learns
   the URL can post plausible-looking events. Combine with the platform's own
   source filtering, and never let a received event move money by itself.
3. **Re-check critical events against the API.** For high-value actions,
   ignore the envelope's trust problem entirely: when a `payment.confirmed`
   arrives, call `GET /api/payments/<paymentId>` with an API key and act only
   if the stored state agrees. The webhook is then just a _prompt_, not a
   _proof_.

Rule of thumb: **verification via relay for money-adjacent flows; URL
secrecy + API re-check for dashboards and notifications.**

## Idempotency and retries

OphirPay retries a delivery up to 3 times (1s/2s/4s backoff) until your
endpoint answers 2xx, and a manual replay can re-send older events later.
Both means a platform can receive the **same logical event more than once**.
Make every automation idempotent:

- **Deduplicate on `event` + `data.paymentId`** (or `batchId` /
  `recurrenceId` / `requestId`) — the natural composite key. In n8n, write
  the key into a data store (e.g. the built-in Static Data or a Redis node)
  and drop duplicates before the workflow body.
- **`timestamp` is when OphirPay produced the event**, not when it was
  delivered — use it for ordering, never as a uniqueness key.
- **Replays re-sign with the original envelope timestamp**, so an old event
  delivered late still carries its original `timestamp`. Dedup keys must not
  include the delivery time.
- **Ordering is not guaranteed** across retries: a replayed
  `payment.created` can arrive after a live `payment.confirmed`. Store state
  keyed by id and apply events by their lifecycle position rather than by
  arrival order.
- **Answer fast.** Trigger heavy automation _after_ returning 200. Long
  processing inside the trigger step risks the 5s attempt timeout, which
  turns a successful run into a retry — and a duplicate.

## Platform notes

### n8n

- Use the **Webhook** node with HTTP method `POST` and response mode
  _Immediately_ (return 200 fast).
- Register the production URL (not the test URL) in OphirPay's Webhooks page.
- Deduplicate with the **Data Store** or **Redis** node on
  `{{ $json.event }}:{{ $json.data.paymentId }}`.
- For signature checking, front the Webhook node with a **Code** node calling
  a hosted relay (option 1 above), or self-host n8n and verify inline via the
  Node crypto module.

### Zapier

- Create a **Webhooks by Zapier** trigger ("Catch Hook"), then enable the
  OphirPay integration by registering the Zapier-provided URL.
- Zapier delivers at-least-once; use a **Filter** step plus a Storage-based
  dedup (e.g. _Storage by Zapier → Set Value_ with the composite key) before
  any paid action.
- Zapier cannot compute the HMAC — use the relay (option 1) or the API
  re-check (option 3) for anything money-adjacent.

### Make (Integromat)

- Use the **Webhooks → Custom webhook** module as the trigger and register
  the generated URL.
- Make retries on non-2xx automatically; your scenario should commit to
  idempotent handling (dedup via the **Data store** module).
- Same HMAC limitation as above — verify with a relay or re-check via API.

## Test event

Use **Webhooks → Send test** in the dashboard (or `POST /api/webhooks/<id>/test`)
to have OphirPay deliver a `test: true` payload shaped like `payment.completed`
so you can validate the whole pipeline before going live:

Check `test === true` (envelope or `data`) in your automation and route the
event to a no-op branch. The `test` flag (on both the envelope and inside
`data`) is present only on these simulated events — never on a real payment.
The payload mirrors a settled USDC payment, including the asset's issuing
account in `assetIssuer` (native XLM payments omit that field). The sample
above is signed with the documentation secret `test-secret-0123456789`, so it
also works as a receiver fixture:

```json
{
  "event": "payment.completed",
  "timestamp": "2026-09-01T10:00:00.000Z",
  "test": true,
  "data": {
    "test": true,
    "paymentId": "test_payment_000000000000000000000000",
    "amount": "25.00",
    "assetCode": "USDC",
    "assetIssuer": "GA5ZSEJ4KZ3P4P6XWJLZ4TLQUDV6C6PDU4XJ7BCVQZ4TVPULZNK3WYJ",
    "status": "COMPLETED",
    "description": "OphirPay test event — no real payment was created",
    "createdAt": "2026-09-01T10:00:00.000Z"
  },
  "signature": "ef4eb3000d2f390a02bbe15619c262517acc52151ab68bd4d039b611cab69b60"
}
```

Check `test === true` (envelope or `data`) in your automation and route the
event to a no-op branch.

## Reference

- Event source of truth: `src/app/api/webhooks/event-types.ts`
- Dispatch pipeline map: `src/lib/webhook-dispatcher.ts`
- Signing implementation: `src/lib/webhook-deliver.ts` (`buildSignedPayload`)
- Receiver verification: `docs/webhook-verification.md` +
  `examples/webhook-verification/` (Node, Python, Go)
- Signed example payloads: `examples/automation-payloads/` (regenerate with
  `node scripts/generate-automation-guide-payloads.mjs`)
