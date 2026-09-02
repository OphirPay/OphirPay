# Webhook Signature Verification

Every webhook delivery OphirPay sends is an HTTP `POST` to your registered
endpoint with an HMAC-SHA256 signature, so you can prove the request really
came from OphirPay and was not tampered with in transit.

```
POST /hooks HTTP/1.1
Content-Type: application/json
X-OphirPay-Signature: 647945219590e65b3f903bdd28baeabdc5ce3915cc9a8a497bfcba9ed2802b64
X-OphirPay-Event: payment.created

{
  "event": "payment.created",
  "timestamp": "2026-08-14T00:00:00Z",
  "data": { "id": "p_123", "amount": 100 },
  "signature": "647945219590e65b3f903bdd28baeabdc5ce3915cc9a8a497bfcba9ed2802b64"
}
```

- **`X-OphirPay-Signature`** — HMAC-SHA256 (hex) over the canonical body, the
  value you must verify.
- **`X-OphirPay-Event`** — the event type, mirrored in the body's `event`
  field. Informational; don't trust it for verification.
- **`signature`** (in the body) — the same value as the header, mirrored for
  convenience. Always verify against the **header** value.

---

## The exact canonical form

OphirPay signs the payload with `buildSignedPayload` (see
`src/lib/webhook-deliver.ts`), and the receiver must reproduce the **exact
same byte string** before recomputing the HMAC:

1. **Parse** the received body as JSON.
2. **Empty the `signature` field** — set it to `""`. Keep the key; do *not*
   delete it. The canonical string contains `"signature":""` as the last key.
3. **Re-serialize with stable key order** — the order of the keys as received
   (parse-then-stringify preserves insertion order; do not sort or reorder).
4. **HMAC-SHA256** the canonical string with your webhook secret, hex-encoded.
5. **Compare** against `X-OphirPay-Signature` using a constant-time comparison.

Concretely, the signature is computed over this exact string:

```
{"event":"payment.created","timestamp":"2026-08-14T00:00:00Z","data":{"id":"p_123","amount":100},"signature":""}
```

> ⚠️ **The most common bug:** stripping the `signature` field out of the
> object (`const { signature, ...rest } = body`). That removes the key
> entirely and produces a different canonical string than the sender signed.
> **Empty it — don't remove it.**

> ⚠️ **Key order matters.** The canonical string is the JSON with keys in the
> order the sender serialized them (`event`, `timestamp`, `data`, `signature`).
> Parse and re-serialize in the received order; never sort keys or
> pretty-print the JSON.

---

## Replay protection

The signature proves *authenticity* (the body came from OphirPay and wasn't
tampered with). It does **not** by itself prevent *replay* — an attacker can
capture a valid request and re-send it later. Combine two defenses:

### 1. Timestamp freshness window

Every payload carries a `timestamp` (ISO 8601 UTC). Reject deliveries whose
timestamp is too old or too far in the future:

- **Too old** (e.g. older than 5 minutes) — likely a replay of a captured
  request.
- **In the future** (beyond a small clock-skew allowance, e.g. 5 minutes) —
  a sign of a fabricated or manipulated payload.

OphirPay retries failed deliveries up to 3 times (1s, 2s, 4s backoff) with
the **same payload and signature**, so your window must comfortably cover the
retry span — 5 minutes is a sensible default. A fresh delivery has a
timestamp within a second or two of receipt.

### 2. Idempotent processing (dedupe)

Because retries are byte-identical, process each logical event **at most
once**. Keep a short-lived store of recently processed events keyed by
`event + timestamp` (or a hash of the canonical body) and skip duplicates.
This makes replays harmless even if they arrive inside the freshness window.

> Note: the current payload has no monotonic delivery ID. If you need a
> stronger idempotency key, hash the canonical body — it is stable across
> retries and unique per logical event.

---

## Reference implementations

Runnable, dependency-free examples are in
[`examples/webhook-verification/`](../examples/webhook-verification/):

| Language | File | Run |
|---|---|---|
| Node.js (ESM) | [`node/verify.mjs`](../examples/webhook-verification/node/verify.mjs) | `node verify.mjs --secret <secret> --signature <hex> --body-file body.json` |
| Python 3 | [`python/verify.py`](../examples/webhook-verification/python/verify.py) | `python3 verify.py --secret <secret> --signature <hex> --body-file body.json` |

Both print `VALID` (exit 0) or `INVALID: <reason>` (exit 1), and both
implement the canonical form above plus a configurable freshness window
(`--max-age`, default 300s; `--max-age 0` disables it).

### Sample payload (self-test)

```json
{
  "event": "payment.created",
  "timestamp": "2026-08-14T00:00:00Z",
  "data": { "id": "p_123", "amount": 100 },
  "signature": "647945219590e65b3f903bdd28baeabdc5ce3915cc9a8a497bfcba9ed2802b64"
}
```

- **Secret:** `test-secret-0123456789`
- **Canonical string:** `{"event":"payment.created","timestamp":"2026-08-14T00:00:00Z","data":{"id":"p_123","amount":100},"signature":""}`

