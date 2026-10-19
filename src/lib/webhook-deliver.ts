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
export const WEBHOOK_SIGNATURE_HEADER = "X-OphirPay-Signature";
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

/**
 * Compare two signature strings in constant time (issue #1386).
 *
 * A plain `===` comparison short-circuits on the first differing byte, which
 * lets an attacker recover a valid signature byte-by-byte from response-timing
 * differences. `crypto.timingSafeEqual` does not, but it *throws* on unequal
 * buffer lengths — so equal encoded length is checked first and a mismatch
 * returns `false` rather than raising. The comparison is over the UTF-8 bytes
 * of each string (the hex digests the sender transmits).
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  // Length is not secret (the digest length is fixed), and equal-byte-length
  // is a hard precondition for timingSafeEqual. Bailing here keeps a malformed
  // or truncated signature from throwing an uncaught RangeError.
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

/** Why a delivery was accepted or rejected by {@link verifyWebhookSignature}. */
export type WebhookVerificationReason =
  | "valid"
  | "invalid body"
  | "signature mismatch"
  | "missing or invalid timestamp"
  | "payload too old — possible replay"
  | "payload timestamp is in the future";

export interface WebhookVerificationInput {
  /** Raw request body, exactly as received. */
  body: string;
  /** `X-OphirPay-Signature` header value (the body field is informational). */
  signature: string | null | undefined;
  /** The webhook signing secret. */
  secret: string;
  /**
   * `X-OphirPay-Timestamp` header value. Falls back to the (also-signed)
   * body `timestamp` field when absent.
   */
  timestamp?: string | null;
  /** Replay window in seconds; `0` disables the freshness check. */
  maxAgeSeconds?: number;
  /** Reference time in ms epoch for the freshness check (injectable in tests). */
  now?: number;
}

export interface WebhookVerificationResult {
  valid: boolean;
  reason: WebhookVerificationReason;
}

/**
 * Receiver-side verification of an OphirPay webhook delivery (issue #1386).
 *
 * Reproduces the exact signed material `buildSignedPayload` produces —
 * `<timestamp>.<canonical body>` with the `signature` field emptied, not
 * deleted — then compares the recomputed hex digest against the supplied
 * signature with a constant-time comparison.
 *
 * This is the canonical in-repo receiver: subscriber examples in
 * `examples/webhook-verification/` mirror it, and the contract is documented in
 * `docs/webhook-verification.md`. It never throws on malformed input — a
 * truncated/oversized signature, a non-JSON body or an unparseable timestamp
 * all yield `{ valid: false, reason }`.
 *
 * @example
 * ```ts
 * const result = verifyWebhookSignature({
 *   body: await request.text(),
 *   signature: request.headers.get("X-OphirPay-Signature"),
 *   timestamp: request.headers.get("X-OphirPay-Timestamp"),
 *   secret: process.env.WEBHOOK_SECRET!,
 * });
 * if (!result.valid) return new Response("unauthorized", { status: 401 });
 * ```
 */
export function verifyWebhookSignature({
  body,
  signature,
  secret,
  timestamp,
  maxAgeSeconds = WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS,
  now = Date.now(),
}: WebhookVerificationInput): WebhookVerificationResult {
  let parsed: WebhookPayload;
  let canonical: string;
  try {
    const raw: unknown = JSON.parse(body);
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return { valid: false, reason: "invalid body" };
    }
    parsed = raw as WebhookPayload;
    // Empty the signature field (do NOT delete the key) — the HMAC covers
    // `"signature":""` as the last member.
    canonical = JSON.stringify({ ...parsed, signature: "" });
  } catch {
    return { valid: false, reason: "invalid body" };
  }

  // The timestamp is authenticated (it is prepended to the canonical body), so
  // the header is safe to trust for replay protection. Prefer the header, fall
  // back to the body field, which is signed too.
  const signedTimestamp = String(timestamp ?? parsed.timestamp ?? "");
  const expected = crypto
    .createHmac("sha256", secret)
    .update(webhookSignedInput(signedTimestamp, canonical))
    .digest("hex");

  // Constant-time comparison — see constantTimeEqual. Length mismatches return
  // false without throwing (acceptance criterion of issue #1386).
  if (!constantTimeEqual(String(signature ?? ""), expected)) {
    return { valid: false, reason: "signature mismatch" };
  }

  if (maxAgeSeconds > 0) {
    const ts = Date.parse(signedTimestamp);
    if (Number.isNaN(ts)) {
      return { valid: false, reason: "missing or invalid timestamp" };
    }
    const ageSeconds = (now - ts) / 1000;
    if (ageSeconds > maxAgeSeconds) {
      return { valid: false, reason: "payload too old — possible replay" };
    }
    if (ageSeconds < -maxAgeSeconds) {
      return { valid: false, reason: "payload timestamp is in the future" };
    }
  }

  return { valid: true, reason: "valid" };
}

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
      [WEBHOOK_SIGNATURE_HEADER]: signature,
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

