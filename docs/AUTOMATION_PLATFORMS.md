# Webhook Integration Guide for Automation Platforms

For people building OphirPay flows in **n8n**, **Zapier**, **Make** (Integromat)
or any other no-code / low-code automation tool.

If you are writing code, read [`webhook-verification.md`](./webhook-verification.md)
and the runnable verifiers in [`examples/webhook-verification`](../examples/webhook-verification)
instead — this guide is for the platforms where you cannot run arbitrary code.

---

## 1. How a delivery arrives

Every webhook is one HTTP `POST` with a JSON body and these headers:

| Header | Meaning |
|---|---|
| `Content-Type` | `application/json` |
| `X-OphirPay-Signature` | HMAC-SHA256 of the body, hex-encoded (see §5) |
| `X-OphirPay-Event` | The event type, e.g. `payment.completed` |
| `X-OphirPay-Delivery` | Unique id for *this delivery attempt* — use it to deduplicate |

## 2. The envelope

Every event shares the same outer shape (`data` is event-specific — see §3):

```text
{
  "event":     "<event type, e.g. payment.completed>",
  "timestamp": "<ISO-8601 UTC>",
  "data":      { ... event-specific fields, see §3 ... },
  "signature": "<HMAC-SHA256 hex over the canonical body, see §5>"
}
```

| Field | Meaning |
|---|---|
| `event` | Event type — match on this to branch your flow |
| `timestamp` | ISO-8601 UTC time the event was dispatched |
| `data` | Event-specific object (§3) |
| `signature` | HMAC-SHA256 over the canonical body (§5) |

## 3. Events and their payloads

### 3.1 Payment lifecycle (dispatched)

The five payment stages arrive in this order for a successful payment.
A `payment.failed` can arrive instead of `confirmed`/`completed`.

**`payment.created`** — dispatched by `POST /api/payments`

| Field | Meaning |
|---|---|
| `paymentId` | OphirPay payment id (`pay_…`) — stable across every stage |
| `amount` | Decimal string in the asset's units. Keep it a string |
| `assetCode` | Asset ticker, e.g. `USDC` |
| `status` | `CREATED` |
| `createdAt` | When the record was created |

```json
{
  "event": "payment.created",
  "timestamp": "2026-08-14T00:00:00Z",
  "data": {
    "paymentId": "pay_01HZX8Q2M4T7K9V3N5P6R8S1TD",
    "amount": "25.00",
    "assetCode": "USDC",
    "status": "CREATED",
    "createdAt": "2026-08-14T00:00:00Z"
  },
  "signature": ""
}
```

**`payment.signed`** — the transaction was signed

| Field | Meaning |
|---|---|
| `paymentId` | As above |
| `amount` | As above |
| `assetCode` | As above |
| `status` | `SIGNED` |
| `signedAt` | When the transaction was signed |

```json
{
  "event": "payment.signed",
  "timestamp": "2026-08-14T00:00:05Z",
  "data": {
    "paymentId": "pay_01HZX8Q2M4T7K9V3N5P6R8S1TD",
    "amount": "25.00",
    "assetCode": "USDC",
    "status": "SIGNED",
    "signedAt": "2026-08-14T00:00:05Z"
  },
  "signature": ""
}
```

**`payment.submitted`** — sent to the Stellar network

| Field | Meaning |
|---|---|
| `paymentId` | As above |
| `amount` | As above |
| `assetCode` | As above |
| `transactionHash` | Stellar transaction hash — link out to an explorer with this |
| `submittedAt` | When it was submitted |

```json
{
  "event": "payment.submitted",
  "timestamp": "2026-08-14T00:00:09Z",
  "data": {
    "paymentId": "pay_01HZX8Q2M4T7K9V3N5P6R8S1TD",
    "amount": "25.00",
    "assetCode": "USDC",
    "transactionHash": "3389e9f0f1a65f19736cacf544c2e825313e8447f569233bb8db39aa607c8889",
    "submittedAt": "2026-08-14T00:00:09Z"
  },
  "signature": ""
}
```

