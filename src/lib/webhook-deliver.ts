// SPDX-License-Identifier: MIT

/**
 * Legacy re-export for webhook delivery and signing.
 * Real implementation lives in @/lib/webhooks.
 */

export {
  deliverWebhook,
  type WebhookDeliveryResult,
} from "./webhooks/delivery";

export {
  signWebhookPayload,
  buildSignedPayload,
  type WebhookPayload,
} from "./webhooks/signing";
