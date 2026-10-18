// SPDX-License-Identifier: MIT

import { describe, expect, it, vi, beforeEach } from "vitest";
import prisma from "@/lib/prisma";
import {
  hashApiKey,
  hashApiKeyV1,
  hashApiKeyV2,
  deriveApiKeySalt,
  verifyApiKeyDigest,
  validateKeyEntropy,
  assertMinimumKeyEntropy,
  authenticateRequest,
  apiKeyLookupHashesV2,
  migrateApiKeyToV2,
  generateApiKey,
  deriveKeyPrefix,
  API_KEY_DIGEST_VERSION_V2,
  MIN_API_KEY_ENTROPY_BYTES,
} from "@/lib/api-auth";

vi.mock("@/lib/prisma", () => ({
  default: {
    apiKey: {
      findFirst: vi.fn(),
      update: vi.fn().mockReturnValue({ catch: vi.fn() }),
    },
    apiKeyRequestLog: {
      create: vi.fn().mockReturnValue({ catch: vi.fn() }),
    },
  },
}));

const VALID_STANDARDIZED_KEY =
  "op_test_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef_9440d1e5";
const VALID_LIVE_KEY =
  "op_live_fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210_3fe24cd0";
const LEGACY_701_KEY =
  "oph_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const SHORT_WEAK_KEY = "op_test_1234567890abcdef_12345678";

