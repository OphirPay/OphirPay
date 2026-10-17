// SPDX-License-Identifier: MIT

import crypto from "crypto";
import { WEBHOOK_EVENTS, type WebhookEventType } from "@/app/api/webhooks/event-types";
import {
  WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS,
  webhookSignedInput,
  type WebhookPayload,
} from "@/lib/webhook-deliver";

/** Maximum accepted raw webhook body size (1 MiB) to guard against DoS. */
export const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024;

/**
 * Build a realistic but clearly-fake sample payload for an integrator test
 * event. No real payment/record is created server-side — the `test` flag
 * (on both the envelope and the data) lets receivers skip side effects.
 *
 * @param event The event type to simulate. Defaults to `payment.completed`.
 */
export function buildTestWebhookPayload(
  event: WebhookEventType = WEBHOOK_EVENTS.PAYMENT_COMPLETED,
  timestamp = new Date().toISOString(),
): WebhookPayload {
  return {
    event,
    timestamp,
    test: true,
    data: {
      test: true,
      paymentId: "test_payment_000000000000000000000000",
      amount: "25.00",
      assetCode: "USDC",
      assetIssuer: "GA5ZSEJ4KZ3P4P6XWJLZ4TLQUDV6C6PDU4XJ7BCVQZ4TVPULZNK3WYJ",
      status: "COMPLETED",
      description: "OphirPay test event — no real payment was created",
      createdAt: timestamp,
    },
  };
}

/**
 * Parse and validate an `X-OphirPay-Signature` header value.
 * Rejects missing headers, duplicate header arrays, comma-joined multi-values,
 * non-hex strings, and non-64-character SHA-256 hex digests. Never throws.
 */
export function parseSignatureHeader(headerValue: unknown): string | null {
  if (typeof headerValue !== "string") {
    return null;
  }
  const trimmed = headerValue.trim();
  if (!trimmed || trimmed.includes(",") || trimmed.includes("\0")) {
    return null;
  }
  const normalized = trimmed.toLowerCase().startsWith("sha256=")
    ? trimmed.slice(7).trim()
    : trimmed;

  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    return null;
  }
  return normalized.toLowerCase();
}

export interface VerifyWebhookSignatureOptions {
  /** Explicit `X-OphirPay-Timestamp` header override. */
  timestampHeader?: unknown;
  /** Reference clock in milliseconds for replay-window enforcement. */
  nowMs?: number;
  /** Maximum clock skew / replay window in seconds (defaults to 300s). */
  toleranceSeconds?: number;
  /** Maximum raw body byte length (defaults to 1 MiB). */
  maxBodyBytes?: number;
}

/**
 * Constant-time, exception-safe webhook signature and payload verifier (#1299).
 *
 * Resilient against malformed unicode, null bytes, truncated or oversized JSON
 * payloads, duplicate/missing headers, and timing side-channels. Always returns
 * `false` on any invalid or malformed input and never throws.
 */
export function verifySignature(
  rawBody: unknown,
  signatureHeader: unknown,
  secret: unknown,
  options: VerifyWebhookSignatureOptions = {},
): boolean {
  try {
    if (typeof rawBody !== "string" || rawBody.length === 0) {
      return false;
    }
    if (typeof secret !== "string" || secret.length === 0) {
      return false;
    }

    const maxBytes = options.maxBodyBytes ?? MAX_WEBHOOK_BODY_BYTES;
    if (Buffer.byteLength(rawBody, "utf8") > maxBytes) {
      return false;
    }

    const providedHex = parseSignatureHeader(signatureHeader);
    if (!providedHex) {
      return false;
    }

    const parsed = JSON.parse(rawBody) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return false;
    }

    const record = parsed as Record<string, unknown>;
    const timestamp =
      typeof options.timestampHeader === "string" && options.timestampHeader.trim().length > 0
        ? options.timestampHeader.trim()
        : typeof record.timestamp === "string"
          ? record.timestamp
          : "";

    if (!timestamp || timestamp.includes("\0")) {
      return false;
    }

    if (options.nowMs !== undefined) {
      const tolerance = options.toleranceSeconds ?? WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS;
      const parsedTimeMs = Date.parse(timestamp);
      const numericSeconds = Number(timestamp);
      const timestampMs = Number.isFinite(parsedTimeMs)
        ? parsedTimeMs
        : Number.isFinite(numericSeconds)
          ? numericSeconds * 1000
          : NaN;

      if (!Number.isFinite(timestampMs)) {
        return false;
      }
      const skewSeconds = Math.abs(options.nowMs - timestampMs) / 1000;
      if (skewSeconds > tolerance) {
        return false;
      }
    }

    const canonical = JSON.stringify({ ...record, signature: "" });
    const expectedHex = crypto
      .createHmac("sha256", secret)
      .update(webhookSignedInput(timestamp, canonical))
      .digest("hex");

    const expectedBuf = Buffer.from(expectedHex, "hex");
    const providedBuf = Buffer.from(providedHex, "hex");
    if (expectedBuf.length !== providedBuf.length || expectedBuf.length !== 32) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuf, providedBuf);
  } catch {
    return false;
  }
}
