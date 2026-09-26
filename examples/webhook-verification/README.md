# Webhook Signature Verification — Example Code

Runnable reference implementations for verifying the `X-OphirPay-Signature`
header on incoming webhook deliveries. The HMAC covers
`<X-OphirPay-Timestamp>.<canonical body>`, so the timestamp header is part of
the signed material and can be trusted for replay protection.

- [`node/verify.mjs`](node/verify.mjs) — Node.js (ESM, no dependencies)
- [`python/verify.py`](python/verify.py) — Python 3 (stdlib only)
- [`go/main.go`](go/main.go) — Go (stdlib only)
- [`sample-payload.json`](sample-payload.json) — sample signed payload

Full guidance (canonical form, replay protection, pitfalls) lives in
[`docs/webhook-verification.md`](../../docs/webhook-verification.md).

## Canonicalization Rule

To verify signatures identically across languages:
1. Parse the received JSON body.
2. Set the `signature` field to `""` (empty string) — do **NOT** remove the `signature` key; the canonical string must include `"signature":""`.
3. Preserve the exact key order of the original object without adding superfluous whitespace (compact separators `","` and `":"`).
4. Compute HMAC-SHA256 in hexadecimal over the resulting UTF-8 bytes using your webhook secret.
5. Use constant-time byte comparison against the `X-OphirPay-Signature` header to prevent timing attacks.

## Quick start (sample payload)

All scripts read the body from `--body-file` (or stdin), verify the HMAC,
then print `VALID` (exit 0) or `INVALID: <reason>` (exit 1).

```bash
# Node
node node/verify.mjs \
  --secret test-secret-0123456789 \
  --signature 83ab64c58dadec406835ebd9b907b579cb89132098823ec66f2b96dd1ad84258 \
  --timestamp 2026-08-14T00:00:00Z \
  --body-file sample-payload.json

# Python
python3 python/verify.py \
  --secret test-secret-0123456789 \
  --signature 83ab64c58dadec406835ebd9b907b579cb89132098823ec66f2b96dd1ad84258 \
  --timestamp 2026-08-14T00:00:00Z \
  --body-file sample-payload.json

# Go
go run go/main.go \
  --secret test-secret-0123456789 \
  --signature 647945219590e65b3f903bdd28baeabdc5ce3915cc9a8a497bfcba9ed2802b64 \
  --body-file sample-payload.json
```

`--timestamp` is the `X-OphirPay-Timestamp` header value. It is optional: when
omitted the body's `timestamp` field (which is signed too) is used. **In a real
receiver always pass the header value** so a stale or re-dated delivery is
rejected.

The sample's timestamp is fixed (`2026-08-14T00:00:00Z`), so it is outside the
default 5-minute replay window when run "now". Pass `--now` to simulate the
receiver seeing it in time:

```bash
node node/verify.mjs \
  --secret test-secret-0123456789 \
  --signature 83ab64c58dadec406835ebd9b907b579cb89132098823ec66f2b96dd1ad84258 \
  --timestamp 2026-08-14T00:00:00Z \
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
