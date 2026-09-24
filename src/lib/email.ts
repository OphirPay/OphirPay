// SPDX-License-Identifier: MIT

/**
 * Transactional email via the Resend HTTPS API.
 *
 * Sends payment confirmations, webhook failures, and account notifications.
 * Returns `true` only when the provider accepted the message — never a
 * silent no-op. Missing configuration fails loudly instead of dropping mail.
 */

interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export class EmailConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailConfigurationError";
  }
}

export class EmailSendError extends Error {
  constructor(
    message: string,
    readonly providerStatus?: number,
    readonly attempts?: number
  ) {
    super(message);
    this.name = "EmailSendError";
  }
}

const RESEND_API_URL = "https://api.resend.com/emails";
const DEFAULT_FROM = "OphirPay <payments@ophirpay.com>";
const MAX_ATTEMPTS = 3;

function getMailConfig(): { apiKey: string; from: string } {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new EmailConfigurationError(
      "RESEND_API_KEY is not set. Add it to your environment (see .env.example) " +
        "to enable transactional email."
    );
  }
  return { apiKey, from: process.env.EMAIL_FROM || DEFAULT_FROM };
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

function backoffMs(attempt: number): number {
  return 100 * attempt;
}

export async function sendEmail(payload: EmailPayload): Promise<boolean> {
  if (process.env.NODE_ENV === "development") {
    console.log("[Email Dev]", {
      to: payload.to,
      subject: payload.subject,
    });
    return true;
  }

  const { apiKey, from } = getMailConfig();

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response: Response;
    try {
      response = await fetch(RESEND_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from, ...payload }),
      });
    } catch (error) {
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt)));
        continue;
      }
      throw new EmailSendError(
        `Email provider unreachable after ${MAX_ATTEMPTS} attempts: ` +
          `${error instanceof Error ? error.message : String(error)}`,
        undefined,
        attempt
      );
    }

    if (response.ok) {
      return true;
    }

    if (!isRetryable(response.status) || attempt === MAX_ATTEMPTS) {
      throw new EmailSendError(
        `Email provider rejected the message (status ${response.status})` +
          (attempt > 1 ? ` after ${attempt} attempts` : ""),
        response.status,
        attempt
      );
    }
    await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt)));
  }

  throw new EmailSendError("Email send failed", undefined, MAX_ATTEMPTS);
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
