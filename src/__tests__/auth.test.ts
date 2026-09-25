// SPDX-License-Identifier: MIT

import { describe, it, expect, vi } from "vitest";
import crypto from "crypto";

vi.mock("@/lib/prisma", () => ({
  default: {},
}));
import {
  hashApiKey,
  hashLegacyApiKey,
  verifyApiKeyHash,
  extractApiKey,
  deriveKeyPrefix,
  validateApiKeyFormat,
  generateApiKey,
  API_KEY_PREFIX_LENGTH,
  MIN_API_KEY_LENGTH,
  MIN_API_KEY_ENTROPY_BYTES,
} from "@/lib/api-auth";
import { InMemoryRateLimitStore } from "@/lib/rate-limit";
import { timingSafeEqual } from "@/lib/crypto";
import { searchRecords, rankSearchResults } from "@/lib/search-index";

// ─── API Key Format & Entropy ───────────────────────────────────

describe("validateApiKeyFormat", () => {
  it("accepts a compliant 32-byte CSPRNG key", () => {
    const key = `oph_${"a".repeat(64)}`;
    const result = validateApiKeyFormat(key);
    expect(result.valid).toBe(true);
  });

  it("accepts generated keys from generateApiKey()", () => {
    const key = generateApiKey();
    expect(key).toHaveLength(MIN_API_KEY_LENGTH);
    expect(validateApiKeyFormat(key).valid).toBe(true);
  });

  it("rejects keys without oph_ prefix", () => {
    const key = "a".repeat(68);
    const result = validateApiKeyFormat(key);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("must start with prefix 'oph_'");
  });

  it("rejects short keys (< 32 bytes random material)", () => {
    const shortKey = "oph_abc123";
    const result = validateApiKeyFormat(shortKey);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("must be at least 32 bytes");
  });

  it("rejects keys containing non-hexadecimal characters in random material", () => {
    const invalidCharKey = `oph_${"g".repeat(64)}`;
    const result = validateApiKeyFormat(invalidCharKey);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("valid hexadecimal characters");
  });

  it("rejects non-string inputs", () => {
    // @ts-expect-error test invalid type
    expect(validateApiKeyFormat(12345).valid).toBe(false);
  });
});

describe("generateApiKey", () => {
  it("generates a key with minimum 32 bytes of CSPRNG entropy", () => {
    const key = generateApiKey();
    expect(key.startsWith("oph_")).toBe(true);
    expect(key.length).toBeGreaterThanOrEqual(MIN_API_KEY_LENGTH);
    expect(validateApiKeyFormat(key).valid).toBe(true);
  });

  it("supports custom higher entropy lengths", () => {
    const key = generateApiKey(48);
    expect(key.length).toBe(4 + 48 * 2); // oph_ + 96 hex = 100
    expect(validateApiKeyFormat(key).valid).toBe(true);
  });
});

// ─── hashApiKey & verifyApiKeyHash ──────────────────────────────

describe("hashApiKey", () => {
  it("produces a v1$ tagged HMAC-SHA256 digest", () => {
    const hash = hashApiKey("oph_abc123");
    expect(hash.startsWith("v1$")).toBe(true);
    expect(hash).toHaveLength(3 + 64); // v1$ + 64 hex
    expect(hash.slice(3)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is deterministic for the same key and pepper", () => {
    expect(hashApiKey("my-key")).toBe(hashApiKey("my-key"));
  });

  it("produces different hashes for different inputs", () => {
    expect(hashApiKey("key-a")).not.toBe(hashApiKey("key-b"));
  });

  it("produces different hashes for different peppers", () => {
    expect(hashApiKey("key-a", "pepper-1")).not.toBe(hashApiKey("key-a", "pepper-2"));
  });
});

describe("hashLegacyApiKey", () => {
  it("produces a 64-char plain SHA-256 hex string", () => {
    const hash = hashLegacyApiKey("oph_abc123");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).toBe(crypto.createHash("sha256").update("oph_abc123").digest("hex"));
  });
});

describe("verifyApiKeyHash", () => {
  it("verifies a v1$ peppered digest", () => {
    const rawKey = generateApiKey();
    const storedHash = hashApiKey(rawKey);
    expect(verifyApiKeyHash(rawKey, storedHash)).toBe(true);
    expect(verifyApiKeyHash("oph_wrongkey123456789012345678901234567890123456789012345678901234", storedHash)).toBe(false);
  });

  it("verifies a legacy plain SHA-256 digest (backward compatibility)", () => {
    const rawKey = "oph_legacy_key_from_prior_release_1234567890";
    const legacyHash = hashLegacyApiKey(rawKey);
    expect(verifyApiKeyHash(rawKey, legacyHash)).toBe(true);
    expect(verifyApiKeyHash("oph_different_key", legacyHash)).toBe(false);
  });
});

// ─── deriveKeyPrefix ────────────────────────────────────────────

