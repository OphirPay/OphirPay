# First-party Client, CLI & GitHub Action

The OphirPay API is the product's programmatic surface. This document covers
the three first-party ways to call it without hand-rolling HTTP and signature
handling: the typed client, the CLI, and the GitHub Action.

## The typed client — `@ophirpay/client`

Source: [`packages/ophirpay-client`](../packages/ophirpay-client). It is
dependency-free (Node 20+), and its operation catalogue is **generated from the
committed [`docs/openapi.yaml`](openapi.yaml)** — the client cannot drift from
the published spec.

```bash
npm install ./packages/ophirpay-client
```

```js
import { OphirPayClient } from "@ophirpay/client";

const client = new OphirPayClient({
  baseUrl: process.env.OPHIRPAY_BASE_URL,
  apiKey: process.env.OPHIRPAY_API_KEY,
});

await client.createPayment({ recipient: "G...", amount: 25, assetCode: "XLM" });
await client.createBatch({ recipients: [{ address: "G...", amount: 5 }] });
await client.getPayment("pay_1");
```

| Method | Operation |
| ------ | --------- |
| `createPayment(input)` | `POST /api/payments` |
| `listPayments(query)` | `GET /api/payments` |
| `getPayment(id)` | `GET /api/payments/{id}` |
| `createBatch(input, { idempotencyKey })` | `POST /api/batches` |
| `getBatch(id)` | `GET /api/batches/{id}` |
| `getStats()` | `GET /api/stats` |

Any other documented operation is reachable through
`client.operation(name)` + `client.request(...)`, using the generated
catalogue.

### Regeneration

```bash
npm run client:generate   # rewrite operations.generated.{js,d.ts}
npm run client:check      # CI guard: fail if the committed output is stale
```

`scripts/generate-api-client.test.ts` enforces the same check in the test
suite, so a spec edit without regeneration fails the build.

## The CLI — `scripts/ophirpay-cli.mjs`

```bash
export OPHIRPAY_BASE_URL=https://api.ophirpay.com
export OPHIRPAY_API_KEY=oph_...

node scripts/ophirpay-cli.mjs payment:create --to G... --amount 25 --memo payroll
node scripts/ophirpay-cli.mjs status --id pay_1
node scripts/ophirpay-cli.mjs batch:submit --file recipients.csv --name payroll
node scripts/ophirpay-cli.mjs webhook:verify \
  --secret "$WEBHOOK_SECRET" --body-file body.json \
  --signature "$SIG" --timestamp "$TS"
```

- `batch:submit` reads `address,amount[,memo]` (header or headerless) and
  **exits non-zero when any payment is rejected**, so a CI job cannot silently
  drop a payout.
- `status` prints the payment record as JSON.
- `webhook:verify` recomputes the HMAC-SHA256 signature over
  `<timestamp>.<canonical body>` and enforces the replay tolerance window; it
  exits non-zero on a mismatch.

## The GitHub Action

Source: [`.github/actions/ophirpay-payment`](../.github/actions/ophirpay-payment).

```yaml
- uses: OphirPay/OphirPay/.github/actions/ophirpay-payment@main
  with:
    api-key: ${{ secrets.OPHIRPAY_API_KEY }}
    csv-file: payouts/recipients.csv
    name: nightly-payout
    base-url: https://api.ophirpay.com
```

The action runs the CLI's `batch:submit`, so a rejected payment fails the job.

## Versioning & deprecation policy

- The client tracks the API's `info.version`. A breaking path or payload change
  ships as a new API major and a matching client major.
- A deprecated operation stays in `docs/openapi.yaml` and remains callable from
  the previous client minor for at least one release cycle, with a `deprecated:
  true` marker and a migration note in this document.
- `npm run client:check` is part of `npm run ci`, so the client is regenerated
  in the same PR that changes the spec.

## Tests

`scripts/typed-client.test.ts` runs the client and the CLI against a real local
HTTP server that speaks the OphirPay envelope — create payment, batch
submission, status retrieval, error mapping and webhook verification are all
covered, not just documented.
