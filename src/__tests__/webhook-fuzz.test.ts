// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import crypto from "crypto";
import {
  verifyWebhookSignature,
  buildSignedPayload,
  constantTimeEqual,
  type WebhookVerificationInput,
  type WebhookPayload,
} from "@/lib/webhook-deliver";
import { buildTestWebhookPayload } from "@/lib/webhook-test";
import { ALL_WEBHOOK_EVENTS } from "@/app/api/webhooks/event-types";

// Simple seedable PRNG for reproducible fuzzing
function createRng(seed = 1337) {
  let s = seed >>> 0;
  return function next(): number {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = createRng(42);

function randomChoice<T>(items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

const UNICODE_CORPUS = [
  "",
  "\0",
  "\x00\x01\x02\x1f",
  "Hello, World!",
  "你好，世界！",
  "🚀🎉✨⚡️💎",
  "اللغة العربية",
  "עִבְרִית",
  "\u200B\u200C\u200D\uFEFF", // Zero-width spaces & joins
  "\uD83D\uDE00", // Surrogate pairs
  "<script>alert(1)</script>",
  "' OR 1=1; --",
  "{\"__proto__\":{\"polluted\":\"yes\"}}",
  "A".repeat(1024),
  "B".repeat(10000),
  "\\n\\r\\t\\b\\f",
  "null",
  "undefined",
  "NaN",
  "true",
  "false",
  "[]",
  "{}",
];

function generateRandomString(len = 16): string {
  const chars =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=[]{}|;':\",./<>? \t\n\0\u00A0\u4E2D\u6587";
  let str = "";
  for (let i = 0; i < len; i++) {
    str += chars[Math.floor(rng() * chars.length)];
  }
  return str;
}

function generateRandomHex(len = 64): string {
  const hexChars = "0123456789abcdef";
  let str = "";
  for (let i = 0; i < len; i++) {
    str += hexChars[Math.floor(rng() * hexChars.length)];
  }
  return str;
}

describe("Webhook Fuzz Testing Suite (Issue #1299)", () => {
  describe("buildSignedPayload fuzzing (1,500 iterations)", () => {
    it("handles extreme, malformed, empty, null-byte, and oversized payloads without throwing", () => {
      const iterations = 1500;
      let completed = 0;

      for (let i = 0; i < iterations; i++) {
        let payloadInput: unknown;
        const selector = i % 10;

        if (selector === 0) {
          payloadInput = null;
        } else if (selector === 1) {
          payloadInput = undefined;
        } else if (selector === 2) {
          payloadInput = {};
        } else if (selector === 3) {
          payloadInput = {
            event: randomChoice(UNICODE_CORPUS),
            timestamp: randomChoice(UNICODE_CORPUS),
            data: { key: randomChoice(UNICODE_CORPUS) },
          };
        } else if (selector === 4) {
          const circ: Record<string, unknown> = { event: "test", timestamp: "now", data: {} };
          circ.self = circ;
          payloadInput = circ;
        } else if (selector === 5) {
          payloadInput = {
            event: "payment.created",
            timestamp: new Date().toISOString(),
            data: { blob: "X".repeat(randomInt(100, 5000)) },
          };
        } else if (selector === 6) {
          payloadInput = {
            event: `pay\x00ment\x00.${generateRandomString(4)}`,
            timestamp: `2026\x00-08-14T\x000:00:00Z`,
            data: { ["key\x00with\x00null"]: "value\x00with\x00null" },
          };
        } else if (selector === 7) {
          payloadInput = {
            event: 12345,
            timestamp: false,
            data: [1, 2, 3],
          };
        } else {
          payloadInput = buildTestWebhookPayload(
            randomChoice(ALL_WEBHOOK_EVENTS),
            new Date(Date.now() + randomInt(-100000, 100000)).toISOString(),
            { data: { fuzzKey: generateRandomString(32) } }
          );
        }

        const secretCandidate =
          i % 4 === 0
            ? ""
            : i % 4 === 1
            ? randomChoice(UNICODE_CORPUS)
            : generateRandomString(24);

        expect(() => {
          const result = buildSignedPayload(payloadInput as unknown as WebhookPayload, secretCandidate);
          expect(typeof result.body).toBe("string");
          expect(typeof result.signature).toBe("string");
          expect(typeof result.timestamp).toBe("string");
          expect(result.signature).toMatch(/^[a-f0-9]{64}$/);
        }).not.toThrow();

        completed++;
      }

      expect(completed).toBe(iterations);
    });
  });

  describe("verifyWebhookSignature fuzzing (2,500 iterations)", () => {
    it("never throws an unhandled exception on malformed JSON, invalid signatures, missing headers, or corrupt timestamps", () => {
      const iterations = 2500;
      let completed = 0;

      for (let i = 0; i < iterations; i++) {
        let body: string;
        const bodyMode = i % 8;
        if (bodyMode === 0) {
          body = "";
        } else if (bodyMode === 1) {
          body = randomChoice(UNICODE_CORPUS);
        } else if (bodyMode === 2) {
          const raw = JSON.stringify({
            event: "payment.completed",
            timestamp: new Date().toISOString(),
            data: { id: "123" },
          });
          body = raw.slice(0, randomInt(1, raw.length - 1));
        } else if (bodyMode === 3) {
          body = randomChoice(["[1, 2, 3]", "12345", '"just a string"', "null", "true", "false"]);
        } else if (bodyMode === 4) {
          body = JSON.stringify({
            event: `test\x00\uFFFF\uD83D\uDE00`,
            timestamp: randomChoice(UNICODE_CORPUS),
            data: {
              script: "<script>alert('fuzz')</script>",
              sqli: "' OR 1=1 --",
              huge: "Z".repeat(randomInt(50, 1000)),
            },
          });
        } else {
          body = generateRandomString(randomInt(0, 200));
        }

        let signature: string | string[] | null | undefined;
        const sigMode = i % 9;
        if (sigMode === 0) {
          signature = null;
        } else if (sigMode === 1) {
          signature = undefined;
        } else if (sigMode === 2) {
          signature = [];
        } else if (sigMode === 3) {
          signature = [generateRandomHex(64), generateRandomHex(64)];
        } else if (sigMode === 4) {
          signature = generateRandomString(64);
        } else if (sigMode === 5) {
          const boundaryLen = randomChoice([0, 1, 32, 63, 65, 128, 500]);
          signature = generateRandomHex(boundaryLen);
        } else if (sigMode === 6) {
          signature = generateRandomHex(64);
        } else {
          signature = randomChoice(UNICODE_CORPUS);
        }

        let timestamp: string | null | undefined;
        const tsMode = i % 5;
        if (tsMode === 0) {
          timestamp = null;
        } else if (tsMode === 1) {
          timestamp = undefined;
        } else if (tsMode === 2) {
          timestamp = "invalid-date-string";
        } else if (tsMode === 3) {
          timestamp = new Date(Date.now() + randomInt(-1000000000, 1000000000)).toISOString();
        } else {
          timestamp = randomChoice(UNICODE_CORPUS);
        }

        const secret =
          i % 5 === 0
            ? ""
            : i % 5 === 1
            ? (null as unknown as string)
            : generateRandomString(16);

        const maxAgeSeconds =
          i % 6 === 0 ? 0 : i % 6 === 1 ? -1 : i % 6 === 2 ? NaN : randomInt(1, 1000);
        const now =
          i % 6 === 0 ? undefined : i % 6 === 1 ? NaN : Date.now() + randomInt(-5000, 5000);

        const input: WebhookVerificationInput = {
          body,
          signature,
          secret,
          timestamp,
          maxAgeSeconds,
          now,
        };

        expect(() => {
          const result = verifyWebhookSignature(input);
          expect(typeof result.valid).toBe("boolean");
          expect(typeof result.reason).toBe("string");
          if (sigMode !== 6 || bodyMode !== 4) {
            expect(result.valid).toBe(false);
          }
        }).not.toThrow();

        completed++;
      }

      expect(completed).toBe(iterations);
    });
  });

  describe("Round-trip valid & mutated verification (1,000 iterations)", () => {
    it("accepts valid signed payloads and reliably rejects any single-byte or field mutations", () => {
      const iterations = 1000;
      let validCount = 0;
      let rejectedMutations = 0;

      for (let i = 0; i < iterations; i++) {
        const secret = `secret-${generateRandomString(16)}`;
        const testTimestamp = new Date(Date.now() - randomInt(0, 60_000)).toISOString();
        const basePayload = buildTestWebhookPayload(
          randomChoice(ALL_WEBHOOK_EVENTS),
          testTimestamp,
          {
            data: {
              seq: i,
              uuid: crypto.randomUUID(),
              unicode: randomChoice(UNICODE_CORPUS),
              amount: `${randomInt(1, 1000)}.${randomInt(10, 99)}`,
            },
          }
        );

        const { body, signature, timestamp } = buildSignedPayload(basePayload, secret);

        const validResult = verifyWebhookSignature({
          body,
          signature,
          secret,
          timestamp,
          maxAgeSeconds: 300,
          now: Date.parse(timestamp) + 1000,
        });

        expect(validResult.valid).toBe(true);
        expect(validResult.reason).toBe("valid");
        validCount++;

        const mutationType = i % 4;
        let mutatedInput: WebhookVerificationInput;

        if (mutationType === 0) {
          const parsed = JSON.parse(body);
          parsed.data = { ...parsed.data, _fuzz_tampered: `corrupted_${i}` };
          const mutatedBody = JSON.stringify(parsed);
          mutatedInput = {
            body: mutatedBody,
            signature,
            secret,
            timestamp,
            maxAgeSeconds: 300,
            now: Date.parse(timestamp) + 1000,
          };
        } else if (mutationType === 1) {
          const mutatedSig = (signature[0] === "0" ? "1" : "0") + signature.slice(1);
          mutatedInput = {
            body,
            signature: mutatedSig,
            secret,
            timestamp,
            maxAgeSeconds: 300,
            now: Date.parse(timestamp) + 1000,
          };
        } else if (mutationType === 2) {
          mutatedInput = {
            body,
            signature,
            secret: `${secret}-tampered`,
            timestamp,
            maxAgeSeconds: 300,
            now: Date.parse(timestamp) + 1000,
          };
        } else {
          const staleTimestamp = new Date(Date.now() - 3600_000).toISOString();
          mutatedInput = {
            body,
            signature,
            secret,
            timestamp: staleTimestamp,
            maxAgeSeconds: 300,
            now: Date.now(),
          };
        }

        const mutatedResult = verifyWebhookSignature(mutatedInput);
        expect(mutatedResult.valid).toBe(false);
        expect(mutatedResult.reason).not.toBe("valid");
        rejectedMutations++;
      }

      expect(validCount).toBe(iterations);
      expect(rejectedMutations).toBe(iterations);
    });
  });

  describe("constantTimeEqual fuzzing and edge cases", () => {
    it("handles arbitrary types, unequal lengths, and malformed inputs safely in constant time", () => {
      const inputs: unknown[] = [
        "",
        "a",
        "abc",
        "0".repeat(64),
        "1".repeat(64),
        "a".repeat(1024),
        null,
        undefined,
        123,
        {},
        [],
        "\0",
        "🔥",
      ];

      for (const a of inputs) {
        for (const b of inputs) {
          expect(() => {
            const res = constantTimeEqual(a as string, b as string);
            if (typeof a === "string" && typeof b === "string" && a === b) {
              expect(res).toBe(true);
            } else {
              expect(res).toBe(false);
            }
          }).not.toThrow();
        }
      }
    });
  });
});
