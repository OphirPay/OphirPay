// SPDX-License-Identifier: MIT
//
// Webhook signing — the *only* place the HMAC-SHA256 scheme lives.
//
// The signature covers `<timestamp>.<canonical body>` where the canonical body
// is the JSON payload with the `signature` field emptied (not removed). The
// timestamp is part of the signed material so the `X-OphirPay-Timestamp`
// header cannot be edited without invalidating the signature. See
// `docs/webhook-verification.md` for the receiver-side recipe.

import crypto from "crypto";
import type { WebhookPayload, WebhookRequestPreview } from "./types";

export const WEBHOOK_TIMESTAMP_HEADER = "X-OphirPay-Timestamp";
export const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 300;

/** The byte string actually signed: `<timestamp>.<canonical body>`. */
export function webhookSignedInput(
  timestamp: string,
  canonicalBody: string
): string {
  return `${timestamp}.${canonicalBody}`;
}

/**
 * Serialize the payload with the `signature` field emptied. The receiver must
 * reproduce this exact string (same key order, `"signature":""` present).
 */
export function canonicalizeWebhookBody(payload: WebhookPayload): string {
  return JSON.stringify({ ...payload, signature: "" });
}

/** HMAC-SHA256 (hex) over the timestamp-prefixed canonical body. */
export function signWebhookPayload(payload: WebhookPayload, secret: string): string {
  const canonical = canonicalizeWebhookBody(payload);
  return crypto
    .createHmac("sha256", secret)
    .update(webhookSignedInput(payload.timestamp, canonical))
    .digest("hex");
}

/**
 * Build the exact HTTP body that will be transmitted and sign it, so a
 * receiver verifying the HMAC over the received body always matches.
 */
export function buildSignedPayload(
  payload: WebhookPayload,
  secret: string
): { body: string; signature: string; timestamp: string } {
  const timestamp = payload.timestamp;
  const canonical = canonicalizeWebhookBody(payload);
  const signature = crypto
    .createHmac("sha256", secret)
    .update(webhookSignedInput(timestamp, canonical))
    .digest("hex");
  return { body: JSON.stringify({ ...payload, signature }), signature, timestamp };
}

/**
 * Build the full request (headers + body + signature) a delivery would send.
 * Used by the delivery path and by the dashboard's "test webhook" preview so
 * both show byte-identical requests.
 */
export function buildWebhookRequestPreview(
  payload: WebhookPayload,
  secret: string
): WebhookRequestPreview {
  const { body, signature, timestamp } = buildSignedPayload(payload, secret);
  return {
    canonicalBody: canonicalizeWebhookBody(payload),
    body,
    signature,
    headers: {
      "Content-Type": "application/json",
      "X-OphirPay-Signature": signature,
      "X-OphirPay-Event": payload.event,
      [WEBHOOK_TIMESTAMP_HEADER]: timestamp,
    },
  };
}
