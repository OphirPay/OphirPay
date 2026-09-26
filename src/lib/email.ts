// SPDX-License-Identifier: MIT

/**
 * Transactional email delivery through the Resend HTTPS API.
 *
 * `sendEmail()` returns `true` only when the provider accepted the message.
 * Missing configuration throws `EmailConfigurationError`, and a provider
 * rejection or transport failure throws `EmailSendError` once a small,
 * bounded retry budget is spent — a dropped notification can never be
 * mistaken for a delivered one (issue #800).
 */

import { ERROR_CODES } from "@/lib/error-codes";
import { logger } from "@/lib/logger";

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
}

/** Resend transactional endpoint — a plain HTTPS API, no SDK required. */
export const RESEND_API_URL = "https://api.resend.com/emails";

/** Sender identity used when `EMAIL_FROM` is not configured. */
export const DEFAULT_EMAIL_FROM = "OphirPay <payments@ophirpay.com>";

/** Bounded retry budget: 3 attempts with 250ms -> 500ms backoff. */
export const MAX_ATTEMPTS = 3;
export const RETRY_BASE_DELAY_MS = 250;
export const MAX_RETRY_DELAY_MS = 2_000;
/** A single provider request that hangs longer than this is aborted. */
export const REQUEST_TIMEOUT_MS = 10_000;

/** Missing/invalid mail configuration — thrown before any request is made. */
export class EmailConfigurationError extends Error {
  readonly code = ERROR_CODES.EMAIL_UNAVAILABLE;

  constructor(message: string) {
    super(message);
    this.name = "EmailConfigurationError";
  }
}

/** The provider did not accept the message (rejection or transport failure). */
export class EmailSendError extends Error {
  readonly code = ERROR_CODES.EMAIL_SEND_FAILED;
  /** HTTP status returned by the provider, when it answered at all. */
  readonly providerStatus?: number;
  /** How many attempts were made before giving up. */
  readonly attempts: number;

  constructor(
    message: string,
    options: { providerStatus?: number; attempts: number }
  ) {
    super(message);
    this.name = "EmailSendError";
    this.providerStatus = options.providerStatus;
    this.attempts = options.attempts;
  }
}

/**
 * Resolve the mail configuration from the environment.
 * Fails loudly: an unconfigured deployment must never look like a
 * successful send.
 */
export function getMailConfig(): { apiKey: string; from: string } {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    throw new EmailConfigurationError(
      "RESEND_API_KEY is not set — transactional email is not configured. " +
        "Add it to your environment (documented in .env.example) before sending email."
    );
  }
  return { apiKey, from: process.env.EMAIL_FROM?.trim() || DEFAULT_EMAIL_FROM };
}

/** Transient provider responses: rate limits and server-side errors. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export function backoffMs(attempt: number): number {
  return Math.min(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Best-effort provider error detail, capped so a huge body cannot flood logs. */
async function readErrorDetail(response: Response): Promise<string | undefined> {
  try {
    const text = (await response.text()).trim();
    return text ? text.slice(0, 300) : undefined;
  } catch {
    return undefined;
  }
}

type AttemptResult =
  | { kind: "accepted" }
  | { kind: "rejected"; status: number; detail?: string }
  | { kind: "unreachable"; message: string };

async function attemptSend(
  apiKey: string,
  from: string,
  payload: EmailPayload
): Promise<AttemptResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: payload.from || from,
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
        ...(payload.text ? { text: payload.text } : {}),
      }),
      signal: controller.signal,
    });
    if (response.ok) return { kind: "accepted" };
    return {
      kind: "rejected",
      status: response.status,
      detail: await readErrorDetail(response),
    };
  } catch (error) {
    return {
      kind: "unreachable",
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function sendEmail(payload: EmailPayload): Promise<boolean> {
  const { apiKey, from } = getMailConfig();

  let lastError: EmailSendError | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = await attemptSend(apiKey, from, payload);

    if (result.kind === "accepted") {
      logger.info("Email accepted by provider", {
        to: payload.to,
        attempts: attempt,
      });
      return true;
    }

    const message =
      result.kind === "rejected"
        ? `Email provider rejected the message (HTTP ${result.status})` +
          (result.detail ? `: ${result.detail}` : "")
        : `Could not reach the email provider: ${result.message}`;

    lastError = new EmailSendError(message, {
      providerStatus: result.kind === "rejected" ? result.status : undefined,
      attempts: attempt,
    });

    // Transport failures and 429/5xx are worth another attempt; any other
    // 4xx rejection is permanent — retrying cannot help.
    const permanent =
      result.kind === "rejected" && !isRetryableStatus(result.status);

    if (permanent) {
      logger.error("Email rejected by provider", {
        to: payload.to,
        status: result.status,
        attempts: attempt,
        error: message,
      });
      break;
    }

    if (attempt < MAX_ATTEMPTS) {
      logger.warn("Email delivery attempt failed, retrying", {
        to: payload.to,
        attempt,
        error: message,
      });
      await sleep(backoffMs(attempt));
    } else {
      logger.error("Email delivery failed after retries", {
        to: payload.to,
        attempts: attempt,
        error: message,
      });
    }
  }

  // Reached either by exhausting the retry budget or by a permanent
  // rejection — `lastError` is always assigned above.
  throw lastError;
}

/**
 * Predefined email templates for common notifications.
 */
export const EMAIL_TEMPLATES = {
  paymentSent: (amount: string, txHash: string) => ({
    subject: `Payment of ${amount} sent on Stellar`,
    html: `<p>Your payment of <strong>${amount}</strong> has been sent.</p><p>TX: ${txHash}</p>`,
  }),
  paymentReceived: (amount: string, from: string) => ({
    subject: `You received ${amount} on Stellar`,
    html: `<p>You received <strong>${amount}</strong> from ${from}.</p>`,
  }),
  webhookFailed: (url: string, event: string) => ({
    subject: `Webhook delivery failed: ${event}`,
    html: `<p>Failed to deliver <strong>${event}</strong> to ${url}.</p><p>Check the webhook configuration.</p>`,
  }),
};
