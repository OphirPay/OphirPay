// SPDX-License-Identifier: MIT
//
// Automation-platform integration guide drift guard — issue #817.
//
// docs/AUTOMATION_PLATFORMS.md tells n8n / Zapier / Make users which events
// exist and what each payload carries. That claim fails *silently*: a renamed
// event type or a new field leaves the guide describing a delivery nobody
// sends, and the reader finds out only when their flow never fires.
//
// This suite binds the guide, the sample payloads and the event schema
// together, so the three cannot drift apart:
//   - every dispatched event has a sample and a documented field list;
//   - the samples match the fields the guide table claims;
//   - events with no dispatch site are declared as such, not silently missing;
//   - every payload in the guide's JSON blocks parses and matches the envelope.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ALL_WEBHOOK_EVENTS } from "@/app/api/webhooks/event-types";
import type { WebhookPayload } from "@/lib/webhook-deliver";
import {
  PAYMENT_LIFECYCLE_SAMPLES,
  EVENT_PAYLOAD_FIELDS,
  UNDISPATCHED_EVENTS,
  FIELD_MEANINGS,
} from "@/lib/automation-platform-samples";

const root = process.cwd();
const GUIDE = "docs/AUTOMATION_PLATFORMS.md";
const guide = readFileSync(join(root, GUIDE), "utf8");

