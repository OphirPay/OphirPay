// SPDX-License-Identifier: MIT

/**
 * Regenerate the webhook payload examples from the single source of truth in
 * `src/lib/webhook-payload-examples.ts`:
 *
 *   - `examples/webhook-payloads/<event>.json` — one fully-signed example
 *     delivery per event type (verifiable with the reference verifiers under
 *     `examples/webhook-verification/` using the docs secret).
 *   - the generated sections of `docs/AUTOMATION_PLATFORMS.md` (event catalog
 *     tables and lifecycle payload examples, between the GENERATED markers).
 *
 * Run with: npm run generate:webhook-examples
 *
 * `src/__tests__/webhook-payload-examples.test.ts` fails if the committed
 * artifacts drift from the source module, so run this after changing any
 * contract, field doc, or example value.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { ALL_WEBHOOK_EVENTS } from "../src/app/api/webhooks/event-types";
import {
  replaceGeneratedSection,
  renderEventCatalogMarkdown,
  renderPayloadExamplesMarkdown,
  WEBHOOK_PAYLOAD_EXAMPLES,
  webhookExampleFileName,
} from "../src/lib/webhook-payload-examples";

const ROOT = process.cwd();
const GUIDE = path.join(ROOT, "docs/AUTOMATION_PLATFORMS.md");
const EXAMPLES_DIR = path.join(ROOT, "examples/webhook-payloads");

function main(): void {
  mkdirSync(EXAMPLES_DIR, { recursive: true });

  for (const event of ALL_WEBHOOK_EVENTS) {
    const example = WEBHOOK_PAYLOAD_EXAMPLES[event];
    writeFileSync(
      path.join(ROOT, webhookExampleFileName(event)),
      `${example.bodyJson}\n`,
      "utf8",
    );
  }
  console.log(`Wrote ${ALL_WEBHOOK_EVENTS.length} payload examples to examples/webhook-payloads/`);

  let guide = readFileSync(GUIDE, "utf8");
  guide = replaceGeneratedSection(guide, "eventCatalog", renderEventCatalogMarkdown());
  guide = replaceGeneratedSection(guide, "payloadExamples", renderPayloadExamplesMarkdown());
  writeFileSync(GUIDE, guide, "utf8");
  console.log("Updated generated sections in docs/AUTOMATION_PLATFORMS.md");
}

main();
