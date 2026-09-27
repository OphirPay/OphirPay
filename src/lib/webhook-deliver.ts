// SPDX-License-Identifier: MIT
//
// COMPATIBILITY SHIM — the implementation moved to `src/lib/webhooks/`
// (issue #758). Kept so existing imports keep working; new code should import
// from `@/lib/webhooks`. See `src/lib/webhooks/index.ts` for the pipeline map.

export * from "./webhooks/signing";
export * from "./webhooks/delivery";
export type {
  WebhookPayload,
  WebhookDeliveryResult,
  WebhookRequestPreview,
  WebhookDeliveryDetails,
} from "./webhooks/types";
