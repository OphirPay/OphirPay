// SPDX-License-Identifier: MIT
//
// Webhook HTTP delivery with retry — the single implementation of the
// outbound POST, exponential backoff and SSRF re-validation.
//
// Every attempt re-runs the URL guard (`url-safety.ts`) immediately before the
// fetch, so a DNS rebind between registration and delivery cannot slip a
// private address through. Redirects are refused (`redirect: "manual"`) so a
// 3xx hop cannot swap a public destination for an internal one.

import { logger } from "@/lib/logger";
import { incMetric } from "@/lib/metrics-counters";
import { isSafeWebhookUrlAtDelivery } from "./url-safety";
import { buildWebhookRequestPreview } from "./signing";
import type { WebhookDeliveryDetails, WebhookPayload } from "./types";

export const BLOCKED_WEBHOOK_TARGET_ERROR =
  "Webhook target rejected by the SSRF guard — URL resolves to a private/internal address or a disallowed port";

/**
 * Deliver a webhook event to a registered endpoint with retries and signing.
 *
 * @param url       Destination URL (re-validated on every attempt).
 * @param secret    HMAC signing secret.
 * @param payload   Event envelope to sign and POST.
 * @param maxRetries Maximum attempts (default 3, backoff 1s/2s/4s).
 */
export async function deliverWebhook(
  url: string,
  secret: string,
  payload: WebhookPayload,
  maxRetries = 3
): Promise<WebhookDeliveryDetails> {
  const startedAt = Date.now();
  const request = buildWebhookRequestPreview(payload, secret);
  let lastStatusCode: number | undefined;
  let lastResponseBody = "";
  let lastError: string | undefined;
  let attempts = 0;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    if (!(await isSafeWebhookUrlAtDelivery(url))) {
      logger.error(
        "Webhook delivery blocked — URL resolved to a private/internal address or a disallowed port",
        { url, attempt }
      );
      incMetric("webhooks_failed_total");
      const latencyMs = Date.now() - startedAt;
      return {
        success: false,
        statusCode: lastStatusCode,
        latencyMs,
        attempts,
        errorMessage: BLOCKED_WEBHOOK_TARGET_ERROR,
        delivered: false,
        status: lastStatusCode ?? null,
        responseBody: lastResponseBody,
        durationMs: latencyMs,
        blocked: true,
        error: BLOCKED_WEBHOOK_TARGET_ERROR,
        request,
      };
    }

    attempts = attempt;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: request.headers,
        body: request.body,
        signal: controller.signal,
        redirect: "manual",
      });
      const responseBody = typeof response.text === "function" ? await response.text() : "";
      lastResponseBody = responseBody;
      lastStatusCode = response.status;

      if (response.ok) {
        logger.info("Webhook delivered", { url, event: payload.event, attempt });
        incMetric("webhooks_delivered_total");
        const latencyMs = Date.now() - startedAt;
        return {
          success: true,
          statusCode: response.status,
          latencyMs,
          attempts: attempt,
          delivered: true,
          status: response.status,
          responseBody,
          durationMs: latencyMs,
          blocked: false,
          error: null,
          request,
        };
      }

      lastError = `HTTP ${response.status}`;
      logger.warn("Webhook delivery failed", { url, status: response.status, attempt });
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      logger.warn("Webhook delivery error", { url, error: lastError, attempt });
    } finally {
      clearTimeout(timeout);
    }

    if (attempt < maxRetries) {
      await new Promise((r) => setTimeout(r, Math.pow(2, attempt - 1) * 1000));
    }
  }

  logger.error("Webhook delivery exhausted retries", { url, event: payload.event });
  incMetric("webhooks_failed_total");
  const latencyMs = Date.now() - startedAt;
  return {
    success: false,
    statusCode: lastStatusCode,
    latencyMs,
    attempts: maxRetries,
    errorMessage: lastError ?? "Delivery exhausted retries",
    delivered: false,
    status: lastStatusCode ?? null,
    responseBody: lastResponseBody,
    durationMs: latencyMs,
    blocked: false,
    error: lastError ?? "Delivery exhausted retries",
    request,
  };
}

/**
 * Alias kept for the delivery-test route, which wants the full per-attempt
 * detail (response body, duration, whether the guard blocked the target).
 */
export async function deliverWebhookWithDetails(
  url: string,
  secret: string,
  payload: WebhookPayload,
  maxRetries = 3
): Promise<WebhookDeliveryDetails> {
  return deliverWebhook(url, secret, payload, maxRetries);
}
