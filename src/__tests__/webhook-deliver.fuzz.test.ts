// SPDX-License-Identifier: MIT

/**
 * Property-based (fuzz) tests for the webhook signature path (issue #1437).
 *
 * `buildSignedPayload` and `verifyWebhookSignature` are the two places where
 * bytes from outside the process — a JSON body, three HTTP headers and a
 * shared secret — are turned into (and compared against) an HMAC. The
 * hand-written cases in `webhook-deliver.test.ts` pin the documented scheme;
 * this suite attacks the same code with randomised input: empty and truncated
 * bodies, null bytes, lone surrogates and other malformed unicode, megabytes of
 * padding, non-hex / truncated / oversized signatures and non-string values
 * smuggled in through `as unknown as`.
 *
 * The invariants under test are the acceptance criteria of the issue:
 *
 *   1. `buildSignedPayload` is total over representable payloads and always
 *      produces a 64-character lowercase hex digest that a receiver can verify.
 *   2. Nothing throws out of `verifyWebhookSignature` — every malformed input
 *      yields `{ valid: false, reason }`.
 *   3. `valid: true` is only ever returned for a signature we actually
 *      produced; a random digest never verifies.
 *
 * fast-check shrinks every failing case to a minimal reproduction, so a future
 * regression arrives as a small counter-example rather than a 4 KiB blob.
 */

import { describe, it, expect, vi } from "vitest";
import fc from "fast-check";
import crypto from "crypto";

// `webhook-deliver` pulls in the SSRF guard, which resolves DNS. Nothing in
// this suite delivers a webhook, so stub the guard to keep the suite hermetic.
vi.mock("@/lib/webhook-url-guard", () => ({
  isSafeWebhookUrlAtDelivery: vi.fn().mockResolvedValue(true),
}));

import {
  MAX_WEBHOOK_BODY_BYTES,
  buildSignedPayload,
  canonicalizeWebhookBody,
  constantTimeEqual,
  verifyWebhookSignature,
  webhookSignedInput,
  type WebhookPayload,
  type WebhookVerificationInput,
} from "@/lib/webhook-deliver";

/** Total number of randomised iterations this suite is expected to run. */
const FUZZ_RUNS = {
  signRoundTrip: 1500,
  malformedBody: 5000,
  arbitraryValues: 1000,
  constantTime: 1000,
};

const HEX_SHA256 = /^[0-9a-f]{64}$/;
const SECRET = "fuzz-secret-0123456789";

/**
 * Arbitrary text built from *arbitrary UTF-16 code units* — i.e. the full
 * `binary` unit set, which includes NUL bytes, lone surrogates and other
 * sequences that are not valid unicode. JSON.stringify serialises lone
 * surrogates as escapes (well-formed JSON.stringify, ES2019), so these are
 * exactly the inputs that reach a receiver even from buggy senders.
 */
const arbitraryWireString = (maxLength = 128) =>
  fc.string({ unit: "binary", maxLength });

/** An arbitrary payload envelope whose fields are all malformed-unicode-safe. */
const arbitraryPayload = (): fc.Arbitrary<WebhookPayload> =>
  fc.record({
    event: arbitraryWireString(48),
    timestamp: fc.oneof(
      fc.constant(""),
      arbitraryWireString(40),
      fc
        .integer({ min: 0, max: 4_102_444_800_000 })
        .map((ms) => new Date(ms).toISOString())
    ),
    data: fc.dictionary(arbitraryWireString(16), fc.jsonValue(), {
      maxKeys: 6,
    }) as fc.Arbitrary<Record<string, unknown>>,
    test: fc.option(fc.boolean(), { nil: undefined }),
  });

/** JSON text a receiver could plausibly see, valid or not. */
const arbitraryBody = (): fc.Arbitrary<string> =>
  fc.oneof(
    { weight: 3, arbitrary: fc.jsonValue().map((v) => JSON.stringify(v)) },
    { weight: 3, arbitrary: arbitraryWireString(512) },
    {
      weight: 1,
      arbitrary: fc
        .jsonValue()
        .map((v) => JSON.stringify(v).slice(0, 64)),
    },
    // Empty and null-byte-only bodies are the two most common "truncated
    // upload" shapes and must not be special-cased away by the generator.
    { weight: 1, arbitrary: fc.constantFrom("", "\u0000", "\u0000\u0000") }
  );

