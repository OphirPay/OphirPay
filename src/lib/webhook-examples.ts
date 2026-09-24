// SPDX-License-Identifier: MIT

import { ALL_WEBHOOK_EVENTS, WEBHOOK_EVENTS, type WebhookEventType } from "@/app/api/webhooks/event-types";
import type { WebhookPayload } from "@/lib/webhook-deliver";

export type WebhookLifecycleStage = "created" | "signed" | "submitted" | "confirmed" | "failed";

export interface WebhookEventDocumentation {
  event: WebhookEventType;
  lifecycleStage: WebhookLifecycleStage;
  description: string;
  fields: Record<string, string>;
}

const BASE_PAYMENT_FIELDS: Record<string, string> = {
  paymentId: "OphirPay payment identifier used for idempotent consumption.",
  userId: "OphirPay user that owns the payment.",
  amount: "Decimal asset amount as a string; do not parse as floating point for accounting.",
  assetCode: "Asset code such as XLM or USDC.",
  assetIssuer: "Issuer public key for non-native assets; null for native XLM.",
  source: "Source Stellar public key.",
  destination: "Destination Stellar public key.",
  memo: "Optional Stellar memo copied from the payment request.",
  status: "Current payment lifecycle status.",
  createdAt: "ISO-8601 timestamp when the payment was created.",
  updatedAt: "ISO-8601 timestamp when the lifecycle event was emitted.",
};

const BATCH_FIELDS: Record<string, string> = {
  batchId: "OphirPay batch identifier used as the batch-level idempotency key.",
  userId: "OphirPay user that owns the batch.",
  paymentIds: "Payment identifiers included in the batch.",
  totalAmount: "Decimal total for the batch as a string.",
  assetCode: "Asset code for the batch.",
  status: "Current batch lifecycle status.",
  createdAt: "ISO-8601 timestamp when the batch was created.",
  updatedAt: "ISO-8601 timestamp when the lifecycle event was emitted.",
};

const RECURRENCE_FIELDS: Record<string, string> = {
  recurrenceId: "Recurring payment schedule identifier.",
  userId: "OphirPay user that owns the schedule.",
  paymentId: "Payment identifier created by this recurrence run, when available.",
  runAt: "ISO-8601 timestamp for the recurrence attempt.",
  status: "Current recurrence lifecycle status.",
  failureReason: "Human-readable failure reason for failed recurrence events.",
};

const REQUEST_FIELDS: Record<string, string> = {
  requestId: "Payment-request identifier used for idempotent consumption.",
  userId: "OphirPay user that owns the request.",
  payerAddress: "Stellar public key that paid the request, when known.",
  amount: "Requested decimal amount as a string.",
  assetCode: "Requested asset code.",
  status: "Current request lifecycle status.",
  expiresAt: "ISO-8601 expiration timestamp for request.expired events.",
  paidAt: "ISO-8601 timestamp for request.paid events.",
};

