// SPDX-License-Identifier: MIT
//
// Issue #701 — API key material must be high-entropy (>= 32 CSPRNG bytes) and
// match the documented format at creation. Digests are version-tagged, and
// keys minted before the change must keep authenticating.

import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";

vi.mock("@/lib/prisma", () => ({
  default: {
    apiKey: {
      findFirst: vi.fn(),
      update: vi.fn(() => Promise.resolve({})),
      create: vi.fn(),
    },
    apiKeyRequestLog: { create: vi.fn(() => Promise.resolve({})) },
  },
}));

import prisma from "@/lib/prisma";
import {
  API_KEY_PREFIX,
  API_KEY_PATTERN,
  API_KEY_LOOKUP_PATTERN,
  API_KEY_RANDOM_BYTES,
  API_KEY_RANDOM_HEX_LENGTH,
  API_KEY_LEGACY_HEX_LENGTH,
  API_KEY_DIGEST_VERSION,
  apiKeyLookupHashes,
  assertValidApiKeyFormat,
  authenticateRequest,
  deriveKeyPrefix,
  generateApiKey,
  hashApiKey,
  hashApiKeyV1,
  isValidApiKeyFormat,
} from "@/lib/api-auth";

const LEGACY_KEY = `${API_KEY_PREFIX}${"a1b2c3d4".repeat(6)}`; // 48 hex chars
const MODERN_KEY = `${API_KEY_PREFIX}${"a1b2c3d4".repeat(8)}`; // 64 hex chars

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateApiKey", () => {
  it("mints 32 CSPRNG bytes as lowercase hex behind the oph_ prefix", () => {
    const key = generateApiKey();
    expect(key).toMatch(API_KEY_PATTERN);
    expect(key.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(key.length).toBe(
      API_KEY_PREFIX.length + API_KEY_RANDOM_HEX_LENGTH
    );
    expect(API_KEY_RANDOM_HEX_LENGTH).toBe(API_KEY_RANDOM_BYTES * 2);
  });

  it("produces unique keys", () => {
    const keys = new Set(Array.from({ length: 50 }, () => generateApiKey()));
    expect(keys.size).toBe(50);
  });

  it("never mints the legacy 24-byte format", () => {
    expect(generateApiKey()).not.toMatch(
      new RegExp(`^${API_KEY_PREFIX}[0-9a-f]{${API_KEY_LEGACY_HEX_LENGTH}}$`)
    );
  });
});

describe("isValidApiKeyFormat (creation format)", () => {
  it("accepts the documented 32-byte format", () => {
    expect(isValidApiKeyFormat(generateApiKey())).toBe(true);
  });

  it("rejects material shorter than 32 bytes", () => {
    const shortKey = `${API_KEY_PREFIX}${crypto
      .randomBytes(8)
      .toString("hex")}`; // 8 bytes
    expect(isValidApiKeyFormat(shortKey)).toBe(false);
  });

  it("rejects the legacy 24-byte format at creation", () => {
    expect(isValidApiKeyFormat(LEGACY_KEY)).toBe(false);
  });

  it.each([
    ["missing prefix", "a1b2c3d4".repeat(8)],
    ["wrong prefix", `key_${"a1b2c3d4".repeat(8)}`],
    ["uppercase hex", `${API_KEY_PREFIX}${"A1B2C3D4".repeat(8)}`],
    ["non-hex characters", `${API_KEY_PREFIX}${"z".repeat(64)}`],
    ["one byte too short", `${API_KEY_PREFIX}${"a".repeat(63)}`],
    ["one byte too long", `${API_KEY_PREFIX}${"a".repeat(65)}`],
    ["empty string", ""],
  ])("rejects %s", (_label, value) => {
    expect(isValidApiKeyFormat(value)).toBe(false);
  });

  it("rejects null and undefined", () => {
    expect(isValidApiKeyFormat(null)).toBe(false);
    expect(isValidApiKeyFormat(undefined)).toBe(false);
  });
});

