// SPDX-License-Identifier: MIT
/**
 * OphirPay Webhook Verification — TypeScript Reference Verifier
 *
 * Implements HMAC-SHA256 signature verification and replay protection
 * with explicit error codes as specified in docs/webhook-verification.md.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const DEFAULT_MAX_AGE_SECONDS = 300; // 5 minutes

export const WebhookErrorCode = {
  TIMESTAMP_EXPIRED: "WebhookTimestampExpired",
  TIMESTAMP_FUTURE_SKEW: "WebhookTimestampFutureSkew",
  SIGNATURE_MISMATCH: "WebhookSignatureMismatch",
  INVALID_BODY: "WebhookInvalidBody",
  INVALID_TIMESTAMP: "WebhookInvalidTimestamp",
} as const;

export type WebhookErrorCodeType =
  (typeof WebhookErrorCode)[keyof typeof WebhookErrorCode];

export class WebhookVerificationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "WebhookVerificationError";
  }
}

export class WebhookTimestampExpired extends WebhookVerificationError {
  constructor(ageSeconds: number, maxAgeSeconds: number) {
    super(
      WebhookErrorCode.TIMESTAMP_EXPIRED,
      `payload too old (${Math.round(ageSeconds)}s > ${maxAgeSeconds}s) — possible replay`,
    );
    this.name = "WebhookTimestampExpired";
  }
}

export class WebhookTimestampFutureSkew extends WebhookVerificationError {
  constructor(skewSeconds: number, maxSkewSeconds: number) {
    super(
      WebhookErrorCode.TIMESTAMP_FUTURE_SKEW,
      `payload timestamp is in the future (${Math.round(skewSeconds)}s > ${maxSkewSeconds}s allowed)`,
    );
    this.name = "WebhookTimestampFutureSkew";
  }
}

export class WebhookSignatureMismatch extends WebhookVerificationError {
  constructor() {
    super(WebhookErrorCode.SIGNATURE_MISMATCH, "signature mismatch");
    this.name = "WebhookSignatureMismatch";
  }
}

export class WebhookInvalidBody extends WebhookVerificationError {
  constructor(details: string) {
    super(WebhookErrorCode.INVALID_BODY, `invalid body: ${details}`);
    this.name = "WebhookInvalidBody";
  }
}

export class WebhookInvalidTimestamp extends WebhookVerificationError {
  constructor(details: string) {
    super(WebhookErrorCode.INVALID_TIMESTAMP, `missing or invalid timestamp: ${details}`);
    this.name = "WebhookInvalidTimestamp";
  }
}

/**
 * Builds the canonical string a receiver must sign, byte-for-byte identical
 * to what OphirPay signs on the sender side.
 * Preserves original key order, replacing signature value with empty string.
 */
export function canonicalize(body: string): string {
  const parsed = JSON.parse(body);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("body must be a JSON object");
  }
  return JSON.stringify({ ...parsed, signature: "" });
}

export interface VerifyWebhookOptions {
  body: string;
  signature: string;
  secret: string;
  timestamp?: string;
  maxAgeSeconds?: number;
  now?: Date;
}

export interface WebhookVerificationResult {
  valid: boolean;
  code?: WebhookErrorCodeType;
  reason: string;
}

/**
 * Verifies an OphirPay webhook delivery against the provided secret.
 * Performs constant-time HMAC check and enforces replay window.
 */
export function verifyWebhookSignature({
  body,
  signature,
  secret,
  timestamp,
  maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS,
  now = new Date(),
}: VerifyWebhookOptions): WebhookVerificationResult {
  let parsed: Record<string, unknown>;
  let canonical: string;

  try {
    parsed = JSON.parse(body);
    canonical = canonicalize(body);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      valid: false,
      code: WebhookErrorCode.INVALID_BODY,
      reason: `${WebhookErrorCode.INVALID_BODY}: ${msg}`,
    };
  }

  const signedTimestamp = String(timestamp ?? parsed.timestamp ?? "");
  const expected = createHmac("sha256", secret)
    .update(`${signedTimestamp}.${canonical}`)
    .digest("hex");

  const provided = String(signature ?? "");
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);

  const matches =
    providedBuf.length === expectedBuf.length &&
    timingSafeEqual(providedBuf, expectedBuf);

  if (!matches) {
    return {
      valid: false,
      code: WebhookErrorCode.SIGNATURE_MISMATCH,
      reason: `${WebhookErrorCode.SIGNATURE_MISMATCH}: signature mismatch`,
    };
  }

  if (maxAgeSeconds > 0) {
    const ts = Date.parse(signedTimestamp);
    if (Number.isNaN(ts)) {
      return {
        valid: false,
        code: WebhookErrorCode.INVALID_TIMESTAMP,
        reason: `${WebhookErrorCode.INVALID_TIMESTAMP}: missing or invalid timestamp`,
      };
    }

    const ageSeconds = (now.getTime() - ts) / 1000;
    if (ageSeconds > maxAgeSeconds) {
      return {
        valid: false,
        code: WebhookErrorCode.TIMESTAMP_EXPIRED,
        reason: `${WebhookErrorCode.TIMESTAMP_EXPIRED}: payload too old (${Math.round(ageSeconds)}s > ${maxAgeSeconds}s) — possible replay`,
      };
    }

    if (ageSeconds < -maxAgeSeconds) {
      return {
        valid: false,
        code: WebhookErrorCode.TIMESTAMP_FUTURE_SKEW,
        reason: `${WebhookErrorCode.TIMESTAMP_FUTURE_SKEW}: payload timestamp is in the future (${Math.round(-ageSeconds)}s ahead)`,
      };
    }
  }

  return { valid: true, reason: "valid" };
}

/**
 * Asserts that a webhook delivery is authentic and fresh. Throws typed error if not.
 */
export function assertWebhookSignature(options: VerifyWebhookOptions): void {
  const result = verifyWebhookSignature(options);
  if (!result.valid) {
    switch (result.code) {
      case WebhookErrorCode.TIMESTAMP_EXPIRED:
        throw new WebhookTimestampExpired(
          options.now && options.timestamp
            ? (options.now.getTime() - Date.parse(options.timestamp)) / 1000
            : 0,
          options.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS,
        );
      case WebhookErrorCode.TIMESTAMP_FUTURE_SKEW:
        throw new WebhookTimestampFutureSkew(
          options.now && options.timestamp
            ? (Date.parse(options.timestamp) - options.now.getTime()) / 1000
            : 0,
          options.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS,
        );
      case WebhookErrorCode.SIGNATURE_MISMATCH:
        throw new WebhookSignatureMismatch();
      case WebhookErrorCode.INVALID_BODY:
        throw new WebhookInvalidBody(result.reason);
      case WebhookErrorCode.INVALID_TIMESTAMP:
        throw new WebhookInvalidTimestamp(result.reason);
      default:
        throw new WebhookVerificationError(
          result.code ?? "WebhookVerificationError",
          result.reason,
        );
    }
  }
}
