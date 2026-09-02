// SPDX-License-Identifier: MIT

import { WEBHOOK_EVENTS, type WebhookEventType } from "@/app/api/webhooks/event-types";
import type { WebhookPayload } from "@/lib/webhook-deliver";

/**
 * Build a realistic but clearly-fake sample payload for an integrator test
 * event. No real payment/record is created server-side — the `test` flag
 * (on both the envelope and the data) lets receivers skip side effects.
 *
 * @param event The event type to simulate. Defaults to `payment.completed`.
 */
export function buildTestWebhookPayload(
  event: WebhookEventType = WEBHOOK_EVENTS.PAYMENT_COMPLETED,
): WebhookPayload {
  return {
    event,
    timestamp: new Date().toISOString(),
    test: true,
    data: {
      test: true,
      paymentId: "test_payment_000000000000000000000000",
      amount: "25.00",
      assetCode: "USDC",
      assetIssuer: "GA5ZSEJ4KZ3P4P6XWJLZ4TLQUDV6C6PDU4XJ7BCVQZ4TVPULZNK3WYJ",
      status: "COMPLETED",
      description: "OphirPay test event — no real payment was created",
      createdAt: new Date().toISOString(),
    },
  };
}
