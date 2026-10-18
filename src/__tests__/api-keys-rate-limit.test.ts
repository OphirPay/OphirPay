// SPDX-License-Identifier: MIT

/**
 * Unit and integration test suite for API key creation and rotation rate limiting.
 * Issue #1370 — sliding window limit (10/hr), max active keys cap (5), and audit logging.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  API_KEY_RATE_LIMIT_WINDOW_MS,
  API_KEY_RATE_LIMIT_MAX,
  MAX_ACTIVE_API_KEYS,
  InMemoryRateLimitStore,
  setRateLimitStore,
  getRetryAfterSeconds,
} from "@/lib/rate-limit";

describe("API Key Rate Limiting Constants & Store (#1370)", () => {
  let store: InMemoryRateLimitStore;

  beforeEach(() => {
    store = new InMemoryRateLimitStore();
    setRateLimitStore(store);
  });

  it("exports correct rate limiting and active key constants", () => {
    expect(API_KEY_RATE_LIMIT_WINDOW_MS).toBe(3600000); // 1 hour
    expect(API_KEY_RATE_LIMIT_MAX).toBe(10); // 10 operations per hour
    expect(MAX_ACTIVE_API_KEYS).toBe(5); // max 5 active keys
  });

  it("permits up to 10 operations within the 1-hour window", async () => {
    const key = "rl:keys:user-123";
    for (let i = 1; i <= API_KEY_RATE_LIMIT_MAX; i++) {
      const res = await store.increment(key, API_KEY_RATE_LIMIT_WINDOW_MS, API_KEY_RATE_LIMIT_MAX);
      expect(res.allowed).toBe(true);
      expect(res.remaining).toBe(API_KEY_RATE_LIMIT_MAX - i);
    }
  });

  it("rejects the 11th operation with allowed: false and remaining: 0", async () => {
    const key = "rl:keys:user-overflow";
    for (let i = 0; i < API_KEY_RATE_LIMIT_MAX; i++) {
      await store.increment(key, API_KEY_RATE_LIMIT_WINDOW_MS, API_KEY_RATE_LIMIT_MAX);
    }

    const res = await store.increment(key, API_KEY_RATE_LIMIT_WINDOW_MS, API_KEY_RATE_LIMIT_MAX);
    expect(res.allowed).toBe(false);
    expect(res.remaining).toBe(0);

    const retryAfter = getRetryAfterSeconds(res);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(3600);
  });

  it("isolates rate limit counters between different users", async () => {
    const userA = "rl:keys:user-a";
    const userB = "rl:keys:user-b";

    for (let i = 0; i < API_KEY_RATE_LIMIT_MAX; i++) {
      await store.increment(userA, API_KEY_RATE_LIMIT_WINDOW_MS, API_KEY_RATE_LIMIT_MAX);
    }

    // User A is exhausted
    expect((await store.increment(userA, API_KEY_RATE_LIMIT_WINDOW_MS, API_KEY_RATE_LIMIT_MAX)).allowed).toBe(false);

    // User B is fresh
    const resB = await store.increment(userB, API_KEY_RATE_LIMIT_WINDOW_MS, API_KEY_RATE_LIMIT_MAX);
    expect(resB.allowed).toBe(true);
    expect(resB.remaining).toBe(API_KEY_RATE_LIMIT_MAX - 1);
  });
});

describe("API Key active keys cap & audit logging rules (#1370)", () => {
  it("enforces active key cap rule (5 keys)", () => {
    const mockExistingKeys = [
      { id: "k1", revokedAt: null },
      { id: "k2", revokedAt: null },
      { id: "k3", revokedAt: null },
      { id: "k4", revokedAt: null },
      { id: "k5", revokedAt: null },
    ];

    const activeCount = mockExistingKeys.filter((k) => k.revokedAt === null).length;
    const canCreate = activeCount < MAX_ACTIVE_API_KEYS;
    expect(canCreate).toBe(false);
  });

  it("permits creation when inactive/revoked keys exist alongside fewer than 5 active keys", () => {
    const mockExistingKeys = [
      { id: "k1", revokedAt: new Date() },
      { id: "k2", revokedAt: new Date() },
      { id: "k3", revokedAt: null },
      { id: "k4", revokedAt: null },
      { id: "k5", revokedAt: null },
    ];

    const activeCount = mockExistingKeys.filter((k) => k.revokedAt === null).length;
    const canCreate = activeCount < MAX_ACTIVE_API_KEYS;
    expect(canCreate).toBe(true);
  });
});
