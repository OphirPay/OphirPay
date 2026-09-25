# Automation Platforms (n8n · Zapier · Make)

> **Audience:** you build automations in a no-code/low-code tool, not in Node or Rust.
> This guide is written so you never have to open `contracts/` or read the SDK types.
> Every payload below is generated from the same source as the schema and is
> validated by `tests/automation-payloads.test.ts` — if the backend changes an
> event, that test fails and this document cannot silently rot.

---

## 1. The three things you actually need

1. **A URL on your side** that accepts `POST` with a JSON body.
2. **The shared secret** of the OphirPay webhook that fires at that URL.
3. **A way to ignore duplicates** — see §5, this is the part most automations get wrong.

That's it. You do not need to understand Stellar transactions to consume events.

---

## 2. Event reference

Events are grouped by resource. The `event` field in every payload is the
canonical name — subscribe with exactly these strings.

| Event | Fires when | Safe to act on? |
|---|---|---|
| `payment.created` | A payment record exists, nothing sent yet | **No** — record as pending |
| `payment.signed` | Transaction envelope signed locally | **No** — could still be dropped |
| `payment.submitted` | Accepted by Horizon for inclusion | **No** — not final |
| `payment.confirmed` | Included in a confirmed ledger | **Yes** — money moved |
| `payment.completed` | Terminal success bookkeeping done | **Yes** — best "invoice paid" signal |
| `payment.failed` | Network rejected or submission timed out | Treat as retryable |
| `batch.created` | A batch job was created | No |
| `batch.completed` | Every item in the batch finished | Yes |
| `batch.failed` | At least one item failed | Yes — inspect per-item results |
| `recurrence.triggered` | A scheduled recurrence fired | Yes |
| `recurrence.completed` | The recurrence finished all runs | Yes |
| `recurrence.failed` | A recurrence run failed | Yes |
| `request.created` | A payment request (invoice) was created | No |
| `request.paid` | The request was paid | **Yes** — revenue signal |
| `request.expired` | The request passed its expiry | Yes — follow-up |

### Payload envelope

Every event uses one envelope. There are no other top-level keys.

```json
{
  "event": "payment.confirmed",
  "timestamp": "2026-09-25T12:00:22Z",
  "data": { }
}
```

| Field | Type | Meaning |
|---|---|---|
| `event` | string | One of the values in the table above |
| `timestamp` | string (RFC 3339) | When OphirPay emitted the event, not when you received it |
| `data` | object | Event-specific fields, documented below |

Full worked examples for every lifecycle stage live in
[`examples/automation-payloads.json`](../examples/automation-payloads.json).

---

## 3. Lifecycle walkthrough with real payloads

A single payment moves left to right. Your automation should only ever *pay out
value* (credit a customer, ship an order, close a task) at **confirmed** or later.

### 3.1 `payment.created` — pending

```json
{
  "event": "payment.created",
  "timestamp": "2026-09-25T12:00:00Z",
  "data": {
    "id": "pay_01J8ZQ4K2M9V7T3XN6B5C0D8EF",
    "status": "PENDING",
    "amount": "250.00",
    "asset": {
      "code": "USDC",
      "issuer": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      "type": "credit_alphanum4"
    },
    "destination": "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
    "memo": { "type": "text", "value": "invoice-2026-0917" },
    "idempotencyKey": "b7e3a1f2-4c5d-4e6f-8a9b-0c1d2e3f4a5b",
    "createdAt": "2026-09-25T11:59:58Z"
  }
}
```

**Do:** write `id` + `idempotencyKey` to your sheet/DB with state `pending`.

### 3.2 `payment.signed` — local only

```json
{
  "event": "payment.signed",
  "timestamp": "2026-09-25T12:00:04Z",
  "data": {
    "id": "pay_01J8ZQ4K2M9V7T3XN6B5C0D8EF",
    "status": "SIGNED",
    "transactionHash": null,
    "signedEnvelopeLength": 216,
    "signedAt": "2026-09-25T12:00:04Z"
  }
}
```

**Do:** nothing. `transactionHash` is `null` because nothing is on-chain.

### 3.3 `payment.submitted` — in a ledger soon

```json
{
  "event": "payment.submitted",
  "timestamp": "2026-09-25T12:00:07Z",
  "data": {
    "id": "pay_01J8ZQ4K2M9V7T3XN6B5C0D8EF",
    "status": "SUBMITTED",
    "transactionHash": "9f2c1b8a7d6e5f4c3b2a1908172635445a6b7c8d9e0f1a2b3c4d5e6f708192a3",
    "ledger": 58123456,
    "submittedAt": "2026-09-25T12:00:07Z"
  }
}
```

**Do:** keep the transaction hash for support tickets. Still no fulfilment.

### 3.4 `payment.confirmed` — money moved

```json
{
  "event": "payment.confirmed",
  "timestamp": "2026-09-25T12:00:22Z",
  "data": {
    "id": "pay_01J8ZQ4K2M9V7T3XN6B5C0D8EF",
    "status": "CONFIRMED",
    "transactionHash": "9f2c1b8a7d6e5f4c3b2a1908172635445a6b7c8d9e0f1a2b3c4d5e6f708192a3",
    "ledger": 58123457,
    "confirmedAt": "2026-09-25T12:00:22Z"
  }
}
```

**Do:** this is your fulfilment trigger. Mark the row `paid` and run your
downstream action.

### 3.5 `payment.failed` — retryable

