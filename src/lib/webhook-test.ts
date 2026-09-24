// SPDX-License-Identifier: MIT

import { WEBHOOK_EVENTS, type WebhookEventType } from "@/app/api/webhooks/event-types";
import {
  type WebhookPayload,
  buildSignedPayload,
} from "@/lib/webhook-deliver";
import { validateWebhookUrlWithReason } from "@/lib/webhook-url-guard";

/**
 * Build a realistic but clearly-fake sample payload for an integrator test
 * event. No real payment/record is created server-side — the `test` flag
 * (on both the envelope and the data) lets receivers skip side effects.
 *
 * @param event The event type to simulate. Defaults to `payment.completed`.
 * @param timestamp Optional fixed timestamp for deterministic previews.
 */
export function buildTestWebhookPayload(
  event: WebhookEventType = WEBHOOK_EVENTS.PAYMENT_COMPLETED,
  timestamp?: string,
): WebhookPayload {
  const ts = timestamp ?? new Date().toISOString();
  let data: Record<string, unknown>;

  if (event.startsWith("batch.")) {
    data = {
      test: true,
      batchId: "test_batch_000000000000000000000000",
      totalPayments: 5,
      totalAmount: "125.00",
      assetCode: "USDC",
      status: event.endsWith(".failed") ? "FAILED" : "COMPLETED",
      description: "OphirPay test batch event — no real batch was processed",
      createdAt: ts,
    };
  } else if (event.startsWith("recurrence.")) {
    data = {
      test: true,
      scheduleId: "test_sched_000000000000000000000000",
      frequency: "MONTHLY",
      amount: "50.00",
      assetCode: "XLM",
      status: event.endsWith(".failed") ? "FAILED" : "COMPLETED",
      description: "OphirPay test recurrence event — no real recurrence occurred",
      createdAt: ts,
    };
  } else if (event.startsWith("request.")) {
    data = {
      test: true,
      requestId: "test_req_000000000000000000000000",
      amount: "100.00",
      assetCode: "USDC",
      status: event.endsWith(".paid") ? "PAID" : event.endsWith(".expired") ? "EXPIRED" : "PENDING",
      description: "OphirPay test payment request event — no real payment was requested",
      createdAt: ts,
    };
  } else {
    data = {
      test: true,
      paymentId: "test_payment_000000000000000000000000",
      amount: "25.00",
      assetCode: "USDC",
      assetIssuer: "GA5ZSEJ4KZ3P4P6XWJLZ4TLQUDV6C6PDU4XJ7BCVQZ4TVPULZNK3WYJ",
      status: event.endsWith(".failed") ? "FAILED" : "COMPLETED",
      description: "OphirPay test event — no real payment was created",
      createdAt: ts,
    };
  }

  return {
    event,
    timestamp: ts,
    test: true,
    data,
  };
}

export interface WebhookDeliveryPreview {
  url: string;
  urlGuard: { safe: boolean; reason?: string };
  event: WebhookEventType;
  headers: Record<string, string>;
  canonicalPayload: WebhookPayload & { signature: string };
  canonicalJson: string;
  outgoingBody: string;
  signature: string;
}

/**
 * Build delivery preview showing:
 * 1. Target URL and its URL guard validation outcome
 * 2. Canonical payload that will be signed (including signature scheme's empty-signature field)
 * 3. Headers that will be transmitted on the wire
 * 4. Byte-for-byte exact outgoing payload body
 */
export function buildWebhookPreview(
  url: string,
  secret = "",
  event: WebhookEventType = WEBHOOK_EVENTS.PAYMENT_COMPLETED,
  timestamp?: string,
): WebhookDeliveryPreview {
  const payload = buildTestWebhookPayload(event, timestamp);
  const { body: outgoingBody, signature } = buildSignedPayload(payload, secret);
  const canonicalPayload = { ...payload, signature: "" };
  const canonicalJson = JSON.stringify(canonicalPayload, null, 2);
  const urlGuard = validateWebhookUrlWithReason(url);

  return {
    url,
    urlGuard,
    event,
    headers: {
      "Content-Type": "application/json",
      "X-OphirPay-Signature": signature,
      "X-OphirPay-Event": payload.event,
    },
    canonicalPayload,
    canonicalJson,
    outgoingBody,
    signature,
  };
}
