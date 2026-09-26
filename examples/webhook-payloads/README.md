# Webhook payload examples

One fully-signed example delivery per webhook event type — the exact JSON body
OphirPay POSTs to your endpoint, including the `signature` field.

**Generated — do not edit by hand.** These files are produced from the single
source of truth in [`src/lib/webhook-payload-examples.ts`](../../src/lib/webhook-payload-examples.ts)
by:

```bash
npm run generate:webhook-examples
```

and are validated against the payload schemas by
`src/__tests__/webhook-payload-examples.test.ts` (which also fails if these
files drift from the source module).

## Verifying an example

Every example is signed with the well-known documentation secret
`test-secret-0123456789`, so you can run it through the reference verifiers:

```bash
SIG=$(node -p "JSON.parse(require('fs').readFileSync('payment.confirmed.json','utf8')).signature")
node ../webhook-verification/node/verify.mjs \
  --secret test-secret-0123456789 --signature "$SIG" \
  --body-file payment.confirmed.json \
  --now 2026-01-15T12:00:30Z
# → VALID
```

(Python equivalent: `../webhook-verification/python/verify.py`.)

The examples use fixed timestamps, so pass `--now` close to the payload's
`timestamp` (or `--max-age 0`) when verifying — the freshness window is
otherwise anchored to the real current time.

## Files

| File | Lifecycle stage |
|---|---|
| `payment.created.json` | created |
| `payment.signed.json` | signed |
| `payment.submitted.json` | submitted |
| `payment.confirmed.json` | confirmed |
| `payment.completed.json` | completed |
| `payment.failed.json` | failed (alternative ending) |
| `request.created.json` | payment request created |
| `batch.*.json`, `recurrence.*.json`, `request.paid.json`, `request.expired.json` | **reserved** — documented contract preview; not yet dispatched by production code |

See [docs/AUTOMATION_PLATFORMS.md](../../docs/AUTOMATION_PLATFORMS.md) for the
full event catalog, field meanings, and no-code setup guidance.