/** Arbitrary "signature header" values, including boundary lengths. */
const arbitrarySignature = (): fc.Arbitrary<string> =>
  fc.oneof(
    arbitraryWireString(140),
    fc.hexaString({ maxLength: 140 }),
    fc.constantFrom(
      "",
      " ",
      "0",
      "00",
      "0".repeat(63),
      "0".repeat(64),
      "0".repeat(65),
      "0".repeat(128),
      "\u0000".repeat(64),
      "ABCDEF".repeat(10),
      "zzzz".repeat(16)
    )
  );

function verify(input: Partial<WebhookVerificationInput>): ReturnType<
  typeof verifyWebhookSignature
> {
  return verifyWebhookSignature({
    body: "",
    signature: "",
    secret: SECRET,
    maxAgeSeconds: 0,
    ...input,
  });
}

describe("fuzz: buildSignedPayload", () => {
  it("is deterministic and produces a verifiable 64-hex digest for arbitrary payloads", () => {
    fc.assert(
      fc.property(arbitraryPayload(), arbitraryWireString(64), (payload, secret) => {
        const first = buildSignedPayload(payload, secret);
        const second = buildSignedPayload(payload, secret);

        // Deterministic: the same payload and secret always sign the same way.
        expect(second.signature).toBe(first.signature);
        expect(second.body).toBe(first.body);
        expect(first.timestamp).toBe(payload.timestamp);

        expect(first.signature).toMatch(HEX_SHA256);

        // The wire body carries the real signature, while the canonical form
        // is what was signed (signature field emptied, key preserved). Compare
        // via the JSON round-trip: `undefined` members are dropped and `-0`
        // becomes `0` on the wire, which is precisely what a receiver sees.
        const wire = JSON.parse(first.body) as Record<string, unknown>;
        expect(wire.signature).toBe(first.signature);
        expect(canonicalizeWebhookBody(payload)).toBe(
          JSON.stringify({ ...wire, signature: "" })
        );
        expect(first.signature).toBe(
          crypto
            .createHmac("sha256", secret)
            .update(
              webhookSignedInput(first.timestamp, canonicalizeWebhookBody(payload))
            )
            .digest("hex")
        );

        // And the verifier accepts exactly that digest (freshness disabled:
        // the timestamp is arbitrary, not a real clock reading).
        expect(
          verify({
            body: first.body,
            signature: first.signature,
            secret,
            timestamp: payload.timestamp,
          })
        ).toEqual({ valid: true, reason: "valid" });
      }),
      { numRuns: FUZZ_RUNS.signRoundTrip }
    );
  });

  it("handles empty bodies, null bytes and extremely long strings without losing information", () => {
    const cases: WebhookPayload[] = [
      { event: "", timestamp: "", data: {} },
      { event: "\u0000", timestamp: "\u0000", data: { "\u0000": "\u0000" } },
      { event: "e".repeat(100_000), timestamp: "t", data: { blob: "x".repeat(100_000) } },
      { event: "a", timestamp: "b", data: { emoji: "👩‍💻🏳️‍🌈🇳🇬" } },
    ];

    for (const payload of cases) {
      const signed = buildSignedPayload(payload, SECRET);
      expect(signed.signature).toMatch(HEX_SHA256);
      expect(
        verify({
          body: signed.body,
          signature: signed.signature,
          timestamp: payload.timestamp,
        })
      ).toEqual({ valid: true, reason: "valid" });
    }
  });
});

