// SPDX-License-Identifier: MIT
//
// ══════════════════════════════════════════════════════════════════════
//  Webhooks — single documented entry point
// ══════════════════════════════════════════════════════════════════════
//
//  Where is delivery attempted, and in what order do signing, filtering and
//  persistence happen? Answering that question used to require reading eight
//  similarly named modules (webhook-deliver, webhook-dispatcher,
//  webhook-event-store, webhook-delivery-service, webhook-filter,
//  webhook-test, webhook-replay-config, webhook-url-guard). This directory is
//  the one place that answers it.
//
//  The delivery pipeline, end to end:
//
//    1. DISPATCH   `dispatch.ts` — `dispatchWebhookEvent()` is called by API
//                  routes / server actions. It loads the active subscriptions
//                  (scoped to one user when a `scopedUserId` is given).
//    2. FILTER     `filter.ts`   — `isSubscribedToEvent()` decides which
//                  subscriptions want this event type.
//    3. PERSIST    `persistence.ts` — the event is stored once
//                  (`storeWebhookEvent`) so it can be replayed later.
//    4. SIGN       `signing.ts`  — `buildWebhookRequestPreview()` produces the
//                  canonical body and HMAC-SHA256 signature. The signed input
//                  is `<timestamp>.<canonical body>`; the body carries an
//                  emptied `signature` field. Never re-implemented elsewhere.
//    5. SAFETY     `url-safety.ts` — `deliverWebhook` re-validates the target
//                  immediately before *every* attempt (SSRF + DNS rebinding),
//                  and refuses redirects.
//    6. DELIVER    `delivery.ts` — POSTs the signed body, retrying with
//                  exponential backoff (1s/2s/4s, 3 attempts by default).
//    7. RECORD     `persistence.ts` — each attempt is written to the delivery
//                  ledger (`recordWebhookDelivery` / `persistDeliveryResult`).
//    8. REPLAY     `replay.ts`   — `resolveReplayBounds()` clamps the replay
//                  window/limit; `persistence.selectEventsForReplay()` reads
//                  the stored events back for a bounded, filtered replay.
//
//  Single responsibilities, no duplicated implementation:
//    • signing        → `signing.ts`
//    • URL safety     → `url-safety.ts`
//    • filtering      → `filter.ts`
//    • delivery/retry → `delivery.ts`
//    • persistence    → `persistence.ts`
//    • replay bounds  → `replay.ts`
//    • orchestration  → `dispatch.ts`
//
//  The old top-level `src/lib/webhook-*.ts` files are now thin re-export
//  shims kept so existing call sites (and tests) do not need a sweeping
//  rename. New code should import from `@/lib/webhooks`.
//
//  See `docs/webhook-verification.md` for the receiver-side verification
//  recipe and the SSRF target policy.

export * from "./types";
export * from "./signing";
export * from "./url-safety";
export * from "./filter";
export * from "./delivery";
export * from "./dispatch";
export * from "./persistence";
export * from "./replay";
export * from "./test-payload";
