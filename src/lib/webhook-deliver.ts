// SPDX-License-Identifier: MIT

import { logger } from "@/lib/logger";
import {
  incMetric,
  incDeliveryAttempt,
  incDeliveryFinalOutcome,
} from "@/lib/metrics-counters";
import { isSafeWebhookUrlAtDelivery } from "@/lib/webhook-url-guard";
import crypto from "crypto";

export const DEFAULT_WEBHOOK_TIMEOUT_MS = 5000;

export interface WebhookPayload {
  event: string;
  timestamp: string;
  data: Record<string, unknown>;
  /** Present and true only for integrator test events — never real payments. */
  test?: boolean;
}

export interface WebhookDeliveryOptions {
  maxRetries?: number;
  timeoutMs?: number;
}

export interface WebhookDeliveryResult {
  success: boolean;
  statusCode?: number;
  latencyMs: number;
  attempts: number;
  errorMessage?: string;
  isDeadLetter?: boolean;
  timedOut?: boolean;
  lastResponseSnippet?: string;
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
 * Deliver a webhook event to a registered endpoint with bounded per-attempt timeout,
 * exponential retries, dead-letter routing upon exhaustion, and HMAC signing.
 * Returns delivery outcome including HTTP status and distinct failure reasons.
 */
export async function deliverWebhook(
  url: string,
  secret: string,
  payload: WebhookPayload,
  maxRetriesOrOptions: number | WebhookDeliveryOptions = 3,
  legacyTimeoutMs = DEFAULT_WEBHOOK_TIMEOUT_MS
): Promise<WebhookDeliveryResult> {
  const startedAt = Date.now();
  const maxRetries =
    typeof maxRetriesOrOptions === "object"
      ? maxRetriesOrOptions.maxRetries ?? 3
      : maxRetriesOrOptions;
  const timeoutMs =
    typeof maxRetriesOrOptions === "object"
      ? maxRetriesOrOptions.timeoutMs ?? DEFAULT_WEBHOOK_TIMEOUT_MS
      : legacyTimeoutMs;

  const { body, signature } = buildSignedPayload(payload, secret);

  // Re-validate the destination at delivery time to mitigate DNS rebinding.
  if (!(await isSafeWebhookUrlAtDelivery(url))) {
    logger.error("Webhook delivery blocked — URL resolved to a private/internal address", { url });
    incMetric("webhooks_failed_total");
    incDeliveryFinalOutcome("webhook", 1, "failure");
    return {
      success: false,
      attempts: 0,
      latencyMs: Date.now() - startedAt,
      errorMessage: "URL resolved to a private/internal address",
      isDeadLetter: true,
      timedOut: false,
    };
  }

  let lastStatusCode: number | undefined;
  let lastError: string | undefined;
  let lastResponseSnippet: string | undefined;
  let hasTimedOut = false;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    incDeliveryAttempt("webhook", attempt);
    let isTimeout = false;
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => {
      isTimeout = true;
      controller.abort();
    }, timeoutMs);

    try {
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

      clearTimeout(timeoutHandle);
      lastStatusCode = response.status;

      if (response.ok) {
        logger.info("Webhook delivered", { url, event: payload.event, attempt });
        incMetric("webhooks_delivered_total");
        incDeliveryFinalOutcome("webhook", attempt, "success");
        return {
          success: true,
          statusCode: response.status,
          latencyMs: Date.now() - startedAt,
          attempts: attempt,
          isDeadLetter: false,
          timedOut: false,
        };
      }

      // Read response snippet for failure diagnosis
      try {
        const text = await response.text();
        lastResponseSnippet = text.slice(0, 500);
      } catch {
        // stream already consumed or non-text
      }

      lastError = `HTTP ${response.status}`;
      logger.warn("Webhook delivery failed", { url, status: response.status, attempt });
    } catch (err: unknown) {
      clearTimeout(timeoutHandle);
      if (
        isTimeout ||
        (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError"))
      ) {
        lastError = `TIMEOUT: Delivery attempt timed out after ${timeoutMs}ms`;
        hasTimedOut = true;
        incMetric("webhooks_timeout_total");
      } else {
        lastError = err instanceof Error ? err.message : String(err);
      }
      logger.warn("Webhook delivery error", { url, error: lastError, attempt });
    }

    if (attempt < maxRetries) {
      await new Promise((r) => setTimeout(r, Math.pow(2, attempt - 1) * 1000));
    }
  }

  logger.error("Webhook delivery exhausted retries — moved to dead-letter queue", {
    url,
    event: payload.event,
    attempts: maxRetries,
    lastError,
  });

  incMetric("webhooks_failed_total");
  incMetric("webhooks_dead_letter_total");
  incDeliveryFinalOutcome("webhook", maxRetries, "dead_letter");

  return {
    success: false,
    statusCode: lastStatusCode,
    latencyMs: Date.now() - startedAt,
    attempts: maxRetries,
    errorMessage: lastError ?? "Delivery exhausted retries",
    isDeadLetter: true,
    timedOut: hasTimedOut,
    lastResponseSnippet,
  };
}
