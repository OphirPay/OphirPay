# 🤖 Automation Platforms (n8n, Zapier, Make) — Webhook Integration Guide

> The no-code guide to OphirPay webhooks: which events exist, what the payload
> looks like at each lifecycle stage, how to verify (or safely skip) signature
> checks, and how to retry and deduplicate — without reading the source code.

OphirPay delivers **outgoing webhooks**: when something happens to a payment,
payment request, batch, or recurring schedule, OphirPay sends an HTTP `POST`
with a signed JSON body to the URL you registered. Automation platforms
(n8n, Zapier, Make) can receive these POSTs directly — no polling and no
Stellar SDK required.

If you write code instead of wiring nodes, see
[Webhook Signature Verification](webhook-verification.md) for the exact
canonical form and runnable Node/Python verifiers, and
[docs/SSE.md](SSE.md) for the browser-oriented live event stream (a separate
mechanism from webhooks).

---

## How a delivery works

Every delivery is one HTTP request:

| Property | Value |
|---|---|
| Method | `POST` |
| `Content-Type` | `application/json` |
| `X-OphirPay-Event` | Event type, e.g. `payment.confirmed` (mirrors the body's `event` field) |
| `X-OphirPay-Timestamp` | Delivery time, ISO 8601 UTC. **Part of the signed material** — safe to use for the replay freshness window |
| `X-OphirPay-Signature` | HMAC-SHA256 (hex) over `<timestamp>.<canonical body>` — see [Signature verification per platform](#signature-verification-per-platform) |
| Body | JSON envelope: `{ "event", "timestamp", "data", "signature" }` (+ `"test": true` on test events) |
| Timeout | 5 seconds per attempt — answer `2xx` fast and do heavy work asynchronously |
| Retries | Up to 3 attempts with exponential backoff (1s, then 2s between attempts). Retries are **byte-identical** — same body, same signature |
| Redirects | Not followed (`3xx` counts as failure and is retried) |

Your endpoint must be a **public `http(s)` URL on port 80 or 443** — the SSRF
guard refuses loopback, private, link-local, and other internal targets, and
re-checks DNS before every attempt (details in
[webhook-verification.md](webhook-verification.md#delivery-target-policy-ssrf-guard)).
Every platform below gives you a URL that qualifies.

---

## 1. Subscribe: register a webhook

Register once, then paste the platform's URL as the webhook target. The
**signing secret is returned exactly once** — store it immediately.

```bash
curl -X POST https://ophirpay.com/api/webhooks \
  -H "Authorization: Bearer $OPHIRPAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-platform.example/hooks/ophirpay", "events": []}'
```

- **`"events": []` subscribes you to every event type** — the simplest choice
  for automation; filter inside your flow instead. To receive only some
  events, list them: `"events": ["payment.confirmed", "payment.failed"]`.
- Lost the secret? Rotate it (old secret stops working immediately):
  `PATCH /api/webhooks?id=<webhook-id>`.
- You can also register and manage webhooks from the OphirPay **Webhooks
  dashboard** in the UI.

---

## 2. Event catalog

Every event type you can subscribe to, with the meaning of each `data` field.
Events marked **reserved** are in the catalog (you can subscribe today) but no
code path dispatches them yet — their documented shape is a preview and may be
adjusted when the emitters land.

<!-- BEGIN GENERATED EVENT CATALOG -->

### `payment.created`

A payment was created via `POST /api/payments`.

_Emitted by `src/app/api/payments/route.ts`._

| `data` field | Type | Meaning |
|---|---|---|
| `paymentId` | string | Application payment id (CUID) — use it to correlate later lifecycle events for the same payment. |
| `amount` | string | Amount in asset units as a decimal string (e.g. `"125.50"`), not stroops. |
| `assetCode` | string | Asset code sent, e.g. `"XLM"` or `"USDC"`. |
| `status` | string | Payment status at dispatch time — `"CREATED"` for this event. |
| `createdAt` | string (ISO 8601) | When the payment record was created. |

### `payment.signed`

The payer signed the payment transaction (status → `SIGNED`).

_Emitted by `src/app/api/payments/[id]/route.ts`._

| `data` field | Type | Meaning |
|---|---|---|
| `paymentId` | string | Application payment id (CUID). |
| `amount` | string | Amount in asset units as a decimal string. |
| `assetCode` | string | Asset code sent. |
| `status` | string | Payment status at dispatch time — `"SIGNED"` for this event. |
| `signedAt` | string (ISO 8601) | When the signature was recorded. |

### `payment.submitted`

The signed transaction was submitted to the Stellar network (status → `SUBMITTED`).

_Emitted by `src/app/api/payments/[id]/route.ts`._

| `data` field | Type | Meaning |
|---|---|---|
| `paymentId` | string | Application payment id (CUID). |
| `amount` | string | Amount in asset units as a decimal string. |
| `assetCode` | string | Asset code sent. |
| `transactionHash` | string \| null | 64-char hex Stellar transaction hash — view it on Stellar Expert. `null` if unavailable. |
| `submittedAt` | string (ISO 8601) | When the transaction was submitted to the network. |

### `payment.confirmed`

The transaction was confirmed on-chain (status → `CONFIRMED`). Also fired by the background reconciliation job.

_Emitted by `src/app/api/payments/[id]/route.ts`, `src/lib/payment-sync.ts`._

| `data` field | Type | Meaning |
|---|---|---|
| `paymentId` | string | Application payment id (CUID). |
| `amount` | string | Amount in asset units as a decimal string. |
| `assetCode` | string | Asset code sent. |
| `transactionHash` | string \| null | 64-char hex Stellar transaction hash of the confirmed transaction. |
| `confirmedAt` | string (ISO 8601) | When confirmation was recorded (by the API or the sync job). |

### `payment.completed`

The payment reached its terminal `COMPLETED` state.

_Emitted by `src/app/api/payments/[id]/route.ts`._

| `data` field | Type | Meaning |
|---|---|---|
| `paymentId` | string | Application payment id (CUID). |
| `amount` | string | Amount in asset units as a decimal string. |
| `assetCode` | string | Asset code sent. |
| `transactionHash` | string \| null | 64-char hex Stellar transaction hash of the completed transaction. |
| `completedAt` | string (ISO 8601) | When the payment was marked complete. |

### `payment.failed`

The payment failed (status → `FAILED`) — see `data.errorMessage`. Also fired by the background reconciliation job.

_Emitted by `src/app/api/payments/[id]/route.ts`, `src/lib/payment-sync.ts`._

| `data` field | Type | Meaning |
|---|---|---|
| `paymentId` | string | Application payment id (CUID). |
| `amount` | string | Amount in asset units as a decimal string. |
| `assetCode` | string | Asset code sent. |
| `transactionHash` | string \| null | Present only when the failure came from an on-chain transaction (reconciliation job); omitted by the API status transition. |
| `errorMessage` | string \| null | Human-readable failure reason. |
| `failedAt` | string (ISO 8601) | When the failure was recorded. |

### `batch.created`

A batch payment run was created.

> ⏳ **Reserved — not emitted yet.** The shape below is the documented contract preview; fields may be adjusted when the emitters land.

| `data` field | Type | Meaning |
|---|---|---|
| `batchId` | string | Batch id (CUID). |
| `totalPayments` | number | Number of payments in the batch. |
| `totalAmount` | string | Sum of all payments in asset units as a decimal string. |
| `assetCode` | string | Asset code for the batch. |
| `status` | string | Batch status at dispatch time — `"CREATED"` for this event. |
| `createdAt` | string (ISO 8601) | When the batch was created. |

### `batch.completed`

A batch payment run finished — check `succeeded`/`failed` for the per-payment outcome.

> ⏳ **Reserved — not emitted yet.** The shape below is the documented contract preview; fields may be adjusted when the emitters land.

| `data` field | Type | Meaning |
|---|---|---|
| `batchId` | string | Batch id (CUID). |
| `totalPayments` | number | Number of payments in the batch. |
| `succeeded` | number | Payments that completed successfully. |
| `failed` | number | Payments that failed. |
| `completedAt` | string (ISO 8601) | When the batch finished. |

### `batch.failed`

A batch payment run failed before completing.

> ⏳ **Reserved — not emitted yet.** The shape below is the documented contract preview; fields may be adjusted when the emitters land.

| `data` field | Type | Meaning |
|---|---|---|
| `batchId` | string | Batch id (CUID). |
| `errorMessage` | string \| null | Human-readable failure reason. |
| `failedAt` | string (ISO 8601) | When the batch failed. |

### `recurrence.triggered`

A recurring payment schedule fired and created its next payment.

> ⏳ **Reserved — not emitted yet.** The shape below is the documented contract preview; fields may be adjusted when the emitters land.

| `data` field | Type | Meaning |
|---|---|---|
| `scheduleId` | string | Recurring schedule id (CUID). |
| `paymentId` | string | Id of the payment created by this occurrence. |
| `occurrence` | number | 1-based occurrence number within the schedule. |
| `triggeredAt` | string (ISO 8601) | When the schedule fired. |

### `recurrence.completed`

A recurring payment schedule ran its final occurrence.

> ⏳ **Reserved — not emitted yet.** The shape below is the documented contract preview; fields may be adjusted when the emitters land.

| `data` field | Type | Meaning |
|---|---|---|
| `scheduleId` | string | Recurring schedule id (CUID). |
| `totalOccurrences` | number | Total number of occurrences the schedule produced. |
| `completedAt` | string (ISO 8601) | When the schedule completed. |

### `recurrence.failed`

A recurring payment schedule occurrence failed.

> ⏳ **Reserved — not emitted yet.** The shape below is the documented contract preview; fields may be adjusted when the emitters land.

| `data` field | Type | Meaning |
|---|---|---|
| `scheduleId` | string | Recurring schedule id (CUID). |
| `errorMessage` | string \| null | Human-readable failure reason. |
| `failedAt` | string (ISO 8601) | When the occurrence failed. |

### `request.created`

A payment request was created via `POST /api/requests`.

_Emitted by `src/app/api/requests/route.ts`._

| `data` field | Type | Meaning |
|---|---|---|
| `requestId` | string | Payment request id (CUID). |
| `amount` | string | Requested amount in asset units as a decimal string. |
| `assetCode` | string | Asset code requested. |
| `description` | string \| null | Free-text note explaining what the request is for. |
| `status` | string | Request status at dispatch time — `"PENDING"` for this event. |
| `createdAt` | string (ISO 8601) | When the request was created. |

### `request.paid`

A payment request was paid in full.

> ⏳ **Reserved — not emitted yet.** The shape below is the documented contract preview; fields may be adjusted when the emitters land.

| `data` field | Type | Meaning |
|---|---|---|
| `requestId` | string | Payment request id (CUID). |
| `paymentId` | string | Id of the payment that settled the request. |
| `amount` | string | Paid amount in asset units as a decimal string. |
| `assetCode` | string | Asset code paid. |
| `paidAt` | string (ISO 8601) | When the request was marked paid. |

### `request.expired`

A payment request expired without being paid.

> ⏳ **Reserved — not emitted yet.** The shape below is the documented contract preview; fields may be adjusted when the emitters land.

| `data` field | Type | Meaning |
|---|---|---|
| `requestId` | string | Payment request id (CUID). |
| `expiredAt` | string (ISO 8601) | When the request expired. |

<!-- END GENERATED EVENT CATALOG -->

---

## 3. Payload examples by lifecycle stage

One complete, realistic delivery per payment lifecycle stage — **created,
signed, submitted, confirmed, completed, failed** — plus `request.created`.
These are generated from the same schema source as this guide (and validated
by a test), so they cannot drift from the code. The committed files live in
[`examples/webhook-payloads/`](../examples/webhook-payloads/) and are signed
with the documentation secret `test-secret-0123456789`, so you can feed them
straight into the reference verifiers.

> ⚠️ `payment.failed` is an **alternative ending**, not a stage that follows
> `confirmed`. A payment ends either `confirmed`/`completed` or `failed`.

<!-- BEGIN GENERATED PAYLOAD EXAMPLES -->

#### Stage: created — `payment.created`

```http
POST /your-automation-endpoint HTTP/1.1
Content-Type: application/json
X-OphirPay-Event: payment.created
X-OphirPay-Timestamp: 2026-01-15T12:00:00.000Z
X-OphirPay-Signature: 68bb22d237ab5121e9510a0c977d27c6adafb6b4ddbbdb2ea5c7e765a0e39034
```

```json
{
  "event": "payment.created",
  "timestamp": "2026-01-15T12:00:00.000Z",
  "data": {
    "paymentId": "cm5k9x2m00000356g4h7j8k2q",
    "amount": "125.50",
    "assetCode": "USDC",
    "status": "CREATED",
    "createdAt": "2026-01-15T12:00:00.000Z"
  },
  "signature": "68bb22d237ab5121e9510a0c977d27c6adafb6b4ddbbdb2ea5c7e765a0e39034"
}
```

#### Stage: signed — `payment.signed`

```http
POST /your-automation-endpoint HTTP/1.1
Content-Type: application/json
X-OphirPay-Event: payment.signed
X-OphirPay-Timestamp: 2026-01-15T12:00:08.000Z
X-OphirPay-Signature: e2c58e942a840cff2e99417a82d2ce18e823bdd3c093d7951ca681ef333a12ea
```

```json
{
  "event": "payment.signed",
  "timestamp": "2026-01-15T12:00:08.000Z",
  "data": {
    "paymentId": "cm5k9x2m00000356g4h7j8k2q",
    "amount": "125.50",
    "assetCode": "USDC",
    "status": "SIGNED",
    "signedAt": "2026-01-15T12:00:08.000Z"
  },
  "signature": "e2c58e942a840cff2e99417a82d2ce18e823bdd3c093d7951ca681ef333a12ea"
}
```

#### Stage: submitted — `payment.submitted`

```http
POST /your-automation-endpoint HTTP/1.1
Content-Type: application/json
X-OphirPay-Event: payment.submitted
X-OphirPay-Timestamp: 2026-01-15T12:00:11.000Z
X-OphirPay-Signature: 95bbdda7184ab046214af846fdf512de05217782767a9b8c8faff05250c5f74c
```

```json
{
  "event": "payment.submitted",
  "timestamp": "2026-01-15T12:00:11.000Z",
  "data": {
    "paymentId": "cm5k9x2m00000356g4h7j8k2q",
    "amount": "125.50",
    "assetCode": "USDC",
    "transactionHash": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    "submittedAt": "2026-01-15T12:00:11.000Z"
  },
  "signature": "95bbdda7184ab046214af846fdf512de05217782767a9b8c8faff05250c5f74c"
}
```

#### Stage: confirmed — `payment.confirmed`

```http
POST /your-automation-endpoint HTTP/1.1
Content-Type: application/json
X-OphirPay-Event: payment.confirmed
X-OphirPay-Timestamp: 2026-01-15T12:00:26.000Z
X-OphirPay-Signature: 528afd72f06f722c172268de21ea5efe3820f345cbdbdd22fc7e07e7c879f829
```

```json
{
  "event": "payment.confirmed",
  "timestamp": "2026-01-15T12:00:26.000Z",
  "data": {
    "paymentId": "cm5k9x2m00000356g4h7j8k2q",
    "amount": "125.50",
    "assetCode": "USDC",
    "transactionHash": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    "confirmedAt": "2026-01-15T12:00:26.000Z"
  },
  "signature": "528afd72f06f722c172268de21ea5efe3820f345cbdbdd22fc7e07e7c879f829"
}
```

#### Stage: completed — `payment.completed`

```http
POST /your-automation-endpoint HTTP/1.1
Content-Type: application/json
X-OphirPay-Event: payment.completed
X-OphirPay-Timestamp: 2026-01-15T12:00:26.000Z
X-OphirPay-Signature: 1e5adbd5ed8ff7c2e88cb41cc01f4a35bad7a5d77cf952da1154593448070e95
```

```json
{
  "event": "payment.completed",
  "timestamp": "2026-01-15T12:00:26.000Z",
  "data": {
    "paymentId": "cm5k9x2m00000356g4h7j8k2q",
    "amount": "125.50",
    "assetCode": "USDC",
    "transactionHash": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    "completedAt": "2026-01-15T12:00:26.000Z"
  },
  "signature": "1e5adbd5ed8ff7c2e88cb41cc01f4a35bad7a5d77cf952da1154593448070e95"
}
```

#### Stage: failed — `payment.failed`

```http
POST /your-automation-endpoint HTTP/1.1
Content-Type: application/json
X-OphirPay-Event: payment.failed
X-OphirPay-Timestamp: 2026-01-15T12:01:02.000Z
X-OphirPay-Signature: 3eab4a3daa76afa54091d9ab32e9631688bed74bca91f615b13f23517c35650a
```

```json
{
  "event": "payment.failed",
  "timestamp": "2026-01-15T12:01:02.000Z",
  "data": {
    "paymentId": "cm5k9x2m00000356g4h7j8k2q",
    "amount": "125.50",
    "assetCode": "USDC",
    "transactionHash": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    "errorMessage": "Transaction failed on-chain. See the transaction on Stellar Expert for the operation result.",
    "failedAt": "2026-01-15T12:01:02.000Z"
  },
  "signature": "3eab4a3daa76afa54091d9ab32e9631688bed74bca91f615b13f23517c35650a"
}
```

#### Stage: request created — `request.created`

```http
POST /your-automation-endpoint HTTP/1.1
Content-Type: application/json
X-OphirPay-Event: request.created
X-OphirPay-Timestamp: 2026-01-15T09:30:00.000Z
X-OphirPay-Signature: a2e53728040976fa3d0c9f63d4e9ce4d25a7aad57d6a7090290d8c7f9c5dfd0c
```

```json
{
  "event": "request.created",
  "timestamp": "2026-01-15T09:30:00.000Z",
  "data": {
    "requestId": "cm5ka1b2c00011356ddee1f2g",
    "amount": "40.00",
    "assetCode": "USDC",
    "description": "Invoice #1042 — design retainer",
    "status": "PENDING",
    "createdAt": "2026-01-15T09:30:00.000Z"
  },
  "signature": "a2e53728040976fa3d0c9f63d4e9ce4d25a7aad57d6a7090290d8c7f9c5dfd0c"
}
```

<!-- END GENERATED PAYLOAD EXAMPLES -->

---

## 4. Idempotent consumption (required)

Retries and replays mean **your flow will receive the same event more than
once** — process each logical event at most once:

1. **Compute a dedupe key** from `event + timestamp` (the body fields), or
   hash the canonical body. Both are stable across retries, because retries
   resend the identical bytes.
2. **Store the key** when you first process the event. Keep keys for at least
   24 hours.
3. **Skip** the run when the key is already stored — return `2xx` anyway so
   OphirPay stops retrying.

> ℹ️ The payload carries no monotonic delivery ID today. `event + timestamp`
> is unique per logical event, and `data.paymentId` / `data.requestId`
> correlates the stages of one payment — but correlation is not dedupe: the
> *same* stage arriving twice is what you filter.

Per platform:

| Platform | Dedupe recipe |
|---|---|
| **n8n** | Key = `{{$json.body.event}}:{{$json.body.timestamp}}`. Check/store it with a **Redis** or **Postgres** node, or n8n's workflow static data (`$getWorkflowStaticData`) for low volumes. |
| **Zapier** | **Storage by Zapier**: "Get" the key `{{event}}:{{timestamp}}`; if found, stop with a Filter step; otherwise "Set" it and continue. |
| **Make** | A **Data store** with the key `{{event}}:{{timestamp}}` — "Search records" first, "Add record" after processing. |

---

## 5. Signature verification per platform

The signature proves the request came from OphirPay and was not tampered
with. The signed input is the exact string
`<X-OphirPay-Timestamp>.<canonical body>`, where the canonical body is the
received JSON **with the `signature` field emptied (set to `""`, not
removed) and the key order unchanged**, HMAC-SHA256 with your webhook secret,
hex-encoded. Full specification: [webhook-verification.md](webhook-verification.md).

### n8n — verify natively ✅

1. **Webhook node** — receive the POST. Headers arrive lowercased
   (`x-ophirpay-signature`, `x-ophirpay-timestamp`).
2. **Code node** (JavaScript, "Run Once for All Items") — build the signed
   input string:
   ```js
   const body = $input.first().json.body;
   const headers = $input.first().json.headers;
   const canonical = JSON.stringify({ ...body, signature: "" }); // empty, don't delete
   return [{ json: { signedInput: `${headers["x-ophirpay-timestamp"]}.${canonical}` } }];
   ```
3. **Crypto node** — Action `HMAC`, Type `SHA-256`, Value = `signedInput`,
   Secret = your webhook secret, Encoding `hex`.
4. **IF node** — compare the Crypto node's output with
   `x-ophirpay-signature`; route mismatches to a Stop-and-Error or alert.
5. Branch on `body.event` with a **Switch node**.

> ⚠️ Never re-serialize the body through a formatter before step 2 — key
> order and spacing are part of the signed bytes.

### Zapier — verify in a Code step ✅

1. Trigger: **Webhooks by Zapier → Catch Raw Hook** (the raw variant preserves
   the exact body string).
2. Action: **Code by Zapier → JavaScript**:
   ```js
   const crypto = require("crypto");
   const body = JSON.parse(inputData.rawBody);
   const canonical = JSON.stringify({ ...body, signature: "" }); // empty, don't delete
   const expected = crypto
     .createHmac("sha256", inputData.secret) // store the secret in a Zapier environment variable
     .update(`${inputData.timestamp}.${canonical}`)
     .digest("hex");
   if (expected !== inputData.signature) throw new Error("Invalid OphirPay signature");
   output = [{ event: body.event, data: body.data }];
   ```
3. Continue the Zap with `body.event` / `body.data` (Paths for branching).

If `require("crypto")` is unavailable in your Zapier environment, don't fall
back to comparing anything weaker — use the
[confirm-via-API pattern](#when-the-platform-cannot-compute-an-hmac) below.

### Make — do not attempt in-scenario verification ⚠️

Make has **no built-in HMAC-SHA256 primitive**, and string functions cannot
reproduce the signed bytes reliably. Do not try to fake verification with
text comparisons — a wrong check is worse than none. Use the
confirm-via-API pattern below instead (or put a verification proxy in front
of your scenario).

### When the platform cannot compute an HMAC

Two sound options, in order of preference:

1. **Confirm via the API (recommended, works everywhere).** Treat the webhook
   as a *hint*, not proof. Before acting on `payment.confirmed`, call the
   authenticated API and check the record yourself:
   `GET /api/payments/<data.paymentId>` with
   `Authorization: Bearer $OPHIRPAY_API_KEY` — proceed only if the API agrees
   with the webhook's claim. Authenticity then comes from TLS + your API key,
   which every platform's HTTP module can do.
2. **Verification proxy.** Put a tiny verifier in front of the platform URL —
   e.g. a serverless function running the check from
   [`examples/webhook-verification/node/verify.mjs`](../examples/webhook-verification/node/verify.mjs)
   — that returns `401` on bad signatures and forwards good ones to your
   platform's hook URL. The platform then only ever sees verified events.

Either way, still enforce [idempotent consumption](#4-idempotent-consumption-required)
and keep the hook URL unguessable (treat it like a password).

---

## 6. Retries, failures, and missed events

- **Respond `2xx` within 5 seconds.** Any other status, a timeout, or a
  connection error triggers a retry (up to 3 attempts, 1s/2s backoff).
- **Acknowledge first, process after** where the platform allows it, so slow
  downstream steps don't cause retries.
- **Missed events while your flow was off:** events are persisted for 7 days.
  Replay them from the dashboard or via
  `POST /api/webhooks/<webhook-id>/replay` (optionally with `since`/`until` and
  `limit`, max 100). Replayed events keep their original `timestamp` — your
  dedupe store makes replays safe.
- Inspect what was sent: `GET /api/webhooks/<webhook-id>/deliveries` lists
  recent deliveries with status codes and attempts (also in the dashboard).

---

## 7. Testing your flow

1. Register the webhook pointing at your platform's **test/listening URL**.
2. Send a synthetic event from the dashboard (**Send test event**) or with
   `POST /api/webhooks/<webhook-id>/test` (optionally `?event=payment.failed`).
   Test deliveries carry `"test": true` in both the envelope and `data`, and a
   clearly-fake `paymentId` — make your flow ignore them for side effects.
3. Check the signature path end-to-end with a committed example:
   ```bash
   SIG=$(node -p "JSON.parse(require('fs').readFileSync('examples/webhook-payloads/payment.confirmed.json','utf8')).signature")
   node examples/webhook-verification/node/verify.mjs \
     --secret test-secret-0123456789 --signature "$SIG" \
     --body-file examples/webhook-payloads/payment.confirmed.json \
     --now 2026-01-15T12:00:30Z
   # → VALID
   ```
   (Python equivalent in `examples/webhook-verification/python/verify.py`.)

---

## Regenerating the examples and tables

The event catalog tables, the payload examples above, and
`examples/webhook-payloads/*.json` are generated from
[`src/lib/webhook-payload-examples.ts`](../src/lib/webhook-payload-examples.ts)
(the single source of truth — schemas, field meanings, and example values):

```bash
npm run generate:webhook-examples
```

`npm test` fails if the committed artifacts drift from that module, so a
payload change can never silently desynchronize the docs.

## Related docs

- [Webhook Signature Verification](webhook-verification.md) — canonical form, replay protection, reference verifiers
- [Integration guide](integration-guide.md) — end-to-end API setup, replay API details
- [API Cookbook](API_COOKBOOK.md) — curl recipes for the webhook management endpoints
- [docs/SSE.md](SSE.md) — the browser live event stream (separate from webhooks)

---

<div align="center">

**[← Back to OphirPay README](../README.md)**

</div>
