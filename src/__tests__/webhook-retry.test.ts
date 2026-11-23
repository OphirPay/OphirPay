// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";

import {
  WEBHOOK_BACKOFF_BASE_MS,
  WEBHOOK_BACKOFF_JITTER_RATIO,
  WEBHOOK_BACKOFF_MAX_MS,
  webhookBackoffWithJitterMs,
} from "@/lib/webhook-deliver";

/** Deterministic `random()` sources for the jitter boundaries. */
const noJitter = () => 0;
const maxJitter = () => 0.999999;

describe("webhook exponential backoff", () => {
  it("attempt 1 is approximately 10s", () => {
    expect(webhookBackoffWithJitterMs(1, noJitter)).toBe(10_000);
    const withJitter = webhookBackoffWithJitterMs(1, maxJitter);
    expect(withJitter).toBeGreaterThanOrEqual(10_000);
    expect(withJitter).toBeLessThanOrEqual(12_000);
  });

  it("doubles on every attempt (exponential progression)", () => {
    const delays = [1, 2, 3, 4, 5].map((n) => webhookBackoffWithJitterMs(n, noJitter));
    expect(delays).toEqual([10_000, 20_000, 40_000, 80_000, 160_000]);
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBe(delays[i - 1] * 2);
    }
  });

  it("caps at the 1 hour maximum", () => {
    expect(WEBHOOK_BACKOFF_MAX_MS).toBe(3_600_000);
    // 10s * 2^9 = 5120s > 1h, so attempt 10 is already capped.
    expect(webhookBackoffWithJitterMs(10, noJitter)).toBe(WEBHOOK_BACKOFF_MAX_MS);
  });

  it("never exceeds the cap, even with maximum jitter or huge attempts", () => {
    for (const attempt of [10, 20, 100, 10_000]) {
      expect(webhookBackoffWithJitterMs(attempt, maxJitter)).toBeLessThanOrEqual(
        WEBHOOK_BACKOFF_MAX_MS
      );
    }
  });

  it("treats attempts below 1 as attempt 1", () => {
    expect(webhookBackoffWithJitterMs(0, noJitter)).toBe(WEBHOOK_BACKOFF_BASE_MS);
    expect(webhookBackoffWithJitterMs(-3, noJitter)).toBe(WEBHOOK_BACKOFF_BASE_MS);
  });
});

describe("webhook backoff jitter", () => {
  it("adds 0% jitter at the lower bound", () => {
    expect(webhookBackoffWithJitterMs(3, () => 0)).toBe(40_000);
  });

  it("adds ~20% jitter at the upper bound", () => {
    expect(WEBHOOK_BACKOFF_JITTER_RATIO).toBe(0.2);
    expect(webhookBackoffWithJitterMs(3, () => 0.9999999)).toBeCloseTo(48_000, -1);
  });

  it("adds a proportional amount for a mid-range random value", () => {
    expect(webhookBackoffWithJitterMs(3, () => 0.5)).toBe(44_000);
  });

  it("keeps every sampled delay within [base, base * 1.2]", () => {
    for (let attempt = 1; attempt <= 6; attempt++) {
      const base = webhookBackoffWithJitterMs(attempt, noJitter);
      for (let i = 0; i < 200; i++) {
        const delay = webhookBackoffWithJitterMs(attempt);
        expect(delay).toBeGreaterThanOrEqual(base);
        expect(delay).toBeLessThanOrEqual(Math.ceil(base * 1.2));
      }
    }
  });

  it("randomizes across calls so retries do not synchronize", () => {
    const samples = new Set(
      Array.from({ length: 50 }, () => webhookBackoffWithJitterMs(4))
    );
    expect(samples.size).toBeGreaterThan(1);
  });
});
