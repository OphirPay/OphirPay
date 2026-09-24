/**
 * Discord payload adapter for OphirPay PaymentEvent webhook.
 *
 * Returns a payload compatible with Discord's webhook API (application/json).
 *
 * As with Slack, Discord cannot verify the HMAC signature attached to the
 * original OphirPay webhook, so this adapter should be used behind a trusted
 * relay that validates the signature first.
 */

import { PaymentEvent } from '../../types/paymentEvent';

export function buildDiscordPayload(event: PaymentEvent) {
  const embed = {
    title: `Payment ${event.status}`,
    color: event.status === 'succeeded' ? 0x57f287 : 0xf04747, // green / red
    fields: [
      {
        name: 'Amount',
        value: `${event.amount} ${event.currency}`,
        inline: true,
      },
      {
        name: 'Payment ID',
        value: `\`${event.id}\``,
        inline: true,
      },
      {
        name: 'Tx Hash',
        value: event.transactionHash ? `\`${event.transactionHash}\`` : 'N/A',
        inline: true,
      },
    ],
    timestamp: new Date(event.createdAt).toISOString(),
  };

  // Append metadata fields if any
  if (event.metadata && Object.keys(event.metadata).length > 0) {
    embed.fields.push({
      name: 'Metadata',
      value: Object.entries(event.metadata)
        .map(([k, v]) => `**${k}**: ${v}`)
        .join('\n'),
    });
  }

  return {
    embeds: [embed],
  };
}
