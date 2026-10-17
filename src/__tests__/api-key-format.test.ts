// SPDX-License-Identifier: MIT
//
// Issue #701 & #1397 — API key material must be high-entropy (>= 32 CSPRNG bytes) and
// match the documented format at creation: op_{env}_{32_hex_bytes}_{4_byte_crc}.
// Digests are version-tagged, and keys minted before the change must keep authenticating.

import { describe, it, expect, vi, beforeEach } from "vitest";

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
  API_KEY_LEGACY_HEX_LENGTH,
  API_KEY_DIGEST_VERSION,
  calculateCrc32,
  validateKeyFormat,
  apiKeyLookupHashes,
  assertValidApiKeyFormat,
  authenticateRequest,
  deriveKeyPrefix,
  generateApiKey,
  hashApiKey,
  hashApiKeyV1,
  isValidApiKeyFormat,
} from "@/lib/api-auth";

const PRE_701_LEGACY_KEY = `${API_KEY_PREFIX}${"a1b2c3d4".repeat(6)}`; // 48 hex chars (oph_)
const POST_701_LEGACY_KEY = `${API_KEY_PREFIX}${"a1b2c3d4".repeat(8)}`; // 64 hex chars (oph_)

function createStandardKey(env: "live" | "test" = "test", hex?: string): string {
  const entropy = hex ?? "a1b2c3d4".repeat(8);
  const payload = `op_${env}_${entropy}`;
  const crc = calculateCrc32(payload);
  return `${payload}_${crc}`;
}

const STANDARDIZED_TEST_KEY = createStandardKey("test");
const STANDARDIZED_LIVE_KEY = createStandardKey("live");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateApiKey (#1397)", () => {
  it("mints standardized op_{env}_{32_hex_bytes}_{4_byte_crc} keys", () => {
    const testKey = generateApiKey({ env: "test" });
    expect(testKey).toMatch(API_KEY_PATTERN);
    expect(testKey.startsWith("op_test_")).toBe(true);

    const liveKey = generateApiKey({ env: "live" });
    expect(liveKey).toMatch(API_KEY_PATTERN);
    expect(liveKey.startsWith("op_live_")).toBe(true);

    // 8 chars prefix + 64 hex chars entropy + 1 char separator + 8 chars crc = 81
    expect(testKey.length).toBe(81);
  });

  it("produces unique keys with valid CRC32 checksums", () => {
    const keys = new Set(Array.from({ length: 50 }, () => generateApiKey({ env: "test" })));
    expect(keys.size).toBe(50);

    for (const key of keys) {
      const validation = validateKeyFormat(key);
      expect(validation.valid).toBe(true);
      expect(validation.env).toBe("test");
    }
  });

  it("never mints the legacy formats", () => {
    const key = generateApiKey();
    expect(key.startsWith(API_KEY_PREFIX)).toBe(false);
    expect(key).not.toMatch(
      new RegExp(`^${API_KEY_PREFIX}[0-9a-f]{${API_KEY_LEGACY_HEX_LENGTH}}$`)
    );
  });
});

describe("validateKeyFormat & CRC verification (#1397)", () => {
  it("accepts valid standardized keys with matching CRC", () => {
    expect(validateKeyFormat(STANDARDIZED_TEST_KEY)).toEqual({
      valid: true,
      env: "test",
    });
    expect(validateKeyFormat(STANDARDIZED_LIVE_KEY)).toEqual({
      valid: true,
      env: "live",
    });
  });

  it("rejects keys with corrupted CRC checksums", () => {
    const lastChar = STANDARDIZED_TEST_KEY.slice(-1);
    const flippedChar = lastChar === "0" ? "1" : "0";
    const corrupted = STANDARDIZED_TEST_KEY.slice(0, -1) + flippedChar;
    const result = validateKeyFormat(corrupted);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/CRC/i);
  });

  it("rejects keys with entropy below minimum requirement (< 32 hex chars)", () => {
    const shortEntropy = "a1b2c3d4"; // 8 hex chars
    const payload = `op_test_${shortEntropy}`;
    const key = `${payload}_${calculateCrc32(payload)}`;
    const result = validateKeyFormat(key);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/format|entropy/i);
  });

  it.each([
    ["missing prefix", "a1b2c3d4".repeat(8)],
    ["unsupported environment", `op_dev_${"a1b2c3d4".repeat(8)}_12345678`],
    ["uppercase hex in entropy", `op_test_${"A1B2C3D4".repeat(8)}_12345678`],
    ["non-hex characters in crc", `op_test_${"a1b2c3d4".repeat(8)}_zzzzzzzz`],
    ["legacy format at standard validator", POST_701_LEGACY_KEY],
    ["empty string", ""],
  ])("rejects %s", (_label, value) => {
    expect(validateKeyFormat(value).valid).toBe(false);
  });

  it("rejects null and undefined", () => {
    expect(validateKeyFormat(null).valid).toBe(false);
    expect(validateKeyFormat(undefined).valid).toBe(false);
  });
});

describe("isValidApiKeyFormat & assertValidApiKeyFormat", () => {
  it("accepts generated keys", () => {
    expect(isValidApiKeyFormat(generateApiKey())).toBe(true);
    expect(() => assertValidApiKeyFormat(generateApiKey())).not.toThrow();
  });

  it("rejects invalid keys with descriptive errors", () => {
    expect(isValidApiKeyFormat("invalid-key")).toBe(false);
    expect(() => assertValidApiKeyFormat("invalid-key")).toThrow(
      /Invalid API key format/
    );
  });
});

