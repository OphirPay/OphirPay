# Webhook Signature Verification — Example Code

Runnable reference implementations for verifying the `X-OphirPay-Signature`
header on incoming webhook deliveries. The HMAC covers
`<X-OphirPay-Timestamp>.<canonical body>`, so the timestamp header is part of
the signed material and can be trusted for replay protection.

- [`node/verify.mjs`](node/verify.mjs) — Node.js (ESM, no dependencies)
- [`python/verify.py`](python/verify.py) — Python 3 (stdlib only)
- [`go/verify.go`](go/verify.go) — Go 1.21+ (stdlib only)
- [`sample-payload.json`](sample-payload.json) — sample signed payload

Full guidance (canonical form, replay protection, pitfalls) lives in
[`docs/webhook-verification.md`](../../docs/webhook-verification.md).

## Quick start (sample payload)

Both scripts read the body from `--body-file` (or stdin), verify the HMAC,
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

# Go (from the repository root; requires a Go 1.21+ toolchain)
go run ./examples/webhook-verification/go \
  --secret test-secret-0123456789 \
  --signature 83ab64c58dadec406835ebd9b907b579cb89132098823ec66f2b96dd1ad84258 \
  --timestamp 2026-08-14T00:00:00Z \
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

## The canonicalization rule

Every verifier signs the same bytes, and the rule is subtle:

1. Parse the received JSON body.
2. Set the `signature` field to `""` — **keep the key, empty the value**
   (do not delete it; the canonical string contains `"signature":""`).
3. Re-serialize exactly the way Node's `JSON.stringify` does: **no
   whitespace**, and object keys in the order they appeared in the parsed
   body (insertion order). Whitespace differences are erased by this step;
   **key order is preserved**, so a body whose keys were reordered produces
   different bytes and fails verification.
4. HMAC-SHA256 over `<timestamp>.<canonical body>`.

A receiver that reproduces step 3 differently (sorted keys, pretty-printed
output, numeric formatting changes) will compute a different HMAC and reject
every delivery. When in doubt, verify against the sample payload — all three
implementations must print `VALID` for it.

## Tests

The reference implementations are exercised against a fresh signed payload
(produced by `buildSignedPayload`) and the sample payload in
`src/__tests__/webhook-verification-examples.test.ts`. Run with:

```bash
npm test
```

The Node and Python verifiers run unconditionally; the Go verifier is
included in the same test suite and skipped automatically when no `go`
toolchain is installed. It also ships self-tests covering tampering, key
reordering, replay protection and the exact canonical form — run them from
the repository root with:

```bash
go test ./examples/webhook-verification/go/...
```
