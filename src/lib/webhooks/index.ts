// SPDX-License-Identifier: MIT

/**
 * ==============================================================================
 * OphirPay Webhook Subsystem — Consolidated Architecture & Pipeline Entry Point
 * ==============================================================================
 *
 * This module is the documented single entry point for all webhook behavior in OphirPay.
 * It unifies signing, URL safety, subscription filtering, outbound delivery with
 * retries, persistence, replay, and integrator testing into an explicit, modular pipeline.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * Webhook Delivery Pipeline (End-to-End Lifecycle)
 * ──────────────────────────────────────────────────────────────────────────────
 *
 *  [1. Event Trigger]
 *         │  An application event occurs (e.g. payment completed, escrow resolved).
 *         │  Caller invokes `dispatchWebhookEvent(event, data, scopedUserId)`.
 *         ▼
 *  [2. Scoping & Filtering] (`filter.ts`)
 *         │  Active webhooks are retrieved from the database.
 *         │  User scoping ensures user A's events never notify user B's webhooks.
 *         │  `isSubscribedToEvent(wh.events, event)` checks if the endpoint subscribed
 *         │  to this specific event type (or wildcard empty list).
 *         ▼
 *  [3. Event Persistence] (`store.ts`)
 *         │  `storeWebhookEvent(userId, event, data, timestamp)` stores the raw event
 *         │  in `WebhookEvent` for immutable auditability and historical replay.
 *         ▼
 *  [4. Pre-Flight SSRF Guard] (`url-guard.ts`)
 *         │  `isSafeWebhookUrlAtDelivery(url)` validates scheme and resolves DNS
 *         │  immediately before connection. Rejects loopback, link-local (cloud metadata),
 *         │  private IPv4/IPv6, and internal suffixes to eliminate SSRF & DNS rebinding.
 *         ▼
 *  [5. Canonical Signing] (`signing.ts`)
 *         │  `buildSignedPayload(payload, secret)` canonicalizes the JSON body with
 *         │  empty signature field, computes HMAC-SHA256 hex digest, and populates
 *         │  both the `X-OphirPay-Signature` header and the body `signature` field.
 *         ▼
 *  [6. Outbound HTTP Delivery & Retries] (`delivery.ts`)
 *         │  `deliverWebhook(url, secret, payload, maxRetries)` performs HTTP POST with:
 *         │    - 5000ms AbortController timeout
 *         │    - `redirect: "manual"` (blocks redirect-based SSRF)
 *         │    - Exponential backoff retry (1s, 2s, 4s) on HTTP error or network drop.
 *         ▼
 *  [7. Delivery Ledger Recording] (`store.ts`)
 *         │  `recordWebhookDelivery(webhookId, eventId, status, details)` records
 *         │  HTTP status code, latency (ms), attempt count, and error in `WebhookDelivery`.
 *         ▼
 *  [8. Historical Replay & Testing] (`replay.ts`, `test-payload.ts`)
 *         │  - `selectEventsForReplay` queries historical events bounded by `resolveReplayBounds`.
 *         │  - `buildTestWebhookPayload` creates harmless simulation events for integrators.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 */

// ── 1. Signing & Canonicalization ──────────────────────────────
export {
  signWebhookPayload,
  buildSignedPayload,
  type WebhookPayload,
} from "./signing";

// ── 2. URL Safety & SSRF Guard ─────────────────────────────────
export {
  isSafeWebhookUrl,
  isSafeWebhookUrlAtDelivery,
} from "./url-guard";

// ── 3. Subscription Filtering ──────────────────────────────────
export {
  isSubscribedToEvent,
} from "./filter";

// ── 4. Outbound Delivery Engine ────────────────────────────────
export {
  deliverWebhook,
  type WebhookDeliveryResult,
} from "./delivery";

// ── 5. Persistence & Delivery Ledger ───────────────────────────
export {
  storeWebhookEvent,
  recordWebhookDelivery,
  persistDeliveryResult,
  toWebhookPayload,
  type StoredWebhookPayload,
  type RecordDeliveryOptions,
} from "./store";

// ── 6. Historical Replay ───────────────────────────────────────
export {
  REPLAY_MAX_DAYS,
  REPLAY_MAX_COUNT,
  REPLAY_DEFAULT_COUNT,
  resolveReplayBounds,
  selectEventsForReplay,
  type ReplaySelectionParams,
  type ReplaySelectionResult,
} from "./replay";

// ── 7. Integrator Testing ──────────────────────────────────────
export {
  buildTestWebhookPayload,
} from "./test-payload";

// ── 8. Dispatcher (Pipeline Orchestrator) ──────────────────────
export {
  dispatchWebhookEvent,
  dispatchWebhookEventAsync,
} from "./dispatcher";
