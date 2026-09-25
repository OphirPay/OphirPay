# Webhook Signature Verification

Every webhook delivery OphirPay sends is an HTTP `POST` to your registered
endpoint with an HMAC-SHA256 signature, so you can prove the request really
came from OphirPay, was not tampered with in transit, and cannot be replayed.

```http
POST /hooks HTTP/1.1
Content-Type: application/json
X-OphirPay-Signature: 83ab64c58dadec406835ebd9b907b579cb89132098823ec66f2b96dd1ad84258
X-OphirPay-Timestamp: 2026-08-14T00:00:00Z
X-OphirPay-Event: payment.created

{
  "event": "payment.created",
  "timestamp": "2026-08-14T00:00:00Z",
  "data": { "id": "p_123", "amount": 100 },
  "signature": "83ab64c58dadec406835ebd9b907b579cb89132098823ec66f2b96dd1ad84258"
}
```

- **`X-OphirPay-Signature`** — HMAC-SHA256 (hex) over `${timestamp}.${canonicalBody}`,
  the value you must verify.
- **`X-OphirPay-Timestamp`** — ISO 8601 UTC timestamp transmitted in the request header,
  covered by the signature for replay protection.
- **`X-OphirPay-Event`** — the event type, mirrored in the body's `event`
  field. Informational; don't trust it for verification.
- **`signature`** (in the body) — the same value as the header, mirrored for
  convenience. Always verify against the **`X-OphirPay-Signature`** header value.

---

## The exact canonical form

OphirPay signs the payload with `buildSignedPayload` (see
`src/lib/webhook-deliver.ts`), and the receiver must reproduce the **exact
same byte string** before recomputing the HMAC:

1. **Obtain the timestamp** from the `X-OphirPay-Timestamp` header (fallback
   to `body.timestamp` if omitted).
2. **Parse** the received body as JSON.
3. **Empty the `signature` field** — set it to `""`. Keep the key; do *not*
   delete it. The canonical string contains `"signature":""` as the last key.
4. **Re-serialize with stable key order** — the order of the keys as received
   (parse-then-stringify preserves insertion order; do not sort or reorder).
5. **Prepend the timestamp** separated by a dot: `${timestamp}.${canonical}`.
6. **HMAC-SHA256** the resulting string with your webhook secret, hex-encoded.
7. **Compare** against `X-OphirPay-Signature` using a constant-time comparison.

Concretely, the signature is computed over this exact string:

