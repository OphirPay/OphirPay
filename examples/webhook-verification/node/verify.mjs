#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * OphirPay webhook signature verification — reference implementation (Node.js)
 *
 * Canonicalization (must match `buildSignedPayload` in
 * `src/lib/webhook-deliver.ts`):
 *
 *   1. Parse the received JSON body.
 *   2. Set the `signature` field to "" — keep the key, empty the value.
 *      (Do NOT delete the key; the canonical string contains `"signature":""`.)
 *   3. Re-serialize with stable key order (JSON.stringify preserves the
 *      insertion order of the parsed body, which matches the sender's order).
 *   4. Compute HMAC-SHA256 (hex) over that canonical string using your
 *      webhook secret.
 *   5. Compare against the `X-OphirPay-Signature` header with a
 *      constant-time comparison.
 *
 * CLI:
 *
 *   node verify.mjs --secret <secret> --signature <hex> \
 *     [--body-file <path>] [--max-age <seconds>] [--now <iso>]
 *
 * Reads the body from `--body-file`, or stdin when omitted. Prints "VALID"
 * and exits 0 on success, or "INVALID: <reason>" and exits 1 otherwise.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const DEFAULT_MAX_AGE_SECONDS = 300; // replay-protection window

/**
 * Build the canonical string a receiver must sign, byte-for-byte identical
 * to what `buildSignedPayload` signs on the sender side.
 */
export function canonicalize(body) {
  const parsed = JSON.parse(body);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("body must be a JSON object");
  }
  // Empty the signature field instead of deleting it: the HMAC input
  // includes `"signature":""` as the last key.
  return JSON.stringify({ ...parsed, signature: "" });
}

/**
 * Verify an OphirPay webhook delivery.
 *
 * @param {object} opts
 * @param {string} opts.body      raw request body (string)
 * @param {string} opts.signature value of the X-OphirPay-Signature header
 * @param {string} opts.secret    your webhook signing secret
 * @param {number} [opts.maxAgeSeconds=300] replay window; 0 disables the check
 * @param {Date}   [opts.now]     reference time (defaults to the current time)
 * @returns {{ valid: boolean, reason: string }}
 */
export function verifyWebhookSignature({
  body,
  signature,
  secret,
  maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS,
  now = new Date(),
}) {
  let canonical;
  try {
    canonical = canonicalize(body);
  } catch (err) {
    return { valid: false, reason: `invalid body: ${err.message}` };
  }

  const expected = createHmac("sha256", secret).update(canonical).digest("hex");
  const provided = String(signature ?? "");
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  const matches =
    providedBuf.length === expectedBuf.length && timingSafeEqual(providedBuf, expectedBuf);
  if (!matches) {
    return { valid: false, reason: "signature mismatch" };
  }

  if (maxAgeSeconds > 0) {
    const parsed = JSON.parse(body);
    const ts = Date.parse(parsed.timestamp);
    if (Number.isNaN(ts)) {
      return { valid: false, reason: "missing or invalid timestamp" };
    }
    const ageSeconds = (now.getTime() - ts) / 1000;
    if (ageSeconds > maxAgeSeconds) {
      return {
        valid: false,
        reason: `payload too old (${Math.round(ageSeconds)}s > ${maxAgeSeconds}s) — possible replay`,
      };
    }
    if (ageSeconds < -maxAgeSeconds) {
      return {
        valid: false,
        reason: `payload timestamp is in the future (${Math.round(-ageSeconds)}s ahead)`,
      };
    }
  }

  return { valid: true, reason: "valid" };
}

function parseArgs(argv) {
  const args = { secret: null, signature: null, bodyFile: null, maxAge: null, now: null };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--secret":
        args.secret = argv[++i];
        break;
      case "--signature":
        args.signature = argv[++i];
        break;
      case "--body-file":
        args.bodyFile = argv[++i];
        break;
      case "--max-age":
        args.maxAge = Number(argv[++i]);
        break;
      case "--now":
        args.now = argv[++i];
        break;
      default:
        throw new Error(`unknown argument: ${argv[i]}`);
    }
  }
  return args;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`error: ${err.message}`);
    console.error(
      "usage: node verify.mjs --secret <secret> --signature <hex> [--body-file <path>] [--max-age <seconds>] [--now <iso>]"
    );
    process.exit(2);
  }
  if (!args.secret || !args.signature) {
    console.error(
      "usage: node verify.mjs --secret <secret> --signature <hex> [--body-file <path>] [--max-age <seconds>] [--now <iso>]"
    );
    process.exit(2);
  }
  const body = args.bodyFile ? readFileSync(args.bodyFile, "utf8") : readFileSync(0, "utf8");
  const now = args.now ? new Date(args.now) : new Date();
  const result = verifyWebhookSignature({
    body,
    signature: args.signature,
    secret: args.secret,
    maxAgeSeconds: args.maxAge ?? DEFAULT_MAX_AGE_SECONDS,
    now,
  });
  if (result.valid) {
    console.log("VALID");
    process.exit(0);
  }
  console.error(`INVALID: ${result.reason}`);
  process.exit(1);
}

// Run as a CLI when executed directly (not when imported).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
