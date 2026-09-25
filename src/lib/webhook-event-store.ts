// SPDX-License-Identifier: MIT

/**
 * Legacy re-export for webhook event persistence and replay.
 * Real implementation lives in @/lib/webhooks.
 */

export {
  storeWebhookEvent,
  recordWebhookDelivery,
  resolveReplayBounds,
  selectEventsForReplay,
  toWebhookPayload,
  type StoredWebhookPayload,
  type ReplaySelectionParams,
  type ReplaySelectionResult,
} from "./webhooks";