```
2026-08-14T00:00:00Z.{"event":"payment.created","timestamp":"2026-08-14T00:00:00Z","data":{"id":"p_123","amount":100},"signature":""}
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
tampered with) and *integrity* over both the timestamp and the body.
Combine two defenses against replays:

### 1. Timestamp freshness window

Every delivery transmits `X-OphirPay-Timestamp` (and mirrors `timestamp` in
the payload, ISO 8601 UTC). Reject deliveries whose timestamp is outside a
documented freshness window (default: **5 minutes / 300 seconds**):

- **Too old** (e.g. older than 5 minutes) — a replay of a captured request.
- **In the future** (beyond a 5-minute clock-skew allowance) — a sign of a
  fabricated or manipulated request.

Because the HMAC covers `${timestamp}.${canonical}`, an attacker cannot
tamper with `X-OphirPay-Timestamp` to make a captured request appear fresh;
changing the header causes an immediate signature mismatch.

OphirPay retries failed deliveries up to 3 times (1s, 2s, 4s backoff) with
the **same payload and signature**, so your window comfortably covers the
retry span — 5 minutes is a sensible default. A fresh delivery has a
timestamp within a second or two of receipt.

### 2. Idempotent processing (dedupe)

Where receivers need replay detection beyond the 5-minute freshness window,
use the delivery/event ID carried in the payload (`data.id` or event ID) as
an **idempotency key** to record and deduplicate processed events. Process each
logical event **at most once**:

1. Verify the signature and timestamp window.
2. Check if `data.id` (or delivery ID) was already processed. If so, return
   `200 OK` immediately without re-executing side effects (e.g., crediting funds).
3. If not processed, store the ID in an idempotency table and process the event.

---

## Reference implementations

Runnable, dependency-free examples are in
[`examples/webhook-verification/`](../examples/webhook-verification/):

| Language | File | Run |
|---|---|---|
| Node.js (ESM) | [`node/verify.mjs`](../examples/webhook-verification/node/verify.mjs) | `node verify.mjs --secret <secret> --signature <hex> --timestamp <iso> --body-file body.json` |
| Python 3 | [`python/verify.py`](../examples/webhook-verification/python/verify.py) | `python3 verify.py --secret <secret> --signature <hex> --timestamp <iso> --body-file body.json` |

Both print `VALID` (exit 0) or `INVALID: <reason>` (exit 1), and both
implement the canonical form above plus a configurable freshness window
(`--max-age`, default 300s; `--max-age 0` disables it).

### Sample payload (self-test)

```json
{
  "event": "payment.created",
  "timestamp": "2026-08-14T00:00:00Z",
  "data": { "id": "p_123", "amount": 100 },
  "signature": "83ab64c58dadec406835ebd9b907b579cb89132098823ec66f2b96dd1ad84258"
}
```

- **Secret:** `test-secret-0123456789`
- **Timestamp:** `2026-08-14T00:00:00Z`
- **Canonical string:** `{"event":"payment.created","timestamp":"2026-08-14T00:00:00Z","data":{"id":"p_123","amount":100},"signature":""}`
- **Signed string:** `2026-08-14T00:00:00Z.{"event":"payment.created","timestamp":"2026-08-14T00:00:00Z","data":{"id":"p_123","amount":100},"signature":""}`

Verify your own implementation reproduces `83ab64c58dadec406835ebd9b907b579cb89132098823ec66f2b96dd1ad84258`
over that signed string. The sample's timestamp is fixed, so pass `--now`
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
 * @param {string} [timestamp] - X-OphirPay-Timestamp header value
 * @param {number} [maxAgeSeconds=300] - replay window (0 disables); default 300
 * @param {Date}   [now=new Date()] - current reference time
 */
export function verifyWebhookSignature({
  body,
  signature,
  secret,
  timestamp,
  maxAgeSeconds = 300,
  now = new Date(),
}) {
  // 1–4. Parse, empty the signature field, re-serialize in key order.
  const parsed = JSON.parse(body);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("body must be a JSON object");
  }
  const canonical = JSON.stringify({ ...parsed, signature: "" });

  // 5. Signature covers timestamp plus canonical body.
  const effectiveTimestamp =
    timestamp || (typeof parsed.timestamp === "string" ? parsed.timestamp : undefined);
  if (!effectiveTimestamp) {
    return { valid: false, reason: "missing or invalid timestamp" };
  }

  const toSign = `${effectiveTimestamp}.${canonical}`;
  const expected = createHmac("sha256", secret).update(toSign).digest("hex");

  // 6. Constant-time comparison against the header value.
  const provided = Buffer.from(String(signature ?? ""));
  const expectedBuf = Buffer.from(expected);
  const matches =
    provided.length === expectedBuf.length && timingSafeEqual(provided, expectedBuf);
  if (!matches) {
    return { valid: false, reason: "signature mismatch" };
  }

  // 7. Replay protection: timestamp freshness window.
  if (maxAgeSeconds > 0) {
    const ts = Date.parse(effectiveTimestamp);
    if (Number.isNaN(ts)) return { valid: false, reason: "missing or invalid timestamp" };
    const ageSeconds = (now.getTime() - ts) / 1000;
    if (ageSeconds > maxAgeSeconds) {
      return { valid: false, reason: `payload too old (${Math.round(ageSeconds)}s > ${maxAgeSeconds}s) — possible replay` };
    }
    if (ageSeconds < -maxAgeSeconds) {
      return { valid: false, reason: `payload timestamp is in the future (${Math.round(-ageSeconds)}s ahead)` };
    }
  }

  return { valid: true, reason: "valid" };
}
```

