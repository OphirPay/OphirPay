// SPDX-License-Identifier: MIT

import { logger } from "@/lib/logger";
import {
  incDeliveryAttempt,
  incDeliveryFinalOutcome,
  incMetric,
} from "@/lib/metrics-counters";
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
 * Generate HMAC-SHA256 signature for a webhook payload.
 * Receiving endpoints can verify authenticity by recomputing the signature.
 */
export function signWebhookPayload(payload: WebhookPayload, secret: string): string {
  const body = JSON.stringify(payload);
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

/**
 * Build the exact HTTP body that will be transmitted and sign it, so a
 * receiver verifying the HMAC over the received body always matches.
 *
 * Canonicalization: the HMAC is computed over the body with the signature
 * field emptied — `JSON.stringify({...payload, signature: ""})`. A receiver
 * recomputes identically: parse the received body, empty the `signature`
 * field, re-serialize (stable key order), and compare against the
 * `X-OphirPay-Signature` header.
 */
export function buildSignedPayload(
  payload: WebhookPayload,
  secret: string
): { body: string; signature: string } {
  const canonical = JSON.stringify({ ...payload, signature: "" });
  const signature = crypto
    .createHmac("sha256", secret)
    .update(canonical)
    .digest("hex");
  return { body: JSON.stringify({ ...payload, signature }), signature };
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
): Promise<{ success: boolean; statusCode?: number }> {
  const { body, signature } = buildSignedPayload(payload, secret);
  const totalAttempts = Number.isFinite(maxRetries)
    ? Math.max(1, Math.floor(maxRetries))
    : 1;

  // Re-validate the destination at delivery time to mitigate DNS rebinding.
  if (!(await isSafeWebhookUrlAtDelivery(url))) {
    logger.error("Webhook delivery blocked — URL resolved to a private/internal address", { url });
    incMetric("webhooks_failed_total");
    return { success: false };
  }

  let lastStatusCode: number | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      // `redirect: "manual"` closes the SSRF redirect bypass: without it the
      // default fetch behavior follows 3xx hops to internal addresses (e.g.
      // http://169.254.169.254) even after the initial URL passed the guard.
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-OphirPay-Signature": signature,
          "X-OphirPay-Event": payload.event,
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
        return { success: true, statusCode: response.status };
      }

      lastError = `HTTP ${response.status}`;
      logger.warn("Webhook delivery failed", { url, status: response.status, attempt });
    } catch (err) {
      logger.warn("Webhook delivery error", { url, error: String(err), attempt });
    } finally {
      clearTimeout(timeout);
    }

    // Exponential backoff: 1s, 2s, 4s
    if (attempt < totalAttempts) {
      await new Promise((r) => setTimeout(r, Math.pow(2, attempt - 1) * 1000));
    }
  }

  logger.error("Webhook delivery exhausted retries", { url, event: payload.event });
  incMetric("webhooks_failed_total");
  return { success: false, statusCode: lastStatusCode };
}
