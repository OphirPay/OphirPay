// SPDX-License-Identifier: MIT

/**
 * Legacy re-export for webhook SSRF URL validation.
 * Real implementation lives in @/lib/webhooks/url-guard.
 */

export {
  DEFAULT_ALLOWED_WEBHOOK_PORTS,
  getAllowedWebhookPorts,
  isSafeWebhookUrl,
  validateWebhookUrlAtDelivery,
  isSafeWebhookUrlAtDelivery,
  type WebhookUrlValidation,
} from "./webhooks/url-guard";