describe("API Key Hashing & Verification — Issue #1287", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Argon2id Hashing (v2)", () => {
    it("produces version-tagged Argon2id digest with per-key salt", async () => {
      const v2Hash = await hashApiKeyV2(VALID_STANDARDIZED_KEY);
      expect(v2Hash.startsWith(`${API_KEY_DIGEST_VERSION_V2}:$argon2id$`)).toBe(true);
      expect(v2Hash).toContain("$m=4096,p=1,t=2$");
    });

    it("generates deterministic salts and hashes for identical keys to enable O(1) DB lookups", async () => {
      const salt1 = deriveApiKeySalt(VALID_STANDARDIZED_KEY);
      const salt2 = deriveApiKeySalt(VALID_STANDARDIZED_KEY);
      expect(salt1.equals(salt2)).toBe(true);

      const hash1 = await hashApiKeyV2(VALID_STANDARDIZED_KEY);
      const hash2 = await hashApiKeyV2(VALID_STANDARDIZED_KEY);
      expect(hash1).toBe(hash2);
    });

    it("generates distinct salts and hashes for distinct keys", async () => {
      const salt1 = deriveApiKeySalt(VALID_STANDARDIZED_KEY);
      const salt2 = deriveApiKeySalt(VALID_LIVE_KEY);
      expect(salt1.equals(salt2)).toBe(false);

      const hash1 = await hashApiKeyV2(VALID_STANDARDIZED_KEY);
      const hash2 = await hashApiKeyV2(VALID_LIVE_KEY);
      expect(hash1).not.toBe(hash2);
    });

    it("verifies matching key and rejects incorrect key via verifyApiKeyDigest", async () => {
      const v2Hash = await hashApiKeyV2(VALID_STANDARDIZED_KEY);
      const isValid = await verifyApiKeyDigest(VALID_STANDARDIZED_KEY, v2Hash);
      expect(isValid).toBe(true);

      const isInvalid = await verifyApiKeyDigest(VALID_LIVE_KEY, v2Hash);
      expect(isInvalid).toBe(false);
    });
  });

  describe("Backward-Compatible Migration Window", () => {
    it("verifies v1 tagged SHA-256 digests accurately", async () => {
      const v1Hash = hashApiKeyV1(VALID_STANDARDIZED_KEY);
      expect(v1Hash.startsWith("v1:")).toBe(true);

      expect(await verifyApiKeyDigest(VALID_STANDARDIZED_KEY, v1Hash)).toBe(true);
      expect(await verifyApiKeyDigest(VALID_LIVE_KEY, v1Hash)).toBe(false);
    });

    it("verifies legacy bare SHA-256 digests accurately", async () => {
      const legacyHash = hashApiKey(LEGACY_701_KEY);
      expect(legacyHash).toHaveLength(64);

      expect(await verifyApiKeyDigest(LEGACY_701_KEY, legacyHash)).toBe(true);
      expect(await verifyApiKeyDigest(VALID_STANDARDIZED_KEY, legacyHash)).toBe(false);
    });

    it("rejects empty or corrupt hashes gracefully", async () => {
      expect(await verifyApiKeyDigest(VALID_STANDARDIZED_KEY, "")).toBe(false);
      expect(await verifyApiKeyDigest(VALID_STANDARDIZED_KEY, "v2:invalid-phc-string")).toBe(false);
      expect(await verifyApiKeyDigest(VALID_STANDARDIZED_KEY, "v1:short")).toBe(false);
    });

    it("apiKeyLookupHashesV2 queries modern Argon2id v2, tagged v1, and legacy digests", async () => {
      const hashes = await apiKeyLookupHashesV2(VALID_STANDARDIZED_KEY);
      expect(hashes).toHaveLength(3);
      expect(hashes[0]!.startsWith("v2:$argon2id$")).toBe(true);
      expect(hashes[1]).toBe(hashApiKeyV1(VALID_STANDARDIZED_KEY));
      expect(hashes[2]).toBe(hashApiKey(VALID_STANDARDIZED_KEY));
    });

    it("migrates a key to Argon2id v2 during migration window via migrateApiKeyToV2", async () => {
      const expectedV2Hash = await hashApiKeyV2(VALID_STANDARDIZED_KEY);

      const returnedHash = await migrateApiKeyToV2("key_migrating_1", VALID_STANDARDIZED_KEY);
      expect(returnedHash).toBe(expectedV2Hash);
      expect(prisma.apiKey.update).toHaveBeenCalledWith({
        where: { id: "key_migrating_1" },
        data: { keyHash: expectedV2Hash },
      });
    });

    it("authenticates standard keys and includes modern Argon2id v2 in lookup where clause", async () => {
      const expectedV2Hash = await hashApiKeyV2(VALID_STANDARDIZED_KEY);

      vi.mocked(prisma.apiKey.findFirst).mockResolvedValueOnce({
        id: "key_modern_2",
        userId: "user_modern",
        name: "Modern Argon2id key",
        expiresAt: null,
        scopes: ["read:payments"],
      } as never);

      const req = new Request("http://localhost/api/payments", {
        headers: { "x-api-key": VALID_STANDARDIZED_KEY },
      });

      const auth = await authenticateRequest(req);
      expect(auth).not.toBeNull();
      expect(auth?.userId).toBe("user_modern");

      const where = vi.mocked(prisma.apiKey.findFirst).mock.calls[0]![0]!
        .where as { keyHash: { in: string[] }; prefix: string };
      expect(where.prefix).toBe(deriveKeyPrefix(VALID_STANDARDIZED_KEY));
      expect(where.keyHash.in).toContain(expectedV2Hash);
      expect(where.keyHash.in).toContain(hashApiKeyV1(VALID_STANDARDIZED_KEY));
      expect(where.keyHash.in).toContain(hashApiKey(VALID_STANDARDIZED_KEY));
    });
  });

  describe("Minimum Entropy Enforcement", () => {
    it("validates that newly generated keys satisfy 32-byte CSPRNG requirement", () => {
      const generated = generateApiKey();
      const check = validateKeyEntropy(generated);
      expect(check.valid).toBe(true);
      expect(check.entropyBytes).toBeGreaterThanOrEqual(MIN_API_KEY_ENTROPY_BYTES);
      expect(() => assertMinimumKeyEntropy(generated)).not.toThrow();
    });

    it("rejects keys with less than 32 bytes (256-bit) of entropy", () => {
      const check = validateKeyEntropy(SHORT_WEAK_KEY);
      expect(check.valid).toBe(false);
      expect(check.error).toContain("API key entropy below minimum requirement");
      expect(() => assertMinimumKeyEntropy(SHORT_WEAK_KEY)).toThrow(
        /API key entropy below minimum requirement/
      );
    });

    it("rejects empty or non-string keys", () => {
      expect(validateKeyEntropy("").valid).toBe(false);
      expect(() => assertMinimumKeyEntropy("")).toThrow();
      expect(validateKeyEntropy("short").valid).toBe(false);
    });
  });
});
