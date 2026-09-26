// SPDX-License-Identifier: MIT

import { logger } from "@/lib/logger";
import { incMetric } from "@/lib/metrics-counters";
import { isSafeWebhookUrlAtDelivery } from "@/lib/webhook-url-guard";
import crypto from "crypto";

export interface WebhookPayload {
  event: string;
  timestamp: string;
  data: Record<string, unknown>;
  /** Present and true only for integrator test events — never real payments. */
  test?: boolean;
}

export interface WebhookDeliveryResult {
  success: boolean;
  statusCode?: number;
  latencyMs: number;
  attempts: number;
  errorMessage?: string;
}

/**
 * Header carrying the delivery timestamp (issue #702). Its value is part of
 * the signed material, so a receiver can trust it for replay protection
 * instead of trusting an unsigned header.
 */
export const WEBHOOK_TIMESTAMP_HEADER = "X-OphirPay-Timestamp";

/**
 * Advertised freshness window for a delivery, in seconds. Retries reuse the
 * same payload and signature (1s/2s/4s backoff), so any window over ~10s
 * comfortably covers the retry span; 300s additionally absorbs clock skew.
 */
export const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 300;

/**
 * The exact byte string the HMAC covers: `<timestamp>.<canonicalBody>`.
 *
 * Binding the timestamp *outside* the JSON body (in addition to it being a
 * field of the body) means the `X-OphirPay-Timestamp` header is authenticated
 * too — a captured delivery cannot be re-dated by editing the header, and a
 * receiver that only trusts the header still verifies the body.
 */
export function webhookSignedInput(
  timestamp: string,
  canonicalBody: string
): string {
  return `${timestamp}.${canonicalBody}`;
}

/**
 * Build the canonical string a receiver must sign: the body serialized with
 * the `signature` field emptied (key order preserved).
 */
export function canonicalizeWebhookBody(payload: WebhookPayload): string {
  return JSON.stringify({ ...payload, signature: "" });
}

/**
 * Delivery error surfaced when the SSRF guard refuses a target. Kept
 * descriptive so an operator can tell a blocked destination apart from a
 * network failure (issue #706).
 */
export const BLOCKED_WEBHOOK_TARGET_ERROR =
  "Webhook target rejected by the SSRF guard — URL resolves to a private/internal address or a disallowed port";

/**
 * Generate HMAC-SHA256 signature for a webhook payload.
 * Receiving endpoints can verify authenticity by recomputing the signature.
 */
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
 *
 * Canonicalization: the HMAC is computed over
 * `<timestamp>.<body with the signature field emptied>`. A receiver
 * recomputes identically: take the `X-OphirPay-Timestamp` header value, parse
 * the received body, empty the `signature` field, re-serialize (stable key
 * order), prepend the timestamp and a dot, and compare against the
 * `X-OphirPay-Signature` header.
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
 * Deliver a webhook event to a registered endpoint with retries and signing.
 * Returns delivery outcome including HTTP status when available.
 */
export async function deliverWebhook(
  url: string,
  secret: string,
  payload: WebhookPayload,
  maxRetries = 3
): Promise<WebhookDeliveryResult> {
  const startedAt = Date.now();
  const { body, signature, timestamp } = buildSignedPayload(payload, secret);

  let lastStatusCode: number | undefined;
  let lastError: string | undefined;
  // Number of attempts actually made. A target refused on the first check
  // records 0; a target that resolves privately on a later retry records the
  // attempts already spent.
  let attempts = 0;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // Re-resolve and re-validate immediately before every attempt. DNS can
    // change between registration and delivery (or between retries), so the
    // allow/deny decision must be made against the address this attempt is
    // about to connect to — not once per registration.
    if (!(await isSafeWebhookUrlAtDelivery(url))) {
      logger.error(
        "Webhook delivery blocked — URL resolved to a private/internal address or a disallowed port",
        { url, attempt }
      );
      incMetric("webhooks_failed_total");
      return {
        success: false,
        statusCode: lastStatusCode,
        latencyMs: Date.now() - startedAt,
        attempts,
        errorMessage: BLOCKED_WEBHOOK_TARGET_ERROR,
      };
    }

    attempts = attempt;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-OphirPay-Signature": signature,
          "X-OphirPay-Event": payload.event,
          // Part of the signed material (see `webhookSignedInput`) — receivers
          // use it for the replay-freshness window.
          [WEBHOOK_TIMESTAMP_HEADER]: timestamp,
        },
        body,
        signal: controller.signal,
        redirect: "manual",
      });

      clearTimeout(timeout);
      lastStatusCode = response.status;

      if (response.ok) {
        logger.info("Webhook delivered", { url, event: payload.event, attempt });
        incMetric("webhooks_delivered_total");
        return {
          success: true,
          statusCode: response.status,
          latencyMs: Date.now() - startedAt,
          attempts: attempt,
        };
      }

      lastError = `HTTP ${response.status}`;
      logger.warn("Webhook delivery failed", { url, status: response.status, attempt });
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      logger.warn("Webhook delivery error", { url, error: lastError, attempt });
    }

    if (attempt < maxRetries) {
      await new Promise((r) => setTimeout(r, Math.pow(2, attempt - 1) * 1000));
    }
  }

  logger.error("Webhook delivery exhausted retries", { url, event: payload.event });
  incMetric("webhooks_failed_total");
  return {
    success: false,
    statusCode: lastStatusCode,
    latencyMs: Date.now() - startedAt,
    attempts: maxRetries,
    errorMessage: lastError ?? "Delivery exhausted retries",
  };
}
