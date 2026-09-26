// SPDX-License-Identifier: MIT

/**
 * Legacy re-export for webhook delivery and signing.
 * Real implementation lives in @/lib/webhooks.
 */

export {
  deliverWebhook,
  deliverWebhookWithDetails,
  BLOCKED_WEBHOOK_TARGET_ERROR,
  type WebhookDeliveryResult,
  type WebhookDeliveryDetails,
} from "./webhooks/delivery";

export {
  signWebhookPayload,
  buildSignedPayload,
  buildWebhookRequestPreview,
  webhookSignedInput,
  canonicalizeWebhookBody,
  WEBHOOK_TIMESTAMP_HEADER,
  WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS,
  type WebhookPayload,
  type WebhookRequestPreview,
} from "./webhooks/signing";
