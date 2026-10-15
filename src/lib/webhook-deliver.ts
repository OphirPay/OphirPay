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

/**
 * Constant-time comparison between two string digests or signatures.
 *
 * Prevents timing side-channel attacks by comparing byte buffers using
 * `crypto.timingSafeEqual`. Ensures both buffers have identical length
 * before executing the comparison, returning false without throwing if
 * lengths differ or inputs are invalid.
 */
export function timingSafeEqualSignatures(sigA: string, sigB: string): boolean {
  if (typeof sigA !== "string" || typeof sigB !== "string") {
    return false;
  }
  try {
    const bufA = Buffer.from(sigA);
    const bufB = Buffer.from(sigB);
    if (bufA.length === 0 || bufB.length === 0 || bufA.length !== bufB.length) {
      return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

export interface VerifyWebhookSignatureOptions {
  payload?: WebhookPayload;
  rawBody?: string;
  signature: string;
  secret: string;
  timestamp?: string;
  maxAgeSeconds?: number;
  now?: Date;
}

export interface WebhookVerificationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Verifies an OphirPay webhook signature against a payload or raw body string.
 *
 * Performs constant-time comparison via `crypto.timingSafeEqual` after length
 * verification, preventing byte-by-byte timing attacks. Also enforces replay
 * protection via the timestamp freshness window.
 */
export function verifyWebhookSignature({
  payload,
  rawBody,
  signature,
  secret,
  timestamp,
  maxAgeSeconds = WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS,
  now = new Date(),
}: VerifyWebhookSignatureOptions): WebhookVerificationResult {
  if (!signature || typeof signature !== "string") {
    return { valid: false, reason: "Missing or invalid signature" };
  }
  if (!secret || typeof secret !== "string") {
    return { valid: false, reason: "Missing or invalid secret" };
  }

  let parsed: WebhookPayload;
  let canonical: string;

  try {
    if (rawBody !== undefined) {
      const decoded = JSON.parse(rawBody);
      if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
        return { valid: false, reason: "Body must be a valid JSON object" };
      }
      parsed = decoded as WebhookPayload;
      canonical = canonicalizeWebhookBody(parsed);
    } else if (payload !== undefined) {
      if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
        return { valid: false, reason: "Payload must be a valid object" };
      }
      parsed = payload;
      canonical = canonicalizeWebhookBody(payload);
    } else {
      return { valid: false, reason: "Either rawBody or payload must be provided" };
    }
  } catch (err) {
    return {
      valid: false,
      reason: `Invalid JSON body: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const signedTimestamp = String(timestamp ?? parsed.timestamp ?? "");
  if (!signedTimestamp) {
    return { valid: false, reason: "Missing timestamp for webhook verification" };
  }

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(webhookSignedInput(signedTimestamp, canonical))
    .digest("hex");

  const matches = timingSafeEqualSignatures(signature, expectedSignature);
  if (!matches) {
    return { valid: false, reason: "signature mismatch" };
  }

  if (maxAgeSeconds > 0) {
    const ts = Date.parse(signedTimestamp);
    if (Number.isNaN(ts)) {
      return { valid: false, reason: "missing or invalid timestamp" };
    }
    const ageSeconds = (now.getTime() - ts) / 1000;
    if (ageSeconds > maxAgeSeconds) {
      return {
        valid: false,
        reason: `payload too old (${Math.round(ageSeconds)}s > ${maxAgeSeconds}s) — possible replay`,
      };
    }
    if (ageSeconds < -maxAgeSeconds) {
      return {
        valid: false,
        reason: `payload timestamp is in the future (${Math.round(-ageSeconds)}s ahead)`,
      };
    }
  }

  return { valid: true };
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
