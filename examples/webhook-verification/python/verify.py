#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""
OphirPay webhook signature verification - reference implementation (Python)

Canonicalization (must match `buildSignedPayload` in
`src/lib/webhook-deliver.ts`):

  1. Parse the received JSON body.
  2. Set the `signature` field to "" - keep the key, empty the value.
     (Do NOT delete the key; the canonical string contains `"signature":""`.)
  3. Re-serialize with stable key order. Python 3.7+ dicts preserve
     insertion order, so parsing the body and re-serializing keeps the
     sender's key order. Use compact separators (",", ":") and raw UTF-8
     (no \\uXXXX escapes) so the bytes match Node's `JSON.stringify`.
  4. Compute HMAC-SHA256 (hex) over that canonical string using your
     webhook secret.
  5. Compare against the `X-OphirPay-Signature` header with a
     constant-time comparison (`hmac.compare_digest`).

CLI:

  python3 verify.py --secret <secret> --signature <hex> \\
      [--body-file <path>] [--max-age <seconds>] [--now <iso>]

Reads the body from `--body-file`, or stdin when omitted. Prints "VALID"
and exits 0 on success, or "INVALID: <reason>" and exits 1 otherwise.
"""

import argparse
import hashlib
import hmac
import json
import sys
from datetime import datetime, timezone

DEFAULT_MAX_AGE_SECONDS = 300  # replay-protection window


def canonicalize(body):
    """Build the canonical string a receiver must sign, byte-for-byte
    identical to what `buildSignedPayload` signs on the sender side."""
    parsed = json.loads(body)
    if not isinstance(parsed, dict):
        raise ValueError("body must be a JSON object")
    # Empty the signature field instead of deleting it: the HMAC input
    # includes `"signature":""` as the last key.
    parsed["signature"] = ""
    # separators=(",", ":") and ensure_ascii=False match Node's
    # `JSON.stringify` byte-for-byte for JSON-safe payloads.
    return json.dumps(parsed, separators=(",", ":"), ensure_ascii=False)


def verify_webhook_signature(body, signature, secret, max_age_seconds=DEFAULT_MAX_AGE_SECONDS, now=None):
    """Verify an OphirPay webhook delivery.

    Returns (valid: bool, reason: str).
    """
    try:
        canonical = canonicalize(body)
    except (ValueError, json.JSONDecodeError) as exc:
        return False, "invalid body: %s" % exc

    expected = hmac.new(secret.encode("utf-8"), canonical.encode("utf-8"), hashlib.sha256).hexdigest()
    provided = (signature or "").encode("utf-8")
    expected_bytes = expected.encode("utf-8")
    if len(provided) != len(expected_bytes) or not hmac.compare_digest(provided, expected_bytes):
        return False, "signature mismatch"

    if max_age_seconds > 0:
        try:
            ts = datetime.fromisoformat(json.loads(body).get("timestamp", "").replace("Z", "+00:00"))
        except (ValueError, TypeError):
            return False, "missing or invalid timestamp"
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        now = now or datetime.now(timezone.utc)
        age_seconds = (now - ts).total_seconds()
        if age_seconds > max_age_seconds:
            return False, "payload too old (%ds > %ds) - possible replay" % (round(age_seconds), max_age_seconds)
        if age_seconds < -max_age_seconds:
            return False, "payload timestamp is in the future (%ds ahead)" % round(-age_seconds)

    return True, "valid"


def main(argv=None):
    parser = argparse.ArgumentParser(description="Verify an OphirPay webhook signature.")
    parser.add_argument("--secret", required=True, help="your webhook signing secret")
    parser.add_argument("--signature", required=True, help="value of the X-OphirPay-Signature header")
    parser.add_argument("--body-file", help="path to the received JSON body (defaults to stdin)")
    parser.add_argument("--max-age", type=int, default=DEFAULT_MAX_AGE_SECONDS, help="replay window in seconds (0 disables)")
    parser.add_argument("--now", help="reference timestamp (ISO 8601); defaults to the current time")
    args = parser.parse_args(argv)

    if args.body_file:
        with open(args.body_file, "r", encoding="utf-8") as fh:
            body = fh.read()
    else:
        body = sys.stdin.read()

    now = None
    if args.now:
        now = datetime.fromisoformat(args.now.replace("Z", "+00:00"))
        if now.tzinfo is None:
            now = now.replace(tzinfo=timezone.utc)

    valid, reason = verify_webhook_signature(
        body, args.signature, args.secret, max_age_seconds=args.max_age, now=now
    )
    if valid:
        print("VALID")
        return 0
    print("INVALID: %s" % reason, file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
