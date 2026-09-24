/**
 * Slack payload adapter for OphirPay PaymentEvent webhook.
 *
 * The function receives a PaymentEvent object (as stored in the webhook
 * delivery record) and returns a JSON payload compatible with Slack's
 * Incoming Webhook API.
 *
 * NOTE: Slack cannot verify the HMAC signature that OphirPay adds to
 * webhook requests. Therefore this adapter should be used behind a
 * user‑controlled relay that first validates the signature and then
 * forwards the transformed payload to Slack.
 */

import { PaymentEvent } from '../../types/paymentEvent';

/**
 * Build a human‑readable Slack message from a payment event.
 *
 * @param event - The payment event emitted by OphirPay.
 * @returns An object ready to be JSON‑stringified and POSTed to a Slack
 *          Incoming Webhook URL.
 */
export function buildSlackPayload(event: PaymentEvent) {
  const title = `*Payment ${event.status.toUpperCase()}*`;
  const amountLine = `*Amount:* ${event.amount} ${event.currency}`;
  const idLine = `*Payment ID:* \`${event.id}\``;
  const txLine = event.transactionHash
    ? `*Tx Hash:* \`${event.transactionHash}\``
    : '*Tx Hash:* N/A';
  const timeLine = `*Created:* <!date^${Math.floor(
    new Date(event.createdAt).getTime() / 1000,
  )}^{date_short_pretty} at {time}|${event.createdAt}>`;

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${title}\n${amountLine}\n${idLine}\n${txLine}\n${timeLine}`,
      },
    },
    {
      type: 'divider',
    },
  ];

  // Include optional metadata as a separate section if present
  if (event.metadata && Object.keys(event.metadata).length > 0) {
    const metaLines = Object.entries(event.metadata)
      .map(([k, v]) => `*${k}:* ${v}`)
      .join('\n');

    blocks.splice(1, 0, {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: metaLines,
      },
    });
  }

  return {
    text: `Payment ${event.status}`,
    blocks,
  };
}
