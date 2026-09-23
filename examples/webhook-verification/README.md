# Webhook Signature Verification — Example Code

Runnable reference implementations for verifying the `X-OphirPay-Signature`
header on incoming webhook deliveries.

- [`node/verify.mjs`](node/verify.mjs) — Node.js (ESM, no dependencies)
- [`python/verify.py`](python/verify.py) — Python 3 (stdlib only)
- [`go/verify.go`](go/verify.go) — Go (stdlib only)
- [`sample-payload.json`](sample-payload.json) — sample signed payload

Full guidance (canonical form, replay protection, pitfalls) lives in
[`docs/webhook-verification.md`](../../docs/webhook-verification.md).

## Canonicalization Rule

The webhook HMAC signature is calculated over the canonical JSON representation of the payload:
1. Parse the received JSON object.
2. Set the `signature` field value to `""` (empty string) while preserving the key in place.
3. Re-serialize preserving insertion key order with compact separators (no extraneous whitespace). The output must match Node's `JSON.stringify` byte-for-byte.
4. Calculate HMAC-SHA256 in hex using your webhook secret and perform a constant-time comparison against `X-OphirPay-Signature`.

## Quick start (sample payload)

All scripts read the body from `--body-file` (or stdin), verify the HMAC,
then print `VALID` (exit 0) or `INVALID: <reason>` (exit 1).

```bash
# Node
node node/verify.mjs \
  --secret test-secret-0123456789 \
  --signature 647945219590e65b3f903bdd28baeabdc5ce3915cc9a8a497bfcba9ed2802b64 \
  --body-file sample-payload.json

# Python
python3 python/verify.py \
  --secret test-secret-0123456789 \
  --signature 647945219590e65b3f903bdd28baeabdc5ce3915cc9a8a497bfcba9ed2802b64 \
  --body-file sample-payload.json

# Go
go run go/verify.go \
  --secret test-secret-0123456789 \
  --signature 647945219590e65b3f903bdd28baeabdc5ce3915cc9a8a497bfcba9ed2802b64 \
  --body-file sample-payload.json
```

The sample's timestamp is fixed (`2026-08-14T00:00:00Z`), so it is outside the
default 5-minute replay window when run "now". Pass `--now` to simulate the
receiver seeing it in time:

```bash
# Node
node node/verify.mjs \
  --secret test-secret-0123456789 \
  --signature 647945219590e65b3f903bdd28baeabdc5ce3915cc9a8a497bfcba9ed2802b64 \
  --body-file sample-payload.json \
  --now 2026-08-14T00:00:30Z

# Go
go run go/verify.go \
  --secret test-secret-0123456789 \
  --signature 647945219590e65b3f903bdd28baeabdc5ce3915cc9a8a497bfcba9ed2802b64 \
  --body-file sample-payload.json \
  --now 2026-08-14T00:00:30Z
```

For a delivery that just arrived, omit `--now` (defaults to the current time)
and keep the default `--max-age 300` replay window.

## Tests

The reference implementations are exercised against a fresh signed payload
(produced by `buildSignedPayload`) and the sample payload in
`src/__tests__/webhook-verification-examples.test.ts`. Run with:

```bash
npm test
```