export interface RequeueDeliveryOptions {
  resetAttempts?: boolean;
  targetStatus?: DeliveryStatus;
}

/**
 * Requeue a dead-lettered or failed webhook delivery (issue #1362).
 * Resets attempt count to 0 and updates status to PENDING.
 * Preserves the original event, timestamp, and payload linkage.
 */
export async function requeueWebhookDelivery(
  deliveryId: string,
  options: RequeueDeliveryOptions = {}
): Promise<{
  id: string;
  status: DeliveryStatus;
  attempts: number;
  eventId: string;
  webhookId: string;
}> {
  const resetAttempts = options.resetAttempts ?? true;
  const targetStatus = options.targetStatus ?? ("PENDING" as DeliveryStatus);

  const updated = await prisma.webhookDelivery.update({
    where: { id: deliveryId },
    data: {
      status: targetStatus,
      attempts: resetAttempts ? 0 : undefined,
      errorMessage: null,
      error: null,
    },
    select: {
      id: true,
      status: true,
      attempts: true,
      eventId: true,
      webhookId: true,
    },
  });

  logger.info("Webhook delivery requeued into DLQ retry pool", {
    deliveryId: updated.id,
    webhookId: updated.webhookId,
    eventId: updated.eventId,
    status: updated.status,
  });

  return updated;
}

export interface DlqFilterParams {
  statusCodes?: number[];
  onlyTimeouts?: boolean;
  limit?: number;
  deliveryIds?: string[];
}

/**
 * Find and bulk-requeue dead-lettered/failed webhook deliveries matching filters.
 */
export async function bulkRequeueDlqDeliveries(
  webhookId: string,
  filter: DlqFilterParams = {}
): Promise<{
  requeuedCount: number;
  deliveries: Array<{
    id: string;
    eventId: string;
    status: DeliveryStatus;
    attempts: number;
  }>;
}> {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 100);

  // Match deliveries that failed or are dead-lettered
  const candidates = await prisma.webhookDelivery.findMany({
    where: {
      webhookId,
      status: {
        in: ["FAILED", "DEAD_LETTER"] as DeliveryStatus[],
      },
      ...(filter.deliveryIds && filter.deliveryIds.length > 0
        ? { id: { in: filter.deliveryIds } }
        : {}),
      ...(filter.statusCodes && filter.statusCodes.length > 0
        ? { responseCode: { in: filter.statusCodes } }
        : {}),
      ...(filter.onlyTimeouts
        ? {
            OR: [
              { errorMessage: { contains: "timeout", mode: "insensitive" } },
              { errorMessage: { contains: "timed out", mode: "insensitive" } },
              { error: { contains: "timeout", mode: "insensitive" } },
              { error: { contains: "timed out", mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { deliveredAt: "desc" },
    take: limit,
    select: { id: true, eventId: true },
  });

  if (candidates.length === 0) {
    return { requeuedCount: 0, deliveries: [] };
  }

  const ids = candidates.map((c) => c.id);

  // Perform bulk update to PENDING and reset attempts
  await prisma.webhookDelivery.updateMany({
    where: { id: { in: ids } },
    data: {
      status: "PENDING" as DeliveryStatus,
      attempts: 0,
      errorMessage: null,
      error: null,
    },
  });

  const updatedDeliveries = candidates.map((c) => ({
    id: c.id,
    eventId: c.eventId,
    status: "PENDING" as DeliveryStatus,
    attempts: 0,
  }));

  logger.info("Bulk requeued dead-lettered webhook deliveries", {
    webhookId,
    requeuedCount: updatedDeliveries.length,
  });

  return {
    requeuedCount: updatedDeliveries.length,
    deliveries: updatedDeliveries,
  };
}

