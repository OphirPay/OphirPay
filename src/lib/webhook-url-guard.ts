// SPDX-License-Identifier: MIT

/**
 * Legacy re-export for webhook SSRF URL validation.
 * Real implementation lives in @/lib/webhooks/url-guard.
 */

export {
  isSafeWebhookUrl,
  isSafeWebhookUrlAtDelivery,
} from "./webhooks/url-guard";