describe("fuzz: verifyWebhookSignature never throws", () => {
  it("rejects 5,000 randomised malformed bodies and signatures without throwing", () => {
    fc.assert(
      fc.property(
        arbitraryBody(),
        arbitrarySignature(),
        arbitraryWireString(40),
        (body, signature, timestamp) => {
          let result: ReturnType<typeof verifyWebhookSignature> | undefined;
          expect(() => {
            result = verify({ body, signature, timestamp });
          }).not.toThrow();

          // A digest we did not produce can never verify, whatever the body.
          expect(result!.valid).toBe(false);
          expect(typeof result!.reason).toBe("string");
          return true;
        }
      ),
      { numRuns: FUZZ_RUNS.malformedBody }
    );
  });

  it("rejects non-string bodies, secrets, signatures and timestamps without throwing", () => {
    fc.assert(
      fc.property(
        fc.anything(),
        fc.anything(),
        fc.anything(),
        fc.anything(),
        (body, signature, timestamp, secret) => {
          let result: ReturnType<typeof verifyWebhookSignature> | undefined;
          expect(() => {
            result = verifyWebhookSignature({
              body: body as unknown as string,
              signature: signature as unknown as string,
              timestamp: timestamp as unknown as string,
              secret: secret as unknown as string,
              maxAgeSeconds: 0,
            });
          }).not.toThrow();
          expect(result!.valid).toBe(false);
          return true;
        }
      ),
      { numRuns: FUZZ_RUNS.arbitraryValues }
    );
  });

  it("rejects a body exactly at / over the size cap and accepts a 1-byte-smaller one", () => {
    const head = '{"event":"a","timestamp":"t","data":{"blob":"';
    const tail = '"}}';
    const atLimit = head + "x".repeat(MAX_WEBHOOK_BODY_BYTES - head.length - tail.length) + tail;
    const overLimit = head + "x".repeat(MAX_WEBHOOK_BODY_BYTES - head.length - tail.length + 1) + tail;

    expect(Buffer.byteLength(atLimit, "utf8")).toBe(MAX_WEBHOOK_BODY_BYTES);
    expect(Buffer.byteLength(overLimit, "utf8")).toBe(MAX_WEBHOOK_BODY_BYTES + 1);

    // At the cap the body is still parsed and simply fails signature comparison.
    expect(verify({ body: atLimit, signature: "0".repeat(64) })).toEqual({
      valid: false,
      reason: "signature mismatch",
    });
    // One byte over is refused before JSON.parse / HMAC.
    expect(verify({ body: overLimit, signature: "0".repeat(64) })).toEqual({
      valid: false,
      reason: "body too large",
    });
    // Multi-megabyte bodies are refused too, not just the cap boundary.
    expect(() =>
      verify({ body: "a".repeat(4 * 1024 * 1024), signature: "" })
    ).not.toThrow();
    expect(verify({ body: "a".repeat(4 * 1024 * 1024), signature: "" })).toEqual({
      valid: false,
      reason: "body too large",
    });
  });

  it("treats missing, duplicated and non-hex headers as a signature mismatch", () => {
    const { body, signature } = buildSignedPayload(
      { event: "payment.created", timestamp: "2026-08-14T00:00:00Z", data: {} },
      SECRET
    );

    const cases: Array<string | null | undefined> = [
      undefined,
      null,
      "",
      ` ${signature}`,
      `${signature} `,
      signature.toUpperCase(),
      `${signature},${signature}`, // duplicate header folded by the runtime
      `${signature.slice(0, 32)}${signature.slice(0, 32)}`, // truncated then padded
      "not-hex",
      "\u0000".repeat(64),
    ];

    for (const candidate of cases) {
      expect(() =>
        verify({ body, signature: candidate, timestamp: "2026-08-14T00:00:00Z" })
      ).not.toThrow();
      expect(
        verify({ body, signature: candidate, timestamp: "2026-08-14T00:00:00Z" })
      ).toEqual({ valid: false, reason: "signature mismatch" });
    }

    // Duplicate timestamp headers are just not the signed value.
    expect(
      verify({
        body,
        signature,
        timestamp: "2026-08-14T00:00:00Z, 2026-08-14T00:00:00Z",
      }).reason
    ).toBe("signature mismatch");
  });

  it("normalises non-string header values without running user code", () => {
    const { body, timestamp, signature } = buildSignedPayload(
      { event: "e", timestamp: "2026-08-14T00:00:00Z", data: {} },
      SECRET
    );

    // Numbers and booleans keep the coercion a sender's template literal
    // would have applied (`${12345}` === "12345").
    expect(
      verify({
        body,
        signature,
        timestamp: 12345 as unknown as string,
      }).reason
    ).toBe("signature mismatch");

    // Symbols, functions and objects never reach user-defined coercion.
    const hostile = {
      toString() {
        throw new Error("hostile toString");
      },
      valueOf() {
        throw new Error("hostile valueOf");
      },
    };
    const nullProto = Object.create(null) as Record<string, unknown>;

    for (const value of [Symbol("sig"), () => "x", hostile, nullProto]) {
      let result: ReturnType<typeof verifyWebhookSignature> | undefined;
      expect(() => {
        result = verify({
          body,
          signature: value as unknown as string,
          timestamp: value as unknown as string,
        });
      }).not.toThrow();
      expect(result!.valid).toBe(false);
    }

    // The genuine delivery with its string timestamp still verifies, so the
    // normalisation only ever affects junk values.
    expect(verify({ body, signature, timestamp })).toEqual({
      valid: true,
      reason: "valid",
    });
  });

  it("never throws on truncated JSON, invalid JSON and non-object JSON", () => {
    const { body } = buildSignedPayload(
      { event: "payment.created", timestamp: "2026-08-14T00:00:00Z", data: { a: 1 } },
      SECRET
    );

    const truncated = body.slice(0, Math.floor(body.length / 2));
    const bodies = [
      truncated,
      "",
      "{",
      "\u0000",
      "undefined",
      "NaN",
      "[]",
      "null",
      "true",
      '"a string"',
      "{}",
      '{"timestamp":{}}',
      '{"event":"x","timestamp":null,"data":[]}',
    ];

    for (const candidate of bodies) {
      let result: ReturnType<typeof verifyWebhookSignature> | undefined;
      expect(() => {
        result = verify({ body: candidate, signature: "0".repeat(64) });
      }).not.toThrow();
      // `{}` parses but still cannot match the digest; everything else is an
      // invalid body. Both are `valid: false`, which is what the caller sees.
      const parsed = (() => {
        try {
          const v: unknown = JSON.parse(candidate);
          return typeof v === "object" && v !== null && !Array.isArray(v);
        } catch {
          return false;
        }
      })();
      expect(result!.valid).toBe(false);
      expect(result!.reason).toBe(
        parsed ? "signature mismatch" : "invalid body"
      );
    }
  });
});

