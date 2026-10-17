// SPDX-License-Identifier: MIT

/**
 * Webhook Replay Rejection Integration Test Suite (#1409).
 *
 * Validates replay rejection across Node.js, Python, and Go reference verifiers
 * against the 5-minute tolerance window specified in docs/webhook-verification.md.
 *
 * Test matrix covers:
 * - -10s: valid (fresh delivery)
 * - -4m:  valid (within 5-minute tolerance window)
 * - -6m:  expired (exceeds window, rejected with WebhookTimestampExpired)
 * - +2m:  future-skew valid (within acceptable clock skew)
 * - +10m: future-skew expired (excessive future timestamp, rejected with WebhookTimestampFutureSkew)
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { createHmac } from "node:crypto";
import {
  verifyWebhookSignature,
  assertWebhookSignature,
  WebhookErrorCode,
  WebhookTimestampExpired,
  WebhookTimestampFutureSkew,
  canonicalize,
} from "../examples/webhook-verification/node-verifier";

const SECRET = "whsec_test_secret_0123456789abcdef";
const EXAMPLES_DIR = path.resolve(process.cwd(), "examples/webhook-verification");
const NODE_VERIFY = path.join(EXAMPLES_DIR, "node/verify.mjs");
const PY_VERIFY = path.join(EXAMPLES_DIR, "python/verify.py");
const GO_DIR = path.join(EXAMPLES_DIR, "go");

const hasPython =
  spawnSync("python3", ["--version"], { encoding: "utf8" }).status === 0;
const hasGo = spawnSync("go", ["version"], { encoding: "utf8" }).status === 0;

interface PayloadFixture {
  label: string;
  offsetSeconds: number;
  expectedValid: boolean;
  expectedErrorCode?: string;
}

const FIXTURES: PayloadFixture[] = [
  {
    label: "-10s (fresh delivery)",
    offsetSeconds: -10,
    expectedValid: true,
  },
  {
    label: "-4m (valid within window)",
    offsetSeconds: -240,
    expectedValid: true,
  },
  {
    label: "-6m (expired past 5m tolerance)",
    offsetSeconds: -360,
    expectedValid: false,
    expectedErrorCode: WebhookErrorCode.TIMESTAMP_EXPIRED,
  },
  {
    label: "+2m (valid future clock skew)",
    offsetSeconds: 120,
    expectedValid: true,
  },
  {
    label: "+10m (excessive future skew)",
    offsetSeconds: 600,
    expectedValid: false,
    expectedErrorCode: WebhookErrorCode.TIMESTAMP_FUTURE_SKEW,
  },
];

function buildSignedWebhook(timestampIso: string, secret: string) {
  const baseObject = {
    event: "payment.created",
    timestamp: timestampIso,
    data: { id: "pay_test_123", amount: 5000 },
  };

  const canonical = canonicalize(JSON.stringify(baseObject));
  const signature = createHmac("sha256", secret)
    .update(`${timestampIso}.${canonical}`)
    .digest("hex");

  const body = JSON.stringify({
    ...baseObject,
    signature,
  });

  return { body, signature, timestamp: timestampIso };
}

describe("Webhook replay protection — Node.js TypeScript library (node-verifier.ts)", () => {
  const baseTime = new Date("2026-10-15T12:00:00Z");

  for (const fixture of FIXTURES) {
    it(`evaluates ${fixture.label}`, () => {
      const payloadTime = new Date(
        baseTime.getTime() + fixture.offsetSeconds * 1000,
      );
      const { body, signature, timestamp } = buildSignedWebhook(
        payloadTime.toISOString(),
        SECRET,
      );

      const result = verifyWebhookSignature({
        body,
        signature,
        secret: SECRET,
        timestamp,
        maxAgeSeconds: 300,
        now: baseTime,
      });

      expect(result.valid).toBe(fixture.expectedValid);

      if (fixture.expectedValid) {
        expect(result.code).toBeUndefined();
        expect(result.reason).toBe("valid");
        expect(() =>
          assertWebhookSignature({
            body,
            signature,
            secret: SECRET,
            timestamp,
            maxAgeSeconds: 300,
            now: baseTime,
          }),
        ).not.toThrow();
      } else {
        expect(result.code).toBe(fixture.expectedErrorCode);
        expect(result.reason).toContain(fixture.expectedErrorCode);

        if (fixture.expectedErrorCode === WebhookErrorCode.TIMESTAMP_EXPIRED) {
          expect(() =>
            assertWebhookSignature({
              body,
              signature,
              secret: SECRET,
              timestamp,
              maxAgeSeconds: 300,
              now: baseTime,
            }),
          ).toThrow(WebhookTimestampExpired);
        } else if (
          fixture.expectedErrorCode === WebhookErrorCode.TIMESTAMP_FUTURE_SKEW
        ) {
          expect(() =>
            assertWebhookSignature({
              body,
              signature,
              secret: SECRET,
              timestamp,
              maxAgeSeconds: 300,
              now: baseTime,
            }),
          ).toThrow(WebhookTimestampFutureSkew);
        }
      }
    });
  }
});

describe("Webhook replay protection — Node.js CLI (examples/webhook-verification/node/verify.mjs)", () => {
  const baseTime = new Date("2026-10-15T12:00:00Z");

  for (const fixture of FIXTURES) {
    it(`evaluates ${fixture.label}`, () => {
      const payloadTime = new Date(
        baseTime.getTime() + fixture.offsetSeconds * 1000,
      );
      const { body, signature, timestamp } = buildSignedWebhook(
        payloadTime.toISOString(),
        SECRET,
      );

      const res = spawnSync(
        "node",
        [
          NODE_VERIFY,
          "--secret",
          SECRET,
          "--signature",
          signature,
          "--timestamp",
          timestamp,
          "--now",
          baseTime.toISOString(),
          "--max-age",
          "300",
        ],
        { input: body, encoding: "utf8" },
      );

      if (fixture.expectedValid) {
        expect(res.status).toBe(0);
        expect(String(res.stdout).trim()).toBe("VALID");
      } else {
        expect(res.status).toBe(1);
        expect(String(res.stderr)).toContain(fixture.expectedErrorCode);
      }
    });
  }
});

describe("Webhook replay protection — Python 3 reference verifier", () => {
  const baseTime = new Date("2026-10-15T12:00:00Z");

  for (const fixture of FIXTURES) {
    it.skipIf(!hasPython)(`evaluates ${fixture.label}`, () => {
      const payloadTime = new Date(
        baseTime.getTime() + fixture.offsetSeconds * 1000,
      );
      const { body, signature, timestamp } = buildSignedWebhook(
        payloadTime.toISOString(),
        SECRET,
      );

      const res = spawnSync(
        "python3",
        [
          PY_VERIFY,
          "--secret",
          SECRET,
          "--signature",
          signature,
          "--timestamp",
          timestamp,
          "--now",
          baseTime.toISOString(),
          "--max-age",
          "300",
        ],
        { input: body, encoding: "utf8" },
      );

      if (fixture.expectedValid) {
        expect(res.status).toBe(0);
        expect(String(res.stdout).trim()).toBe("VALID");
      } else {
        expect(res.status).toBe(1);
        expect(String(res.stderr)).toContain(fixture.expectedErrorCode);
      }
    });
  }
});

describe("Webhook replay protection — Go reference verifier", () => {
  const baseTime = new Date("2026-10-15T12:00:00Z");

  for (const fixture of FIXTURES) {
    it.skipIf(!hasGo)(
      `evaluates ${fixture.label}`,
      () => {
      const payloadTime = new Date(
        baseTime.getTime() + fixture.offsetSeconds * 1000,
      );
      const { body, signature, timestamp } = buildSignedWebhook(
        payloadTime.toISOString(),
        SECRET,
      );

      const res = spawnSync(
        "go",
        [
          "run",
          ".",
          "--secret",
          SECRET,
          "--signature",
          signature,
          "--timestamp",
          timestamp,
          "--now",
          baseTime.toISOString(),
          "--max-age",
          "300",
        ],
        {
          input: body,
          encoding: "utf8",
          cwd: GO_DIR,
          env: { ...process.env, GOFLAGS: "-mod=mod" },
        },
      );

      if (fixture.expectedValid) {
        expect(res.status).toBe(0);
        expect(String(res.stdout).trim()).toBe("VALID");
      } else {
        expect(res.status).toBe(1);
        expect(String(res.stderr)).toContain(fixture.expectedErrorCode);
      }
    }, 60000);
  }
});
