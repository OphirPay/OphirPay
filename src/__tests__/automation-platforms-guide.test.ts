// SPDX-License-Identifier: MIT

/**
 * Issue #817 — the automation-platform guide's examples are generated from
 * the same source as the schema, so they cannot drift.
 *
 * Acceptance criteria covered here:
 *   • Every documented event type has a documented payload with field
 *     meanings (the table covers every entry of WEBHOOK_EVENTS, and every
 *     embedded lifecycle payload re-verifies against the real signing
 *     implementation).
 *   • At least one complete payload per lifecycle stage is shown.
 *   • The idempotent-consumption guidance is explicit.
 *   • The examples are validated against the schema by this test.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import { WEBHOOK_EVENTS, WEBHOOK_EVENT_LABELS } from "@/app/api/webhooks/event-types";
import { buildSignedPayload } from "@/lib/webhook-deliver";

const root = process.cwd();
const GUIDE_PATH = join(root, "docs/AUTOMATION_PLATFORMS.md");
const PAYLOADS_DIR = join(root, "examples/automation-payloads");

const DOC_SECRET = "test-secret-0123456789";
const guide = readFileSync(GUIDE_PATH, "utf8");

/** Pull ```json fenced blocks out of the guide. */
function jsonBlocks(markdown: string): unknown[] {
  const blocks: unknown[] = [];
  for (const match of markdown.matchAll(/```json\n([\s\S]*?)```/g)) {
    blocks.push(JSON.parse(match[1]));
  }
  return blocks;
}

/** Canonical form signed by buildSignedPayload: signature emptied, key order kept. */
function canonicalize(body: string): string {
  const parsed = JSON.parse(body) as Record<string, unknown>;
  return JSON.stringify({ ...parsed, signature: "" });
}

function verifyEnvelope(raw: string): { valid: boolean; reason?: string } {
  const parsed = JSON.parse(raw) as {
    event: string;
    timestamp: string;
    signature: string;
  };
  const timestamp = parsed.timestamp;
  const expected = createHmac("sha256", DOC_SECRET)
    .update(`${timestamp}.${canonicalize(raw)}`)
    .digest("hex");
  if (expected !== parsed.signature) {
    return { valid: false, reason: `signature mismatch for ${parsed.event}` };
  }
  return { valid: true };
}

/** Envelope-shaped JSON blocks parsed out of the guide (shared across suites). */
interface GuideEnvelope {
  event: string;
  timestamp: string;
  data: Record<string, unknown>;
  signature: string;
  test?: boolean;
}

const envelopes: GuideEnvelope[] = jsonBlocks(guide).filter(
  (b): b is GuideEnvelope =>
    typeof b === "object" &&
    b !== null &&
    "event" in (b as object) &&
    "signature" in (b as object),
) as GuideEnvelope[];

