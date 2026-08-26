// SPDX-License-Identifier: MIT
import crypto from "crypto";

export interface VerifyWebhookOptions {
  /**
   * Maximum allowed clock drift / age in seconds before rejecting as replayed.
   * Defaults to 300 seconds (5 minutes). Set to 0 to disable timestamp checking.
   */
  toleranceSeconds?: number;
  /**
   * Custom timestamp for testing (epoch milliseconds).
   */
  now?: number;
}

export interface WebhookVerificationResult {
  valid: boolean;
  reason?: string;
  payload?: {
    event: string;
    timestamp: string;
    data: Record<string, unknown>;
    signature?: string;
  };
}

/**
 * Verifies an incoming OphirPay webhook signature against the raw body and webhook secret.
 *
 * Canonicalization algorithm:
 * 1. Parse JSON body if string is passed.
 * 2. Set signature field to empty string "".
 * 3. Serialize to canonical JSON string matching buildSignedPayload.
 * 4. Compute HMAC-SHA256 digest in hex.
 * 5. Compare signatures using constant-time crypto.timingSafeEqual.
 * 6. Validate payload timestamp within tolerance window (default 300s) to prevent replay attacks.
 */
export function verifyWebhookSignature(
  rawBody: string | Record<string, unknown>,
  signatureHeader: string,
  secret: string,
  options: VerifyWebhookOptions = {}
): WebhookVerificationResult {
  if (!signatureHeader || !secret) {
    return { valid: false, reason: "Missing signature header or webhook secret" };
  }

  let parsed: Record<string, unknown> | null = null;
  if (typeof rawBody === "string") {
    try {
      parsed = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return { valid: false, reason: "Invalid JSON payload body" };
    }
  } else if (typeof rawBody === "object" && rawBody !== null) {
    parsed = rawBody as Record<string, unknown>;
  } else {
    return { valid: false, reason: "Invalid payload type" };
  }

  if (!parsed || typeof parsed !== "object") {
    return { valid: false, reason: "Payload must be a JSON object" };
  }

  // 1. Canonicalize payload: recreate object with signature set to empty string
  const canonicalObj = {
    event: parsed.event,
    timestamp: parsed.timestamp,
    data: parsed.data,
    signature: "",
  };

  const canonicalString = JSON.stringify(canonicalObj);

  // 2. Compute expected HMAC-SHA256 hex digest
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(canonicalString)
    .digest("hex");

  // 3. Timing-safe constant-time comparison
  const sigBuffer = Buffer.from(signatureHeader, "utf-8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf-8");

  if (
    sigBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(sigBuffer, expectedBuffer)
  ) {
    return { valid: false, reason: "Signature mismatch" };
  }

  // 4. Replay protection: verify timestamp tolerance
  const tolerance = options.toleranceSeconds ?? 300;
  if (tolerance > 0 && typeof parsed.timestamp === "string") {
    const eventTime = new Date(parsed.timestamp).getTime();
    if (isNaN(eventTime)) {
      return { valid: false, reason: "Invalid ISO timestamp in payload" };
    }

    const currentTime = options.now ?? Date.now();
    const ageSeconds = Math.abs((currentTime - eventTime) / 1000);

    if (ageSeconds > tolerance) {
      return {
        valid: false,
        reason: `Timestamp outside tolerance window (${Math.round(ageSeconds)}s > ${tolerance}s)`,
      };
    }
  }

  return {
    valid: true,
    payload: {
      event: String(parsed.event ?? ""),
      timestamp: String(parsed.timestamp ?? ""),
      data: (parsed.data as Record<string, unknown>) ?? {},
      signature: typeof parsed.signature === "string" ? parsed.signature : undefined,
    },
  };
}
