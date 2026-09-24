// SPDX-License-Identifier: MIT
//
// Sample webhook payloads for the automation-platform integration guide — #817.
//
// n8n / Zapier / Make users need to see what a delivery actually looks like, and
// they cannot read `src/app/api/payments/[id]/route.ts` to find out. The samples
// here feed docs/AUTOMATION_PLATFORMS.md and the drift guard in
// src/__tests__/automation-platform-guide.test.ts.
//
// Every payload below is transcribed from the dispatcher that emits it; none is
// invented. The dispatching site is named next to each entry so the next reader
// can check it against the code rather than trusting this file.
//
// Events that exist in WEBHOOK_EVENTS but are never dispatched are listed in
// UNDISPATCHED_EVENTS below and documented as such: telling an integrator to
// subscribe to an event that never fires is worse than omitting it.

import { WEBHOOK_EVENTS, type WebhookEventType } from "@/app/api/webhooks/event-types";
import type { WebhookPayload } from "@/lib/webhook-deliver";

/** Deterministic timestamps keep the guide's examples byte-stable across runs. */
const T = {
  created: "2026-08-14T00:00:00Z",
  signed: "2026-08-14T00:00:05Z",
  submitted: "2026-08-14T00:00:09Z",
  confirmed: "2026-08-14T00:00:14Z",
  completed: "2026-08-14T00:00:15Z",
  failed: "2026-08-14T00:00:16Z",
} as const;

const TX_HASH = "3389e9f0f1a65f19736cacf544c2e825313e8447f569233bb8db39aa607c8889";

/** The lifecycle stage a sample illustrates. */
export type LifecycleStage = "created" | "signed" | "submitted" | "confirmed" | "completed" | "failed";

/** An example delivery plus the stage it documents. */
export interface SampleDelivery {
  stage: LifecycleStage;
  event: WebhookEventType;
  payload: WebhookPayload;
}

function envelope(event: WebhookEventType, timestamp: string, data: Record<string, unknown>): WebhookPayload {
  // A real delivery carries `signature`; the empty string here is the shape a
  // receiver parses before recomputing the HMAC (see docs/webhook-verification.md).
  return { event, timestamp, data, signature: "" } as WebhookPayload;
}

/**
 * One complete delivery per payment lifecycle stage.
 *
 * Shapes transcribed from:
 *   created    -> src/app/api/payments/route.ts          (POST /api/payments)
 *   signed     -> src/app/api/payments/[id]/route.ts     (PATCH status SIGNED)
 *   submitted  -> src/app/api/payments/[id]/route.ts     (PATCH status SUBMITTED)
 *   confirmed  -> src/app/api/payments/[id]/route.ts     (PATCH status CONFIRMED)
 *                 and src/lib/payment-sync.ts            (on-chain reconciliation)
 *   completed  -> src/app/api/payments/[id]/route.ts     (PATCH status COMPLETED)
 *   failed     -> src/lib/payment-sync.ts                (on-chain failure)
 *                 and src/app/api/payments/[id]/route.ts (PATCH status FAILED)
 */
export const PAYMENT_LIFECYCLE_SAMPLES: readonly SampleDelivery[] = [
  {
    stage: "created",
    event: WEBHOOK_EVENTS.PAYMENT_CREATED,
    payload: envelope(WEBHOOK_EVENTS.PAYMENT_CREATED, T.created, {
      paymentId: "pay_01HZX8Q2M4T7K9V3N5P6R8S1TD",
      amount: "25.00",
      assetCode: "USDC",
      status: "CREATED",
      createdAt: T.created,
    }),
  },
  {
    stage: "signed",
    event: WEBHOOK_EVENTS.PAYMENT_SIGNED,
    payload: envelope(WEBHOOK_EVENTS.PAYMENT_SIGNED, T.signed, {
      paymentId: "pay_01HZX8Q2M4T7K9V3N5P6R8S1TD",
      amount: "25.00",
      assetCode: "USDC",
      status: "SIGNED",
      signedAt: T.signed,
    }),
  },
  {
    stage: "submitted",
    event: WEBHOOK_EVENTS.PAYMENT_SUBMITTED,
    payload: envelope(WEBHOOK_EVENTS.PAYMENT_SUBMITTED, T.submitted, {
      paymentId: "pay_01HZX8Q2M4T7K9V3N5P6R8S1TD",
      amount: "25.00",
      assetCode: "USDC",
      transactionHash: TX_HASH,
      submittedAt: T.submitted,
    }),
  },
  {
    stage: "confirmed",
    event: WEBHOOK_EVENTS.PAYMENT_CONFIRMED,
    payload: envelope(WEBHOOK_EVENTS.PAYMENT_CONFIRMED, T.confirmed, {
      paymentId: "pay_01HZX8Q2M4T7K9V3N5P6R8S1TD",
      amount: "25.00",
      assetCode: "USDC",
      transactionHash: TX_HASH,
      confirmedAt: T.confirmed,
    }),
  },
  {
    stage: "completed",
    event: WEBHOOK_EVENTS.PAYMENT_COMPLETED,
    payload: envelope(WEBHOOK_EVENTS.PAYMENT_COMPLETED, T.completed, {
      paymentId: "pay_01HZX8Q2M4T7K9V3N5P6R8S1TD",
      amount: "25.00",
      assetCode: "USDC",
      transactionHash: TX_HASH,
      completedAt: T.completed,
    }),
  },
  {
    stage: "failed",
    event: WEBHOOK_EVENTS.PAYMENT_FAILED,
    payload: envelope(WEBHOOK_EVENTS.PAYMENT_FAILED, T.failed, {
      paymentId: "pay_01HZX8Q2M4T7K9V3N5P6R8S1TD",
      amount: "25.00",
      assetCode: "USDC",
      transactionHash: TX_HASH,
      errorMessage: "op_underfunded: source account balance is below the payment amount",
      failedAt: T.failed,
    }),
  },
];

