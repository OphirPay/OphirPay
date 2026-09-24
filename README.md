# Webhook Verification Examples

This directory provides reference implementations for verifying webhook signatures in various languages. 

## Canonicalization Rule
To verify a signature, the receiver must:
1. Canonicalize the JSON body: empty the `signature` field while preserving order and spacing, then stringify.
2. Compute the HMAC-SHA256 of this canonicalized string using the shared secret.
3. Compare the result with the signature header provided by the sender.

## Implementations
- **Node.js**: `node/verify.mjs`
- **Python**: `python/verify.py`
- **Go**: `go/verify.go`

Run the examples using the standard CLI flags `--secret`, `--signature`, and optionally `--now` for clock drift simulation.