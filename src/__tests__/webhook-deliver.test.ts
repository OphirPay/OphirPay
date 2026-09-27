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
  BLOCKED_WEBHOOK_TARGET_ERROR,
  canonicalizeWebhookBody,
  webhookSignedInput,
  WEBHOOK_TIMESTAMP_HEADER,
  WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS,
  type WebhookPayload,
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
});
