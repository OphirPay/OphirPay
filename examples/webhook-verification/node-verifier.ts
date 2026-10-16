// SPDX-License-Identifier: MIT
/**
 * OphirPay webhook signature verification — reference implementation (TypeScript / Node.js)
 *
 * Implements constant-time HMAC-SHA256 signature verification over:
 *   `<timestamp>.<canonicalBody>`
 *
 * 1. Takes the timestamp header (falling back to payload timestamp).
 * 2. Parses received JSON and empties `signature` field to preserve canonical format.
 * 3. Compares expected digest using crypto.timingSafeEqual with safe length validation.
 * 4. Enforces configurable replay freshness window.
 *
 * CLI:
 *   npx tsx node-verifier.ts --secret <secret> --signature <hex> \
 *     [--timestamp <iso>] [--body-file <path>] [--max-age <seconds>] [--now <iso>]
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";

export const DEFAULT_MAX_AGE_SECONDS = 300;

export interface VerifyWebhookOptions {
  body: string;
  signature: string;
  secret: string;
  timestamp?: string;
  maxAgeSeconds?: number;
  now?: Date;
}

export interface VerifyWebhookResult {
  valid: boolean;
  reason: string;
}

/**
 * Builds the canonical string matching sender-side buildSignedPayload.
 */
export function canonicalize(body: string): string {
  const parsed = JSON.parse(body);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("body must be a JSON object");
  }
  return JSON.stringify({ ...parsed, signature: "" });
}

/**
 * Performs timing-safe comparison of provided and expected signatures.
 * Prevents timing attacks while avoiding RangeError exceptions on length mismatch.
 */
export function timingSafeEqualSignature(provided: string, expected: string): boolean {
  if (typeof provided !== "string" || typeof expected !== "string") {
    return false;
  }
  const bufProvided = Buffer.from(provided, "utf8");
  const bufExpected = Buffer.from(expected, "utf8");
  if (bufProvided.length === 0 || bufProvided.length !== bufExpected.length) {
    return false;
  }
  return timingSafeEqual(bufProvided, bufExpected);
}

/**
 * Verify an OphirPay webhook delivery.
 */
export function verifyWebhookSignature({
  body,
  signature,
  secret,
  timestamp,
  maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS,
  now = new Date(),
}: VerifyWebhookOptions): VerifyWebhookResult {
  let parsed: Record<string, unknown>;
  let canonical: string;
  try {
    parsed = JSON.parse(body);
    canonical = canonicalize(body);
  } catch (err) {
    return {
      valid: false,
      reason: `invalid body: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const signedTimestamp = String(timestamp ?? parsed.timestamp ?? "");
  const expected = createHmac("sha256", secret)
    .update(`${signedTimestamp}.${canonical}`)
    .digest("hex");

  if (!timingSafeEqualSignature(signature, expected)) {
    return { valid: false, reason: "signature mismatch" };
  }

  if (maxAgeSeconds > 0) {
    const ts = Date.parse(signedTimestamp);
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

function parseArgs(argv: string[]) {
  const args: {
    secret: string | null;
    signature: string | null;
    timestamp: string | null;
    bodyFile: string | null;
    maxAge: number | null;
    now: string | null;
  } = {
    secret: null,
    signature: null,
    timestamp: null,
    bodyFile: null,
    maxAge: null,
    now: null,
  };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--secret":
        args.secret = argv[++i];
        break;
      case "--signature":
        args.signature = argv[++i];
        break;
      case "--timestamp":
        args.timestamp = argv[++i];
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

export function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }
  if (!args.secret || !args.signature) {
    console.error(
      "usage: npx tsx node-verifier.ts --secret <secret> --signature <hex> [--timestamp <iso>] [--body-file <path>] [--max-age <seconds>] [--now <iso>]"
    );
    process.exit(2);
  }
  const body = args.bodyFile ? readFileSync(args.bodyFile, "utf8") : readFileSync(0, "utf8");
  const now = args.now ? new Date(args.now) : new Date();
  const result = verifyWebhookSignature({
    body,
    signature: args.signature,
    secret: args.secret,
    timestamp: args.timestamp ?? undefined,
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

if (typeof require !== "undefined" && require.main === module) {
  main();
}
