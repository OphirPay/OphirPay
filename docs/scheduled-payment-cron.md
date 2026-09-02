# ⏱ Scheduled Payment Cron

The scheduler that turns a **scheduled payment** — a payment persisted with a
future date — into a submitted Stellar transaction. Vercel Cron calls one
endpoint on a fixed interval; that endpoint claims every due payment, submits
it, and records the outcome.

> Related: the scheduling API and UI that create these rows are tracked in
> issue #68. This document covers the execution trigger (issue #175).

---

## How a run works

```
Vercel Cron (*/5 * * * *)
        │  GET /api/cron
        │  Authorization: Bearer $CRON_SECRET
        ▼
1. Authorize ────────────── missing CRON_SECRET → 503, bad secret → 401
2. Check configuration ──── missing signing key → 503 (no row is touched)
3. Select due rows ──────── status SCHEDULED/PROCESSING, scheduledAt <= now
4. Claim each row ───────── SCHEDULED → PROCESSING (atomic compare-and-set)
5. Submit sequentially ──── signed by $SCHEDULED_PAYMENTS_SOURCE_SECRET
6. Record the outcome ───── EXECUTED + tx hash, or FAILED / retry
```

Steps 4–6 run one payment at a time. Every submission loads the operator
account and consumes its next sequence number, so parallel submissions from
the same account would collide (`tx_bad_seq`).

## Why it cannot double-execute

The endpoint is safe to run concurrently — overlapping cron runs, a manual
trigger during a scheduled run, or a retried invocation.

Selection is only a *hint*. The guarantee comes from the claim, a conditional
update that the database evaluates atomically:

```sql
UPDATE "ScheduledPayment"
   SET status = 'PROCESSING', "lockedAt" = now, "lockedBy" = <runId>,
       attempts = attempts + 1
 WHERE id = <id>
   AND "scheduledAt" <= now
   AND attempts < 3
   AND (status = 'SCHEDULED'
        OR (status = 'PROCESSING' AND "lockedAt" <= now - lease))
```

Two runs racing for the same row both issue this update. Exactly one sees
`count === 1` and proceeds to submit; the other sees `count === 0`, reports
the row as `SKIPPED`, and moves on. A payment is therefore submitted by at
most one run, whatever the overlap.

### Crashed runs

A run that dies after claiming a row leaves it `PROCESSING`. Its lease
(`lockedAt`) expires after **5 minutes**, after which a later run reclaims and
retries it. Without the lease such a row would be stuck forever.

### Failures and retries

A submission error returns the row to `SCHEDULED` so the next run retries it —
a transient Horizon outage delays a payment rather than cancelling it. After
**3 attempts** the row is marked `FAILED` with the last error message.

| Outcome | Row status | Reported as |
|---|---|---|
| Submitted | `EXECUTED` (+ `transactionHash`, `executedAt`) | `EXECUTED` |
| Failed, attempts remain | `SCHEDULED` (+ `errorMessage`) | `RETRY_SCHEDULED` |
| Failed, attempts exhausted | `FAILED` (+ `errorMessage`) | `FAILED` |
| Claimed by another run | unchanged | `SKIPPED` |

## The endpoint

### `GET /api/cron` · `POST /api/cron`

Both methods run the same work. Vercel Cron uses `GET`; `POST` is there for
external schedulers and manual triggering.

**Authentication** — Vercel sends the project's `CRON_SECRET` automatically as
`Authorization: Bearer <secret>`. The `x-cron-secret` header is accepted too.
The comparison is constant-time.

| Status | Meaning |
|---|---|
| `200` | Run completed (possibly with nothing due) |
| `401` | Missing or wrong cron secret |
| `500` | `SCHEDULED_PAYMENTS_SOURCE_SECRET` is not a valid Stellar secret key |
| `503` | `CRON_SECRET` or `SCHEDULED_PAYMENTS_SOURCE_SECRET` is unset |

**Response**

```json
{
  "success": true,
  "data": {
    "runId": "9f1c…",
    "startedAt": "2026-08-28T12:00:00.000Z",
    "picked": 2,
    "executed": 1,
    "failed": 0,
    "skipped": 1,
    "sourcePublicKey": "GBTEST…",
    "results": [
      { "id": "sched_1", "status": "EXECUTED", "transactionHash": "abc123…" },
      { "id": "sched_2", "status": "SKIPPED" }
    ]
  },
  "meta": { "timestamp": "2026-08-28T12:00:02.418Z" }
}
```

Trigger a run manually:

```bash
curl -sS -H "Authorization: Bearer $CRON_SECRET" \
  https://<your-deployment>/api/cron | jq
```

## Configuration

| Env var | Purpose |
|---|---|
| `CRON_SECRET` | Shared secret protecting the endpoint. Generate with `openssl rand -hex 32`. Vercel injects it into cron invocations automatically once it is set on the project. |
| `SCHEDULED_PAYMENTS_SOURCE_SECRET` | Stellar secret key of the operator account that signs and submits due payments. It must be funded, and hold enough balance (plus trustlines for non-native assets) for every payment in a run. |

Schedule — `vercel.json`:

```json
"crons": [{ "path": "/api/cron", "schedule": "*/5 * * * *" }]
```

The interval bounds how late a payment can be: a payment due at 12:01 is
submitted by the 12:05 run. Shorten it for tighter timing; every run is a
no-op when nothing is due. Note that Vercel's Hobby plan permits daily cron
schedules only — sub-daily intervals need a Pro plan or an external scheduler
calling the same endpoint.

### Tuning

The policy constants live in [`src/lib/scheduler.ts`](../src/lib/scheduler.ts):

| Constant | Default | Effect |
|---|---|---|
| `MAX_PAYMENTS_PER_RUN` | `25` | Rows executed per run, so a run fits inside its 60s function timeout |
| `PROCESSING_LEASE_MS` | `5 min` | How long a claimed row is protected before another run may reclaim it |
| `MAX_EXECUTION_ATTEMPTS` | `3` | Submissions before a payment is given up on |

Keep `PROCESSING_LEASE_MS` at or above the function's `maxDuration`, otherwise
a slow-but-alive run can have its rows stolen mid-submission.

## Operational notes

- **Fund the operator account.** A run with an unfunded source account fails
  every payment three times and marks them `FAILED`.
- **Watch the logs.** Each run emits `Scheduled payment run complete` with its
  `runId` and counts; failures log `Scheduled payment execution failed` with
  the payment id, attempt number and error.
- **A backlog drains over several runs.** More than `MAX_PAYMENTS_PER_RUN` due
  rows are executed oldest-first across consecutive runs.

## Tests

- [`src/__tests__/scheduler-policy.test.ts`](../src/__tests__/scheduler-policy.test.ts)
  — due-selection, lease expiry, ordering, attempt caps and secret handling,
  all driven by a simulated clock.
- [`src/__tests__/cron-scheduled-payments-route.test.ts`](../src/__tests__/cron-scheduled-payments-route.test.ts)
  — authorization, configuration guards, execution and hash recording, the
  overlapping-run claim race, and the retry/give-up paths.
