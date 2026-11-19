// SPDX-License-Identifier: MIT
/**
 * Slack and Discord Notification Relay Adapter for OphirPay Webhooks.
 *
 * Security Note:
 * Slack and Discord incoming webhook endpoints cannot verify HMAC-SHA256 signatures.
 * Therefore, this relay adapter MUST sit between OphirPay and your chat platforms.
 * It cryptographically verifies incoming deliveries, filters events, and renders
 * user-friendly rich cards for your team.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { isSubscribedToEvent } from "../../src/lib/webhook-filter";

export interface OphirPayWebhookPayload {
  event: string;
  timestamp: string;
  data: Record<string, any>;
  signature: string;
}

export interface SlackBlockPayload {
  text: string;
  blocks: Array<{
    type: string;
    text?: { type: string; text: string; emoji?: boolean };
    fields?: Array<{ type: string; text: string }>;
  }>;
}

export interface DiscordEmbedPayload {
  content?: string;
  embeds: Array<{
    title: string;
    description: string;
    color: number;
    timestamp: string;
    fields: Array<{ name: string; value: string; inline?: boolean }>;
    footer: { text: string };
  }>;
}

/**
 * Verifies the incoming OphirPay webhook signature.
 */
export function verifySignature(rawBody: string, signature: string, secret: string): boolean {
  try {
    const parsed = JSON.parse(rawBody);
    const canonical = JSON.stringify({ ...parsed, signature: "" });
    const expected = createHmac("sha256", secret)
      .update(`${parsed.timestamp}.${canonical}`)
      .digest("hex");
    const a = Buffer.from(signature || "");
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Transforms an OphirPay event into a Slack Block Kit payload.
 */
export function renderSlackPayload(payload: OphirPayWebhookPayload): SlackBlockPayload {
  const { event, timestamp, data } = payload;
  const isFailure = event.endsWith(".failed");
  const isSuccess = event.endsWith(".confirmed") || event.endsWith(".completed");
  const statusIcon = isFailure ? "🚨" : isSuccess ? "✅" : "ℹ️";

  return {
    text: `${statusIcon} OphirPay Event: ${event}`,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `${statusIcon} ${event.toUpperCase()}`,
          emoji: true,
        },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*ID:* \`${data.id || "N/A"}\`` },
          { type: "mrkdwn", text: `*Amount:* *${data.amount != null ? data.amount : "N/A"}* ${data.asset || "XLM"}` },
          { type: "mrkdwn", text: `*Time:* ${timestamp}` },
          { type: "mrkdwn", text: `*Recipient:* \`${data.recipient ? String(data.recipient).slice(0, 10) + "..." : "N/A"}\`` },
        ],
      },
    ],
  };
}

/**
 * Transforms an OphirPay event into a Discord Embed payload.
 */
export function renderDiscordPayload(payload: OphirPayWebhookPayload): DiscordEmbedPayload {
  const { event, timestamp, data } = payload;
  const isFailure = event.endsWith(".failed");
  const isSuccess = event.endsWith(".confirmed") || event.endsWith(".completed");

  // Discord colors: Red = 0xE74C3C, Green = 0x2ECC71, Blue = 0x3498DB
  const color = isFailure ? 0xe74c3c : isSuccess ? 0x2ecc71 : 0x3498db;

  return {
    embeds: [
      {
        title: `OphirPay Notification: ${event}`,
        description: `Lifecycle event triggered for transaction \`${data.id || "N/A"}\``,
        color,
        timestamp,
        fields: [
          { name: "Amount", value: `${data.amount != null ? data.amount : "N/A"} ${data.asset || "XLM"}`, inline: true },
          { name: "Recipient", value: data.recipient ? `\`${String(data.recipient).slice(0, 12)}...\`` : "N/A", inline: true },
          { name: "Batch / Memo", value: data.memo || data.batchId || "None", inline: true },
        ],
        footer: { text: "OphirPay Payment Orchestration" },
      },
    ],
  };
}

/**
 * Dispatches an event to Slack or Discord if subscribed in filter.
 */
export async function relayNotification(
  rawBody: string,
  signature: string,
  secret: string,
  subscribedEventsJson: string,
  destination: "slack" | "discord",
  webhookUrl: string
): Promise<{ success: boolean; reason?: string }> {
  if (!verifySignature(rawBody, signature, secret)) {
    return { success: false, reason: "Invalid HMAC signature" };
  }

  let payload: OphirPayWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { success: false, reason: "Malformed JSON" };
  }

  if (!isSubscribedToEvent(subscribedEventsJson, payload.event)) {
    return { success: true, reason: "Event filtered out (not in subscription list)" };
  }

  const bodyData =
    destination === "slack"
      ? renderSlackPayload(payload)
      : renderDiscordPayload(payload);

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bodyData),
  });

  return { success: res.ok, reason: res.ok ? undefined : `HTTP ${res.status}` };
}
