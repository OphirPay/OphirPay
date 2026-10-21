// SPDX-License-Identifier: MIT

import { logger } from "@/lib/logger";
import { getCurrentRequestId } from "@/lib/request-logging";
import { REQUEST_ID_HEADER } from "@/lib/request-id";
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
  /**
   * Correlation id of the API request that originated this event. Copied from
   * the request's async context when available and included in the signed
   * body plus the `X-Request-Id` delivery header so a subscriber can trace a
   * webhook back through our logs to the request that caused it.
   */
  requestId?: string;
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

// ── Retry schedule ─────────────────────────────────────────────
//
// `deliverWebhook` retries a few times in-process for a transient blip, but a
// subscriber outage (502/503, DNS timeout) can outlast a request. Failures are
// therefore persisted as RETRYING with the next attempt time, and the cron
// processor drains the queue on this exponential schedule:
//
//   attempt 1 →  1 min      attempt 4 →  1 hour
//   attempt 2 →  5 min      attempt 5 →  4 hours
//   attempt 3 → 15 min      then DEAD_LETTER

export const WEBHOOK_RETRY_BACKOFF_MS = [
  60_000,
  5 * 60_000,
  15 * 60_000,
  60 * 60_000,
  4 * 60 * 60_000,
] as const;

/** Number of scheduled retries before a delivery is dead-lettered. */
export const WEBHOOK_MAX_RETRIES = WEBHOOK_RETRY_BACKOFF_MS.length;

/** Maximum deliveries a single cron run will process. */
export const WEBHOOK_RETRY_QUEUE_BATCH_SIZE = 50;

/**
 * Delay before the next attempt, given how many scheduled retries have already
 * run. Returns `null` once the schedule is exhausted (the caller must then
 * dead-letter the delivery).
 */
export function webhookRetryDelayMs(retriesCompleted: number): number | null {
  const index = Math.max(0, Math.floor(retriesCompleted));
  return WEBHOOK_RETRY_BACKOFF_MS[index] ?? null;
}

/** Absolute time of the next attempt, or `null` when retries are exhausted. */
export function nextWebhookAttemptAt(
  retriesCompleted: number,
  from: Date = new Date()
): Date | null {
  const delayMs = webhookRetryDelayMs(retriesCompleted);
  return delayMs === null ? null : new Date(from.getTime() + delayMs);
}

/** Delivery status to persist after a failed attempt. */
export function deliveryStatusAfterFailure(
  retriesCompleted: number
): DeliveryStatus {
  return webhookRetryDelayMs(retriesCompleted) === null
    ? ("DEAD_LETTER" as DeliveryStatus)
    : ("RETRYING" as DeliveryStatus);
}


/**
 * Largest raw request body the verifier will parse (1 MiB).
 *
 * `verifyWebhookSignature` receives a body from an unauthenticated HTTP
 * client, so its cost must be bounded *before* `JSON.parse` and the HMAC see
 * it: an attacker who can post a 500 MiB body would otherwise make the
 * receiver spend CPU and memory on a payload that can never verify. The
 * delivered envelopes are kilobytes (a batch envelope is capped at 100 child
 * payments), so 1 MiB is orders of magnitude of headroom.
 */
export const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024;

/**
 * Coerce a header/body value to the string used in the signed input, without
 * ever invoking attacker-controlled `toString`/`valueOf`.
 *
 * Header values, body timestamps and signatures all arrive from outside. A
 * plain `String(value)` throws `TypeError` for an object with a null
 * prototype (or one whose `toString` throws), which is exactly the kind of
 * input a fuzzer finds. Objects and symbols therefore collapse to `""` — they
 * can never be a valid timestamp or hex digest anyway — while primitives keep
 * the coercion the sender used.
 */