describe("versioned digests", () => {
  it("hashApiKeyV1 produces tagged SHA-256 digest", () => {
    expect(hashApiKeyV1(STANDARDIZED_TEST_KEY)).toBe(
      `${API_KEY_DIGEST_VERSION}:${hashApiKey(STANDARDIZED_TEST_KEY)}`
    );
    expect(hashApiKeyV1(STANDARDIZED_TEST_KEY)).toMatch(/^v1:[a-f0-9]{64}$/);
  });

  it("apiKeyLookupHashes queries both tagged and legacy digests", () => {
    expect(apiKeyLookupHashes(STANDARDIZED_TEST_KEY)).toEqual([
      hashApiKeyV1(STANDARDIZED_TEST_KEY),
      hashApiKey(STANDARDIZED_TEST_KEY),
    ]);
    expect(apiKeyLookupHashes(STANDARDIZED_TEST_KEY)).toHaveLength(2);
  });
});

describe("deriveKeyPrefix", () => {
  it("returns exactly 8 chars prefix for indexing and identification", () => {
    expect(deriveKeyPrefix(STANDARDIZED_TEST_KEY)).toBe("op_test_");
    expect(deriveKeyPrefix(STANDARDIZED_LIVE_KEY)).toBe("op_live_");
    expect(deriveKeyPrefix(POST_701_LEGACY_KEY)).toBe("oph_a1b2");
  });
});

describe("authenticateRequest", () => {
  const call = (key: string) =>
    authenticateRequest(
      new Request("http://localhost/api/payments", {
        headers: { "x-api-key": key },
      })
    );

  it("authenticates a standardized key and queries both digest forms", async () => {
    const row = {
      id: "key_1",
      userId: "u1",
      name: "CI bot",
      expiresAt: null,
      scopes: ["read:payments"],
    };
    vi.mocked(prisma.apiKey.findFirst).mockResolvedValueOnce(row as never);

    const auth = await call(STANDARDIZED_TEST_KEY);
    expect(auth).toEqual({
      userId: "u1",
      keyId: "key_1",
      keyName: "CI bot",
      scopes: ["read:payments"],
    });

    const where = vi.mocked(prisma.apiKey.findFirst).mock.calls[0]![0]!
      .where as { keyHash: { in: string[] }; prefix: string };
    expect(where.prefix).toBe(deriveKeyPrefix(STANDARDIZED_TEST_KEY));
    expect(where.keyHash.in).toContain(hashApiKeyV1(STANDARDIZED_TEST_KEY));
    expect(where.keyHash.in).toContain(hashApiKey(STANDARDIZED_TEST_KEY));
  });

  it("still authenticates keys minted before #1397 (post-#701 32-byte oph_ format)", async () => {
    vi.mocked(prisma.apiKey.findFirst).mockResolvedValueOnce({
      id: "key_legacy_701",
      userId: "u2",
      name: "legacy 701 key",
      expiresAt: null,
      scopes: ["read:payments"],
    } as never);

    const auth = await call(POST_701_LEGACY_KEY);
    expect(auth?.userId).toBe("u2");
    expect(API_KEY_LOOKUP_PATTERN.test(POST_701_LEGACY_KEY)).toBe(true);
    const where = vi.mocked(prisma.apiKey.findFirst).mock.calls[0]![0]!
      .where as { keyHash: { in: string[] }; prefix: string };
    expect(where.prefix).toBe(deriveKeyPrefix(POST_701_LEGACY_KEY));
  });

  it("still authenticates keys minted before #701 (legacy 24-byte oph_ format)", async () => {
    vi.mocked(prisma.apiKey.findFirst).mockResolvedValueOnce({
      id: "key_legacy_pre701",
      userId: "u3",
      name: "pre-701 old",
      expiresAt: null,
      scopes: null,
    } as never);

    const auth = await call(PRE_701_LEGACY_KEY);
    expect(auth?.userId).toBe("u3");
    expect(API_KEY_LOOKUP_PATTERN.test(PRE_701_LEGACY_KEY)).toBe(true);
    const where = vi.mocked(prisma.apiKey.findFirst).mock.calls[0]![0]!
      .where as { keyHash: { in: string[] } };
    expect(where.keyHash.in).toContain(hashApiKey(PRE_701_LEGACY_KEY));
  });

  it("rejects malformed material without touching the database", async () => {
    expect(await call("totally-not-a-key")).toBeNull();
    expect(await call(`${API_KEY_PREFIX}${"a".repeat(40)}`)).toBeNull();
    expect(await call("op_test_invalid_crc")).toBeNull();
    expect(prisma.apiKey.findFirst).not.toHaveBeenCalled();
  });

  it("rejects an expired key", async () => {
    vi.mocked(prisma.apiKey.findFirst).mockResolvedValueOnce({
      id: "key_expired",
      userId: "u4",
      name: "expired",
      expiresAt: new Date(Date.now() - 1000),
      scopes: [],
    } as never);

    expect(await call(STANDARDIZED_TEST_KEY)).toBeNull();
  });
});
