// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import crypto from "crypto";
import {
  hashApiKey,
  extractApiKey,
  deriveKeyPrefix,
  API_KEY_PREFIX_LENGTH,
} from "@/lib/api-auth";
import { InMemoryRateLimitStore } from "@/lib/rate-limit";
import { timingSafeEqual } from "@/lib/crypto";
import { searchRecords, rankSearchResults } from "@/lib/search-index";

// ─── hashApiKey ─────────────────────────────────────────────────

describe("hashApiKey", () => {
  it("produces a 64-char hex string (SHA-256)", () => {
    const hash = hashApiKey("oph_abc123");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is deterministic", () => {
    expect(hashApiKey("my-key")).toBe(hashApiKey("my-key"));
  });

  it("produces different hashes for different inputs", () => {
    expect(hashApiKey("key-a")).not.toBe(hashApiKey("key-b"));
  });

  it("handles empty string", () => {
    const hash = hashApiKey("");
    expect(hash).toHaveLength(64);
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
