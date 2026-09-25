// SPDX-License-Identifier: MIT

/**
 * Legacy re-export for webhook delivery persistence.
 * Real implementation lives in @/lib/webhooks.
 */

export {
  persistDeliveryResult,
  recordWebhookDelivery,
  toWebhookPayload,
  deliverWebhook,
  type RecordDeliveryOptions,
  type WebhookDeliveryResult,
} from "./webhooks";