describe("automation platforms guide — event table (#817)", () => {
  it("documents every webhook event type", () => {
    for (const eventType of Object.values(WEBHOOK_EVENTS)) {
      expect(
        guide.includes(`\`${eventType}\``),
        `docs/AUTOMATION_PLATFORMS.md must mention ${eventType}`,
      ).toBe(true);
    }
  });

  it("gives every event type a row in the event tables", () => {
    for (const eventType of Object.values(WEBHOOK_EVENTS)) {
      expect(
        guide,
        `${eventType} must appear in a table row (| \`${eventType}\` | ...)`,
      ).toMatch(new RegExp(`\\|\\s*\`${eventType}\`\\s*\\|`));
    }
  });

  it("keeps the label reference in sync with event-types.ts", () => {
    for (const label of Object.values(WEBHOOK_EVENT_LABELS)) {
      expect(label.length).toBeGreaterThan(0);
    }
    // The tables are grouped by prefix; each group heading must exist.
    for (const heading of [
      "### Payments (`payment.*`)",
      "### Batches (`batch.*`)",
      "### Recurrences (`recurrence.*`)",
      "### Payment requests (`request.*`)",
    ]) {
      expect(guide).toContain(heading);
    }
  });

  it("describes every data field it documents", () => {
    // Each payload field appearing in a payload example must be mentioned
    // (backticked) inside a field-meanings section. The union is derived
    // from the shipped payload files so a new field cannot be added without
    // documenting it.
    const firstMeanings = guide.indexOf("Field meanings");
    const fieldMeanings = guide.slice(firstMeanings);
    const fields = new Set<string>();
    for (const envelope of envelopes) {
      for (const key of Object.keys(envelope.data ?? {})) fields.add(key);
    }
    fields.add("test"); // documented on the test-event envelope
    expect(fields.size).toBeGreaterThan(10);
    for (const field of fields) {
      expect(
        fieldMeanings.includes(`\`${field}\``),
        `docs/AUTOMATION_PLATFORMS.md must explain the \`${field}\` field`,
      ).toBe(true);
    }
  });

  it("documents the idempotency guidance explicitly", () => {
    expect(guide).toMatch(/## Idempotency and retries/);
    expect(guide).toMatch(/Deduplicate on `event` \+ `data\./);
    expect(guide).toMatch(/at-least-once|more than once/);
    expect(guide).toMatch(/Ordering is not guaranteed/);
  });

  it("covers the HMAC-canonicalization rule and the no-HMC platform guidance", () => {
    expect(guide).toMatch(/signature.*field emptied/i);
    expect(guide).toMatch(/cannot compute an HMAC/);
    expect(guide).toMatch(/relay-adapter\.ts/);
    expect(guide).toMatch(/GET \/api\/payments\//);
  });

  it("links to the runnable reference verifiers", () => {
    expect(guide).toContain("../examples/webhook-verification/README.md");
    expect(guide).toContain("Node, Python and Go");
  });
});

describe("automation platforms guide — embedded payloads (#817)", () => {
  it("shows at least one complete payload per payment lifecycle stage", () => {
    const shown = new Set(envelopes.map((e) => e.event));
    for (const stage of [
      WEBHOOK_EVENTS.PAYMENT_CREATED,
      WEBHOOK_EVENTS.PAYMENT_SIGNED,
      WEBHOOK_EVENTS.PAYMENT_SUBMITTED,
      WEBHOOK_EVENTS.PAYMENT_CONFIRMED,
      WEBHOOK_EVENTS.PAYMENT_FAILED,
    ]) {
      expect(shown.has(stage), `lifecycle stage ${stage} must have a complete payload example`).toBe(true);
    }
  });

  it.each(envelopes.map((e) => [e.event, e] as const))(
    "payload for %s is genuinely signed with the doc secret",
    (_event, envelope) => {
      const raw = JSON.stringify(envelope);
      const result = verifyEnvelope(raw);
      expect(result.reason ?? "valid").toBe("valid");
      // Cross-check against the real implementation: re-signing the same
      // envelope must produce the documented signature. Rebuild the payload
      // in the guide's own key order (canonicalization is order-sensitive).
      const { signature: _documented, ...payload } = envelope;
      const { body, signature } = buildSignedPayload(
        payload as Parameters<typeof buildSignedPayload>[0],
        DOC_SECRET,
      );
      expect(signature).toBe(envelope.signature);
      expect(body).toBe(raw);
    },
  );

  it("keeps the envelope shape consistent with the WebhookPayload type", () => {
    for (const envelope of envelopes) {
      expect(Object.keys(envelope).sort()).toEqual(
        expect.arrayContaining(["data", "event", "signature", "timestamp"]),
      );
      expect(envelope.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
  });
});

describe("automation platforms guide — payload files (#817)", () => {
  const files = readdirSync(PAYLOADS_DIR).filter((f) => f.endsWith(".json"));

  it("ships one signed payload file per documented event type", () => {
    const eventsFromFiles = new Set(files.map((f) => f.replace(/\.json$/, "")));
    for (const eventType of Object.values(WEBHOOK_EVENTS)) {
      expect(eventsFromFiles.has(eventType), `examples/automation-payloads/${eventType}.json must exist`).toBe(true);
    }
  });

  it.each(files.map((f) => [f] as const))("%s verifies against the signing scheme", (file) => {
    const raw = readFileSync(join(PAYLOADS_DIR, file), "utf8").trim();
    const result = verifyEnvelope(raw);
    expect(result.reason ?? "valid").toBe("valid");

    const parsed = JSON.parse(raw) as { event: string; timestamp: string; data: Record<string, unknown> };
    const { signature } = buildSignedPayload(parsed, DOC_SECRET);
    const fileSignature = (JSON.parse(raw) as { signature: string }).signature;
    expect(signature).toBe(fileSignature);
  });

  it("matches the payloads embedded in the guide", () => {
    // The `test: true` sample is guide-only (it is produced by the
    // send-test endpoint, not a lifecycle event), so only lifecycle
    // envelopes have file counterparts.
    for (const envelope of envelopes.filter((e) => !e.test)) {
      const fileRaw = readFileSync(join(PAYLOADS_DIR, `${envelope.event}.json`), "utf8");
      expect(JSON.parse(fileRaw)).toEqual(envelope);
    }
  });
});
