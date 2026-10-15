// SPDX-License-Identifier: MIT
import { createHmac, timingSafeEqual } from "node:crypto";

export interface VerificationInput {
  body: string;
  signature: string;
  secret: string;
  timestamp?: string;
  maxAgeSeconds?: number;
}

export interface VerificationResult {
  valid: boolean;
  error?: string;
}

/**
 * Reference implementation of timing-safe webhook verification for Node.js / TypeScript.
 *
 * Requirements:
 * 1. Constant-time comparison using `crypto.timingSafeEqual`.
 * 2. Strict byte buffer length checking prior to comparison to eliminate side-channel
 *    timing attacks and prevent uncaught RangeError exceptions.
 * 3. Freshness window check to mitigate replay attacks.
 */
export function verifyOphirPayWebhook({
  body,
  signature,
  secret,
  timestamp,
  maxAgeSeconds = 300,
}: VerificationInput): VerificationResult {
  try {
    const parsed = JSON.parse(body);
    const canonical = JSON.stringify({ ...parsed, signature: "" });
    const signedTs = String(timestamp ?? parsed.timestamp ?? "");
    const expectedHex = createHmac("sha256", secret)
      .update(`${signedTs}.${canonical}`)
      .digest("hex");

    const providedBuf = Buffer.from(String(signature ?? ""), "utf8");
    const expectedBuf = Buffer.from(expectedHex, "utf8");

    // Guard length prior to timingSafeEqual to avoid throwing RangeError
    const isMatch =
      providedBuf.length === expectedBuf.length &&
      timingSafeEqual(providedBuf, expectedBuf);

    if (!isMatch) {
      return { valid: false, error: "Signature mismatch" };
    }

    if (maxAgeSeconds > 0) {
      const ts = Date.parse(signedTs);
      if (Number.isNaN(ts)) {
        return { valid: false, error: "Invalid timestamp" };
      }
      const ageSeconds = (Date.now() - ts) / 1000;
      if (ageSeconds > maxAgeSeconds || ageSeconds < -maxAgeSeconds) {
        return { valid: false, error: "Timestamp freshness window exceeded" };
      }
    }

    return { valid: true };
  } catch (err) {
    return { valid: false, error: (err as Error).message };
  }
}
