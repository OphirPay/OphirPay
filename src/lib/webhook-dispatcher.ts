// SPDX-License-Identifier: MIT

/**
 * Legacy re-export for webhook event dispatching.
 * Real implementation lives in @/lib/webhooks.
 */

export {
  dispatchWebhookEvent,
  dispatchWebhookEventAsync,
} from "./webhooks";
