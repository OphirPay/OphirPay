// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";

vi.mock("@/lib/webhook-url-guard", () => ({
  isSafeWebhookUrlAtDelivery: vi.fn(async (url: string) => !url.includes("127.0.0.1")),
}));

import {
  signWebhookPayload,
  buildSignedPayload,
  deliverWebhook,
  verifyWebhookSignature,
  DEFAULT_WEBHOOK_TOLERANCE_SECONDS,
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

describe("signWebhookPayload", () => {
  it("computes an HMAC-SHA256 over timestamp plus canonical body", () => {
    const sig = signWebhookPayload(samplePayload, SECRET);
    expect(sig).toMatch(/^[a-f0-9]{64}$/);
    // Deterministic for the same input+secret
    expect(signWebhookPayload(samplePayload, SECRET)).toBe(sig);
    // Different secret => different signature
    expect(signWebhookPayload(samplePayload, "other-secret")).not.toBe(sig);
    // Different timestamp => different signature
    expect(signWebhookPayload(samplePayload, SECRET, "2026-08-14T00:05:00Z")).not.toBe(sig);
  });
});

describe("buildSignedPayload", () => {
  it("produces a body and signature covering timestamp plus canonical body", () => {
    const { body, signature, timestamp } = buildSignedPayload(samplePayload, SECRET);
    const parsed = JSON.parse(body);
    expect(timestamp).toBe(samplePayload.timestamp);
    expect(parsed.timestamp).toBe(samplePayload.timestamp);

    // Receiver-side verification: parse the received body, empty the
    // signature field, re-serialize (stable key order), prepend timestamp., and recompute the HMAC.
    const stripped = { ...parsed, signature: "" };
    const canonical = JSON.stringify(stripped);
    const toSign = `${timestamp}.${canonical}`;
    const expected = crypto
      .createHmac("sha256", SECRET)
      .update(toSign)
      .digest("hex");
    expect(signature).toBe(expected);
    expect(parsed.signature).toBe(signature);
  });

  it("signs over the body with the signature field emptied (not the raw payload)", () => {
    const { body, signature, timestamp } = buildSignedPayload(samplePayload, SECRET);
    const canonical = JSON.stringify({ ...samplePayload, signature: "" });
    const toSign = `${timestamp}.${canonical}`;
    const expected = crypto
      .createHmac("sha256", SECRET)
      .update(toSign)
      .digest("hex");
    expect(signature).toBe(expected);
    // The transmitted body carries the real signature (not the empty one).
    expect(JSON.parse(body).signature).toBe(signature);
    expect(body).not.toBe(canonical);
  });
});

describe("verifyWebhookSignature (replay protection & validity)", () => {
  it("accepts a valid signature with a fresh timestamp", () => {
    const now = new Date("2026-08-14T00:01:00Z");
    const { body, signature, timestamp } = buildSignedPayload(
      { ...samplePayload, timestamp: "2026-08-14T00:00:30Z" },
      SECRET
    );
    const result = verifyWebhookSignature({
      body,
      signature,
      secret: SECRET,
      timestamp,
      now,
    });
    expect(result.valid).toBe(true);
    expect(result.reason).toBe("valid");
  });

  it("rejects a valid signature with a stale timestamp (> 300s old)", () => {
    const now = new Date("2026-08-14T00:10:00Z"); // 600s after timestamp
    const { body, signature, timestamp } = buildSignedPayload(samplePayload, SECRET);
    const result = verifyWebhookSignature({
      body,
      signature,
      secret: SECRET,
      timestamp,
      now,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("payload too old");
    expect(result.reason).toContain("possible replay");
  });

  it("rejects a timestamp too far in the future (> 300s ahead)", () => {
    const now = new Date("2026-08-14T00:00:00Z");
    const futurePayload = { ...samplePayload, timestamp: "2026-08-14T00:10:00Z" };
    const { body, signature, timestamp } = buildSignedPayload(futurePayload, SECRET);
    const result = verifyWebhookSignature({
      body,
      signature,
      secret: SECRET,
      timestamp,
      now,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("in the future");
  });

  it("rejects a replay attempt where the attacker alters the timestamp header", () => {
    const now = new Date("2026-08-14T01:00:00Z");
    // Original delivery was valid at 2026-08-14T00:00:00Z
    const { body, signature } = buildSignedPayload(samplePayload, SECRET);
    // Attacker sends fresh timestamp header to bypass age check, keeping captured signature
    const result = verifyWebhookSignature({
      body,
      signature,
      secret: SECRET,
      timestamp: now.toISOString(),
      now,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("signature mismatch");
  });

  it("rejects a tampered payload body", () => {
    const now = new Date("2026-08-14T00:00:30Z");
    const { body, signature, timestamp } = buildSignedPayload(samplePayload, SECRET);
    const tamperedBody = body.replace('"amount":100', '"amount":9999');
    const result = verifyWebhookSignature({
      body: tamperedBody,
      signature,
      secret: SECRET,
      timestamp,
      now,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("signature mismatch");
  });

  it("rejects when verified with the wrong secret", () => {
    const now = new Date("2026-08-14T00:00:30Z");
    const { body, signature, timestamp } = buildSignedPayload(samplePayload, SECRET);
    const result = verifyWebhookSignature({
      body,
      signature,
      secret: "wrong-secret-0000000000",
      timestamp,
      now,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("signature mismatch");
  });

  it("accepts a timestamp exactly at the tolerance boundary (300s)", () => {
    const now = new Date("2026-08-14T00:05:00Z"); // exactly 300s after 00:00:00Z
    const { body, signature, timestamp } = buildSignedPayload(samplePayload, SECRET);
    const result = verifyWebhookSignature({
      body,
      signature,
      secret: SECRET,
      timestamp,
      maxAgeSeconds: DEFAULT_WEBHOOK_TOLERANCE_SECONDS,
      now,
    });
    expect(result.valid).toBe(true);
  });

  it("supports custom maxAgeSeconds tolerance window", () => {
    const now = new Date("2026-08-14T00:01:30Z"); // 90s after 00:00:00Z
    const { body, signature, timestamp } = buildSignedPayload(samplePayload, SECRET);
    // Strict 60s window fails on 90s old payload
    const strictResult = verifyWebhookSignature({
      body,
      signature,
      secret: SECRET,
      timestamp,
      maxAgeSeconds: 60,
      now,
    });
    expect(strictResult.valid).toBe(false);
    expect(strictResult.reason).toContain("payload too old (90s > 60s)");

    // Relaxed 120s window passes
    const relaxedResult = verifyWebhookSignature({
      body,
      signature,
      secret: SECRET,
      timestamp,
      maxAgeSeconds: 120,
      now,
    });
    expect(relaxedResult.valid).toBe(true);
  });
});

describe("deliverWebhook", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    resetMetricsForTest();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends the signed body, timestamp, and signature headers without following redirects (SSRF guard)", async () => {
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
    expect(headers["X-OphirPay-Timestamp"]).toBe(samplePayload.timestamp);
    expect(headers["X-OphirPay-Event"]).toBe("payment.created");
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

  it("returns false when the destination fails the delivery-time guard", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    // Loopback URL is blocked by the guard before any fetch happens.
    const ok = await deliverWebhook("http://127.0.0.1:8080/hook", SECRET, samplePayload, 2);
    expect(ok.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(ok.errorMessage).toBe("URL resolved to a private/internal address");
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
});
