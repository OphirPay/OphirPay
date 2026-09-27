// SPDX-License-Identifier: MIT
/**
 * @vitest-environment node
 *
 * Issue #735 — the scheduled load test needs an API key for
 * `GET /api/payments`. `scripts/create-load-test-key.mjs` mints it, which means
 * the script is now a second implementation of the key format. These tests make
 * that a checked invariant instead of a coincidence: the digest, prefix, byte
 * count and accepted pattern must all match `src/lib/api-auth.ts`, and a re-run
 * must rotate (never accumulate) credentials.
 */

import { describe, it, expect, vi, beforeAll } from "vitest";

vi.mock("@/lib/prisma", () => ({ default: {} }));

import {
  API_KEY_PREFIX,
  API_KEY_PREFIX_LENGTH,
  API_KEY_RANDOM_BYTES,
  API_KEY_PATTERN,
  deriveKeyPrefix,
  hashApiKey,
  hashApiKeyV1,
} from "@/lib/api-auth";

type KeyModule = {
  API_KEY_PREFIX: string;
  API_KEY_PREFIX_LENGTH: number;
  API_KEY_RANDOM_BYTES: number;
  generateApiKey: (randomBytes?: (n: number) => Buffer) => string;
  hashApiKeyV1: (rawKey: string) => string;
  deriveKeyPrefix: (rawKey: string) => string;
  provisionLoadTestKey: (opts: {
    prisma: unknown;
    keyName?: string;
    email?: string;
    seedPayments?: number;
  }) => Promise<{ rawKey: string; userId: string; seeded: number }>;
};

let keyScript: KeyModule;

beforeAll(async () => {
  keyScript = (await import("../../scripts/create-load-test-key.mjs")) as unknown as KeyModule;
});

/** Minimal Prisma double: only the calls provisionLoadTestKey makes. */
function fakePrisma() {
  const created: Array<Record<string, unknown>> = [];
  const payments: Array<Record<string, unknown>> = [];
  return {
    created,
    payments,
    user: {
      upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => ({
        id: "user_load_test",
        ...create,
      })),
    },
    apiKey: {
      deleteMany: vi.fn(async () => ({ count: created.length })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return data;
      }),
    },
    payment: {
      count: vi.fn(async () => payments.length),
      createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
        payments.push(...data);
        return { count: data.length };
      }),
    },
  };
}

describe("scripts/create-load-test-key.mjs", () => {
  it("matches the API key format documented in src/lib/api-auth.ts", () => {
    expect(keyScript.API_KEY_PREFIX).toBe(API_KEY_PREFIX);
    expect(keyScript.API_KEY_PREFIX_LENGTH).toBe(API_KEY_PREFIX_LENGTH);
    expect(keyScript.API_KEY_RANDOM_BYTES).toBe(API_KEY_RANDOM_BYTES);

    const rawKey = keyScript.generateApiKey();
    expect(rawKey).toMatch(API_KEY_PATTERN);
    expect(keyScript.hashApiKeyV1(rawKey)).toBe(hashApiKeyV1(rawKey));
    expect(keyScript.hashApiKeyV1(rawKey)).toMatch(/^v1:[a-f0-9]{64}$/);
    // The version-tagged digest must never be the bare legacy digest.
    expect(keyScript.hashApiKeyV1(rawKey)).not.toBe(hashApiKey(rawKey));
    expect(keyScript.deriveKeyPrefix(rawKey)).toBe(deriveKeyPrefix(rawKey));
    expect(keyScript.deriveKeyPrefix(rawKey)).toBe(
      rawKey.slice(0, API_KEY_PREFIX_LENGTH)
    );
  });

  it("derives the key from the injected CSPRNG (so entropy is real)", () => {
    const deterministic = Buffer.alloc(API_KEY_RANDOM_BYTES, 0xab);
    const rawKey = keyScript.generateApiKey(() => deterministic);
    expect(rawKey).toBe(`${API_KEY_PREFIX}${"ab".repeat(API_KEY_RANDOM_BYTES)}`);
    expect(rawKey).toMatch(API_KEY_PATTERN);
  });

  it("stores a verifiable digest and read-only scope for the load-test user", async () => {
    const prisma = fakePrisma();
    const { rawKey, userId } = await keyScript.provisionLoadTestKey({
      prisma,
      email: "load-test@ophirpay.local",
    });

    expect(userId).toBe("user_load_test");
    expect(rawKey).toMatch(API_KEY_PATTERN);

    const created = prisma.created[0]!;
    expect(created.userId).toBe("user_load_test");
    expect(created.name).toBe("load-test");
    expect(created.keyHash).toBe(hashApiKeyV1(rawKey));
    expect(created.prefix).toBe(deriveKeyPrefix(rawKey));
    expect(created.scopes).toEqual(["read:payments"]);
  });

  it("rotates the previous load-test key on every run (no key pile-up)", async () => {
    const prisma = fakePrisma();
    await keyScript.provisionLoadTestKey({ prisma });
    await keyScript.provisionLoadTestKey({ prisma });

    expect(prisma.apiKey.deleteMany).toHaveBeenCalledTimes(2);
    expect(prisma.apiKey.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user_load_test", name: "load-test" },
    });
    expect(prisma.created).toHaveLength(2);
    expect(prisma.created[0]!.keyHash).not.toBe(prisma.created[1]!.keyHash);
  });

  it("seeds realistic rows so the payments list query does real work", async () => {
    const prisma = fakePrisma();
    const { seeded } = await keyScript.provisionLoadTestKey({
      prisma,
      seedPayments: 25,
    });

    expect(seeded).toBe(25);
    expect(prisma.payments).toHaveLength(25);
    expect(prisma.payments[0]).toMatchObject({
      userId: "user_load_test",
      assetCode: "XLM",
    });

    // Re-running with the same target does not duplicate rows.
    const second = await keyScript.provisionLoadTestKey({ prisma, seedPayments: 25 });
    expect(second.seeded).toBe(25);
    expect(prisma.payments).toHaveLength(25);
  });
});
