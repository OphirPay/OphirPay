// SPDX-License-Identifier: MIT

import { logger } from "@/lib/logger";
import { incMetric } from "@/lib/metrics-counters";
import { isSafeWebhookUrlAtDelivery } from "@/lib/webhook-url-guard";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { RETRY_CONFIG } from "@/lib/retry-config";
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
  maxRetries = RETRY_CONFIG.webhook.maxAttempts
): Promise<WebhookDeliveryResult> {
  const startedAt = Date.now();
  const { body, signature } = buildSignedPayload(payload, secret);

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
      const response = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-OphirPay-Signature": signature,
            "X-OphirPay-Event": payload.event,
          },
          body,
          redirect: "manual",
        },
        RETRY_CONFIG.webhook.timeoutMs,
      );

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
      const backoffMs = Math.min(
        Math.pow(2, attempt - 1) * RETRY_CONFIG.webhook.baseDelayMs,
        RETRY_CONFIG.webhook.maxDelayMs,
      );
      await new Promise((r) => setTimeout(r, backoffMs));
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
