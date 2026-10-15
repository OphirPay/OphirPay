// SPDX-License-Identifier: MIT
/**
 * OphirPay webhook signature verification — reference implementation (TypeScript).
 *
 * Provides constant-time HMAC-SHA256 signature verification to prevent
 * side-channel timing attacks.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const DEFAULT_MAX_AGE_SECONDS = 300;

export interface WebhookPayloadLike {
  event?: string;
  timestamp?: string;
  data?: Record<string, unknown>;
  signature?: string;
  [key: string]: unknown;
}

export interface VerifyWebhookSignatureOptions {
  body: string;
  signature: string;
  secret: string;
  timestamp?: string;
  maxAgeSeconds?: number;
  now?: Date;
}

export interface VerificationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Build the canonical string a receiver must sign, byte-for-byte identical
 * to what `buildSignedPayload` signs on the sender side.
 */
export function canonicalize(body: string): string {
  const parsed = JSON.parse(body) as WebhookPayloadLike;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("body must be a JSON object");
  }
  // Empty the signature field instead of deleting it: the HMAC input
  // includes `"signature":""` as the last key.
  return JSON.stringify({ ...parsed, signature: "" });
}

/**
 * Constant-time comparison between two string digests.
 *
 * Checks that lengths match before invoking `timingSafeEqual`, preventing
 * length mismatch exceptions and guarding against timing side-channel attacks.
 */
export function timingSafeEqualSignatures(sigA: string, sigB: string): boolean {
  if (typeof sigA !== "string" || typeof sigB !== "string") {
    return false;
  }
  try {
    const bufA = Buffer.from(sigA);
    const bufB = Buffer.from(sigB);
    if (bufA.length === 0 || bufB.length === 0 || bufA.length !== bufB.length) {
      return false;
    }
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/**
 * Verify an OphirPay webhook delivery using constant-time comparison.
 */
export function verifyWebhookSignature({
  body,
  signature,
  secret,
  timestamp,
  maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS,
  now = new Date(),
}: VerifyWebhookSignatureOptions): VerificationResult {
  let parsed: WebhookPayloadLike;
  let canonical: string;
  try {
    parsed = JSON.parse(body) as WebhookPayloadLike;
    canonical = canonicalize(body);
  } catch (err) {
    return {
      valid: false,
      reason: `invalid body: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // The timestamp is authenticated: it is prepended to the canonical body.
  // Prefer the header; fall back to the body field (which is signed too).
  const signedTimestamp = String(timestamp ?? parsed.timestamp ?? "");
  const expected = createHmac("sha256", secret)
    .update(`${signedTimestamp}.${canonical}`)
    .digest("hex");

  const provided = String(signature ?? "");
  const matches = timingSafeEqualSignatures(provided, expected);
  if (!matches) {
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

  return { valid: true };
}

interface ParsedArgs {
  secret: string | null;
  signature: string | null;
  timestamp: string | null;
  bodyFile: string | null;
  maxAge: number | null;
  now: string | null;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
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

function main(): void {
  let args: ParsedArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    console.error(
      "usage: npx tsx node-verifier.ts --secret <secret> --signature <hex> [--timestamp <iso>] [--body-file <path>] [--max-age <seconds>] [--now <iso>]"
    );
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

// Run as CLI when invoked directly
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
