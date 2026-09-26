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

export const WEBHOOK_TIMESTAMP_HEADER = "X-OphirPay-Timestamp";
export const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 300;

export function webhookSignedInput(
  timestamp: string,
  canonicalBody: string
): string {
  return `${timestamp}.${canonicalBody}`;
}

export function canonicalizeWebhookBody(payload: WebhookPayload): string {
  return JSON.stringify({ ...payload, signature: "" });
}

export const BLOCKED_WEBHOOK_TARGET_ERROR =
  "Webhook target rejected by the SSRF guard — URL resolves to a private/internal address or a disallowed port";

export function signWebhookPayload(payload: WebhookPayload, secret: string): string {
  const canonical = canonicalizeWebhookBody(payload);
  return crypto
    .createHmac("sha256", secret)
    .update(webhookSignedInput(payload.timestamp, canonical))
    .digest("hex");
}

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

export interface WebhookRequestPreview {
  canonicalBody: string;
  body: string;
  signature: string;
  headers: Record<string, string>;
}

export interface WebhookDeliveryDetails extends WebhookDeliveryResult {
  delivered: boolean;
  status: number | null;
  responseBody: string;
  durationMs: number;
  blocked: boolean;
  error: string | null;
  request: WebhookRequestPreview;
}

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

/**
 * Deliver a webhook event to a registered endpoint with bounded per-attempt timeout,
 * exponential retries, dead-letter routing upon exhaustion, SSRF checks, and HMAC signing.
 * Returns delivery outcome including HTTP status and distinct failure reasons.
 */
export async function deliverWebhook(
  url: string,
  secret: string,
  payload: WebhookPayload,
  maxRetriesOrOptions: number | WebhookDeliveryOptions = 3,
  legacyTimeoutMs = DEFAULT_WEBHOOK_TIMEOUT_MS
): Promise<WebhookDeliveryDetails> {
  const startedAt = Date.now();
  const maxRetries =
    typeof maxRetriesOrOptions === "object"
      ? maxRetriesOrOptions.maxRetries ?? 3
      : maxRetriesOrOptions;
  const timeoutMs =
    typeof maxRetriesOrOptions === "object"
      ? maxRetriesOrOptions.timeoutMs ?? DEFAULT_WEBHOOK_TIMEOUT_MS
      : legacyTimeoutMs;

  const request = buildWebhookRequestPreview(payload, secret);
  let lastStatusCode: number | undefined;
  let lastResponseBody = "";
  let lastError: string | undefined;
  let lastResponseSnippet: string | undefined;
  let hasTimedOut = false;
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
        headers: request.headers,
        body: request.body,
        signal: controller.signal,
        redirect: "manual",
      });

      clearTimeout(timeoutHandle);
      const responseBody = typeof response.text === "function" ? await response.text() : "";
      lastResponseBody = responseBody;
      lastResponseSnippet = responseBody.slice(0, 500);
      lastStatusCode = response.status;

      if (response.ok) {
        logger.info("Webhook delivered", { url, event: payload.event, attempt });
        incMetric("webhooks_delivered_total");
        incDeliveryFinalOutcome("webhook", attempt, "success");
        const latencyMs = Date.now() - startedAt;
        return {
          success: true,
          statusCode: response.status,
          latencyMs,
          attempts: attempt,
          isDeadLetter: false,
          timedOut: false,
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

  const latencyMs = Date.now() - startedAt;
  return {
    success: false,
    statusCode: lastStatusCode,
    latencyMs,
    attempts: maxRetries,
    errorMessage: lastError ?? "Delivery exhausted retries",
    isDeadLetter: true,
    timedOut: hasTimedOut,
    lastResponseSnippet,
    delivered: false,
    status: lastStatusCode ?? null,
    responseBody: lastResponseBody,
    durationMs: latencyMs,
    blocked: false,
    error: lastError ?? "Delivery exhausted retries",
    request,
  };
}

export async function deliverWebhookWithDetails(
  url: string,
  secret: string,
  payload: WebhookPayload,
  maxRetries = 3
): Promise<WebhookDeliveryDetails> {
  return deliverWebhook(url, secret, payload, maxRetries);
}
