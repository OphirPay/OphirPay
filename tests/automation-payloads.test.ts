// SPDX-License-Identifier: MIT

/**
 * Schema validation for the automation-platform reference payloads.
 *
 * The payloads in examples/automation-payloads.json are consumed by
 * no-code users (n8n / Zapier / Make) who cannot read the Rust emitter or
 * the SDK types, so they must never drift from the source of truth:
 *
 *   - event names  ->  WEBHOOK_EVENTS in src/app/api/webhooks/event-types.ts
 *   - envelope     ->  `{ event, timestamp, data }` in src/lib/webhook-dispatcher.ts
 *
 * This test is the only thing standing between a stale doc example and a
 * broken customer automation, so keep it in the default vitest run.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { WEBHOOK_EVENTS } from "@/app/api/webhooks/event-types";

interface AutomationPayloads {
  envelope: { event: string; timestamp: string; data: Record<string, unknown> };
  lifecycle: Record<
    string,
    {
      event: string;
      description: string;
      payload: {
        event: string;
        timestamp: string;
        data: Record<string, unknown>;
      };
    }
  >;
}

const raw = readFileSync(
  resolve(process.cwd(), "examples/automation-payloads.json"),
  "utf8",
);
// The file carries a leading "//" documentation key; JSON.parse tolerates it
// because the value is a plain object with a quoted key.
const fixtures = JSON.parse(raw) as AutomationPayloads;

const ENVELOPE_KEYS = ["event", "timestamp", "data"];

/** The lifecycle stages every payment moves through, in order. */
const REQUIRED_STAGES = ["created", "signed", "submitted", "confirmed", "failed"];

const KNOWN_EVENT_VALUES = new Set<string>(Object.values(WEBHOOK_EVENTS));

describe("automation-platform payload fixtures", () => {
  it("parses and exposes the documented shape", () => {
    expect(fixtures).toBeTruthy();
    expect(typeof fixtures.envelope).toBe("object");
    expect(Object.keys(fixtures.lifecycle).length).toBeGreaterThan(0);
  });

  it("covers every payment lifecycle stage", () => {
    for (const stage of REQUIRED_STAGES) {
      expect(fixtures.lifecycle, `missing stage ${stage}`).toHaveProperty(stage);
    }
  });

  it("only uses event types the backend can actually emit", () => {
    const seen: string[] = [];
    seen.push(fixtures.envelope.event);
    for (const stage of Object.values(fixtures.lifecycle)) {
      seen.push(stage.event);
    }
    for (const event of seen) {
      expect(
        KNOWN_EVENT_VALUES,
        `unknown event "${event}" — add it to WEBHOOK_EVENTS or fix the fixture`,
      ).toContain(event);
    }
  });

  it("keeps the stage key and the payload event in sync", () => {
    // A reader of docs/AUTOMATION_PLATFORMS.md maps stage -> event, so a
    // mismatch would silently teach the wrong mapping.
    for (const [stage, spec] of Object.entries(fixtures.lifecycle)) {
      expect(spec.payload.event, `stage ${stage}`).toBe(spec.event);
    }
  });

  it("matches the real webhook envelope exactly", () => {
    for (const [stage, spec] of Object.entries(fixtures.lifecycle)) {
      expect(
        Object.keys(spec.payload).sort(),
        `stage ${stage} has unexpected envelope keys`,
      ).toEqual(ENVELOPE_KEYS);
    }
    expect(Object.keys(fixtures.envelope).sort()).toEqual(ENVELOPE_KEYS);
  });

  it("uses RFC 3339 timestamps", () => {
    const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
    const stamps = [
      fixtures.envelope.timestamp,
      ...Object.values(fixtures.lifecycle).map((s) => s.payload.timestamp),
    ];
    for (const stamp of stamps) {
      expect(stamp, `bad timestamp ${stamp}`).toMatch(iso);
    }
  });

  it("keeps every lifecycle payload carrying a data object", () => {
    for (const [stage, spec] of Object.entries(fixtures.lifecycle)) {
      expect(
        typeof spec.payload.data,
        `stage ${stage} data must be an object`,
      ).toBe("object");
      expect(spec.payload.data, `stage ${stage} data must not be null`).not.toBeNull();
      expect(spec.description.length, `stage ${stage} needs a description`).toBeGreaterThan(20);
    }
  });

  it("identifies payments consistently across stages", () => {
    // The same payment must be traceable from created -> confirmed.
    const ids = Object.values(fixtures.lifecycle).map(
      (s) => (s.payload.data as { id?: string }).id,
    );
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(1);
  });

  it("carries an idempotency key on the stage where a duplicate could be created", () => {
    expect(fixtures.lifecycle.created.payload.data).toHaveProperty("idempotencyKey");
  });
});