describe("deriveKeyPrefix", () => {
  it("returns exactly API_KEY_PREFIX_LENGTH characters", () => {
    const key = `oph_${crypto.randomBytes(24).toString("hex")}`;
    expect(deriveKeyPrefix(key)).toHaveLength(API_KEY_PREFIX_LENGTH);
    expect(deriveKeyPrefix(key)).toBe(key.slice(0, 8));
  });

  it("is deterministic for the same key", () => {
    const key = "oph_abcdef123456";
    expect(deriveKeyPrefix(key)).toBe(deriveKeyPrefix(key));
  });

  it("matches the prefix stored at key creation (8 chars)", () => {
    // Regression: key creation used slice(0, 11) while lookup used slice(0, 8),
    // so findFirst({ keyHash, prefix }) never matched and ALL API auth failed.
    const rawKey = `oph_${crypto.randomBytes(24).toString("hex")}`;
    const createdPrefix = deriveKeyPrefix(rawKey); // as stored by POST /api/keys
    const lookupPrefix = deriveKeyPrefix(rawKey); // as derived by authenticateRequest
    expect(createdPrefix).toBe(lookupPrefix);
    expect(createdPrefix).toHaveLength(API_KEY_PREFIX_LENGTH);
  });
});

// ─── extractApiKey ──────────────────────────────────────────────

describe("extractApiKey", () => {
  it("extracts from Authorization: Bearer header", () => {
    const req = new Request("http://localhost/api/test", {
      headers: { Authorization: "Bearer oph_secret123" },
    });
    expect(extractApiKey(req)).toBe("oph_secret123");
  });

  it("extracts from X-API-Key header", () => {
    const req = new Request("http://localhost/api/test", {
      headers: { "x-api-key": "oph_key456" },
    });
    expect(extractApiKey(req)).toBe("oph_key456");
  });

  it("returns null without any auth header", () => {
    const req = new Request("http://localhost/api/test");
    expect(extractApiKey(req)).toBeNull();
  });

  it("returns null for non-Bearer Authorization", () => {
    const req = new Request("http://localhost/api/test", {
      headers: { Authorization: "Basic dXNlcjpwYXNz" },
    });
    expect(extractApiKey(req)).toBeNull();
  });

  it("trims whitespace from extracted key", () => {
    const req = new Request("http://localhost/api/test", {
      headers: { "x-api-key": "  oph_trimmed  " },
    });
    expect(extractApiKey(req)).toBe("oph_trimmed");
  });
});

// ─── InMemoryRateLimitStore ─────────────────────────────────────

describe("InMemoryRateLimitStore", () => {
  it("allows requests within limit", async () => {
    const store = new InMemoryRateLimitStore();
    const result = await store.increment("ip-1", 60_000, 5);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it("blocks when limit exceeded", async () => {
    const store = new InMemoryRateLimitStore();
    for (let i = 0; i < 5; i++) {
      await store.increment("ip-2", 60_000, 5);
    }
    const result = await store.increment("ip-2", 60_000, 5);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("resets counter for a key", async () => {
    const store = new InMemoryRateLimitStore();
    await store.increment("ip-3", 60_000, 3);
    await store.increment("ip-3", 60_000, 3);
    await store.reset("ip-3");
    const result = await store.increment("ip-3", 60_000, 3);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
  });

  it("isolates counters between keys", async () => {
    const store = new InMemoryRateLimitStore();
    await store.increment("ip-a", 60_000, 2);
    await store.increment("ip-a", 60_000, 2);
    const resultB = await store.increment("ip-b", 60_000, 2);
    expect(resultB.allowed).toBe(true);
    expect(resultB.remaining).toBe(1);
  });
});

// ─── timingSafeEqual ────────────────────────────────────────────

describe("timingSafeEqual", () => {
  it("returns true for identical strings", () => {
    expect(timingSafeEqual("abc123", "abc123")).toBe(true);
  });

  it("returns false for different strings", () => {
    expect(timingSafeEqual("abc123", "abc124")).toBe(false);
  });

  it("returns false for different-length strings", () => {
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });

  it("returns true for empty strings", () => {
    expect(timingSafeEqual("", "")).toBe(true);
  });
});

// ─── searchRecords ──────────────────────────────────────────────

describe("searchRecords", () => {
  const records = [
    { id: "1", name: "Alice", email: "alice@test.com" },
    { id: "2", name: "Bob", email: "bob@example.com" },
    { id: "3", name: "Charlie", email: "charlie@test.com" },
  ];

  it("filters by substring match", () => {
    const results = searchRecords(records, "test", ["name", "email"]);
    expect(results).toHaveLength(2);
  });

  it("returns all records for empty query", () => {
    expect(searchRecords(records, "", ["name"])).toHaveLength(3);
  });

  it("is case-insensitive", () => {
    expect(searchRecords(records, "ALICE", ["name"])).toHaveLength(1);
  });

  it("returns empty array for no match", () => {
    expect(searchRecords(records, "xyz", ["name", "email"])).toHaveLength(0);
  });
});

describe("rankSearchResults", () => {
  const records = [
    { id: "1", name: "Payment Service", description: "Handles payments" },
    { id: "2", name: "Payment", description: "A payment record" },
    { id: "3", name: "Service", description: "Generic service" },
  ];

  it("ranks exact matches highest", () => {
    const results = rankSearchResults(records, "Payment", ["name", "description"]);
    expect(results[0].id).toBe("2");
  });

  it("only returns records with score > 0", () => {
    const results = rankSearchResults(records, "payment", ["name", "description"]);
    expect(results.length).toBe(2);
  });
});
