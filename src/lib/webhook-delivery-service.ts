// SPDX-License-Identifier: MIT
//
// COMPATIBILITY SHIM — the implementation moved to
// `src/lib/webhooks/persistence.ts` (issue #758). New code should import from
// `@/lib/webhooks`.

export { persistDeliveryResult } from "./webhooks/persistence";
export type { RecordDeliveryOptions } from "./webhooks/persistence";
export { toWebhookPayload } from "./webhooks/persistence";
export { deliverWebhook } from "./webhooks/delivery";
export type { WebhookDeliveryResult } from "./webhooks/types";