Verify your own implementation reproduces `647945219590e65b3f903bdd28baeabdc5ce3915cc9a8a497bfcba9ed2802b64`
over that canonical string. The sample's timestamp is fixed, so pass `--now`
when testing (see the examples README).

---

## Node.js (reference)

```javascript
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify an OphirPay webhook delivery.
 * @param {string} body      - raw request body (string)
 * @param {string} signature - X-OphirPay-Signature header value
 * @param {string} secret    - your webhook signing secret
 * @param {number} maxAgeSeconds - replay window (0 disables); default 300
 */
export function verifyWebhookSignature({ body, signature, secret, maxAgeSeconds = 300 }) {
  // 1–3. Parse, empty the signature field, re-serialize in key order.
  const parsed = JSON.parse(body);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("body must be a JSON object");
  }
  const canonical = JSON.stringify({ ...parsed, signature: "" });

  // 4. Recompute the expected HMAC-SHA256 hex.
  const expected = createHmac("sha256", secret).update(canonical).digest("hex");

  // 5. Constant-time comparison against the header value.
  const provided = Buffer.from(String(signature ?? ""));
  const expectedBuf = Buffer.from(expected);
  const matches =
    provided.length === expectedBuf.length && timingSafeEqual(provided, expectedBuf);
  if (!matches) return false;

  // Replay protection: timestamp freshness window.
  if (maxAgeSeconds > 0) {
    const ts = Date.parse(parsed.timestamp);
    if (Number.isNaN(ts)) return false;
    const ageSeconds = (Date.now() - ts) / 1000;
    if (ageSeconds > maxAgeSeconds || ageSeconds < -maxAgeSeconds) return false;
  }
  return true;
}
```

Example usage in a route handler:

```javascript
// Express-style example
app.post("/webhooks/ophirpay", (req, res) => {
  const signature = req.headers["x-ophirpay-signature"];
  const valid = verifyWebhookSignature({
    body: JSON.stringify(req.body),
    signature,
    secret: process.env.WEBHOOK_SECRET,
  });
  if (!valid) return res.status(401).end();
  res.status(200).end(); // acknowledge quickly, then process
});
```

---

## Python (reference)

```python
import hashlib
import hmac
import json
from datetime import datetime, timezone

DEFAULT_MAX_AGE_SECONDS = 300


def verify_webhook_signature(body, signature, secret, max_age_seconds=DEFAULT_MAX_AGE_SECONDS, now=None):
    # 1–3. Parse, empty the signature field, re-serialize in key order.
    parsed = json.loads(body)
    if not isinstance(parsed, dict):
        raise ValueError("body must be a JSON object")
    parsed["signature"] = ""
    # Compact separators + raw UTF-8 match Node's JSON.stringify byte-for-byte.
    canonical = json.dumps(parsed, separators=(",", ":"), ensure_ascii=False)

    # 4. Recompute the expected HMAC-SHA256 hex.
    expected = hmac.new(secret.encode("utf-8"), canonical.encode("utf-8"), hashlib.sha256).hexdigest()

    # 5. Constant-time comparison against the header value.
    provided = (signature or "").encode("utf-8")
    expected_bytes = expected.encode("utf-8")
    if len(provided) != len(expected_bytes) or not hmac.compare_digest(provided, expected_bytes):
        return False

    # Replay protection: timestamp freshness window.
    if max_age_seconds > 0:
        try:
            ts = datetime.fromisoformat(parsed.get("timestamp", "").replace("Z", "+00:00"))
        except ValueError:
            return False
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        now = now or datetime.now(timezone.utc)
        age_seconds = (now - ts).total_seconds()
        if age_seconds > max_age_seconds or age_seconds < -max_age_seconds:
            return False
    return True
```

Example usage (Flask-style):

```python
from flask import Flask, request

app = Flask(__name__)

@app.post("/webhooks/ophirpay")
def webhook():
    valid = verify_webhook_signature(
        request.get_data(as_text=True),
        request.headers.get("X-OphirPay-Signature", ""),
        os.environ["WEBHOOK_SECRET"],
    )
    if not valid:
        return "unauthorized", 401
    return "", 200
```

---

## Verification checklist

- [ ] Compare against the `X-OphirPay-Signature` **header**, not the body field.
- [ ] Empty the `signature` field — **don't delete the key**.
- [ ] Re-serialize with the received key order — no sorting, no pretty-print.
- [ ] Use a **constant-time** comparison (`timingSafeEqual` /
      `hmac.compare_digest`).
- [ ] Enforce a timestamp freshness window (default 300s).
- [ ] Process events **idempotently** (dedupe by `event + timestamp`).
- [ ] Return a `2xx` quickly after verification; do heavy work async.
- [ ] Rotate the secret and re-verify on `401` — a mismatch means the
      delivery is not from OphirPay or was modified in transit.

## Related docs

- [Integration guide](integration-guide.md) — end-to-end setup
- [Architecture](architecture.md) — where webhooks fit in the system
- `src/lib/webhook-deliver.ts` — sender-side signing (`buildSignedPayload`)