**`payment.confirmed`** — the network confirmed the transaction

| Field | Meaning |
|---|---|
| `paymentId` | As above |
| `amount` | As above |
| `assetCode` | As above |
| `transactionHash` | As above |
| `confirmedAt` | When the network confirmed it |

```json
{
  "event": "payment.confirmed",
  "timestamp": "2026-08-14T00:00:14Z",
  "data": {
    "paymentId": "pay_01HZX8Q2M4T7K9V3N5P6R8S1TD",
    "amount": "25.00",
    "assetCode": "USDC",
    "transactionHash": "3389e9f0f1a65f19736cacf544c2e825313e8447f569233bb8db39aa607c8889",
    "confirmedAt": "2026-08-14T00:00:14Z"
  },
  "signature": ""
}
```

**`payment.completed`** — OphirPay marked the record complete (safe to fulfil on this one)

| Field | Meaning |
|---|---|
| `paymentId` | As above |
| `amount` | As above |
| `assetCode` | As above |
| `transactionHash` | As above |
| `completedAt` | When the record was marked complete |

```json
{
  "event": "payment.completed",
  "timestamp": "2026-08-14T00:00:15Z",
  "data": {
    "paymentId": "pay_01HZX8Q2M4T7K9V3N5P6R8S1TD",
    "amount": "25.00",
    "assetCode": "USDC",
    "transactionHash": "3389e9f0f1a65f19736cacf544c2e825313e8447f569233bb8db39aa607c8889",
    "completedAt": "2026-08-14T00:00:15Z"
  },
  "signature": ""
}
```

**`payment.failed`** — the payment failed on-chain or was marked failed

| Field | Meaning |
|---|---|
| `paymentId` | As above |
| `amount` | As above |
| `assetCode` | As above |
| `transactionHash` | As above |
| `errorMessage` | Human-readable failure reason |
| `failedAt` | When the failure was recorded |

```json
{
  "event": "payment.failed",
  "timestamp": "2026-08-14T00:00:16Z",
  "data": {
    "paymentId": "pay_01HZX8Q2M4T7K9V3N5P6R8S1TD",
    "amount": "25.00",
    "assetCode": "USDC",
    "transactionHash": "3389e9f0f1a65f19736cacf544c2e825313e8447f569233bb8db39aa607c8889",
    "errorMessage": "op_underfunded: source account balance is below the payment amount",
    "failedAt": "2026-08-14T00:00:16Z"
  },
  "signature": ""
}
```

**`request.created`** — a payment request link was created

| Field | Meaning |
|---|---|
| `requestId` | OphirPay payment-request id |
| `amount` | As above |
| `assetCode` | As above |
| `description` | Free-text description supplied when the request was created |
| `status` | Request status, e.g. `PENDING` |
| `createdAt` | When the request was created |

```json
{
  "event": "request.created",
  "timestamp": "2026-08-14T00:00:00Z",
  "data": {
    "requestId": "req_01HZX8Q2M4T7K9V3N5P6R8S1TD",
    "amount": "25.00",
    "assetCode": "USDC",
    "description": "Invoice 1042",
    "status": "PENDING",
    "createdAt": "2026-08-14T00:00:00Z"
  },
  "signature": ""
}
```

### 3.2 Events that are declared but do not fire yet

These event types are accepted when you create a webhook, but **no dispatch site
exists in the current codebase**, so a subscription to them never receives a
call. Do not build a flow that depends on them yet:

`batch.created`, `batch.completed`, `batch.failed`,
`recurrence.triggered`, `recurrence.completed`, `recurrence.failed`,
`request.paid`, `request.expired`

Subscribe to them if you like — the subscription is valid and will start working
when the dispatcher lands — but design the flow so a missing call is not a broken
flow. (`src/__tests__/automation-platform-guide.test.ts` fails if this list and
the code drift apart.)

## 4. Idempotent consumption (read this twice)

Webhooks are delivered **at least once**. Any of these can happen:

