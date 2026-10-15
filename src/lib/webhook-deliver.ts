// SPDX-License-Identifier: MIT

import { logger } from "@/lib/logger";
import { incMetric } from "@/lib/metrics-counters";
import { isSafeWebhookUrlAtDelivery } from "@/lib/webhook-url-guard";
import { RETRY_CONFIG } from "@/lib/retry-config";
import {
  fetchWithTimeout,
  getWebhookTimeoutMs,
  isTimeoutError,
} from "@/lib/timeout";
import crypto from "crypto";
import prisma from "@/lib/prisma";
import { toWebhookPayload } from "@/lib/webhook-event-store";
import type { DeliveryStatus } from "@prisma/client";

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

export async function deliverWebhook(
  url: string,
  secret: string,
  payload: WebhookPayload,
  maxRetries: number = RETRY_CONFIG.webhook.maxAttempts
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
    try {
      // Explicit, configurable timeout + AbortSignal (issue #747): a hung
      // endpoint aborts here instead of blocking the request budget.
      const response = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: request.headers,
          body: request.body,
          redirect: "manual",
        },
        { timeoutMs: getWebhookTimeoutMs(), label: "Webhook delivery" }
      );
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
      lastError = isTimeoutError(err)
        ? `Webhook delivery timed out after ${getWebhookTimeoutMs()}ms`
        : err instanceof Error
          ? err.message
          : String(err);
      logger.warn("Webhook delivery error", { url, error: lastError, attempt });
    }

    if (attempt < maxRetries) {
      const delayMs = Math.min(
        RETRY_CONFIG.webhook.maxDelayMs,
        RETRY_CONFIG.webhook.baseDelayMs * 2 ** (attempt - 1),
      );
      await new Promise((r) => setTimeout(r, delayMs));
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

export async function deliverWebhookWithDetails(
  url: string,
  secret: string,
  payload: WebhookPayload,
  maxRetries: number = RETRY_CONFIG.webhook.maxAttempts
): Promise<WebhookDeliveryDetails> {
  return deliverWebhook(url, secret, payload, maxRetries);
}

// ── Dead-Letter Queue (DLQ) & Requeue Helpers ───────────────────

export interface RequeueDeliveryOptions {
  /**
   * If true, immediately attempts delivery instead of leaving the row in PENDING state.
   * Defaults to false (leaves row in PENDING with attempts: 0 for worker processing).
   */
  deliverImmediately?: boolean;
}

export interface RequeueResult {
  id: string;
  deliveryId: string;
  status: DeliveryStatus;
  attempts: number;
  eventId: string;
  eventTimestamp: string;
  correlationId: string;
  delivered: boolean;
  statusCode?: number | null;
  errorMessage?: string | null;
}

export interface RequeueFilterOptions {
  webhookId?: string;
  statusCode?: number | "timeout";
  statusCodes?: number[];
  timeoutOnly?: boolean;
  deliveryIds?: string[];
  deliverImmediately?: boolean;
  limit?: number;
}

/**
 * Requeue a single failed/dead-lettered webhook delivery.
 * Resets attempt count to 0 and transitions status to PENDING.
 * Preserves the original event timestamp and correlation ID.
 */
export async function requeueWebhookDelivery(
  deliveryId: string,
  options?: RequeueDeliveryOptions
): Promise<RequeueResult> {
  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: {
      webhook: true,
      event: true,
    },
  });

  if (!delivery) {
    throw new Error(`Webhook delivery not found: ${deliveryId}`);
  }

  // Reset attempt count and set status to PENDING upon requeue
  await prisma.webhookDelivery.update({
    where: { id: deliveryId },
    data: {
      status: "PENDING",
      attempts: 0,
      errorMessage: null,
      error: null,
    },
  });

  const correlationId = delivery.eventId;
  const eventPayload = toWebhookPayload(delivery.event);

  if (options?.deliverImmediately) {
    const result = await deliverWebhook(
      delivery.webhook.url,
      delivery.webhook.secret,
      eventPayload
    );

    const finalStatus: DeliveryStatus = result.success ? "SUCCESS" : "DEAD_LETTER";
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: finalStatus,
        responseCode: result.statusCode ?? null,
        latencyMs: result.latencyMs,
        attempts: result.attempts,
        errorMessage: result.errorMessage ?? null,
        deliveredAt: new Date(),
      },
    });

    return {
      id: deliveryId,
      deliveryId,
      status: finalStatus,
      attempts: result.attempts,
      eventId: delivery.eventId,
      eventTimestamp: delivery.event.timestamp.toISOString(),
      correlationId,
      delivered: result.success,
      statusCode: result.statusCode ?? null,
      errorMessage: result.errorMessage ?? null,
    };
  }

  return {
    id: deliveryId,
    deliveryId,
    status: "PENDING",
    attempts: 0,
    eventId: delivery.eventId,
    eventTimestamp: delivery.event.timestamp.toISOString(),
    correlationId,
    delivered: false,
    statusCode: null,
    errorMessage: null,
  };
}

/**
 * Filter and requeue dead-lettered / failed deliveries for a webhook or system-wide.
 * Supports filtering by HTTP status code, timeout errors, or specific IDs.
 */
export async function requeueFailedDeliveries(
  options: RequeueFilterOptions
): Promise<RequeueResult[]> {
  const where: Record<string, unknown> = {
    status: { in: ["DEAD_LETTER", "FAILED"] },
  };

  if (options.webhookId) {
    where.webhookId = options.webhookId;
  }

  if (options.deliveryIds && options.deliveryIds.length > 0) {
    where.id = { in: options.deliveryIds };
  }

  if (options.timeoutOnly || options.statusCode === "timeout") {
    where.OR = [
      { errorMessage: { contains: "timed out" } },
      { error: { contains: "timed out" } },
      { errorMessage: { contains: "timeout" } },
      { error: { contains: "timeout" } },
    ];
  } else if (typeof options.statusCode === "number") {
    where.responseCode = options.statusCode;
  } else if (options.statusCodes && options.statusCodes.length > 0) {
    where.responseCode = { in: options.statusCodes };
  }

  const deliveries = await prisma.webhookDelivery.findMany({
    where,
    orderBy: { deliveredAt: "desc" },
    take: options.limit ?? 50,
    select: { id: true },
  });

  const results: RequeueResult[] = [];
  for (const del of deliveries) {
    const res = await requeueWebhookDelivery(del.id, {
      deliverImmediately: options.deliverImmediately,
    });
    results.push(res);
  }

  return results;
}

/**
 * Retry worker: processes all PENDING webhook deliveries.
 * Invoked by background workers or schedulers to drain the retry queue.
 */
export async function processPendingWebhookDeliveries(
  limit = 50
): Promise<RequeueResult[]> {
  const pending = await prisma.webhookDelivery.findMany({
    where: { status: "PENDING" },
    include: { webhook: true, event: true },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  const results: RequeueResult[] = [];
  for (const item of pending) {
    if (!item.webhook.isActive) continue;
    const res = await requeueWebhookDelivery(item.id, { deliverImmediately: true });
    results.push(res);
  }

  return results;
}

