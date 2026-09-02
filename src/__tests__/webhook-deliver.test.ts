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
} from "@/lib/webhook-deliver";
import {
  getMetricsSnapshot,
  resetMetricsForTest,
} from "@/lib/metrics-counters";

const SECRET = "test-secret-0123456789";

const samplePayload = {
  event: "payment.created",
  timestamp: "2026-08-14T00:00:00Z",
  data: { id: "p_123", amount: 100 },
};

describe("signWebhookPayload", () => {
  it("computes an HMAC-SHA256 over the JSON body", () => {
    const sig = signWebhookPayload(samplePayload, SECRET);
    expect(sig).toMatch(/^[a-f0-9]{64}$/);
    // Deterministic for the same input+secret
    expect(signWebhookPayload(samplePayload, SECRET)).toBe(sig);
    // Different secret => different signature
    expect(signWebhookPayload(samplePayload, "other-secret")).not.toBe(sig);
  });
});

describe("buildSignedPayload", () => {
  it("produces a body whose signature a receiver can verify (empty-and-reserialize canonicalization)", () => {
    const { body, signature } = buildSignedPayload(samplePayload, SECRET);
    const parsed = JSON.parse(body);
    // Receiver-side verification: parse the received body, empty the
    // signature field, re-serialize (stable key order) and recompute the HMAC.
    const received = JSON.parse(body);
    const stripped = { ...received, signature: "" };
    const canonical = JSON.stringify(stripped);
    const expected = crypto
      .createHmac("sha256", SECRET)
      .update(canonical)
      .digest("hex");
    expect(signature).toBe(expected);
    expect(parsed.signature).toBe(signature);
  });

  it("signs over the body with the signature field emptied (not the raw payload)", () => {
    const { body, signature } = buildSignedPayload(samplePayload, SECRET);
    const canonical = JSON.stringify({ ...samplePayload, signature: "" });
    const expected = crypto
      .createHmac("sha256", SECRET)
      .update(canonical)
      .digest("hex");
    expect(signature).toBe(expected);
    // The transmitted body carries the real signature (not the empty one).
    expect(JSON.parse(body).signature).toBe(signature);
    expect(body).not.toBe(canonical);
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

  it("sends the signed body and does not follow redirects (SSRF guard)", async () => {
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
    expect((init.headers as Record<string, string>)["X-OphirPay-Signature"]).toBe(body.signature);

    const metrics = getMetricsSnapshot();
    expect(metrics.delivery_attempts).toEqual([
      { delivery_type: "webhook", attempt_number: 1, count: 1 },
    ]);
    expect(metrics.delivery_final_outcomes).toEqual([
      {
        delivery_type: "webhook",
        attempt_number: 1,
        final_outcome: "success",
        count: 1,
      },
    ]);
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

    const metrics = getMetricsSnapshot();
    expect(metrics.delivery_attempts).toEqual([
      { delivery_type: "webhook", attempt_number: 1, count: 1 },
    ]);
    expect(metrics.delivery_final_outcomes).toEqual([
      {
        delivery_type: "webhook",
        attempt_number: 1,
        final_outcome: "failure",
        count: 1,
      },
    ]);
  });

  it("returns false when the destination fails the delivery-time guard", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    // Loopback URL is blocked by the guard before any fetch happens.
    const ok = await deliverWebhook("http://127.0.0.1:8080/hook", SECRET, samplePayload, 2);
    expect(ok.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();

    const metrics = getMetricsSnapshot();
    expect(metrics.delivery_attempts).toEqual([]);
    expect(metrics.delivery_final_outcomes).toEqual([
      {
        delivery_type: "webhook",
        attempt_number: 1,
        final_outcome: "failure",
        count: 1,
      },
    ]);
  });

  it("counts each retry attempt and labels the final failed outcome by the last attempt", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const ok = await deliverWebhook("https://example.com/hook", SECRET, samplePayload, 2);
    expect(ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const metrics = getMetricsSnapshot();
    expect(metrics.delivery_attempts).toEqual([
      { delivery_type: "webhook", attempt_number: 1, count: 1 },
      { delivery_type: "webhook", attempt_number: 2, count: 1 },
    ]);
    expect(metrics.delivery_final_outcomes).toEqual([
      {
        delivery_type: "webhook",
        attempt_number: 2,
        final_outcome: "failure",
        count: 1,
      },
    ]);
  });
});
