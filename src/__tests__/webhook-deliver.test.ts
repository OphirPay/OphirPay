// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";

const { isSafeWebhookUrlAtDeliveryMock } = vi.hoisted(() => ({
  isSafeWebhookUrlAtDeliveryMock: vi.fn(),
}));

vi.mock("@/lib/webhook-url-guard", () => ({
  isSafeWebhookUrlAtDelivery: isSafeWebhookUrlAtDeliveryMock,
}));

import {
  signWebhookPayload,
  buildSignedPayload,
  buildWebhookRequestPreview,
  deliverWebhook,
  verifyWebhookSignature,
  constantTimeEqual,
  BLOCKED_WEBHOOK_TARGET_ERROR,
  canonicalizeWebhookBody,
  webhookSignedInput,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS,
  type WebhookPayload,
  type WebhookVerificationResult,
} from "@/lib/webhook-deliver";
import {
  resetMetricsForTest,
} from "@/lib/metrics-counters";

const SECRET = "test-secret-0123456789";

const samplePayload = {
  event: "payment.created",
  timestamp: "2026-08-14T00:00:00Z",
  data: { id: "p_123", amount: 100 },
};

/** Receiver-side recomputation of the documented signature scheme. */
function expectedSignature(payload: WebhookPayload, secret = SECRET): string {
  return crypto
    .createHmac("sha256", secret)
    .update(webhookSignedInput(payload.timestamp, canonicalizeWebhookBody(payload)))
    .digest("hex");
}

/**
 * Minimal receiver check mirroring docs/webhook-verification.md and the
 * reference verifiers: verify the HMAC over `<timestamp>.<canonical body>`,
 * then enforce the freshness window on the signed timestamp.
 */
