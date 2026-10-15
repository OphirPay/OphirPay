// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import {
  timingSafeEqualSignatures,
  verifyWebhookSignature,
  buildSignedPayload,
  type WebhookPayload,
} from "@/lib/webhook-deliver";
import {
  timingSafeEqualSignatures as tsVerifierTimingSafeEqual,
  verifyWebhookSignature as tsVerifierVerify,
  canonicalize as tsCanonicalize,
} from "../../examples/webhook-verification/node-verifier";

const SECRET = "test-secret-0123456789";

const samplePayload: WebhookPayload = {
  event: "payment.created",
  timestamp: "2026-08-14T00:00:00Z",
  data: { id: "p_123", amount: 100 },
};

describe("Timing-safe HMAC signature verification regression tests", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("timingSafeEqualSignatures buffer comparison & non-early-exit", () => {
    it("invokes crypto.timingSafeEqual when buffer lengths match", () => {
      const spy = vi.spyOn(crypto, "timingSafeEqual");
      const sigA = "83ab64c58dadec406835ebd9b907b579cb89132098823ec66f2b96dd1ad84258";
      const sigB = "83ab64c58dadec406835ebd9b907b579cb89132098823ec66f2b96dd1ad84258";

      const result = timingSafeEqualSignatures(sigA, sigB);

      expect(result).toBe(true);
      expect(spy).toHaveBeenCalledTimes(1);
      const [bufA, bufB] = spy.mock.calls[0];
      expect(bufA.byteLength).toBe(64);
      expect(bufB.byteLength).toBe(64);
      expect(Buffer.isBuffer(bufA)).toBe(true);
      expect(Buffer.isBuffer(bufB)).toBe(true);
    });

    it("asserts non-early-exit execution behavior regardless of mismatch position", () => {
      const spy = vi.spyOn(crypto, "timingSafeEqual");
      const baseSig = "83ab64c58dadec406835ebd9b907b579cb89132098823ec66f2b96dd1ad84258";

      // Mismatch at index 0 (first character)
      const mismatchAt0 = "9" + baseSig.slice(1);
      // Mismatch at index 32 (middle character)
      const mismatchAt32 = baseSig.slice(0, 32) + "x" + baseSig.slice(33);
      // Mismatch at index 63 (last character)
      const mismatchAt63 = baseSig.slice(0, 63) + "9";

      // With standard string comparison, mismatchAt0 exits early after 1 byte.
      // With constant-time timingSafeEqual, the full buffers must be passed every time.
      const res0 = timingSafeEqualSignatures(baseSig, mismatchAt0);
      const res32 = timingSafeEqualSignatures(baseSig, mismatchAt32);
      const res63 = timingSafeEqualSignatures(baseSig, mismatchAt63);

      expect(res0).toBe(false);
      expect(res32).toBe(false);
      expect(res63).toBe(false);

      // Verify crypto.timingSafeEqual was invoked for all three with full 64-byte buffers
      expect(spy).toHaveBeenCalledTimes(3);
      for (const [bufA, bufB] of spy.mock.calls) {
        expect(bufA.byteLength).toBe(64);
        expect(bufB.byteLength).toBe(64);
      }
    });

    it("safely rejects length mismatches without throwing uncaught RangeError exceptions", () => {
      const spy = vi.spyOn(crypto, "timingSafeEqual");
      const validSig = "83ab64c58dadec406835ebd9b907b579cb89132098823ec66f2b96dd1ad84258"; // 64 chars

      // Various mismatched lengths: 63, 65, 0, 1, 128
      const mismatchedLengths = [
        validSig.slice(0, 63), // 63 chars
        validSig + "a",        // 65 chars
        "",                    // 0 chars
        "a",                   // 1 char
        validSig.repeat(2),    // 128 chars
      ];

      for (const candidate of mismatchedLengths) {
        expect(() => {
          const resForward = timingSafeEqualSignatures(validSig, candidate);
          expect(resForward).toBe(false);

          const resBackward = timingSafeEqualSignatures(candidate, validSig);
          expect(resBackward).toBe(false);
        }).not.toThrow();
      }

      // timingSafeEqual must NOT be called for mismatched lengths (preventing RangeError)
      expect(spy).not.toHaveBeenCalled();
    });

    it("handles null, undefined, and non-string types safely without throwing", () => {
      const validSig = "83ab64c58dadec406835ebd9b907b579cb89132098823ec66f2b96dd1ad84258";

      // @ts-expect-error test non-string types
      expect(timingSafeEqualSignatures(null, validSig)).toBe(false);
      // @ts-expect-error test non-string types
      expect(timingSafeEqualSignatures(validSig, null)).toBe(false);
      // @ts-expect-error test non-string types
      expect(timingSafeEqualSignatures(undefined, validSig)).toBe(false);
      // @ts-expect-error test non-string types
      expect(timingSafeEqualSignatures(validSig, undefined)).toBe(false);
      // @ts-expect-error test non-string types
      expect(timingSafeEqualSignatures(12345, validSig)).toBe(false);
      // @ts-expect-error test non-string types
      expect(timingSafeEqualSignatures({}, validSig)).toBe(false);
      // @ts-expect-error test non-string types
      expect(timingSafeEqualSignatures([], validSig)).toBe(false);
    });
  });

  describe("verifyWebhookSignature timing-safe integration", () => {
    it("successfully verifies valid webhook deliveries using constant-time comparison", () => {
      const spy = vi.spyOn(crypto, "timingSafeEqual");
      const { body, signature, timestamp } = buildSignedPayload(samplePayload, SECRET);

      const result = verifyWebhookSignature({
        rawBody: body,
        signature,
        secret: SECRET,
        timestamp,
        now: new Date("2026-08-14T00:00:30Z"),
      });

      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it("rejects tampered payloads without leaking timing information", () => {
      const { body, signature, timestamp } = buildSignedPayload(samplePayload, SECRET);
      const tamperedBody = body.replace('"amount":100', '"amount":999');

      const result = verifyWebhookSignature({
        rawBody: tamperedBody,
        signature,
        secret: SECRET,
        timestamp,
        now: new Date("2026-08-14T00:00:30Z"),
      });

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("signature mismatch");
    });

    it("rejects truncated or malformed signatures without uncaught exceptions", () => {
      const { body, timestamp } = buildSignedPayload(samplePayload, SECRET);

      // Short signature
      const shortResult = verifyWebhookSignature({
        rawBody: body,
        signature: "short",
        secret: SECRET,
        timestamp,
        now: new Date("2026-08-14T00:00:30Z"),
      });
      expect(shortResult.valid).toBe(false);
      expect(shortResult.reason).toBe("signature mismatch");

      // Empty signature
      const emptyResult = verifyWebhookSignature({
        rawBody: body,
        signature: "",
        secret: SECRET,
        timestamp,
        now: new Date("2026-08-14T00:00:30Z"),
      });
      expect(emptyResult.valid).toBe(false);
      expect(emptyResult.reason).toBe("Missing or invalid signature");
    });

    it("enforces replay attack prevention via timestamp freshness window", () => {
      const { body, signature, timestamp } = buildSignedPayload(samplePayload, SECRET);

      // 10 minutes later (default window is 5 minutes = 300s)
      const replayResult = verifyWebhookSignature({
        rawBody: body,
        signature,
        secret: SECRET,
        timestamp,
        now: new Date("2026-08-14T00:10:00Z"),
      });

      expect(replayResult.valid).toBe(false);
      expect(replayResult.reason).toContain("payload too old");
    });
  });

  describe("examples/webhook-verification/node-verifier.ts TypeScript reference", () => {
    it("mirrors constant-time behavior in the reference TypeScript verifier", () => {
      const sigA = "83ab64c58dadec406835ebd9b907b579cb89132098823ec66f2b96dd1ad84258";
      expect(tsVerifierTimingSafeEqual(sigA, sigA)).toBe(true);

      const mismatched = sigA.slice(0, 63) + "9";
      expect(tsVerifierTimingSafeEqual(sigA, mismatched)).toBe(false);

      // Length mismatch does not throw
      expect(tsVerifierTimingSafeEqual(sigA, "short")).toBe(false);
      // @ts-expect-error test non-string types
      expect(tsVerifierTimingSafeEqual(null, sigA)).toBe(false);
    });

    it("verifies a valid payload with node-verifier.ts", () => {
      const { body, signature, timestamp } = buildSignedPayload(samplePayload, SECRET);
      const result = tsVerifierVerify({
        body,
        signature,
        secret: SECRET,
        timestamp,
        now: new Date("2026-08-14T00:00:30Z"),
      });

      expect(result.valid).toBe(true);
    });

    it("produces correct canonical serialization in node-verifier.ts", () => {
      const raw = JSON.stringify({
        event: "payment.created",
        timestamp: "2026-08-14T00:00:00Z",
        data: { id: "p_123" },
        signature: "old-signature",
      });

      const canonical = tsCanonicalize(raw);
      expect(canonical).toContain('"signature":""');
      expect(canonical).not.toContain("old-signature");
    });
  });
});