export const WEBHOOK_EVENT_DOCUMENTATION: WebhookEventDocumentation[] = [
  { event: WEBHOOK_EVENTS.PAYMENT_CREATED, lifecycleStage: "created", description: "A payment row was created but has not been signed yet.", fields: BASE_PAYMENT_FIELDS },
  { event: WEBHOOK_EVENTS.PAYMENT_SIGNED, lifecycleStage: "signed", description: "The payment transaction was signed by the source wallet.", fields: { ...BASE_PAYMENT_FIELDS, signedAt: "ISO-8601 timestamp when the transaction was signed." } },
  { event: WEBHOOK_EVENTS.PAYMENT_SUBMITTED, lifecycleStage: "submitted", description: "The signed payment was submitted to the Stellar network.", fields: { ...BASE_PAYMENT_FIELDS, submittedAt: "ISO-8601 submission timestamp.", transactionHash: "Stellar transaction hash returned by Horizon." } },
  { event: WEBHOOK_EVENTS.PAYMENT_CONFIRMED, lifecycleStage: "confirmed", description: "The Stellar network confirmed the payment transaction.", fields: { ...BASE_PAYMENT_FIELDS, confirmedAt: "ISO-8601 confirmation timestamp.", transactionHash: "Confirmed Stellar transaction hash.", ledger: "Ledger sequence that included the transaction." } },
  { event: WEBHOOK_EVENTS.PAYMENT_COMPLETED, lifecycleStage: "confirmed", description: "The payment is complete from OphirPay's perspective.", fields: { ...BASE_PAYMENT_FIELDS, completedAt: "ISO-8601 completion timestamp.", transactionHash: "Final transaction hash when the payment completed on-chain." } },
  { event: WEBHOOK_EVENTS.PAYMENT_FAILED, lifecycleStage: "failed", description: "The payment failed before completion.", fields: { ...BASE_PAYMENT_FIELDS, failedAt: "ISO-8601 failure timestamp.", failureReason: "Human-readable failure reason.", failureCode: "Stable machine-readable failure code when available." } },
  { event: WEBHOOK_EVENTS.BATCH_CREATED, lifecycleStage: "created", description: "A batch payment was created.", fields: BATCH_FIELDS },
  { event: WEBHOOK_EVENTS.BATCH_COMPLETED, lifecycleStage: "confirmed", description: "Every payment in the batch completed.", fields: { ...BATCH_FIELDS, completedAt: "ISO-8601 batch completion timestamp." } },
  { event: WEBHOOK_EVENTS.BATCH_FAILED, lifecycleStage: "failed", description: "One or more payments in the batch failed.", fields: { ...BATCH_FIELDS, failedPaymentIds: "Payment identifiers that failed.", failureReason: "Human-readable failure reason." } },
  { event: WEBHOOK_EVENTS.RECURRENCE_TRIGGERED, lifecycleStage: "submitted", description: "A recurring payment schedule produced a payment attempt.", fields: RECURRENCE_FIELDS },
  { event: WEBHOOK_EVENTS.RECURRENCE_COMPLETED, lifecycleStage: "confirmed", description: "A recurring payment attempt completed.", fields: RECURRENCE_FIELDS },
  { event: WEBHOOK_EVENTS.RECURRENCE_FAILED, lifecycleStage: "failed", description: "A recurring payment attempt failed.", fields: RECURRENCE_FIELDS },
  { event: WEBHOOK_EVENTS.REQUEST_CREATED, lifecycleStage: "created", description: "A shareable payment request was created.", fields: REQUEST_FIELDS },
  { event: WEBHOOK_EVENTS.REQUEST_PAID, lifecycleStage: "confirmed", description: "A payment request was paid.", fields: REQUEST_FIELDS },
  { event: WEBHOOK_EVENTS.REQUEST_EXPIRED, lifecycleStage: "failed", description: "A payment request expired before payment.", fields: REQUEST_FIELDS },
];

const ISO_BY_STAGE: Record<WebhookLifecycleStage, string> = {
  created: "2026-08-14T10:00:00.000Z",
  signed: "2026-08-14T10:01:00.000Z",
  submitted: "2026-08-14T10:02:00.000Z",
  confirmed: "2026-08-14T10:03:00.000Z",
  failed: "2026-08-14T10:04:00.000Z",
};

export function getWebhookEventDocumentation(event: WebhookEventType): WebhookEventDocumentation {
  const found = WEBHOOK_EVENT_DOCUMENTATION.find((entry) => entry.event === event);
  if (!found) throw new Error(`No webhook documentation for ${event}`);
  return found;
}

