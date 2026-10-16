// SPDX-License-Identifier: MIT
/**
 * OphirPay webhook signature verification — TypeScript reference implementation.
 *
 * Implements strict timestamp freshness verification for replay attack mitigation:
 * - Payloads older than tolerance window (default 300s / 5m) rejected with `WebhookTimestampExpired`
 * - Payloads with excessive future skew (> 300s / 5m ahead) rejected with `WebhookTimestampFutureSkew`
 *
 * Generated for Issue #1409.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const DEFAULT_MAX_AGE_SECONDS = 300;

export type WebhookErrorCode =
  | "WebhookTimestampExpired"
  | "WebhookTimestampFutureSkew"
  | "WebhookSignatureMismatch"
  | "WebhookInvalidPayload"
  | "WebhookMissingTimestamp";

export interface VerifyWebhookOptions {
  /** Raw request body string as received */
  body: string;
  /** Value of the X-OphirPay-Signature header */
  signature: string;
  /** Webhook signing secret */
  secret: string;
  /** Value of the X-OphirPay-Timestamp header (falls back to body.timestamp) */
  timestamp?: string;
  /** Freshness tolerance window in seconds (default 300; 0 disables check) */
  maxAgeSeconds?: number;
  /** Reference time for evaluating timestamp age (defaults to new Date()) */
  now?: Date;
}

export interface VerifyWebhookResult {
  valid: boolean;
  code?: WebhookErrorCode;
  reason: string;
}

/**
 * Build the canonical string byte-for-byte identical to sender's buildSignedPayload.
 * The signature field is set to empty string "" rather than deleted.
 */
export function canonicalize(body: string): string {
  const parsed = JSON.parse(body);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("body must be a JSON object");
  }
  return JSON.stringify({ ...parsed, signature: "" });
}

/**
 * Verify an OphirPay webhook delivery signature and timestamp freshness.
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
    const message = err instanceof Error ? err.message : String(err);
    return {
      valid: false,
      code: "WebhookInvalidPayload",
      reason: `invalid body: ${message}`,
    };
  }

  const signedTimestamp = String(timestamp ?? parsed.timestamp ?? "");
  const expected = createHmac("sha256", secret)
    .update(`${signedTimestamp}.${canonical}`)
    .digest("hex");

  const provided = String(signature ?? "").trim().toLowerCase();
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);

  const matches =
    providedBuf.length === expectedBuf.length &&
    timingSafeEqual(providedBuf, expectedBuf);

  if (!matches) {
    return {
      valid: false,
      code: "WebhookSignatureMismatch",
      reason: "signature mismatch",
    };
  }

  if (maxAgeSeconds > 0) {
    const ts = Date.parse(signedTimestamp);
    if (Number.isNaN(ts)) {
      return {
        valid: false,
        code: "WebhookMissingTimestamp",
        reason: "missing or invalid timestamp",
      };
    }

    const ageSeconds = (now.getTime() - ts) / 1000;
    if (ageSeconds > maxAgeSeconds) {
      return {
        valid: false,
        code: "WebhookTimestampExpired",
        reason: `WebhookTimestampExpired: payload too old (${Math.round(ageSeconds)}s > ${maxAgeSeconds}s) — possible replay`,
      };
    }

    if (ageSeconds < -maxAgeSeconds) {
      return {
        valid: false,
        code: "WebhookTimestampFutureSkew",
        reason: `WebhookTimestampFutureSkew: payload timestamp is in the future (${Math.round(-ageSeconds)}s ahead)`,
      };
    }
  }

  return { valid: true, reason: "valid" };
}