function receiverVerify(
  body: string,
  signature: string,
  secret: string,
  nowMs: number,
  maxAgeSeconds = WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS
): string {
  const parsed = JSON.parse(body) as WebhookPayload;
  const canonical = JSON.stringify({ ...parsed, signature: "" });
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${parsed.timestamp}.${canonical}`)
    .digest("hex");
  if (expected !== signature) return "signature mismatch";
  const ageSeconds = (nowMs - Date.parse(parsed.timestamp)) / 1000;
  if (ageSeconds > maxAgeSeconds) return "payload too old — possible replay";
  if (ageSeconds < -maxAgeSeconds) return "payload timestamp is in the future";
  return "valid";
}

describe("signWebhookPayload", () => {
  it("computes an HMAC-SHA256 over `<timestamp>.<canonical body>`", () => {
    const sig = signWebhookPayload(samplePayload, SECRET);
    expect(sig).toMatch(/^[a-f0-9]{64}$/);
    expect(sig).toBe(expectedSignature(samplePayload));
    // Deterministic for the same input+secret
    expect(signWebhookPayload(samplePayload, SECRET)).toBe(sig);
    // Different secret => different signature
    expect(signWebhookPayload(samplePayload, "other-secret")).not.toBe(sig);
  });

  it("changes when the timestamp changes (the timestamp is signed)", () => {
    const later = { ...samplePayload, timestamp: "2026-08-14T00:00:01Z" };
    expect(signWebhookPayload(later, SECRET)).not.toBe(
      signWebhookPayload(samplePayload, SECRET)
    );
  });
});

describe("buildSignedPayload", () => {
  it("produces a body whose signature a receiver can verify (empty-and-reserialize canonicalization)", () => {
    const { body, signature } = buildSignedPayload(samplePayload, SECRET);
    const received = JSON.parse(body);
    const stripped = { ...received, signature: "" };
    const canonical = JSON.stringify(stripped);
    const expected = crypto
      .createHmac("sha256", SECRET)
      .update(`${samplePayload.timestamp}.${canonical}`)
      .digest("hex");
    expect(signature).toBe(expected);
    expect(received.signature).toBe(signature);
  });

  it("exposes the exact canonical input, wire body, and headers used by delivery", () => {
    const preview = buildWebhookRequestPreview(samplePayload, SECRET);
    const signed = buildSignedPayload(samplePayload, SECRET);
    expect(preview.canonicalBody).toBe(JSON.stringify({ ...samplePayload, signature: "" }));
    expect(preview.body).toBe(signed.body);
    expect(preview.headers).toEqual({
      "Content-Type": "application/json",
      "X-OphirPay-Signature": signed.signature,
      "X-OphirPay-Event": samplePayload.event,
      [WEBHOOK_TIMESTAMP_HEADER]: samplePayload.timestamp,
    });
  });

  it("signs over the body with the signature field emptied (not the raw payload)", () => {
    const { body, signature } = buildSignedPayload(samplePayload, SECRET);
    const canonical = JSON.stringify({ ...samplePayload, signature: "" });
    const expected = crypto
      .createHmac("sha256", SECRET)
      .update(`${samplePayload.timestamp}.${canonical}`)
      .digest("hex");
    expect(signature).toBe(expected);
    // The transmitted body carries the real signature (not the empty one).
    expect(JSON.parse(body).signature).toBe(signature);
    expect(body).not.toBe(canonical);
  });

  it("returns the signed timestamp so callers can set the header", () => {
    const { timestamp } = buildSignedPayload(samplePayload, SECRET);
    expect(timestamp).toBe(samplePayload.timestamp);
  });

  it("rejects a delivery re-dated by editing the timestamp header", () => {
    const { body, signature } = buildSignedPayload(samplePayload, SECRET);
    // An attacker captures the body+signature and rewrites the timestamp to
    // "now"; the signature no longer matches because the timestamp is signed.
    const canonical = JSON.stringify({ ...samplePayload, signature: "" });
    const forged = crypto
      .createHmac("sha256", SECRET)
      .update(`${new Date().toISOString()}.${canonical}`)
      .digest("hex");
    expect(forged).not.toBe(signature);
    // The genuine (fresh at receipt time) delivery still verifies.
    expect(
      receiverVerify(body, signature, SECRET, Date.parse(samplePayload.timestamp) + 1000)
    ).toBe("valid");
  });
});

describe("replay window", () => {
  it("accepts a signature inside the freshness window", () => {
    const { body, signature } = buildSignedPayload(samplePayload, SECRET);
    const receivedAt = Date.parse(samplePayload.timestamp) + 30_000; // 30s later
    expect(receiverVerify(body, signature, SECRET, receivedAt)).toBe("valid");
  });

  it("rejects a stale signature outside the freshness window", () => {
    const { body, signature } = buildSignedPayload(samplePayload, SECRET);
    const receivedAt = Date.parse(samplePayload.timestamp) + 3600_000; // 1h later
    expect(receiverVerify(body, signature, SECRET, receivedAt)).toContain(
      "too old"
    );
  });

  it("rejects a future-dated signature beyond the clock-skew allowance", () => {
    const { body, signature } = buildSignedPayload(samplePayload, SECRET);
    const receivedAt = Date.parse(samplePayload.timestamp) - 3600_000;
    expect(receiverVerify(body, signature, SECRET, receivedAt)).toContain(
      "future"
    );
  });
});

import {
  buildTestWebhookPayload,
  parseSignatureHeader,
  verifySignature,
} from "@/lib/webhook-test";

describe("fuzz testing for webhook signature verification and payload parsing (#1299)", () => {
  it("handles empty bodies, null bytes, oversized bodies, invalid JSON, and unicode edge cases without throwing", () => {
    const unicodePayload: WebhookPayload = {
      event: "payment.completed",
      timestamp: "2026-08-14T00:00:00Z",
      data: {
        memo: "Stellar 🚀 \u0000 \uD800 \uFFFF 漢字 Café",
        nested: { empty: "", zero: 0, bool: false },
      },
    };
    const signedUnicode = buildSignedPayload(unicodePayload, SECRET);
    expect(
      verifySignature(signedUnicode.body, signedUnicode.signature, SECRET, {
        nowMs: Date.parse(unicodePayload.timestamp) + 1000,
      })
    ).toBe(true);

    const malformedInputs: Array<[unknown, unknown, unknown]> = [
      ["", "a".repeat(64), SECRET],
      [null, "a".repeat(64), SECRET],
      [undefined, "a".repeat(64), SECRET],
      ["\0\0\0", "a".repeat(64), SECRET],
      ["{truncated json", "a".repeat(64), SECRET],
      ["[]", "a".repeat(64), SECRET],
      ["\"primitive\"", "a".repeat(64), SECRET],
      ["x".repeat(2 * 1024 * 1024), "a".repeat(64), SECRET],
      [signedUnicode.body, "", SECRET],
      [signedUnicode.body, null, SECRET],
      [signedUnicode.body, ["sig1", "sig2"], SECRET],
      [signedUnicode.body, `${signedUnicode.signature},${signedUnicode.signature}`, SECRET],
      [signedUnicode.body, "z".repeat(64), SECRET],
      [signedUnicode.body, signedUnicode.signature.slice(0, 63), SECRET],
      [signedUnicode.body, `${signedUnicode.signature}a`, SECRET],
      [signedUnicode.body, signedUnicode.signature, ""],
    ];

    for (const [body, sig, sec] of malformedInputs) {
      expect(() => verifySignature(body, sig, sec)).not.toThrow();
      expect(verifySignature(body, sig, sec)).toBe(false);
    }

    expect(parseSignatureHeader(`sha256=${signedUnicode.signature.toUpperCase()}`)).toBe(
      signedUnicode.signature,
    );
    expect(parseSignatureHeader(["dup1", "dup2"])).toBeNull();
    expect(parseSignatureHeader("not-hex")).toBeNull();
  });

  it("runs 5,000+ randomized fuzz iterations on buildSignedPayload and verifySignature with zero unhandled exceptions", () => {
    let seed = 0x1299cafe;
    const nextRand = () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return seed >>> 0;
    };

    const alphabet =
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789\0\n\r\t\"'\\{}[]:,🚀漢字\uD800\uDFFF";

    const randomString = (maxLen: number): string => {
      const len = nextRand() % (maxLen + 1);
      let out = "";
      for (let i = 0; i < len; i++) {
        out += alphabet[nextRand() % alphabet.length];
      }
      return out;
    };

    const testPayload = buildTestWebhookPayload();
    expect(testPayload.test).toBe(true);

    const iterations = 5_200;
    let validCount = 0;
    let rejectedCount = 0;

    for (let i = 0; i < iterations; i++) {
      const mode = i % 5;
      if (mode === 0) {
        // Valid round-trip with fuzzed payload fields
        const payload: WebhookPayload = {
          event: `event.${i}`,
          timestamp: "2026-08-14T00:00:00Z",
          data: {
            fuzzKey: randomString(32),
            iteration: i,
          },
        };
        const secret = `sec_${(nextRand() % 1000) + 1}`;
        const signed = buildSignedPayload(payload, secret);
        const ok = verifySignature(signed.body, signed.signature, secret, {
          nowMs: Date.parse(payload.timestamp) + 5_000,
        });
        expect(ok).toBe(true);
        validCount++;
      } else if (mode === 1) {
        // Tampered signature or wrong secret
        const signed = buildSignedPayload(samplePayload, SECRET);
        const flippedSig =
          (signed.signature[0] === "a" ? "b" : "a") + signed.signature.slice(1);
        expect(verifySignature(signed.body, flippedSig, SECRET)).toBe(false);
        rejectedCount++;
      } else if (mode === 2) {
        // Fuzzed raw body string
        const rawBody = randomString(96);
        const rawSig = randomString(68);
        expect(verifySignature(rawBody, rawSig, SECRET)).toBe(false);
        rejectedCount++;
      } else if (mode === 3) {
        // Fuzzed header shapes (arrays, numbers, boundary lengths)
        const boundarySig = "f".repeat(i % 70);
        expect(verifySignature( "{}" , boundarySig, SECRET)).toBe(false);
        rejectedCount++;
      } else {
        // Stale or malformed timestamp in JSON body
        const body = JSON.stringify({
          event: "payment.created",
          timestamp: randomString(20),
          data: { i },
          signature: "a".repeat(64),
        });
        expect(
          verifySignature(body, "a".repeat(64), SECRET, {
            nowMs: 1_700_000_000_000,
          })
        ).toBe(false);
        rejectedCount++;
      }
    }

    expect(validCount + rejectedCount).toBe(iterations);
    expect(iterations).toBeGreaterThanOrEqual(5_000);
  });
});

describe("deliverWebhook", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    resetMetricsForTest();
    // Default: the delivery-time guard accepts the target. Reset the hoisted
    // mock explicitly so call counts don't leak between tests.
    isSafeWebhookUrlAtDeliveryMock.mockReset();
    isSafeWebhookUrlAtDeliveryMock.mockResolvedValue(true);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it("sends the signed body, the timestamp header, and does not follow redirects (SSRF guard)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const ok = await deliverWebhook("https://example.com/hook", SECRET, samplePayload, 1);
    expect(ok.success).toBe(true);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://example.com/hook");
    expect(init.redirect).toBe("manual");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    expect(body.event).toBe("payment.created");
    expect(body.signature).toMatch(/^[a-f0-9]{64}$/);
    const headers = init.headers as Record<string, string>;
    expect(headers["X-OphirPay-Signature"]).toBe(body.signature);
    // Issue #702: the timestamp travels in a dedicated, signed header.
    expect(headers[WEBHOOK_TIMESTAMP_HEADER]).toBe(samplePayload.timestamp);
    expect(body.timestamp).toBe(samplePayload.timestamp);
    expect(ok.attempts).toBe(1);
    expect(ok.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("treats a 3xx redirect response as a failure (never follows it)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 302,
      headers: new Headers({ location: "http://169.254.169.254/latest/meta-data/" }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const ok = await deliverWebhook("https://example.com/hook", SECRET, samplePayload, 1);
    expect(ok.success).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ok.attempts).toBe(1);
    expect(ok.errorMessage).toBe("HTTP 302");
  });

  it("returns a clear error when the destination fails the delivery-time guard", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    isSafeWebhookUrlAtDeliveryMock.mockResolvedValue(false);
    // Loopback URL is blocked by the guard before any fetch happens.
    const ok = await deliverWebhook("http://127.0.0.1:8080/hook", SECRET, samplePayload, 2);
    expect(ok.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(ok.attempts).toBe(0);
    expect(ok.errorMessage).toBe(BLOCKED_WEBHOOK_TARGET_ERROR);
  });

  it("re-validates before every attempt and blocks a rebinding host mid-retry", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    // First attempt resolves publicly, the retry resolves privately — the
    // second attempt must be refused before its fetch (the 1s retry backoff
    // is the only real delay in the test).
    isSafeWebhookUrlAtDeliveryMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const ok = await deliverWebhook("https://rebind.example.com/hook", SECRET, samplePayload, 2);
    expect(ok.success).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ok.attempts).toBe(1);
    expect(ok.errorMessage).toBe(BLOCKED_WEBHOOK_TARGET_ERROR);
    expect(isSafeWebhookUrlAtDeliveryMock).toHaveBeenCalledTimes(2);
  });

  it("counts each retry attempt and labels the final failed outcome by the last attempt", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const ok = await deliverWebhook("https://example.com/hook", SECRET, samplePayload, 2);
    expect(ok.success).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(ok.attempts).toBe(2);
    expect(ok.statusCode).toBe(500);
  });

  it("times out a hanging receiver at the configured per-attempt budget", async () => {
    vi.stubEnv("WEBHOOK_TIMEOUT_MS", "10");
    globalThis.fetch = vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch;

    const result = await deliverWebhook(
      "https://example.com/hook",
      SECRET,
      samplePayload,
      1,
    );

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(1);
    expect(result.errorMessage).toBe("Webhook delivery timed out after 10ms");
  });
});

// ── verifyWebhookSignature (issue #1386) ───────────────────────
//
// The receiver-side verifier must compare signatures in constant time and
// return `false` (never throw) on any mismatch, including length mismatches
// that would otherwise make `crypto.timingSafeEqual` raise a RangeError.

describe("constantTimeEqual", () => {
  it("returns true only for byte-identical strings", () => {
    expect(constantTimeEqual("abc123", "abc123")).toBe(true);
    expect(constantTimeEqual("", "")).toBe(true);
    expect(constantTimeEqual("abc123", "abc124")).toBe(false);
  });

  it("returns false (without throwing) when the lengths differ", () => {
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
    expect(constantTimeEqual("a", "")).toBe(false);
    expect(constantTimeEqual("", "a")).toBe(false);
  });

  it("does not short-circuit on the first differing byte", () => {
    // A `===` implementation would bail after comparing the first character.
    // Both a leading-byte and a trailing-byte difference must reach the
    // constant-time primitive.
    const base = "0000000000000000000000000000000000000000000000000000000000000000";
    const leading = `1${base.slice(1)}`;
    const trailing = `${base.slice(0, -1)}1`;
    const spy = vi.spyOn(crypto, "timingSafeEqual");
    expect(constantTimeEqual(leading, base)).toBe(false);
    expect(constantTimeEqual(trailing, base)).toBe(false);
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});

describe("verifyWebhookSignature", () => {
  const receivedAt = Date.parse(samplePayload.timestamp) + 1000;

  it("accepts a delivery produced by buildSignedPayload", () => {
    const { body, signature } = buildSignedPayload(samplePayload, SECRET);
    const result = verifyWebhookSignature({
      body,
      signature,
      secret: SECRET,
      timestamp: samplePayload.timestamp,
      now: receivedAt,
    });
    expect(result).toEqual({ valid: true, reason: "valid" });
  });

  it("falls back to the signed body timestamp when the header is absent", () => {
    const { body, signature } = buildSignedPayload(samplePayload, SECRET);
    const result = verifyWebhookSignature({
      body,
      signature,
      secret: SECRET,
      now: receivedAt,
    });
    expect(result.valid).toBe(true);
  });

  it("rejects a non-matching digest", () => {
    const { body, signature } = buildSignedPayload(samplePayload, SECRET);
    const flipped = `${signature[0] === "0" ? "1" : "0"}${signature.slice(1)}`;
    const result = verifyWebhookSignature({
      body,
      signature: flipped,
      secret: SECRET,
      timestamp: samplePayload.timestamp,
      now: receivedAt,
    });
    expect(result).toEqual({ valid: false, reason: "signature mismatch" });
  });

  it("rejects a wrong secret", () => {
    const { body, signature } = buildSignedPayload(samplePayload, SECRET);
    const result = verifyWebhookSignature({
      body,
      signature,
      secret: "wrong-secret",
      timestamp: samplePayload.timestamp,
      now: receivedAt,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("signature mismatch");
  });

  it("rejects a tampered body that still carries the original signature", () => {
    const { body, signature } = buildSignedPayload(samplePayload, SECRET);
    const tampered = body.replace('"amount":100', '"amount":999');
    const result = verifyWebhookSignature({
      body: tampered,
      signature,
      secret: SECRET,
      timestamp: samplePayload.timestamp,
      now: receivedAt,
    });
    expect(result.reason).toBe("signature mismatch");
  });

  it("re-dating the delivery via the timestamp header invalidates the signature", () => {
    const { body, signature } = buildSignedPayload(samplePayload, SECRET);
    const result = verifyWebhookSignature({
      body,
      signature,
      secret: SECRET,
      timestamp: "2026-08-14T01:00:00Z",
      now: Date.parse("2026-08-14T01:00:00Z"),
    });
    expect(result.reason).toBe("signature mismatch");
  });

  it("returns false without throwing for truncated / empty / oversized signatures", () => {
    const { body } = buildSignedPayload(samplePayload, SECRET);
    const cases: Array<string | null | undefined> = [
      null,
      undefined,
      "",
      "abc",
      "0".repeat(128), // wrong length (128 hex chars vs 64)
    ];
    for (const signature of cases) {
      let result: WebhookVerificationResult | undefined;
      expect(() => {
        result = verifyWebhookSignature({
          body,
          signature,
          secret: SECRET,
          timestamp: samplePayload.timestamp,
          now: receivedAt,
        });
      }).not.toThrow();
      expect(result!.valid).toBe(false);
      expect(result!.reason).toBe("signature mismatch");
    }
  });

  it("does not invoke the constant-time primitive when lengths differ", () => {
    const { body } = buildSignedPayload(samplePayload, SECRET);
    const spy = vi.spyOn(crypto, "timingSafeEqual");
    // `timingSafeEqual` throws on unequal lengths, so the guard must short-circuit
    // on length (which is not secret) before reaching it.
    expect(() =>
      verifyWebhookSignature({
        body,
        signature: "short",
        secret: SECRET,
        timestamp: samplePayload.timestamp,
        now: receivedAt,
      })
    ).not.toThrow();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("invokes the constant-time primitive for equal-length mismatches", () => {
    const { body, signature } = buildSignedPayload(samplePayload, SECRET);
    const flipped = `${signature[0] === "0" ? "1" : "0"}${signature.slice(1)}`;
    const spy = vi.spyOn(crypto, "timingSafeEqual");
    verifyWebhookSignature({
      body,
      signature: flipped,
      secret: SECRET,
      timestamp: samplePayload.timestamp,
      now: receivedAt,
    });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("rejects a non-object JSON body", () => {
    for (const body of ["not json", "[]", "null", '"str"']) {
      const result = verifyWebhookSignature({
        body,
        signature: "0".repeat(64),
        secret: SECRET,
        now: receivedAt,
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("invalid body");
    }
  });

  it("enforces the replay window on the signed timestamp", () => {
    const { body, signature } = buildSignedPayload(samplePayload, SECRET);
    const stale = verifyWebhookSignature({
      body,
      signature,
      secret: SECRET,
      timestamp: samplePayload.timestamp,
      now: Date.parse(samplePayload.timestamp) + 3600_000,
    });
    expect(stale.reason).toBe("payload too old — possible replay");

    const future = verifyWebhookSignature({
      body,
      signature,
      secret: SECRET,
      timestamp: samplePayload.timestamp,
      now: Date.parse(samplePayload.timestamp) - 3600_000,
    });
    expect(future.reason).toBe("payload timestamp is in the future");
  });

  it("disables the freshness check when maxAgeSeconds is 0", () => {
    const { body, signature } = buildSignedPayload(samplePayload, SECRET);
    const result = verifyWebhookSignature({
      body,
      signature,
      secret: SECRET,
      timestamp: samplePayload.timestamp,
      maxAgeSeconds: 0,
      now: Date.parse(samplePayload.timestamp) + 86_400_000,
    });
    expect(result.valid).toBe(true);
  });

  it("rejects an unparseable timestamp", () => {
    const payload = { ...samplePayload, timestamp: "not-a-date" };
    const { body } = buildSignedPayload(payload, SECRET);
    const canonical = JSON.stringify({ ...payload, signature: "" });
    const signature = crypto
      .createHmac("sha256", SECRET)
      .update(`${payload.timestamp}.${canonical}`)
      .digest("hex");
    const result = verifyWebhookSignature({
      body,
      signature,
      secret: SECRET,
      timestamp: payload.timestamp,
      now: receivedAt,
    });
    expect(result.reason).toBe("missing or invalid timestamp");
  });

  it("exposes the signature header name used on the wire", () => {
    expect(WEBHOOK_SIGNATURE_HEADER).toBe("X-OphirPay-Signature");
  });
});
