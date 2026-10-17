// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import {
  generateApiKey,
  hashApiKey,
  hashApiKeyV1,
  API_KEY_RANDOM_BYTES,
} from "@/lib/api-auth";
import {
  API_KEY_KDF_V2_PREFIX,
  hashApiKeyArgon2id,
  hashApiKeySlowKdf,
  isSlowKdfDigest,
  validateApiKeyEntropy,
  verifyApiKeyDigest,
} from "@/lib/api-key-kdf";

describe("API key salted slow KDF & 32-byte entropy validation (#1287)", () => {
  it("enforces minimum 32-byte (64 hex chars) CSPRNG entropy on generated keys", () => {
    const key = generateApiKey();
    expect(API_KEY_RANDOM_BYTES).toBeGreaterThanOrEqual(32);
    expect(() => validateApiKeyEntropy(key)).not.toThrow();
  });

  it("rejects keys with fewer than 32 bytes of entropy or degenerate secrets", () => {
    expect(() => validateApiKeyEntropy("oph_deadbeef")).toThrow(
      /Insufficient API key entropy/
    );
    expect(() => validateApiKeyEntropy("invalid_prefix_" + "a".repeat(64))).toThrow(
      /must start with/
    );
    expect(() => validateApiKeyEntropy("oph_" + "0".repeat(64))).toThrow(
      /degenerate secret material/
    );
  });

  it("hashes keys using a salted slow KDF with unique salt per invocation", () => {
    const rawKey = generateApiKey();
    const digest1 = hashApiKeyArgon2id(rawKey);
    const digest2 = hashApiKeySlowKdf(rawKey);

    expect(digest1.startsWith(API_KEY_KDF_V2_PREFIX)).toBe(true);
    expect(digest2.startsWith(API_KEY_KDF_V2_PREFIX)).toBe(true);
    expect(isSlowKdfDigest(digest1)).toBe(true);
    // Distinct random 16-byte salts must produce distinct serialized digests
    expect(digest1).not.toBe(digest2);

    // Both digests must verify against the original raw key
    expect(verifyApiKeyDigest(rawKey, digest1)).toBe(true);
    expect(verifyApiKeyDigest(rawKey, digest2)).toBe(true);
  });

  it("rejects wrong keys and tampered slow KDF digests in constant time", () => {
    const rawKey = generateApiKey();
    const otherKey = generateApiKey();
    const digest = hashApiKeySlowKdf(rawKey);

    expect(verifyApiKeyDigest(otherKey, digest)).toBe(false);
    expect(verifyApiKeyDigest(rawKey, digest.slice(0, -2) + "ff")).toBe(false);
    expect(verifyApiKeyDigest(rawKey, "v2$argon2id-scrypt$malformed")).toBe(false);
  });

  it("maintains backward compatibility with v1:<sha256> and legacy bare SHA-256 digests", () => {
    const rawKey = generateApiKey();
    const wrongKey = generateApiKey();

    const v1Digest = hashApiKeyV1(rawKey);
    const legacyDigest = hashApiKey(rawKey);

    expect(verifyApiKeyDigest(rawKey, v1Digest)).toBe(true);
    expect(verifyApiKeyDigest(wrongKey, v1Digest)).toBe(false);

    expect(verifyApiKeyDigest(rawKey, legacyDigest)).toBe(true);
    expect(verifyApiKeyDigest(wrongKey, legacyDigest)).toBe(false);
  });
});
