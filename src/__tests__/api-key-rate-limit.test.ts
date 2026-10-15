// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach } from "vitest";
import {
  checkApiKeyRateLimit,
  getRetryAfterSeconds,
  API_KEY_RATE_LIMIT_OPERATIONS_PER_HOUR,
  API_KEY_RATE_LIMIT_WINDOW_MS,
  MAX_ACTIVE_API_KEYS_PER_USER,
  InMemoryRateLimitStore,
  setRateLimitStore,
} from "@/lib/rate-limit";

describe("API Key Rate Limiting & Account Caps", () => {
  beforeEach(() => {
    setRateLimitStore(new InMemoryRateLimitStore());
  });

  it("exports correct quota constants", () => {
    expect(API_KEY_RATE_LIMIT_OPERATIONS_PER_HOUR).toBe(10);
    expect(API_KEY_RATE_LIMIT_WINDOW_MS).toBe(3_600_000);
    expect(MAX_ACTIVE_API_KEYS_PER_USER).toBe(5);
  });

  it("allows up to 10 operations per hour per identifier", async () => {
    const user = "org_user_abc";

    for (let i = 1; i <= 10; i++) {
      const result = await checkApiKeyRateLimit(user);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(10 - i);
      expect(result.resetAt).toBeGreaterThan(Date.now());
    }

    // 11th attempt is blocked
    const blocked = await checkApiKeyRateLimit(user);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(getRetryAfterSeconds(blocked)).toBeGreaterThan(0);
    expect(getRetryAfterSeconds(blocked)).toBeLessThanOrEqual(3600);
  });

  it("isolates rate limit quotas between different identifiers", async () => {
    const user1 = "user_alpha";
    const user2 = "user_beta";

    // Exhaust user1 quota
    for (let i = 0; i < 10; i++) {
      await checkApiKeyRateLimit(user1);
    }
    const blockedUser1 = await checkApiKeyRateLimit(user1);
    expect(blockedUser1.allowed).toBe(false);

    // User2 is still completely unthrottled
    const allowedUser2 = await checkApiKeyRateLimit(user2);
    expect(allowedUser2.allowed).toBe(true);
    expect(allowedUser2.remaining).toBe(9);
  });

  it("supports custom windowMs and maxOperations options", async () => {
    const customUser = "custom_user";
    const result1 = await checkApiKeyRateLimit(customUser, {
      maxOperations: 2,
      windowMs: 5000,
    });
    expect(result1.allowed).toBe(true);
    expect(result1.remaining).toBe(1);

    const result2 = await checkApiKeyRateLimit(customUser, {
      maxOperations: 2,
      windowMs: 5000,
    });
    expect(result2.allowed).toBe(true);
    expect(result2.remaining).toBe(0);

    const result3 = await checkApiKeyRateLimit(customUser, {
      maxOperations: 2,
      windowMs: 5000,
    });
    expect(result3.allowed).toBe(false);
  });
});
