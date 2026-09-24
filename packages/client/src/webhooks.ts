// SPDX-License-Identifier: MIT

import crypto from "crypto";
import type { WebhookPayload, WebhookVerificationResult } from "./types.js";

/**
 * Verify an incoming OphirPay webhook signature.
 *
 * Implements the canonical signature scheme documented in docs/webhook-verification.md:
 * 1. Parse body as JSON if raw string.
 * 2. Empty the `signature` field (`signature: ""`) while preserving key order.
 * 3. Serialize canonical JSON string.
 * 4. Compute HMAC-SHA256 with the webhook signing secret.
 * 5. Constant-time compare computed signature with the provided header signature.
 * 6. Optionally verify timestamp freshness to protect against replay attacks.
 *
 * @param body Raw JSON string or parsed payload object
 * @param signature Hex signature from X-OphirPay-Signature header
 * @param secret Secret webhook key shared with OphirPay
 * @param options Optional verification options (e.g. clock drift threshold)
 */
export function verifyWebhookSignature(
  body: string | Record<string, unknown>,
  signature: string,
  secret: string,
  options?: {
    maxClockDriftSeconds?: number;
  }
): WebhookVerificationResult {
  if (!body) {
    return { valid: false, reason: "Payload body is empty or undefined" };
  }
  if (!signature || typeof signature !== "string") {
    return { valid: false, reason: "Missing or invalid signature header" };
  }
  if (!secret || typeof secret !== "string") {
    return { valid: false, reason: "Missing webhook secret" };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = typeof body === "string" ? JSON.parse(body) : { ...body };
  } catch {
    return { valid: false, reason: "Malformed JSON payload" };
  }

  // Check clock drift / replay window if timestamp is present and threshold is requested
  if (options?.maxClockDriftSeconds && parsed.timestamp && typeof parsed.timestamp === "string") {
    const payloadTime = Date.parse(parsed.timestamp);
    if (!isNaN(payloadTime)) {
      const now = Date.now();
      const ageSeconds = Math.abs(now - payloadTime) / 1000;
      if (ageSeconds > options.maxClockDriftSeconds) {
        return {
          valid: false,
          reason: `Timestamp drift exceeded: delivery is ${Math.round(ageSeconds)}s old (max allowed: ${options.maxClockDriftSeconds}s)`,
        };
      }
    }
  }

  // Canonicalize according to OphirPay specification:
  // Empty the signature field while preserving key structure and order.
  const canonicalObj = {
    ...parsed,
    signature: "",
  };

  const canonicalString = JSON.stringify(canonicalObj);

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(canonicalString)
    .digest("hex");

  // Constant-time comparison
  const sigBuffer = Buffer.from(signature.trim().toLowerCase(), "hex");
  const expectedBuffer = Buffer.from(expectedSignature.toLowerCase(), "hex");

  if (sigBuffer.length !== expectedBuffer.length) {
    return { valid: false, reason: "Signature length mismatch" };
  }

  const isValid = crypto.timingSafeEqual(sigBuffer, expectedBuffer);
  return {
    valid: isValid,
    reason: isValid ? undefined : "HMAC digest mismatch",
  };
}