export function buildWebhookExamplePayload(event: WebhookEventType): WebhookPayload {
  const doc = getWebhookEventDocumentation(event);
  const timestamp = ISO_BY_STAGE[doc.lifecycleStage];
  const commonPayment = {
    paymentId: "pay_01J8Y6Y8R8V9K4W0T3N5B7C9D2",
    userId: "usr_01J8Y6Y8R8V9K4W0T3N5B7C9D2",
    amount: "125.50",
    assetCode: "USDC",
    assetIssuer: "GA5ZSEJ4KZ3P4P6XWJLZ4TLQUDV6C6PDU4XJ7BCVQZ4TVPULZNK3WYJ",
    source: "GB7ZSEJ4KZ3P4P6XWJLZ4TLQUDV6C6PDU4XJ7BCVQZ4TVPULZNK3ABC",
    destination: "GC6ZSEJ4KZ3P4P6XWJLZ4TLQUDV6C6PDU4XJ7BCVQZ4TVPULZNK3DEF",
    memo: "invoice-1042",
    status: doc.lifecycleStage.toUpperCase(),
    createdAt: ISO_BY_STAGE.created,
    updatedAt: timestamp,
  };

  if (event.startsWith("payment.")) {
    return {
      event,
      timestamp,
      data: {
        ...commonPayment,
        ...(doc.lifecycleStage === "signed" ? { signedAt: timestamp } : {}),
        ...(doc.lifecycleStage === "submitted" ? { submittedAt: timestamp, transactionHash: "8fd3a8f7b4d21678320d8f2f5e5a5b8f9c0d1e2f3a4b5c6d7e8f90123456789a" } : {}),
        ...(doc.lifecycleStage === "confirmed" ? { confirmedAt: timestamp, completedAt: timestamp, transactionHash: "8fd3a8f7b4d21678320d8f2f5e5a5b8f9c0d1e2f3a4b5c6d7e8f90123456789a", ledger: 54123123 } : {}),
        ...(doc.lifecycleStage === "failed" ? { failedAt: timestamp, failureReason: "Destination account lacks the required trustline", failureCode: "DESTINATION_TRUSTLINE_MISSING" } : {}),
      },
    };
  }

  if (event.startsWith("batch.")) {
    return {
      event,
      timestamp,
      data: {
        batchId: "bat_01J8Y6Y8R8V9K4W0T3N5B7C9D2",
        userId: "usr_01J8Y6Y8R8V9K4W0T3N5B7C9D2",
        paymentIds: ["pay_01J8Y6Y8R8V9K4W0T3N5B7C9D2", "pay_01J8Y6Y8R8V9K4W0T3N5B7C9D3"],
        totalAmount: "251.00",
        assetCode: "USDC",
        status: doc.lifecycleStage.toUpperCase(),
        createdAt: ISO_BY_STAGE.created,
        updatedAt: timestamp,
        ...(doc.lifecycleStage === "confirmed" ? { completedAt: timestamp } : {}),
        ...(doc.lifecycleStage === "failed" ? { failedPaymentIds: ["pay_01J8Y6Y8R8V9K4W0T3N5B7C9D3"], failureReason: "One payment failed validation" } : {}),
      },
    };
  }

  if (event.startsWith("recurrence.")) {
    return {
      event,
      timestamp,
      data: {
        recurrenceId: "rec_01J8Y6Y8R8V9K4W0T3N5B7C9D2",
        userId: "usr_01J8Y6Y8R8V9K4W0T3N5B7C9D2",
        paymentId: event === WEBHOOK_EVENTS.RECURRENCE_FAILED ? null : "pay_01J8Y6Y8R8V9K4W0T3N5B7C9D2",
        runAt: timestamp,
        status: doc.lifecycleStage.toUpperCase(),
        ...(event === WEBHOOK_EVENTS.RECURRENCE_FAILED ? { failureReason: "Insufficient source balance" } : {}),
      },
    };
  }

  return {
    event,
    timestamp,
    data: {
      requestId: "req_01J8Y6Y8R8V9K4W0T3N5B7C9D2",
      userId: "usr_01J8Y6Y8R8V9K4W0T3N5B7C9D2",
      payerAddress: event === WEBHOOK_EVENTS.REQUEST_PAID ? "GC6ZSEJ4KZ3P4P6XWJLZ4TLQUDV6C6PDU4XJ7BCVQZ4TVPULZNK3DEF" : null,
      amount: "125.50",
      assetCode: "USDC",
      status: doc.lifecycleStage.toUpperCase(),
      expiresAt: "2026-08-21T10:00:00.000Z",
      ...(event === WEBHOOK_EVENTS.REQUEST_PAID ? { paidAt: timestamp } : {}),
    },
  };
}

export function buildWebhookExamplesByLifecycle(): Record<WebhookLifecycleStage, WebhookPayload> {
  return {
    created: buildWebhookExamplePayload(WEBHOOK_EVENTS.PAYMENT_CREATED),
    signed: buildWebhookExamplePayload(WEBHOOK_EVENTS.PAYMENT_SIGNED),
    submitted: buildWebhookExamplePayload(WEBHOOK_EVENTS.PAYMENT_SUBMITTED),
    confirmed: buildWebhookExamplePayload(WEBHOOK_EVENTS.PAYMENT_CONFIRMED),
    failed: buildWebhookExamplePayload(WEBHOOK_EVENTS.PAYMENT_FAILED),
  };
}

export function validateWebhookDocumentationCoverage(): void {
  const documented = new Set(WEBHOOK_EVENT_DOCUMENTATION.map((entry) => entry.event));
  for (const event of ALL_WEBHOOK_EVENTS) {
    if (!documented.has(event)) throw new Error(`Missing webhook documentation for ${event}`);
    const payload = buildWebhookExamplePayload(event);
    if (payload.event !== event) throw new Error(`Example event mismatch for ${event}`);
    if (!payload.timestamp || typeof payload.data !== "object") {
      throw new Error(`Invalid example payload for ${event}`);
    }
  }
}