/** Every fenced ```json block in the guide, parsed. */
function jsonBlocksIn(source: string): Array<Record<string, unknown>> {
  const blocks: Array<Record<string, unknown>> = [];
  const re = /```json\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    blocks.push(JSON.parse(m[1]) as Record<string, unknown>);
  }
  return blocks;
}

const envelopeShape = (p: WebhookPayload): string[] => Object.keys(p).sort();

describe("every event type is accounted for — #817", () => {
  it("documents a field list for each event type the schema declares", () => {
    // EVENT_PAYLOAD_FIELDS is typed as Record<WebhookEventType, …>, so a new
    // event type fails type-check; this asserts it at runtime too.
    for (const event of ALL_WEBHOOK_EVENTS) {
      expect(EVENT_PAYLOAD_FIELDS[event], `no field list for ${event}`).toBeDefined();
    }
  });

  it("partitions events into dispatched and undispatched with no overlap", () => {
    const dispatched = ALL_WEBHOOK_EVENTS.filter((e) => !UNDISPATCHED_EVENTS.includes(e));
    for (const e of dispatched) {
      expect(UNDISPATCHED_EVENTS, `${e} is both dispatched and undispatched`).not.toContain(e);
    }
    expect(dispatched.length + UNDISPATCHED_EVENTS.length).toBe(ALL_WEBHOOK_EVENTS.length);
  });

  it("gives every dispatched event a non-empty documented payload", () => {
    for (const event of ALL_WEBHOOK_EVENTS) {
      if (UNDISPATCHED_EVENTS.includes(event)) continue;
      expect(EVENT_PAYLOAD_FIELDS[event].length, `${event} has no documented fields`).toBeGreaterThan(0);
    }
  });

  it("gives no undocumented payload to an event that does not fire", () => {
    // Documenting fields for an event with no dispatcher would be invented data.
    for (const event of UNDISPATCHED_EVENTS) {
      expect(EVENT_PAYLOAD_FIELDS[event], `${event} should claim no fields`).toEqual([]);
    }
  });

  it("lists every undispatched event in the guide's own list", () => {
    for (const event of UNDISPATCHED_EVENTS) {
      expect(guide, `${event} is not mentioned in the guide`).toContain(event);
    }
  });
});

describe("sample payloads match the documented fields — #817", () => {
  it("covers at least one complete payload per lifecycle stage", () => {
    const stages = PAYMENT_LIFECYCLE_SAMPLES.map((s) => s.stage);
    expect(new Set(stages)).toEqual(
      new Set(["created", "signed", "submitted", "confirmed", "completed", "failed"]),
    );
  });

  it("uses the real envelope shape on every sample", () => {
    for (const { event, payload } of PAYMENT_LIFECYCLE_SAMPLES) {
      expect(envelopeShape(payload), `${event} envelope drifted`).toEqual(["data", "event", "signature", "timestamp"]);
      expect(payload.event).toBe(event);
    }
  });

  it("carries exactly the fields the field list claims", () => {
    for (const { event, payload } of PAYMENT_LIFECYCLE_SAMPLES) {
      const expected = [...EVENT_PAYLOAD_FIELDS[event]].sort();
      expect(Object.keys(payload.data).sort(), `${event} payload/field-list mismatch`).toEqual(expected);
    }
  });

  it("gives every documented field a meaning", () => {
    for (const event of ALL_WEBHOOK_EVENTS) {
      for (const field of EVENT_PAYLOAD_FIELDS[event]) {
        expect(FIELD_MEANINGS[field], `no meaning documented for "${field}"`).toBeTruthy();
      }
    }
  });

  it("keeps amounts as decimal strings, never numbers", () => {
    // `amount` is a decimal string in the API; a number in an example teaches
    // integrators to parse it as a float and lose precision.
    for (const { event, payload } of PAYMENT_LIFECYCLE_SAMPLES) {
      expect(typeof payload.data.amount, `${event}: amount must be a string`).toBe("string");
    }
  });

  it("keeps timestamps valid ISO-8601", () => {
    for (const { event, payload } of PAYMENT_LIFECYCLE_SAMPLES) {
      expect(Number.isNaN(Date.parse(payload.timestamp)), `${event}: bad timestamp`).toBe(false);
    }
  });
});

describe("the guide's JSON examples are real payloads — #817", () => {
  const blocks = jsonBlocksIn(guide);

  it("contains at least one JSON example per lifecycle stage", () => {
    expect(blocks.length).toBeGreaterThanOrEqual(PAYMENT_LIFECYCLE_SAMPLES.length);
  });

  it("shows each sample event in the guide", () => {
    for (const { event } of PAYMENT_LIFECYCLE_SAMPLES) {
      expect(blocks.some((b) => b.event === event), `${event} example missing from the guide`).toBe(true);
    }
  });

  it("parses every example into a well-formed envelope", () => {
    for (const block of blocks) {
      expect(typeof block.event).toBe("string");
      expect(typeof block.timestamp).toBe("string");
      expect(typeof block.data).toBe("object");
      expect(block).toHaveProperty("signature");
    }
  });

  it("uses an event type the schema actually declares", () => {
    for (const block of blocks) {
      expect(ALL_WEBHOOK_EVENTS, `guide shows unknown event ${String(block.event)}`).toContain(block.event);
    }
  });
});

describe("idempotency guidance is explicit — #817", () => {
  it("names the stable key to deduplicate on", () => {
    expect(guide).toContain("paymentId");
    expect(guide).toMatch(/idempotent/i);
  });

  it("warns against keying on a per-attempt identifier or the timestamp", () => {
    expect(guide).toContain("X-OphirPay-Delivery");
    expect(guide).toMatch(/at least once|at-least-once/i);
  });

  it("says which event to fulfil on", () => {
    // Fulfilling on `confirmed` rather than `completed` is a real integration
    // mistake; the guide has to pick one and say why.
    expect(guide).toMatch(/payment\.completed/);
    expect(guide).toMatch(/payment\.confirmed/);
  });
});

describe("platform guidance covers the no-HMAC case — #817", () => {
  it("names the platforms the guide is written for", () => {
    for (const platform of ["n8n", "Zapier", "Make"]) {
      expect(guide, `${platform} is not covered`).toContain(platform);
    }
  });

  it("tells a platform that cannot compute an HMAC what to do instead", () => {
    expect(guide).toMatch(/cannot compute an HMAC|cannot verify the signature/i);
    expect(guide).toMatch(/do not attempt|do not fake it/i);
  });

  it("states the replay window", () => {
    expect(guide).toMatch(/5 minutes|replay window/i);
  });
});
