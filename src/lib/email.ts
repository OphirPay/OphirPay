// SPDX-License-Identifier: MIT

/**
 * Transactional email service using Resend REST API (issue #800).
 * Handles payment confirmations, webhook failure alerts, and account notifications.
 */

import { logger } from "./logger";
import { assertResendApiKey, DEFAULT_EMAIL_FROM } from "./env";

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
}

export interface EmailTemplateResult {
  subject: string;
  html: string;
  text?: string;
}

export interface SendEmailOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  fetchFn?: typeof fetch;
  apiKey?: string;
  from?: string;
}

export const RESEND_API_URL = "https://api.resend.com/emails";
export const DEFAULT_MAX_RETRIES = 2;

const TRANSIENT_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Send a transactional email.
 *
 * Dev mode: logs recipient & subject to console, returns true.
 * Prod mode: validates configuration (throws if RESEND_API_KEY is missing/invalid),
 *            sends via Resend REST API with exponential backoff retry on transient errors (up to 2 retries),
 *            returns true on success, logs structured error and returns false on failure.
 */
export async function sendEmail(
  payload: EmailPayload,
  options?: SendEmailOptions
): Promise<boolean> {
  if (process.env.NODE_ENV === "development") {
    console.log("[Email Dev]", {
      to: payload.to,
      subject: payload.subject,
    });
    return true;
  }

  // In production mode, validate configuration and throw loudly if missing/invalid
  if (process.env.NODE_ENV === "production") {
    assertResendApiKey(options?.apiKey || process.env.RESEND_API_KEY);
  }

  const apiKey = (options?.apiKey || process.env.RESEND_API_KEY)?.trim();

  // In non-dev, non-prod environments (e.g. test mode), return false if no key configured
  if (!apiKey) {
    return false;
  }

  const from = options?.from || payload.from || process.env.EMAIL_FROM?.trim() || DEFAULT_EMAIL_FROM;
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const initialDelayMs = options?.initialDelayMs ?? (process.env.NODE_ENV === "test" ? 10 : 250);
  const fetchFn = options?.fetchFn ?? globalThis.fetch;

  let lastError: Error | null = null;
  let lastStatus: number | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetchFn(RESEND_API_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "User-Agent": "OphirPay/0.1.0",
        },
        body: JSON.stringify({
          from,
          to: payload.to,
          subject: payload.subject,
          html: payload.html,
          ...(payload.text ? { text: payload.text } : {}),
        }),
      });

      if (response.ok) {
        return true;
      }

      lastStatus = response.status;
      const errorData = await response.json().catch(() => ({} as Record<string, unknown>));
      const message =
        (typeof errorData === "object" && errorData && "message" in errorData && typeof errorData.message === "string"
          ? errorData.message
          : null) ||
        response.statusText ||
        `HTTP ${response.status}`;
      lastError = new Error(message);

      // Check if permanent failure (e.g. 400 Bad Request, 401 Unauthorized, 403 Forbidden, 422 Unprocessable Entity)
      if (!TRANSIENT_HTTP_STATUSES.has(response.status)) {
        logger.error("Failed to send transactional email (permanent failure)", {
          recipient: payload.to,
          subject: payload.subject,
          status: response.status,
          error: message,
          attempt: attempt + 1,
        });
        return false;
      }

      // Transient failure - retry with exponential backoff if retries remain
      if (attempt < maxRetries) {
        const delay = initialDelayMs * Math.pow(2, attempt);
        await sleep(delay);
      }
    } catch (err) {
      // Network failure or unexpected exception
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        const delay = initialDelayMs * Math.pow(2, attempt);
        await sleep(delay);
      }
    }
  }

  // All retries exhausted
  logger.error("Failed to send transactional email after max retries", {
    recipient: payload.to,
    subject: payload.subject,
    status: lastStatus,
    error: lastError?.message || "Unknown error",
    attempts: maxRetries + 1,
  });
  return false;
}

/**
 * Predefined email templates for common notifications.
 */
export const EMAIL_TEMPLATES = {
  paymentSent: (amount: string, txHash: string): EmailTemplateResult => ({
    subject: `Payment of ${amount} sent on Stellar`,
    html: `<p>Your payment of <strong>${amount}</strong> has been sent.</p><p>TX: ${txHash}</p>`,
    text: `Your payment of ${amount} has been sent. TX: ${txHash}`,
  }),
  paymentReceived: (amount: string, from: string): EmailTemplateResult => ({
    subject: `You received ${amount} on Stellar`,
    html: `<p>You received <strong>${amount}</strong> from ${from}.</p>`,
    text: `You received ${amount} from ${from}.`,
  }),
  webhookFailed: (url: string, event: string): EmailTemplateResult => ({
    subject: `Webhook delivery failed: ${event}`,
    html: `<p>Failed to deliver <strong>${event}</strong> to ${url}.</p><p>Check the webhook configuration.</p>`,
    text: `Failed to deliver ${event} to ${url}. Check the webhook configuration.`,
  }),
};
