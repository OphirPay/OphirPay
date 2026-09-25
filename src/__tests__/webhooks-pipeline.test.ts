// SPDX-License-Identifier: MIT

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    webhookEvent: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    webhookDelivery: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import * as Webhooks from "@/lib/webhooks";
import * as LegacyDeliver from "@/lib/webhook-deliver";
import * as LegacyDeliveryService from "@/lib/webhook-delivery-service";
import * as LegacyDispatcher from "@/lib/webhook-dispatcher";
import * as LegacyEventStore from "@/lib/webhook-event-store";
import * as LegacyFilter from "@/lib/webhook-filter";
import * as LegacyReplayConfig from "@/lib/webhook-replay-config";
import * as LegacyTest from "@/lib/webhook-test";
import * as LegacyUrlGuard from "@/lib/webhook-url-guard";

describe("Webhook Consolidated Architecture (Issue #758)", () => {
  // ── 1. Documented Single Entry Point ───────────────────────────
  describe("Single entry point exports and responsibilities", () => {
    it("exports all pipeline components from @/lib/webhooks", () => {
      // Signing
      expect(typeof Webhooks.signWebhookPayload).toBe("function");
      expect(typeof Webhooks.buildSignedPayload).toBe("function");

      // URL Safety & SSRF Guard
      expect(typeof Webhooks.isSafeWebhookUrl).toBe("function");
      expect(typeof Webhooks.isSafeWebhookUrlAtDelivery).toBe("function");

      // Filtering
      expect(typeof Webhooks.isSubscribedToEvent).toBe("function");

      // Outbound Delivery
      expect(typeof Webhooks.deliverWebhook).toBe("function");

      // Persistence & Ledger
      expect(typeof Webhooks.storeWebhookEvent).toBe("function");
      expect(typeof Webhooks.recordWebhookDelivery).toBe("function");
      expect(typeof Webhooks.persistDeliveryResult).toBe("function");
      expect(typeof Webhooks.toWebhookPayload).toBe("function");

      // Replay
      expect(typeof Webhooks.resolveReplayBounds).toBe("function");
      expect(typeof Webhooks.selectEventsForReplay).toBe("function");
      expect(Webhooks.REPLAY_MAX_DAYS).toBe(7);
      expect(Webhooks.REPLAY_MAX_COUNT).toBe(100);
      expect(Webhooks.REPLAY_DEFAULT_COUNT).toBe(50);

      // Testing
      expect(typeof Webhooks.buildTestWebhookPayload).toBe("function");

      // Dispatcher
      expect(typeof Webhooks.dispatchWebhookEvent).toBe("function");
      expect(typeof Webhooks.dispatchWebhookEventAsync).toBe("function");
    });

    it("legacy modules re-export from single implementations without duplication", () => {
      expect(LegacyDeliver.deliverWebhook).toBe(Webhooks.deliverWebhook);
      expect(LegacyDeliver.buildSignedPayload).toBe(Webhooks.buildSignedPayload);
      expect(LegacyDeliveryService.persistDeliveryResult).toBe(Webhooks.persistDeliveryResult);
      expect(LegacyDispatcher.dispatchWebhookEvent).toBe(Webhooks.dispatchWebhookEvent);
      expect(LegacyEventStore.resolveReplayBounds).toBe(Webhooks.resolveReplayBounds);
      expect(LegacyFilter.isSubscribedToEvent).toBe(Webhooks.isSubscribedToEvent);
      expect(LegacyReplayConfig.REPLAY_MAX_DAYS).toBe(Webhooks.REPLAY_MAX_DAYS);
      expect(LegacyTest.buildTestWebhookPayload).toBe(Webhooks.buildTestWebhookPayload);
      expect(LegacyUrlGuard.isSafeWebhookUrl).toBe(Webhooks.isSafeWebhookUrl);
    });
  });

  // ── 2. Signing, Filtering, and Safety ─────────────────────────
  describe("Signing, URL safety, and filtering pipeline steps", () => {
    it("canonical signing produces matching signature header and payload", () => {
      const payload: Webhooks.WebhookPayload = {
        event: "payment.completed",
        timestamp: "2026-09-25T12:00:00.000Z",
        data: { id: "pay_123", amount: "50.00" },
      };
      const secret = "whsec_test_secret_key_12345";
      const { body, signature } = Webhooks.buildSignedPayload(payload, secret);

      expect(signature).toMatch(/^[a-f0-9]{64}$/);
      const parsed = JSON.parse(body);
      expect(parsed.signature).toBe(signature);

      // Verify canonical reconstruction
      const rawCanonical = JSON.stringify({ ...payload, signature: "" });
      const expectedSig = Webhooks.signWebhookPayload(
        JSON.parse(rawCanonical) as Webhooks.WebhookPayload,
        secret
      );
      expect(signature).toBe(expectedSig);
    });

    it("URL safety guard blocks private IPv4, IPv6, and internal hostnames", () => {
      expect(Webhooks.isSafeWebhookUrl("http://127.0.0.1/webhook")).toBe(false);
      expect(Webhooks.isSafeWebhookUrl("http://10.0.0.1/webhook")).toBe(false);
      expect(Webhooks.isSafeWebhookUrl("http://169.254.169.254/latest/meta-data")).toBe(false);
      expect(Webhooks.isSafeWebhookUrl("http://192.168.1.1/webhook")).toBe(false);
      expect(Webhooks.isSafeWebhookUrl("http://localhost:3000/webhook")).toBe(false);
      expect(Webhooks.isSafeWebhookUrl("http://api.internal/webhook")).toBe(false);

      expect(Webhooks.isSafeWebhookUrl("https://example.com/webhook")).toBe(true);
      expect(Webhooks.isSafeWebhookUrl("https://api.mycompany.org/callbacks")).toBe(true);
    });

    it("filtering matches subscribed events and treats empty array as wildcard", () => {
      expect(Webhooks.isSubscribedToEvent(JSON.stringify(["payment.completed"]), "payment.completed")).toBe(true);
      expect(Webhooks.isSubscribedToEvent(JSON.stringify(["payment.completed"]), "escrow.resolved")).toBe(false);
      // Empty array subscribed to all events
      expect(Webhooks.isSubscribedToEvent(JSON.stringify([]), "arbitrary.event")).toBe(true);
      // Malformed JSON returns false safely
      expect(Webhooks.isSubscribedToEvent("not-valid-json", "payment.completed")).toBe(false);
    });
  });

  // ── 3. Replay Bounds & Integrator Test Event ──────────────────
  describe("Replay bounds and test event builder", () => {
    it("resolveReplayBounds clamps limits and time range", () => {
      const now = new Date();
      const bounds = Webhooks.resolveReplayBounds({
        userId: "usr_1",
        subscribedEvents: ["payment.completed"],
        limit: 200, // exceeds max 100
      });

      expect(bounds.limit).toBe(100);
      expect(bounds.until.getTime()).toBeLessThanOrEqual(now.getTime());
      expect(bounds.since.getTime()).toBeLessThan(now.getTime());
    });

    it("buildTestWebhookPayload marks payload as simulation", () => {
      const testPayload = Webhooks.buildTestWebhookPayload("payment.completed");
      expect(testPayload.test).toBe(true);
      expect(testPayload.data.test).toBe(true);
      expect(testPayload.event).toBe("payment.completed");
      expect(testPayload.data.description).toContain("OphirPay test event");
    });
  });
});
