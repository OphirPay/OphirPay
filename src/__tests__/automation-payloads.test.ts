// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { LIFECYCLE_PAYLOADS } from "../../examples/automation-payloads/generate-payloads";
import { WEBHOOK_EVENTS } from "@/app/api/webhooks/event-types";

describe("Automation platform lifecycle payloads and schema validation", () => {
  const payloadDir = path.resolve(process.cwd(), "examples/automation-payloads");
  const docPath = path.resolve(process.cwd(), "docs/automation-integrations.md");
  const requiredStages = ["created", "signed", "submitted", "confirmed", "failed"];

  it("includes all 5 required lifecycle stages in LIFECYCLE_PAYLOADS", () => {
    for (const stage of requiredStages) {
      expect(LIFECYCLE_PAYLOADS).toHaveProperty(stage);
      const payload = LIFECYCLE_PAYLOADS[stage];
      expect(payload.event).toBe(`payment.${stage}`);
      expect(payload.idempotency_key).toMatch(/^idem_/);
      expect(payload.data.id).toMatch(/^pay_/);
      expect(payload.timestamp).toBeDefined();
    }
  });

  it("committed JSON files exist and match schema for each lifecycle stage", () => {
    for (const stage of requiredStages) {
      const filePath = path.join(payloadDir, `payment.${stage}.json`);
      expect(fs.existsSync(filePath)).toBe(true);

      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      expect(parsed.event).toBe(`payment.${stage}`);
      expect(parsed.data.amount).toBe(100.0);
      expect(parsed.data.asset).toBe("USDC");

      if (stage === "failed") {
        expect(parsed.data.error_code).toBeDefined();
        expect(parsed.data.error_message).toBeDefined();
      }
      if (stage === "submitted" || stage === "confirmed") {
        expect(parsed.data.tx_hash).toBeDefined();
      }
    }
  });

  it("documentation includes explicit idempotency guidance and all lifecycle stages", () => {
    expect(fs.existsSync(docPath)).toBe(true);
    const doc = fs.readFileSync(docPath, "utf8");

    expect(doc).toContain("Idempotent Consumption Guidance");
    expect(doc).toContain("payment.created");
    expect(doc).toContain("payment.signed");
    expect(doc).toContain("payment.submitted");
    expect(doc).toContain("payment.confirmed");
    expect(doc).toContain("payment.failed");
  });
});
