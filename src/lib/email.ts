// SPDX-License-Identifier: MIT

/**
 * Email notification service placeholder.
 * In production, integrate with Resend, SendGrid, or SES to send transactional emails
 * for payment confirmations, webhook failures, and account notifications.
 */

interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail(payload: EmailPayload): Promise<boolean> {
  if (process.env.NODE_ENV === "development") {
    console.log("[Email Dev]", {
      to: payload.to,
      subject: payload.subject,
    });
    return true;
  }

  // Production: integrate with email provider
  // const { data, error } = await resend.emails.send({ from: "OphirPay <payments@ophirpay.com>", ...payload });
  // return !error;

  return false;
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
