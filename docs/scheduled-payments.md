# Scheduled (Delayed) Payments

OphirPay supports **one-off scheduled payments**: a payment is persisted with
a future date and is automatically submitted when that date arrives, without
any further user action.

This is the MVP implementation — a `ScheduledPayment` record, a schedule UI
in the send flow, and a cron endpoint that executes due payments.

---

## How it works

```
User schedules a payment (send form, "Schedule this payment for later")
        │  POST /api/scheduled  (validates the date is in the future)
        ▼
ScheduledPayment row  ── status: SCHEDULED
        │
        │  Vercel cron (*/5 minutes)  →  GET/POST /api/scheduled/run
        │  (Authorization: Bearer $CRON_SECRET)
        ▼
Due rows (SCHEDULED + scheduledFor <= now) are claimed (→ PROCESSING),
submitted from the server account ($SCHEDULED_PAYMENTS_SOURCE_SECRET), and
marked EXECUTED (with tx hash) or FAILED (with the error message).
```

## Data model

`ScheduledPayment` (see `prisma/schema.prisma`):

| Field | Type | Notes |
| --- | --- | --- |
| `id` | cuid | |
| `userId` | string | owning user |
| `amount` | Decimal(18,7) | must be > 0 |
| `assetCode` | string | defaults to `XLM` |
| `assetIssuer` | string? | for non-native assets |
| `destAddress` | string | Stellar recipient public key |
| `memo` | string? | ≤ 28 chars |
| `scheduledFor` | DateTime | must be in the future at creation |
| `status` | enum | `SCHEDULED` → `PROCESSING` → `EXECUTED` / `FAILED`, or `CANCELLED` |
| `transactionHash` | string? | set when executed |
| `errorMessage` | string? | set when execution fails |
| `executedAt` | DateTime? | when the payment was submitted |

## API

### `GET /api/scheduled`

List the authenticated user's scheduled payments, soonest first.
Paginated (`page`, `limit`). Amounts are serialized as strings.

### `POST /api/scheduled`

Create a scheduled payment.

```json
{
  "amount": 100,
  "assetCode": "XLM",
  "destAddress": "G...",
  "memo": "September payout",
  "scheduledFor": "2026-09-01T09:00:00.000Z"
}
```

Validation errors (400): `scheduledFor` must be a valid date **in the
future**; `destAddress` must be a valid Stellar address; `amount` must be
greater than 0.

### `DELETE /api/scheduled?id=<id>`

Cancel a scheduled payment that has not run yet (`SCHEDULED` → `CANCELLED`).
Already-executed payments cannot be cancelled.

### `GET|POST /api/scheduled/run` (cron)

Executes all due payments. Protected by `CRON_SECRET` — Vercel cron sends it
as `Authorization: Bearer $CRON_SECRET` automatically; the handler also
accepts an `x-cron-secret` header.

- Requires `SCHEDULED_PAYMENTS_SOURCE_SECRET`; returns **503** (without
  touching any records) when it is not configured.
- Rows are claimed atomically (`SCHEDULED` → `PROCESSING`) so overlapping
  cron runs never double-submit a payment.
- Response body: `{ picked, executed, failed, results[], sourcePublicKey }`.

## Configuration

| Env var | Purpose |
| --- | --- |
| `CRON_SECRET` | Shared secret that protects `/api/scheduled/run` |
| `SCHEDULED_PAYMENTS_SOURCE_SECRET` | Stellar secret key of the account that signs & submits scheduled payments. Must be funded and hold enough balance for every due payment in a run. |

Cron schedule: `*/5 * * * *` (every 5 minutes) in `vercel.json`.

## Tests

- `src/__tests__/scheduled-payments.test.ts` — schema validation
  (future-date rule), due-selection, execution success/failure paths, and the
  concurrent-run claim guard.
- `src/__tests__/scheduled-payments-ui.test.tsx` — send-page schedule flow
  and the upcoming-payments list with cancel.
