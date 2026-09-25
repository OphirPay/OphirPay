// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ALL_WEBHOOK_EVENTS } from "@/app/api/webhooks/event-types";
import {
  WEBHOOK_EVENT_DOCUMENTATION,
  buildWebhookExamplePayload,
  buildWebhookExamplesByLifecycle,
  validateWebhookDocumentationCoverage,
} from "@/lib/webhook-examples";

const guidePath = path.join(process.cwd(), "docs", "automation-platform-webhooks.md");
const guide = fs.readFileSync(guidePath, "utf8").replace(/\r\n/g, "\n");

describe("automation-platform webhook guide", () => {
  it("documents every supported webhook event", () => {
    validateWebhookDocumentationCoverage();
    expect(WEBHOOK_EVENT_DOCUMENTATION).toHaveLength(ALL_WEBHOOK_EVENTS.length);

    for (const event of ALL_WEBHOOK_EVENTS) {
      expect(guide).toContain(`\`${event}\``);
      const payload = buildWebhookExamplePayload(event);
      expect(payload.event).toBe(event);
      expect(payload.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(payload.data).not.toEqual({});
    }
  });

  it("contains complete examples for each required lifecycle stage", () => {
    const examples = buildWebhookExamplesByLifecycle();
    expect(Object.keys(examples).sort()).toEqual(["confirmed", "created", "failed", "signed", "submitted"]);

    for (const payload of Object.values(examples)) {
      const rendered = JSON.stringify(payload, null, 2);
      expect(guide).toContain(rendered);
    }
  });

  it("makes idempotent consumption explicit", () => {
    expect(guide).toContain("at-least-once delivery");
    expect(guide).toContain("event + ':' + data.paymentId");
    expect(guide).toContain("event + ':' + data.batchId");
    expect(guide).toContain("event + ':' + data.recurrenceId + ':' + data.runAt");
    expect(guide).toContain("event + ':' + data.requestId");
  });

  it("warns no-code users not to skip signature verification", () => {
    expect(guide).toContain("do **not** skip verification");
    expect(guide).toContain("verified relay endpoint");
    expect(guide).toContain("n8n");
    expect(guide).toContain("Make");
    expect(guide).toContain("Zapier");
  });
});
