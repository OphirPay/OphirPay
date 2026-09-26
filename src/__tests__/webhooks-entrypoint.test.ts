// SPDX-License-Identifier: MIT
/**
 * @vitest-environment node
 *
 * Issue #758 — webhook behaviour is consolidated behind one documented entry
 * point (`src/lib/webhooks/`). These tests pin:
 *
 *   • the entry point re-exports the full public surface,
 *   • the old top-level modules are thin re-export shims (no duplicate logic),
 *     so existing imports keep resolving to the same function identities, and
 *   • the pipeline is documented in the entry point.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import * as canonical from "@/lib/webhooks";
import * as deliverShim from "@/lib/webhook-deliver";
import * as dispatchShim from "@/lib/webhook-dispatcher";
import * as guardShim from "@/lib/webhook-url-guard";
import * as filterShim from "@/lib/webhook-filter";
import * as storeShim from "@/lib/webhook-event-store";
import * as deliveryServiceShim from "@/lib/webhook-delivery-service";
import * as testShim from "@/lib/webhook-test";
import * as replayConfigShim from "@/lib/webhook-replay-config";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("webhooks entry point (#758)", () => {
  it("exposes the whole delivery pipeline from one module", () => {
    for (const fn of [
      "dispatchWebhookEvent",
      "dispatchWebhookEventAsync",
      "isSubscribedToEvent",
      "storeWebhookEvent",
      "recordWebhookDelivery",
      "persistDeliveryResult",
      "selectEventsForReplay",
      "resolveReplayBounds",
      "toWebhookPayload",
      "signWebhookPayload",
      "buildSignedPayload",
      "buildWebhookRequestPreview",
      "deliverWebhook",
      "deliverWebhookWithDetails",
      "isSafeWebhookUrl",
      "isSafeWebhookUrlAtDelivery",
      "validateWebhookUrlAtDelivery",
      "buildTestWebhookPayload",
    ]) {
      expect(typeof (canonical as Record<string, unknown>)[fn]).toBe("function");
    }
  });

  it("keeps the old modules as identity-preserving re-export shims", () => {
    expect(deliverShim.deliverWebhook).toBe(canonical.deliverWebhook);
    expect(deliverShim.buildSignedPayload).toBe(canonical.buildSignedPayload);
    expect(deliverShim.buildWebhookRequestPreview).toBe(canonical.buildWebhookRequestPreview);
    expect(dispatchShim.dispatchWebhookEvent).toBe(canonical.dispatchWebhookEvent);
    expect(guardShim.isSafeWebhookUrl).toBe(canonical.isSafeWebhookUrl);
    expect(filterShim.isSubscribedToEvent).toBe(canonical.isSubscribedToEvent);
    expect(storeShim.selectEventsForReplay).toBe(canonical.selectEventsForReplay);
    expect(storeShim.REPLAY_MAX_DAYS).toBe(canonical.REPLAY_MAX_DAYS);
    expect(deliveryServiceShim.persistDeliveryResult).toBe(canonical.persistDeliveryResult);
    expect(testShim.buildTestWebhookPayload).toBe(canonical.buildTestWebhookPayload);
    expect(replayConfigShim.REPLAY_MAX_COUNT).toBe(canonical.REPLAY_MAX_COUNT);
  });

  it("marks the legacy modules as compatibility shims", () => {
    for (const file of [
      "src/lib/webhook-deliver.ts",
      "src/lib/webhook-dispatcher.ts",
      "src/lib/webhook-url-guard.ts",
      "src/lib/webhook-filter.ts",
      "src/lib/webhook-event-store.ts",
      "src/lib/webhook-delivery-service.ts",
      "src/lib/webhook-test.ts",
      "src/lib/webhook-replay-config.ts",
    ]) {
      expect(read(file)).toContain("COMPATIBILITY SHIM");
    }
  });

  it("documents the end-to-end delivery pipeline in the entry point", () => {
    const index = read("src/lib/webhooks/index.ts");
    expect(index).toContain("The delivery pipeline, end to end");
    expect(index).toContain("DISPLAY".replace("DISPLAY", "DISPATCH"));
    expect(index).toContain("signing");
    expect(index).toContain("url-safety");
  });
});
