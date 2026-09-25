// SPDX-License-Identifier: MIT

import { logger } from "@/lib/logger";
import { incMetric } from "@/lib/metrics-counters";
import { isSafeWebhookUrlAtDelivery } from "@/lib/webhook-url-guard";
import crypto from "crypto";

export const DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300; // 5 minutes

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

export interface VerifyWebhookOptions {
  body: string;
  signature: string;
  secret: string;
  timestamp?: string;
  maxAgeSeconds?: number;
  now?: Date;
}

export interface VerifyWebhookResult {
  valid: boolean;
  reason: string;
}

/**
 * Build the canonical string a receiver must sign, byte-for-byte identical
 * to what `buildSignedPayload` signs on the sender side.
 */
export function canonicalizeWebhookBody(body: string): {
  canonical: string;
  parsed: Record<string, unknown>;
} {
  const parsed = JSON.parse(body);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("body must be a JSON object");
  }
  return {
    canonical: JSON.stringify({ ...parsed, signature: "" }),
    parsed: parsed as Record<string, unknown>,
  };
}

/**
 * Generate HMAC-SHA256 signature covering the timestamp plus the canonical body.
 * Receiving endpoints verify authenticity and freshness against X-OphirPay-Signature.
 */
export function signWebhookPayload(
  payload: WebhookPayload,
  secret: string,
  timestamp?: string,
): string {
  const ts = timestamp || payload.timestamp || new Date().toISOString();
  const canonical = JSON.stringify({ ...payload, timestamp: ts, signature: "" });
  const toSign = `${ts}.${canonical}`;
  return crypto.createHmac("sha256", secret).update(toSign).digest("hex");
}

/**
 * Build the exact HTTP body that will be transmitted and sign it, covering
 * the timestamp plus the canonical body.
 *
 * Canonicalization: the HMAC is computed over `${timestamp}.${canonical}`
 * where `canonical` is `JSON.stringify({...payload, signature: ""})`.
 * A receiver recomputes identically: parse received body, empty `signature`
 * field, re-serialize (stable key order), prepend `${timestamp}.`, and
 * compare against `X-OphirPay-Signature`.
 */
export function buildSignedPayload(
  payload: WebhookPayload,
  secret: string,
  timestamp?: string,
): { body: string; signature: string; timestamp: string } {
  const ts = timestamp || payload.timestamp || new Date().toISOString();
  const payloadWithTs = { ...payload, timestamp: ts };
  const canonical = JSON.stringify({ ...payloadWithTs, signature: "" });
  const toSign = `${ts}.${canonical}`;
  const signature = crypto
    .createHmac("sha256", secret)
    .update(toSign)
    .digest("hex");
  return {
    body: JSON.stringify({ ...payloadWithTs, signature }),
    signature,
    timestamp: ts,
  };
}

/**
 * Verify an OphirPay webhook delivery against secret, signature, and timestamp.
 * Returns { valid: true, reason: "valid" } or { valid: false, reason: "..." }.
 */
export function verifyWebhookSignature({
  body,
  signature,
  secret,
  timestamp,
  maxAgeSeconds = DEFAULT_WEBHOOK_TOLERANCE_SECONDS,
  now = new Date(),
}: VerifyWebhookOptions): VerifyWebhookResult {
  let canonical: string;
  let parsed: Record<string, unknown>;
  try {
    const res = canonicalizeWebhookBody(body);
    canonical = res.canonical;
    parsed = res.parsed;
  } catch (err) {
    return {
      valid: false,
      reason: `invalid body: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const effectiveTimestamp =
    timestamp || (typeof parsed.timestamp === "string" ? parsed.timestamp : undefined);
  if (!effectiveTimestamp) {
    return { valid: false, reason: "missing or invalid timestamp" };
  }

  const toSign = `${effectiveTimestamp}.${canonical}`;
  const expected = crypto.createHmac("sha256", secret).update(toSign).digest("hex");
  const provided = Buffer.from(String(signature ?? ""));
  const expectedBuf = Buffer.from(expected);

  const matches =
    provided.length === expectedBuf.length &&
    crypto.timingSafeEqual(provided, expectedBuf);
  if (!matches) {
    return { valid: false, reason: "signature mismatch" };
  }

  if (maxAgeSeconds > 0) {
    const ts = Date.parse(effectiveTimestamp);
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

  return { valid: true, reason: "valid" };
}

/**
 * Deliver a webhook event to a registered endpoint with retries, timestamp, and signing.
 * Transmits X-OphirPay-Signature, X-OphirPay-Timestamp, and X-OphirPay-Event headers.
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

  // Re-validate the destination at delivery time to mitigate DNS rebinding.
  if (!(await isSafeWebhookUrlAtDelivery(url))) {
    logger.error("Webhook delivery blocked — URL resolved to a private/internal address", { url });
    incMetric("webhooks_failed_total");
    return {
      success: false,
      attempts: 0,
      latencyMs: Date.now() - startedAt,
      errorMessage: "URL resolved to a private/internal address",
    };
  }

  let lastStatusCode: number | undefined;
  let lastError: string | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-OphirPay-Signature": signature,
          "X-OphirPay-Timestamp": timestamp,
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
