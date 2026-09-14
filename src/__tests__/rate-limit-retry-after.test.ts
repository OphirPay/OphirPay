// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  InMemoryRateLimitStore,
  getRetryAfterSeconds,
  type RateLimitResult,
} from "@/lib/rate-limit";

describe("getRetryAfterSeconds", () => {
  it("returns seconds until reset, rounded up", () => {
    const resetAt = Date.now() + 1500;
    const result: RateLimitResult = {
      allowed: false,
      remaining: 0,
      resetAt,
    };
    const seconds = getRetryAfterSeconds(result);
    // 1500ms → 2 seconds (ceil)
    expect(seconds).toBe(2);
  });

  it("clamps to 0 when the window has already reset", () => {
    const result: RateLimitResult = {
      allowed: true,
      remaining: 5,
      resetAt: Date.now() - 1000,
    };
    expect(getRetryAfterSeconds(result)).toBe(0);
  });
});

describe("InMemoryRateLimitStore resetAt drives Retry-After", () => {
  it("produces a non-negative retry-after on limit exceeded", async () => {
    const store = new InMemoryRateLimitStore();
    const result = await store.increment("ip", 60_000, 1);
    expect(result.allowed).toBe(true);

    const exceeded = await store.increment("ip", 60_000, 1);
    expect(exceeded.allowed).toBe(false);
    expect(getRetryAfterSeconds(exceeded)).toBeGreaterThanOrEqual(0);
  });
});