- the same event delivered twice because your endpoint timed out on the first try;
- a **retry** after a `5xx` or a connection error;
- a **replay** from the deliveries view in your dashboard.

Build every flow so that processing the same event twice is harmless
(idempotent). Concretely:

1. **Key on something stable, not on the delivery.** `data.paymentId` plus the
   event type is a good composite key (e.g. `payment.completed:pay_…`). Store it
   in a "already processed" table/column and stop if you have seen it before.
2. **Do not key on `X-OphirPay-Delivery`.** It is unique per *attempt*, so it
   changes on every retry — keying on it makes retries look like new events.
3. **Do not key on `timestamp`.** Two genuine events can share a second.
4. **Fulfil on `payment.completed`, not on `payment.confirmed`.** `confirmed`
   means the network confirmed the transaction; `completed` is OphirPay's
   terminal state for the record. Fulfilling on `confirmed` risks acting before
   the record is settled.
5. **Return `2xx` quickly.** Do the work asynchronously if your platform allows
   it; a slow endpoint is what causes most duplicate deliveries in the first place.

## 5. Signature verification on a no-code platform

The signature is **HMAC-SHA256** over the body in canonical form:

```
canonical = JSON.stringify({ ...payload, signature: "" })
signature = hex( HMAC_SHA256(secret, canonical) )
```

The secret is the one shown when you created the webhook. Reference
implementations live in [`examples/webhook-verification`](../examples/webhook-verification).

**Can your platform compute it?**

| Platform | Can it verify? | What to do |
|---|---|---|
| **n8n** | Yes — if your instance permits `crypto` | Use a Function/Code node, or the Crypto node's HMAC action, computed over the canonical body (with `signature` emptied). Note `JSON.stringify` must match the sender's key order — in practice, parse and re-serialize with `signature` set to `""`. |
| **Make** | Yes — `sha256` + `hmac` functions exist | Build the canonical string (JSON with `signature` emptied), then HMAC it. Ordering of keys matters; verify against one real delivery before you rely on it. |
| **Zapier** | **No** — no HMAC primitive and no way to control JSON serialization | Do not attempt an HMAC check in Zapier. Use a random secret path in the webhook URL, treat the payload as untrusted, and confirm money-side effects server-side (poll OphirPay's API for the payment) before acting. |
| **Anything else** | Only if it exposes HMAC-SHA256 *and* byte-exact JSON serialization | If it exposes only one of the two, it cannot verify the signature — fall back to the Zapier advice above. |

> **If you cannot compute an HMAC: do not fake it.** A check that always passes
> is worse than no check, because it hides the fact that you are unauthenticated.
> Instead: use a secret URL, treat all fields as untrusted input, and verify the
> payment through the API before doing anything irreversible.

### Replay protection

The canonical form includes `timestamp`. Reject a delivery whose timestamp is
outside a short window (the reference verifiers default to **5 minutes**) unless
you are deliberately replaying one. Combined with the idempotency key in §4,
that covers both a replayed old delivery and a duplicated recent one.

## 6. Retries

| Situation | What OphirPay does |
|---|---|
| Your endpoint returns `2xx` | Delivery recorded as `SUCCESS`; no retry |
| Your endpoint returns `4xx`/`5xx` or times out | Delivery recorded as `FAILED` and shown in the deliveries view |
| Duplicate delivery | Possible at any time — handle it (§4) |

Assume **at-least-once** delivery forever, and make step 1 of your flow the
deduplication check.

## 7. Testing your flow

1. Create the webhook in OphirPay and copy the secret.
2. Use "send test event" in the dashboard — it delivers a payload with
   `test: true` on the envelope and inside `data`, so your flow can skip
   real side effects while you wire it up.
3. Confirm the deduplication key works by sending the test event twice.
4. Only then enable the flow for live events.

---

*The payload examples in this guide are generated from
`src/lib/automation-platform-samples.ts` and validated against the event schema
by `src/__tests__/automation-platform-guide.test.ts`, so they cannot drift from
the dispatchers they describe.*