```json
{
  "event": "payment.failed",
  "timestamp": "2026-09-25T12:00:31Z",
  "data": {
    "id": "pay_01J8ZQ4K2M9V7T3XN6B5C0D8EF",
    "status": "FAILED",
    "transactionHash": "9f2c1b8a7d6e5f4c3b2a1908172635445a6b7c8d9e0f1a2b3c4d5e6f708192a3",
    "errorCode": "tx_failed",
    "errorMessage": "The transaction failed when submitted to the stellar network.",
    "operationResultCodes": ["op_underfunded"],
    "failedAt": "2026-09-25T12:00:31Z"
  }
}
```

**Do:** mark `failed`, notify ops. Do **not** delete the pending row: a
retry reuses the same `id`.

---

## 4. Idempotency — read this before you ship

OphirPay delivers at-least-once. The same event can legitimately arrive twice:
a timeout on your side makes OphirPay retry even after you returned `200`.

### The rule

> One row per `idempotencyKey`. Every handler begins by asking "have I seen this key?" — if yes, exit `200` and do nothing.

The `idempotencyKey` is present on `payment.created` (see §3.1) and is stable
across all events for that payment. Store it next to `id`.

### Platform-specific implementation

| Platform | Mechanism | Sketch |
|---|---|---|
| **n8n** | A "Remove Duplicates" node, or a Postgres/Redis dedupe table | Code node first: `if (alreadySeen(items[0].json.data.idempotencyKey)) return []` |
| **Zapier** | "Storage by Zapier" → `key = data.idempotencyKey`, `true` when present` | Look up key; only continue on `not found` |
| **Make** | "Data store → search record" then conditional filter | Search by idempotency key; route to *stop* branch when a record exists |

### Why the timestamp is not a dedupe key

`timestamp` is when OphirPay *emitted* the event, so two retries of the same
event carry the **same** timestamp. Use `idempotencyKey` (or `data.id`), never
`timestamp`, as your uniqueness key.

---

## 5. Signature verification in a no-code platform

OphirPay signs each delivery with an HMAC-SHA256 over the **raw request body**,
using your webhook's shared secret:

```
signature = hex(HMAC_SHA256(rawBody, webhookSecret))
```

Sent as the `x-ophirpay-signature` header.

**The critical constraint:** HMAC must be computed over the bytes as received.
If your platform JSON-parses the body and then re-serializes it, the payload
will have been re-ordered or re-spaced and **every signature check fails**.

| Platform | Can you HMAC the raw body? | Recommendation |
|---|---|---|
| n8n | **Yes** — the "Crypto" node accepts a raw string from the incoming item | Verify. Feed the raw body string, algorithm `sha256`, key = secret, action `hash` |
| Make | Only with a paid "HTTP > Make a request" workaround | **Do not verify.** Rely on HTTPS + a secret URL path instead |
| Zapier | **No** — Webhooks trigger rewrites the body before your code | **Do not verify.** Use a low-entropy URL path and rotate the secret instead |

If your platform cannot verify, treat the endpoint as bearer-secret: the URL
path itself must contain an unguessable token, and you should prefer storing
only non-sensitive event data.

Reference implementations that *can* verify live in
[`examples/webhook-verification`](../examples/webhook-verification) (Node and
Python). Use them to generate expected signatures while building a custom step.

---

## 6. Retry behaviour and your error codes

| You return | OphirPay does |
|---|---|
| `2xx` | Delivery is complete |
| `410 Gone` | The endpoint is removed and stops receiving events |
| anything else | Retries with exponential backoff for ~24 h |

Practical implication: **return `200` only after your dedupe check passes.**
Returning `200` early means a real failure is silently swallowed.

---

## 7. Per-platform setup notes

### n8n

1. Webhook node → method `POST`, path `/ophirpay`.
2. Set **Respond** to `Immediately` only if your next node dedupes; otherwise
   use `Using Respond to Webhook node` and respond after the dedupe check.
3. Add the Crypto node (`sha256`, `hash`, key = secret) on the raw body and
   compare with `x-ophirpay-signature`.
4. Switch on `event` with a Switch node — do not branch on `status`.

### Zapier

1. Trigger: **Webhooks by Zapier → Catch Hook** → use the `RAW` body option if
   available to preserve the exact bytes.
2. First action: Storage by Zapier lookup on `data.idempotencyKey`.
3. Filter step: continue only when the lookup is empty.
4. No signature verification (see §5).

### Make

1. Webhook → create a custom mailhook.
2. Data store `ophirpay_events`, primary key `idempotency_key`.
3. Flow control: search → router → empty branch continues.
4. No signature verification (see §5).

---

## 8. Common mistakes

| Mistake | Consequence | Fix |
|---|---|---|
| Branching on `data.status` instead of `event` | Your automation fires on the wrong transition | Switch on the top-level `event` field |
| Fulfilling on `submitted` | Customer gets goods for a payment that never landed | Only act on `confirmed` / `completed` |
| Deduping on `timestamp` | Retries still double-fire | Dedupe on `idempotencyKey` |
| Letting the platform re-serialize the body before HMAC | Every signature check fails | Verify the raw body, or skip verification per §5 |
| Deleting the pending row on `failed` | A retry looks like a brand-new payment | Keep the row, update its state |
| Returning `200` before the dedupe check | A genuine processing error becomes invisible | Dedupe first, then respond |

---

## 9. Related

- `docs/API_GUIDE.md` — REST API for humans writing code
- `docs/SSE.md` — server-sent events for live dashboards
- `examples/webhook-verification/` — HMAC reference implementations
- `examples/automation-payloads.json` — machine-readable payload fixtures used by this guide
