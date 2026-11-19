// SPDX-License-Identifier: MIT
/**
 * @vitest-environment node
 *
 * API key digest hardening:
 *   • new keys are stored as salted Argon2id digests (`v2:`),
 *   • pre-existing SHA-256 digests (`v1:` and bare) still verify,
 *   • a legacy digest is upgraded to Argon2id the first time it authenticates,
 *   • creation refuses keys below the 32-byte entropy threshold.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  update: vi.fn(() => Promise.resolve({})),
  logCreate: vi.fn(() => Promise.resolve({})),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    apiKey: { findMany: mocks.findMany, update: mocks.update },
    apiKeyRequestLog: { create: mocks.logCreate },
  },
}));

import {
  API_KEY_ARGON2_PREFIX,
  assertMinimumKeyEntropy,
  authenticateRequest,
  checkApiKeyEntropy,
  deriveKeyPrefix,
  generateApiKey,
  hashApiKey,
  hashApiKeyV1,
  hashApiKeyV2,
  needsApiKeyRehash,
  verifyApiKeyHash,
} from "@/lib/api-auth";
import { MIN_API_KEY_ENTROPY_BYTES } from "@/lib/api-key-format";

const RAW_KEY = `oph_${"a1b2c3d4".repeat(8)}`; // 32 bytes, post-#701 legacy shape

beforeEach(() => {
  mocks.findMany.mockReset();
  mocks.update.mockClear();
  mocks.logCreate.mockClear();
});

describe("hashApiKeyV2", () => {
  it("produces a version-tagged Argon2id digest, never the raw key", async () => {
    const digest = await hashApiKeyV2(RAW_KEY);

    expect(digest.startsWith(API_KEY_ARGON2_PREFIX)).toBe(true);
    expect(digest).toMatch(/^v2:\$argon2id\$v=19\$/);
    expect(digest).not.toContain(RAW_KEY);
  });

  it("salts every digest independently", async () => {
    const [first, second] = await Promise.all([
      hashApiKeyV2(RAW_KEY),
      hashApiKeyV2(RAW_KEY),
    ]);

    expect(first).not.toBe(second);
    // ...and both still verify the same raw key.
    await expect(verifyApiKeyHash(RAW_KEY, first)).resolves.toBe(true);
    await expect(verifyApiKeyHash(RAW_KEY, second)).resolves.toBe(true);
  });

  it("rejects a different raw key", async () => {
    const digest = await hashApiKeyV2(RAW_KEY);
    await expect(verifyApiKeyHash(`${RAW_KEY}0`, digest)).resolves.toBe(false);
  });

  it("fails closed on a malformed stored digest", async () => {
    await expect(
      verifyApiKeyHash(RAW_KEY, `${API_KEY_ARGON2_PREFIX}not-a-digest`)
    ).resolves.toBe(false);
  });
});

describe("legacy digest verification and migration", () => {
  it("verifies v1 and bare SHA-256 digests", async () => {
    await expect(verifyApiKeyHash(RAW_KEY, hashApiKeyV1(RAW_KEY))).resolves.toBe(
      true
    );
    await expect(verifyApiKeyHash(RAW_KEY, hashApiKey(RAW_KEY))).resolves.toBe(
      true
    );
    await expect(
      verifyApiKeyHash(`${RAW_KEY}0`, hashApiKeyV1(RAW_KEY))
    ).resolves.toBe(false);
  });

  it("only flags non-Argon2id digests for rehashing", async () => {
    expect(needsApiKeyRehash(hashApiKeyV1(RAW_KEY))).toBe(true);
    expect(needsApiKeyRehash(hashApiKey(RAW_KEY))).toBe(true);
    expect(needsApiKeyRehash(await hashApiKeyV2(RAW_KEY))).toBe(false);
  });

  it("authenticates a legacy key and upgrades its stored digest", async () => {
    mocks.findMany.mockResolvedValue([
      {
        id: "key_legacy",
        userId: "user_1",
        name: "legacy",
        expiresAt: null,
        scopes: ["read:payments"],
        keyHash: hashApiKeyV1(RAW_KEY),
      },
    ]);

    const auth = await authenticateRequest(
      new Request("http://localhost/api/payments", {
        headers: { "x-api-key": RAW_KEY },
      })
    );

    expect(auth).toEqual({
      userId: "user_1",
      keyId: "key_legacy",
      keyName: "legacy",
      scopes: ["read:payments"],
    });

    // The opportunistic rehash is fire-and-forget; wait for it to land.
    await vi.waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith({
        where: { id: "key_legacy" },
        data: { keyHash: expect.stringMatching(/^v2:\$argon2id\$/) },
      })
    );
  });

  it("does not rehash an already-migrated key", async () => {
    mocks.findMany.mockResolvedValue([
      {
        id: "key_v2",
        userId: "user_2",
        name: "modern",
        expiresAt: null,
        scopes: [],
        keyHash: await hashApiKeyV2(RAW_KEY),
      },
    ]);

    await expect(
      authenticateRequest(
        new Request("http://localhost/api/payments", {
          headers: { authorization: `Bearer ${RAW_KEY}` },
        })
      )
    ).resolves.not.toBeNull();

    // Only the lastUsed write is allowed here.
    await vi.waitFor(() => expect(mocks.update).toHaveBeenCalled());
    const calls = mocks.update.mock.calls as unknown as Array<
      [{ data?: { keyHash?: string } }]
    >;
    for (const [args] of calls) {
      expect(args.data?.keyHash).toBeUndefined();
    }
  });
});

describe("minimum entropy threshold", () => {
  it("accepts keys minted by generateApiKey", () => {
    const rawKey = generateApiKey({ env: "test" });
    const result = checkApiKeyEntropy(rawKey);

    expect(result.valid).toBe(true);
    expect(result.bytes).toBe(32);
    expect(() => assertMinimumKeyEntropy(rawKey)).not.toThrow();
  });

  it("rejects a short random segment", () => {
    const shortKey = `op_test_${"a".repeat(32)}_00000000`;
    const result = checkApiKeyEntropy(shortKey);

    expect(result.valid).toBe(false);
    expect(result.bytes).toBe(16);
    expect(() => assertMinimumKeyEntropy(shortKey)).toThrow(
      /below the minimum requirement/
    );
  });

  it("uses a 32-byte floor", () => {
    expect(MIN_API_KEY_ENTROPY_BYTES).toBe(32);
  });

  it("rejects a key that is not in the creation format", () => {
    expect(checkApiKeyEntropy("not-a-key").valid).toBe(false);
    expect(() => assertMinimumKeyEntropy("not-a-key")).toThrow(
      /Rejected API key creation/
    );
  });
});

describe("lookup prefix", () => {
  it("stays the first eight characters of the raw key", () => {
    expect(deriveKeyPrefix(RAW_KEY)).toBe(RAW_KEY.slice(0, 8));
  });
});
