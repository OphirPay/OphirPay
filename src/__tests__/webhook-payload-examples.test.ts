// SPDX-License-Identifier: MIT

/**
 * Guards the automation-platform guide (docs/AUTOMATION_PLATFORMS.md) and the
 * generated payload examples (examples/webhook-payloads/*.json) against drift
 * from the single source of truth in src/lib/webhook-payload-examples.ts.
 *
 * Acceptance criteria covered (issue #817):
 *  - every event type has a documented payload with field meanings;
 *  - at least one complete payload per lifecycle stage
 *    (created, signed, submitted, confirmed, failed);
 *  - idempotent-consumption guidance is present in the guide;
 *  - the examples are validated against the schema here.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import {
  ALL_WEBHOOK_EVENTS,
  WEBHOOK_EVENTS,
  type WebhookEventType,
} from "@/app/api/webhooks/event-types";
import {
  DOCUMENTED_PAYLOAD_EXAMPLE_EVENTS,
  GENERATED_MARKERS,
  WEBHOOK_EVENT_CONTRACTS,
  WEBHOOK_EXAMPLE_SECRET,
  WEBHOOK_PAYLOAD_EXAMPLES,
  renderEventCatalogMarkdown,
  renderPayloadExamplesMarkdown,
  replaceGeneratedSection,
  webhookEnvelopeSchema,
  webhookEventSchemaKeys,
  webhookExampleFileName,
} from "@/lib/webhook-payload-examples";
import type { WebhookPayload } from "@/lib/webhook-deliver";

const ROOT = process.cwd();
const GUIDE_PATH = "docs/AUTOMATION_PLATFORMS.md";

function readRepoFile(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), "utf8");
}

describe("webhook payload contracts — catalog completeness", () => {
  it("has a contract for every event in WEBHOOK_EVENTS", () => {
    for (const event of ALL_WEBHOOK_EVENTS) {
      const contract = WEBHOOK_EVENT_CONTRACTS[event];
      expect(contract, `missing contract for ${event}`).toBeDefined();
      expect(contract.summary.trim().length).toBeGreaterThan(0);
      expect(contract.stage.trim().length).toBeGreaterThan(0);
      expect(contract.fields.length, `${event} must document its fields`).toBeGreaterThan(0);
    }
    expect(Object.keys(WEBHOOK_EVENT_CONTRACTS).sort()).toEqual(
      [...ALL_WEBHOOK_EVENTS].sort(),
    );
  });

  it("documents exactly the fields the schema accepts, for every event", () => {
    for (const event of ALL_WEBHOOK_EVENTS) {
      const contract = WEBHOOK_EVENT_CONTRACTS[event];
      const docKeys = contract.fields.map((field) => field.name).sort();
      expect(docKeys, `${event}: field docs must match the schema`).toEqual(
        webhookEventSchemaKeys(event),
      );
      for (const field of contract.fields) {
        expect(field.type.trim().length).toBeGreaterThan(0);
        expect(field.description.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("marks emitted events consistently with the dispatch sites in src/", () => {
    // Reference-only modules: they name event constants but never dispatch a
    // real business event, so they must not count as emitters.
    const referenceOnly = [
      "src/app/api/webhooks/", // management plane (catalog, test-event route)
      "src/app/webhooks/", // dashboard UI (test-event picker default)
      "src/lib/webhook-test.ts",
      "src/lib/webhook-payload-examples.ts",
    ];
    const srcFiles = (readdirSync(path.join(ROOT, "src"), { recursive: true }) as string[])
      .filter((file) => /\.tsx?$/.test(file))
      .map((file) => `src/${file}`)
      .filter((file) => !file.includes("__tests__"))
      .filter((file) => !referenceOnly.some((prefix) => file.startsWith(prefix)));

    const constantByEvent = new Map<WebhookEventType, string>(
      Object.entries(WEBHOOK_EVENTS).map(([key, value]) => [value, key]),
    );

    for (const event of ALL_WEBHOOK_EVENTS) {
      const constant = constantByEvent.get(event);
      const emitterPattern = new RegExp(`WEBHOOK_EVENTS\\.${constant}\\b`);
      const detectedEmitters = srcFiles.filter((file) =>
        emitterPattern.test(readRepoFile(file)),
      );
      const contract = WEBHOOK_EVENT_CONTRACTS[event];
      expect(
        contract.emitted,
        `${event}: contract says emitted=${contract.emitted} but src/ references found in [${detectedEmitters.join(", ")}]`,
      ).toBe(detectedEmitters.length > 0);
      if (contract.emitted) {
        expect(contract.emitters.sort()).toEqual(detectedEmitters.sort());
      }
    }
  });

  it("keeps emitted-event schemas aligned with the fields the emitters send", () => {
    for (const event of ALL_WEBHOOK_EVENTS) {
      const contract = WEBHOOK_EVENT_CONTRACTS[event];
      if (!contract.emitted) continue;
      for (const key of webhookEventSchemaKeys(event)) {
        // transactionHash on payment.failed is sent only by the sync job.
        const senders = contract.emitters.filter((emitter) =>
          readRepoFile(emitter).includes(`${key}:`),
        );
        expect(
          senders.length,
          `${event}: field "${key}" not sent by any emitter (${contract.emitters.join(", ")})`,
        ).toBeGreaterThan(0);
      }
    }
  });
});

describe("webhook payload examples — schema validation", () => {
  it("validates every example against the envelope and per-event schema", () => {
    for (const event of ALL_WEBHOOK_EVENTS) {
      const example = WEBHOOK_PAYLOAD_EXAMPLES[event];

      const envelope = webhookEnvelopeSchema.safeParse(example.body);
      expect(envelope.success, `${event}: envelope ${JSON.stringify(envelope)}`).toBe(true);

      const data = WEBHOOK_EVENT_CONTRACTS[event].schema.safeParse(example.body.data);
      expect(data.success, `${event}: data ${JSON.stringify(data)}`).toBe(true);

      // The example must carry exactly the documented fields — no more, no less.
      expect(Object.keys(example.body.data as object).sort()).toEqual(
        webhookEventSchemaKeys(event),
      );
    }
  });

  it("has a complete payload for every payment lifecycle stage", () => {
    const stageByEvent = new Map(
      ALL_WEBHOOK_EVENTS.map((event) => [event, WEBHOOK_EVENT_CONTRACTS[event].stage]),
    );
    for (const stage of ["created", "signed", "submitted", "confirmed", "failed"]) {
      const event = DOCUMENTED_PAYLOAD_EXAMPLE_EVENTS.find(
        (candidate) => stageByEvent.get(candidate) === stage,
      );
      expect(event, `no documented example for lifecycle stage "${stage}"`).toBeDefined();
      const body = WEBHOOK_PAYLOAD_EXAMPLES[event!].body;
      expect(typeof body.event).toBe("string");
      expect(typeof body.timestamp).toBe("string");
      expect(typeof body.signature).toBe("string");
      expect(Object.keys(body.data as object).length).toBeGreaterThan(0);
    }
  });

  it("signs every example with the docs secret so the reference verifier accepts it", async () => {
    const { verifyWebhookSignature } = await import(
      "../../examples/webhook-verification/node/verify.mjs"
    );
    for (const event of ALL_WEBHOOK_EVENTS) {
      const example = WEBHOOK_PAYLOAD_EXAMPLES[event];
      const body = example.body as unknown as WebhookPayload & { signature: string };

      expect(example.headers["X-OphirPay-Signature"]).toBe(body.signature);
      expect(example.headers["X-OphirPay-Timestamp"]).toBe(body.timestamp);
      expect(example.headers["X-OphirPay-Event"]).toBe(event);
      expect(body.test, `${event}: real examples must not be test events`).toBeUndefined();

      const { valid } = verifyWebhookSignature({
        body: example.bodyJson,
        signature: example.headers["X-OphirPay-Signature"],
        secret: WEBHOOK_EXAMPLE_SECRET,
        timestamp: example.headers["X-OphirPay-Timestamp"],
        maxAgeSeconds: 0, // examples use fixed timestamps
      });
      expect(valid, `${event}: signature must verify`).toBe(true);
    }
  });

  it("uses the on-chain failure message from the reconciliation job", () => {
    const syncSource = readRepoFile("src/lib/payment-sync.ts");
    const failedExample = WEBHOOK_PAYLOAD_EXAMPLES[WEBHOOK_EVENTS.PAYMENT_FAILED];
    const errorMessage = (failedExample.body.data as { errorMessage: string }).errorMessage;
    expect(syncSource).toContain(errorMessage);
  });
});

describe("generated artifacts — no drift", () => {
  it("committed example files match the generated payloads", () => {
    for (const event of ALL_WEBHOOK_EVENTS) {
      const committed = readRepoFile(webhookExampleFileName(event));
      expect(
        committed,
        `${webhookExampleFileName(event)} is stale — run npm run generate:webhook-examples`,
      ).toBe(`${WEBHOOK_PAYLOAD_EXAMPLES[event].bodyJson}\n`);
    }
  });

  it("the guide's generated sections match the rendered contracts", () => {
    let guide = readRepoFile(GUIDE_PATH);
    guide = replaceGeneratedSection(guide, "eventCatalog", renderEventCatalogMarkdown());
    guide = replaceGeneratedSection(guide, "payloadExamples", renderPayloadExamplesMarkdown());
    expect(
      guide,
      `${GUIDE_PATH} is stale — run npm run generate:webhook-examples`,
    ).toBe(readRepoFile(GUIDE_PATH));
  });

  it("both generated sections are present in the guide", () => {
    const guide = readRepoFile(GUIDE_PATH);
    for (const { begin, end } of Object.values(GENERATED_MARKERS)) {
      expect(guide).toContain(begin);
      expect(guide).toContain(end);
    }
  });
});

describe("docs/AUTOMATION_PLATFORMS.md — required guidance", () => {
  const guide = readRepoFile(GUIDE_PATH);

  it("makes idempotent consumption explicit", () => {
    expect(guide).toMatch(/Idempotent consumption/i);
    expect(guide).toMatch(/at most once/i);
    expect(guide).toContain("event + timestamp");
  });

  it("covers each automation platform including the no-HMAC case", () => {
    expect(guide).toContain("n8n");
    expect(guide).toContain("Zapier");
    expect(guide).toContain("Make");
    expect(guide).toMatch(/cannot compute an HMAC/i);
    expect(guide).toContain("X-OphirPay-Signature");
  });

  it("documents retries, replay, and the test-event path", () => {
    expect(guide).toMatch(/[Rr]etr/);
    expect(guide).toContain("/replay");
    expect(guide).toContain('"test": true');
    expect(guide).toContain(WEBHOOK_EXAMPLE_SECRET);
  });

  it("is linked from the related webhook docs", () => {
    expect(readRepoFile("docs/webhook-verification.md")).toContain("AUTOMATION_PLATFORMS.md");
    expect(readRepoFile("docs/integration-guide.md")).toContain("AUTOMATION_PLATFORMS.md");
  });
});