/**
 * The `data` fields each *dispatched* event carries, in the order the guide
 * documents them. Transcribed from the dispatch site named above each sample.
 */
export const EVENT_PAYLOAD_FIELDS: Record<WebhookEventType, readonly string[]> = {
  [WEBHOOK_EVENTS.PAYMENT_CREATED]: ["paymentId", "amount", "assetCode", "status", "createdAt"],
  [WEBHOOK_EVENTS.PAYMENT_SIGNED]: ["paymentId", "amount", "assetCode", "status", "signedAt"],
  [WEBHOOK_EVENTS.PAYMENT_SUBMITTED]: ["paymentId", "amount", "assetCode", "transactionHash", "submittedAt"],
  [WEBHOOK_EVENTS.PAYMENT_CONFIRMED]: ["paymentId", "amount", "assetCode", "transactionHash", "confirmedAt"],
  [WEBHOOK_EVENTS.PAYMENT_COMPLETED]: ["paymentId", "amount", "assetCode", "transactionHash", "completedAt"],
  [WEBHOOK_EVENTS.PAYMENT_FAILED]: ["paymentId", "amount", "assetCode", "transactionHash", "errorMessage", "failedAt"],
  [WEBHOOK_EVENTS.REQUEST_CREATED]: ["requestId", "amount", "assetCode", "description", "status", "createdAt"],
  // No dispatch site found in the repository as of this commit — see below.
  [WEBHOOK_EVENTS.BATCH_CREATED]: [],
  [WEBHOOK_EVENTS.BATCH_COMPLETED]: [],
  [WEBHOOK_EVENTS.BATCH_FAILED]: [],
  [WEBHOOK_EVENTS.RECURRENCE_TRIGGERED]: [],
  [WEBHOOK_EVENTS.RECURRENCE_COMPLETED]: [],
  [WEBHOOK_EVENTS.RECURRENCE_FAILED]: [],
  [WEBHOOK_EVENTS.REQUEST_PAID]: [],
  [WEBHOOK_EVENTS.REQUEST_EXPIRED]: [],
};

/**
 * Event types that exist in `WEBHOOK_EVENTS` but have no dispatch site in the
 * repository, so a subscription to them currently never fires.
 *
 * They are documented explicitly rather than silently omitted: an integrator who
 * wires up a batch or recurrence trigger in n8n deserves to know it will not be
 * called yet, and the guide test fails if this list and the code ever disagree.
 */
export const UNDISPATCHED_EVENTS: readonly WebhookEventType[] = [
  WEBHOOK_EVENTS.BATCH_CREATED,
  WEBHOOK_EVENTS.BATCH_COMPLETED,
  WEBHOOK_EVENTS.BATCH_FAILED,
  WEBHOOK_EVENTS.RECURRENCE_TRIGGERED,
  WEBHOOK_EVENTS.RECURRENCE_COMPLETED,
  WEBHOOK_EVENTS.RECURRENCE_FAILED,
  WEBHOOK_EVENTS.REQUEST_PAID,
  WEBHOOK_EVENTS.REQUEST_EXPIRED,
];

/** One-line meaning per field, shared by the guide's tables. */
export const FIELD_MEANINGS: Record<string, string> = {
  paymentId: "OphirPay payment id (`pay_…`) — stable across every stage of one payment",
  requestId: "OphirPay payment-request id — the link you shared with a payer",
  amount: "Decimal string in the asset's units. Keep it a string: parsing it as a float loses precision",
  assetCode: "Asset ticker, e.g. `USDC`",
  status: "Payment or request status at the moment this event fired",
  description: "Free-text description supplied when the record was created",
  transactionHash: "Stellar transaction hash — use it to link out to an explorer",
  errorMessage: "Human-readable failure reason; present only on the `failed` event",
  createdAt: "When the record was created",
  signedAt: "When the transaction was signed",
  submittedAt: "When the signed transaction was submitted to the network",
  confirmedAt: "When the network confirmed the transaction",
  completedAt: "When OphirPay marked the record completed",
  failedAt: "When the failure was recorded",
};