Example usage in a route handler:

```javascript
// Express-style example
app.post("/webhooks/ophirpay", (req, res) => {
  const signature = req.headers["x-ophirpay-signature"];
  const timestamp = req.headers["x-ophirpay-timestamp"];
  const { valid } = verifyWebhookSignature({
    body: JSON.stringify(req.body),
    signature,
    timestamp,
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


def verify_webhook_signature(body, signature, secret, timestamp=None, max_age_seconds=DEFAULT_MAX_AGE_SECONDS, now=None):
    # 1–4. Parse, empty the signature field, re-serialize in key order.
    parsed = json.loads(body)
    if not isinstance(parsed, dict):
        return False, "invalid body: body must be a JSON object"
    parsed["signature"] = ""
    canonical = json.dumps(parsed, separators=(",", ":"), ensure_ascii=False)

    # 5. Signature covers timestamp plus canonical body.
    effective_timestamp = timestamp or parsed.get("timestamp")
    if not effective_timestamp or not isinstance(effective_timestamp, str):
        return False, "missing or invalid timestamp"

    to_sign = f"{effective_timestamp}.{canonical}"
    expected = hmac.new(secret.encode("utf-8"), to_sign.encode("utf-8"), hashlib.sha256).hexdigest()

    # 6. Constant-time comparison against header value.
    provided = (signature or "").encode("utf-8")
    expected_bytes = expected.encode("utf-8")
    if len(provided) != len(expected_bytes) or not hmac.compare_digest(provided, expected_bytes):
        return False, "signature mismatch"

    # 7. Replay protection: timestamp freshness window.
    if max_age_seconds > 0:
        try:
            ts = datetime.fromisoformat(effective_timestamp.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            return False, "missing or invalid timestamp"
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        now = now or datetime.now(timezone.utc)
        age_seconds = (now - ts).total_seconds()
        if age_seconds > max_age_seconds:
            return False, f"payload too old ({round(age_seconds)}s > {max_age_seconds}s) - possible replay"
        if age_seconds < -max_age_seconds:
            return False, f"payload timestamp is in the future ({round(-age_seconds)}s ahead)"

    return True, "valid"
```

Example usage (Flask-style):

```python
from flask import Flask, request

app = Flask(__name__)

@app.post("/webhooks/ophirpay")
def webhook():
    valid, reason = verify_webhook_signature(
        request.get_data(as_text=True),
        request.headers.get("X-OphirPay-Signature", ""),
        os.environ["WEBHOOK_SECRET"],
        timestamp=request.headers.get("X-OphirPay-Timestamp"),
    )
    if not valid:
        return "unauthorized", 401
    return "", 200
```

---

## Verification checklist

- [ ] Compare against the `X-OphirPay-Signature` **header**, not the body field.
- [ ] Read the `X-OphirPay-Timestamp` **header** and compute HMAC over `${timestamp}.${canonical}`.
- [ ] Empty the `signature` field — **don't delete the key**.
- [ ] Re-serialize with the received key order — no sorting, no pretty-print.
- [ ] Use a **constant-time** comparison (`timingSafeEqual` / `hmac.compare_digest`).
- [ ] Enforce a timestamp freshness window (default 300s / 5 minutes).
- [ ] Process events **idempotently** using the delivery/event ID (`data.id`) beyond the freshness window.
- [ ] Return a `2xx` quickly after verification; do heavy work async.
- [ ] Rotate the secret and re-verify on `401` — a mismatch means the delivery is not from OphirPay or was modified in transit.

## Related docs

- [Integration guide](integration-guide.md) — end-to-end setup
- [Architecture](architecture.md) — where webhooks fit in the system
- `src/lib/webhook-deliver.ts` — sender-side signing (`buildSignedPayload`) and verification (`verifyWebhookSignature`)
