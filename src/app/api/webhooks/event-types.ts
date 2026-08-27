// SPDX-License-Identifier: MIT

/**
 * Standard webhook event types for OphirPay.
 * These are the values used in the `events` array when creating a webhook.
 */

export const WEBHOOK_EVENTS = {
  PAYMENT_CREATED: "payment.created",
  PAYMENT_SIGNED: "payment.signed",
  PAYMENT_SUBMITTED: "payment.submitted",
  PAYMENT_CONFIRMED: "payment.confirmed",
  PAYMENT_COMPLETED: "payment.completed",
  PAYMENT_FAILED: "payment.failed",
  BATCH_CREATED: "batch.created",
  BATCH_COMPLETED: "batch.completed",
  BATCH_FAILED: "batch.failed",
  RECURRENCE_TRIGGERED: "recurrence.triggered",
  RECURRENCE_COMPLETED: "recurrence.completed",
  RECURRENCE_FAILED: "recurrence.failed",
  REQUEST_CREATED: "request.created",
  REQUEST_PAID: "request.paid",
  REQUEST_EXPIRED: "request.expired",
} as const;

export type WebhookEventType = (typeof WEBHOOK_EVENTS)[keyof typeof WEBHOOK_EVENTS];

export const WEBHOOK_EVENT_LABELS: Record<WebhookEventType, string> = {
  [WEBHOOK_EVENTS.PAYMENT_CREATED]: "Payment Created",
  [WEBHOOK_EVENTS.PAYMENT_SIGNED]: "Payment Signed",
  [WEBHOOK_EVENTS.PAYMENT_SUBMITTED]: "Payment Submitted",
  [WEBHOOK_EVENTS.PAYMENT_CONFIRMED]: "Payment Confirmed",
  [WEBHOOK_EVENTS.PAYMENT_COMPLETED]: "Payment Completed",
  [WEBHOOK_EVENTS.PAYMENT_FAILED]: "Payment Failed",
  [WEBHOOK_EVENTS.BATCH_CREATED]: "Batch Created",
  [WEBHOOK_EVENTS.BATCH_COMPLETED]: "Batch Completed",
  [WEBHOOK_EVENTS.BATCH_FAILED]: "Batch Failed",
  [WEBHOOK_EVENTS.RECURRENCE_TRIGGERED]: "Recurrence Triggered",
  [WEBHOOK_EVENTS.RECURRENCE_COMPLETED]: "Recurrence Completed",
  [WEBHOOK_EVENTS.RECURRENCE_FAILED]: "Recurrence Failed",
  [WEBHOOK_EVENTS.REQUEST_CREATED]: "Request Created",
  [WEBHOOK_EVENTS.REQUEST_PAID]: "Request Paid",
  [WEBHOOK_EVENTS.REQUEST_EXPIRED]: "Request Expired",
};

/** All webhook event types as an array for form dropdowns */
export const ALL_WEBHOOK_EVENTS = Object.values(WEBHOOK_EVENTS) as WebhookEventType[];
