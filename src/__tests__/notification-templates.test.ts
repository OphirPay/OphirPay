// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  renderSlackPayload,
  renderDiscordPayload,
  verifySignature,
  OphirPayWebhookPayload,
} from "../../examples/notification-templates/relay-adapter";
import { isSubscribedToEvent } from "@/lib/webhook-filter";
import { buildSignedPayload } from "@/lib/webhook-deliver";

const SECRET = "test-secret-0123456789";

const mockEvent: OphirPayWebhookPayload = {
  event: "payment.confirmed",
  timestamp: "2026-09-24T12:00:00Z",
  data: {
    id: "p_test_123",
    amount: 150.5,
    asset: "USDC",
    recipient: "GA3DCS55ZXXXXXXXXXXXXXX",
    memo: "Invoice 101",
  },
  signature: "",
};

describe("Slack & Discord notification templates and relay adapter", () => {
  it("renders valid Slack Block Kit payload matching event details", () => {
    const slack = renderSlackPayload(mockEvent);
    expect(slack.text).toContain("payment.confirmed");
    expect(slack.blocks).toHaveLength(2);
    expect(slack.blocks[0].type).toBe("header");
    expect(slack.blocks[1].type).toBe("section");
    expect(slack.blocks[1].fields?.[0].text).toContain("p_test_123");
    expect(slack.blocks[1].fields?.[1].text).toContain("150.5");
  });

  it("renders valid Discord Embed payload with correct color coding", () => {
    const successDiscord = renderDiscordPayload(mockEvent);
    expect(successDiscord.embeds[0].color).toBe(0x2ecc71); // Green

    const failedEvent = { ...mockEvent, event: "payment.failed" };
    const failDiscord = renderDiscordPayload(failedEvent);
    expect(failDiscord.embeds[0].color).toBe(0xe74c3c); // Red

    const createdEvent = { ...mockEvent, event: "payment.created" };
    const infoDiscord = renderDiscordPayload(createdEvent);
    expect(infoDiscord.embeds[0].color).toBe(0x3498db); // Blue
  });

  it("verifies HMAC signature correctly with buildSignedPayload", () => {
    const signed = buildSignedPayload(
      { event: "payment.created", timestamp: "2026-09-24T12:00:00Z", data: { id: "1" } },
      SECRET
    );
    const valid = verifySignature(signed.body, signed.signature, SECRET);
    expect(valid).toBe(true);

    const tampered = signed.body.replace('"1"', '"2"');
    const invalid = verifySignature(tampered, signed.signature, SECRET);
    expect(invalid).toBe(false);
  });

  it("respects event filtering to prevent channel spamming", () => {
    const subscriptionList = JSON.stringify(["payment.confirmed", "payment.failed"]);
    expect(isSubscribedToEvent(subscriptionList, "payment.confirmed")).toBe(true);
    expect(isSubscribedToEvent(subscriptionList, "payment.failed")).toBe(true);
    expect(isSubscribedToEvent(subscriptionList, "payment.created")).toBe(false);
    expect(isSubscribedToEvent(subscriptionList, "payment.signed")).toBe(false);
  });

  it("committed sample JSON files match schema and parse cleanly", () => {
    const slackSample = JSON.parse(
      fs.readFileSync(path.resolve("examples/notification-templates/slack-sample.json"), "utf8")
    );
    expect(slackSample.blocks[0].type).toBe("header");

    const discordSample = JSON.parse(
      fs.readFileSync(path.resolve("examples/notification-templates/discord-sample.json"), "utf8")
    );
    expect(discordSample.embeds[0].title).toContain("payment.confirmed");
  });
});