function toSignedString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (typeof value === "symbol" || typeof value === "object") return "";
  if (typeof value === "function") return "";
  return String(value);
}

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
  | "body too large"
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
 * truncated/oversized signature, a non-JSON body, an oversized body, a
 * non-string header or an unparseable timestamp all yield
 * `{ valid: false, reason }`.
 *
 * The whole path is wrapped in a final `try/catch`: every rejection above is
 * explicit and intentional, and the catch exists so a future edit (or an
 * exotic runtime value the checks do not anticipate) still degrades to
 * "invalid" instead of surfacing a 500 to an unauthenticated caller.
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
  try {
    // A body or secret that is not a string cannot have been signed by us.
    // Checked before touching either so no implicit coercion (which is where
    // `String(attackerObject)` would run user code) ever happens.
    if (typeof body !== "string" || typeof secret !== "string") {
      return { valid: false, reason: "invalid body" };
    }
    // Bounded work: reject before JSON.parse / HMAC on a body that could only
    // ever be a denial-of-service attempt.
    if (Buffer.byteLength(body, "utf8") > MAX_WEBHOOK_BODY_BYTES) {
      return { valid: false, reason: "body too large" };
    }

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

    // The timestamp is authenticated (it is prepended to the canonical body),
    // so the header is safe to trust for replay protection. Prefer the header,
    // fall back to the body field, which is signed too. Either may be absent,
    // non-string or an object — `toSignedString` normalises it without running
    // attacker-controlled conversions.
    const signedTimestamp = toSignedString(timestamp ?? parsed.timestamp ?? "");
    const expected = crypto
      .createHmac("sha256", secret)
      .update(webhookSignedInput(signedTimestamp, canonical))
      .digest("hex");

    // Constant-time comparison — see constantTimeEqual. Length mismatches
    // return false without throwing (acceptance criterion of issue #1386).
    if (!constantTimeEqual(toSignedString(signature), expected)) {
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
  } catch {
    // Safety net: no input may throw out of the verifier. The explicit checks
    // above are expected to catch everything, so reaching here means an
    // unforeseen value — fail closed, never 500.
    return { valid: false, reason: "invalid body" };
  }
}

export function signWebhookPayload(payload: WebhookPayload, secret: string): string {
  const canonical = canonicalizeWebhookBody(payload);
  return crypto
    .createHmac("sha256", secret)
    .update(webhookSignedInput(payload.timestamp, canonical))
    .digest("hex");
}

export function verifyWebhookSignature(
  body: string,
  signature: string,
  secret: string,
  timestamp?: string
): boolean {
  let parsed: WebhookPayload;
  try {
    parsed = JSON.parse(body) as WebhookPayload;
  } catch {
    return false;
  }
  if (typeof parsed !== "object" || parsed === null) return false;
  const canonical = canonicalizeWebhookBody(parsed);
  const signedTimestamp = String(timestamp ?? parsed.timestamp ?? "");
  const expected = crypto
    .createHmac("sha256", secret)
    .update(webhookSignedInput(signedTimestamp, canonical))
    .digest("hex");
  // Timing-safe comparison (issue #1386): compare raw bytes with
  // crypto.timingSafeEqual after an explicit length check, so a
  // malformed/garbage signature returns false instead of throwing.
  const providedBuf = Buffer.from(String(signature ?? ""));
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
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
      ...(payload.requestId
        ? { [REQUEST_ID_HEADER]: payload.requestId }
        : {}),
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
  // Prefer an explicit id (replay/redelivery of a stored event) and fall back
  // to the request context of the caller. Building the signed payload from
  // this normalized object means the id is covered by the HMAC and cannot be
  // altered in transit.
  const requestId = payload.requestId ?? getCurrentRequestId();
  const deliveryPayload: WebhookPayload = requestId
    ? { ...payload, requestId }
    : payload;
  const request = buildWebhookRequestPreview(deliveryPayload, secret);
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
        logger.info("Webhook delivered", { url, event: payload.event, attempt, requestId });
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
      logger.warn("Webhook delivery failed", { url, status: response.status, attempt, requestId });
    } catch (err) {
      lastError = isTimeoutError(err)
        ? `Webhook delivery timed out after ${getWebhookTimeoutMs()}ms`
        : err instanceof Error
          ? err.message
          : String(err);
      logger.warn("Webhook delivery error", { url, error: lastError, attempt, requestId });
    }

    if (attempt < maxRetries) {
      const delayMs = Math.min(
        RETRY_CONFIG.webhook.maxDelayMs,
        RETRY_CONFIG.webhook.baseDelayMs * 2 ** (attempt - 1),
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  logger.error("Webhook delivery exhausted retries", { url, event: payload.event, requestId });
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
              { errorMessage: { contains: "timeout" } },
              { errorMessage: { contains: "timed out" } },
              { error: { contains: "timeout" } },
              { error: { contains: "timed out" } },
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