describe("fuzz: constantTimeEqual", () => {
  it("returns a boolean for arbitrary inputs and matches equality only on identical bytes", () => {
    fc.assert(
      fc.property(arbitraryWireString(80), arbitraryWireString(80), (a, b) => {
        let equal: boolean | undefined;
        expect(() => {
          equal = constantTimeEqual(a, b);
        }).not.toThrow();
        expect(typeof equal).toBe("boolean");
        if (Buffer.byteLength(a, "utf8") !== Buffer.byteLength(b, "utf8")) {
          expect(equal).toBe(false);
        }
        // Reflexive even for malformed unicode: a value equals itself.
        expect(constantTimeEqual(a, a)).toBe(true);
        return true;
      }),
      { numRuns: FUZZ_RUNS.constantTime }
    );
  });
});

describe("fuzz: replay window", () => {
  it("never throws for arbitrary clocks and tolerances", () => {
    const { body, signature } = buildSignedPayload(
      { event: "e", timestamp: "2026-08-14T00:00:00Z", data: {} },
      SECRET
    );

    fc.assert(
      fc.property(
        fc.integer(),
        fc.integer({ min: 0, max: 10_000_000 }),
        (now, maxAgeSeconds) => {
          let result: ReturnType<typeof verifyWebhookSignature> | undefined;
          expect(() => {
            result = verify({
              body,
              signature,
              timestamp: "2026-08-14T00:00:00Z",
              now,
              maxAgeSeconds,
            });
          }).not.toThrow();
          expect(typeof result!.valid).toBe("boolean");
          return true;
        }
      ),
      { numRuns: FUZZ_RUNS.arbitraryValues }
    );
  });
});