describe("assertValidApiKeyFormat", () => {
  it("does not throw for a valid key", () => {
    expect(() => assertValidApiKeyFormat(MODERN_KEY)).not.toThrow();
  });

  it("throws on the reject path with an actionable message", () => {
    expect(() => assertValidApiKeyFormat(`${API_KEY_PREFIX}short`)).toThrow(
      /Invalid API key format/
    );
    expect(() => assertValidApiKeyFormat(LEGACY_KEY)).toThrow(
      new RegExp(String(API_KEY_RANDOM_HEX_LENGTH))
    );
  });
});

describe("versioned digests", () => {
  it("hashApiKeyV1 is the legacy hash with a version tag", () => {
    expect(hashApiKeyV1(MODERN_KEY)).toBe(
      `${API_KEY_DIGEST_VERSION}:${hashApiKey(MODERN_KEY)}`
    );
    expect(hashApiKeyV1(MODERN_KEY)).toMatch(/^v1:[a-f0-9]{64}$/);
  });

  it("apiKeyLookupHashes returns the tagged digest first, then the legacy one", () => {
    expect(apiKeyLookupHashes(MODERN_KEY)).toEqual([
      hashApiKeyV1(MODERN_KEY),
      hashApiKey(MODERN_KEY),
    ]);
    expect(apiKeyLookupHashes(MODERN_KEY)).toHaveLength(2);
  });
});

describe("authenticateRequest", () => {
  const call = (key: string) =>
    authenticateRequest(
      new Request("http://localhost/api/payments", {
        headers: { "x-api-key": key },
      })
    );

  it("authenticates a new-format key and queries both digest forms", async () => {
    const row = {
      id: "key_1",
      userId: "u1",
      name: "CI bot",
      expiresAt: null,
      scopes: ["read:payments"],
    };
    vi.mocked(prisma.apiKey.findFirst).mockResolvedValueOnce(row as never);

    const auth = await call(MODERN_KEY);
    expect(auth).toEqual({
      userId: "u1",
      keyId: "key_1",
      keyName: "CI bot",
      scopes: ["read:payments"],
    });

    const where = vi.mocked(prisma.apiKey.findFirst).mock.calls[0]![0]!
      .where as { keyHash: { in: string[] }; prefix: string };
    expect(where.prefix).toBe(deriveKeyPrefix(MODERN_KEY));
    expect(where.keyHash.in).toContain(hashApiKeyV1(MODERN_KEY));
    expect(where.keyHash.in).toContain(hashApiKey(MODERN_KEY));
  });

  it("still authenticates keys minted before #701 (legacy 24-byte format)", async () => {
    vi.mocked(prisma.apiKey.findFirst).mockResolvedValueOnce({
      id: "key_legacy",
      userId: "u2",
      name: "old",
      expiresAt: null,
      scopes: null,
    } as never);

    const auth = await call(LEGACY_KEY);
    expect(auth?.userId).toBe("u2");
    // The legacy bare SHA-256 digest is part of the lookup — and the strict
    // creation format is not what gated this request.
    expect(API_KEY_LOOKUP_PATTERN.test(LEGACY_KEY)).toBe(true);
    const where = vi.mocked(prisma.apiKey.findFirst).mock.calls[0]![0]!
      .where as { keyHash: { in: string[] } };
    expect(where.keyHash.in).toContain(hashApiKey(LEGACY_KEY));
  });

  it("rejects malformed material without touching the database", async () => {
    expect(await call("totally-not-a-key")).toBeNull();
    expect(await call(`${API_KEY_PREFIX}${"a".repeat(40)}`)).toBeNull();
    expect(prisma.apiKey.findFirst).not.toHaveBeenCalled();
  });

  it("rejects an expired key", async () => {
    vi.mocked(prisma.apiKey.findFirst).mockResolvedValueOnce({
      id: "key_expired",
      userId: "u3",
      name: "expired",
      expiresAt: new Date(Date.now() - 1000),
      scopes: [],
    } as never);

    expect(await call(MODERN_KEY)).toBeNull();
  });
});
