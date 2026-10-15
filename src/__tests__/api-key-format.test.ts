// SPDX-License-Identifier: MIT
//
// Issue #1397 — API key minimum entropy check, standardized format
// (op_{env}_{32_hex_bytes}_{4_byte_crc}), CRC-32 checksum integrity,
// edge middleware rejection, and backward compatibility.

import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";
import { NextRequest } from "next/server";

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
  API_KEY_LEGACY_PREFIX,
  API_KEY_PREFIX_LENGTH,
  API_KEY_RANDOM_BYTES,
  API_KEY_RANDOM_HEX_LENGTH,
  API_KEY_LEGACY_HEX_LENGTH,
  API_KEY_CRC_HEX_LENGTH,
  API_KEY_PATTERN,
  API_KEY_LOOKUP_PATTERN,
  API_KEY_DIGEST_VERSION,
  crc32,
  computeCrcHex,
  validateKeyFormat,
  isLegacyApiKey,
  isValidApiKeyFormat,
  assertValidApiKeyFormat,
  deriveKeyPrefix,
  generateApiKey,
  hashApiKey,
  hashApiKeyV1,
  apiKeyLookupHashes,
  authenticateRequest,
} from "@/lib/api-auth";
import { proxy } from "@/proxy";

const LEGACY_24_KEY = `${API_KEY_LEGACY_PREFIX}${"a1b2c3d4".repeat(6)}`; // 48 hex chars (24 bytes)
const LEGACY_32_KEY = `${API_KEY_LEGACY_PREFIX}${"a1b2c3d4".repeat(8)}`; // 64 hex chars (32 bytes)
const VALID_TEST_KEY = generateApiKey("test");
const VALID_LIVE_KEY = generateApiKey("live");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CRC-32 Checksum implementation", () => {
  it("matches IEEE 802.3 standard test vector '123456789' -> 0xcbf43926", () => {
    expect(crc32("123456789")).toBe(0xcbf43926);
    expect(computeCrcHex("123456789")).toBe("cbf43926");
  });

  it("produces deterministic 8-character lowercase hex string", () => {
    const hex = computeCrcHex("op_test_sample_payload");
    expect(hex).toHaveLength(8);
    expect(hex).toMatch(/^[0-9a-f]{8}$/);
    expect(computeCrcHex("op_test_sample_payload")).toBe(hex);
  });
});

describe("generateApiKey", () => {
  it("mints 32 CSPRNG bytes (64 hex chars) with standard prefix and CRC-32 checksum", () => {
    const key = generateApiKey("test");
    expect(key).toMatch(API_KEY_PATTERN);
    expect(key.startsWith("op_test_")).toBe(true);
    // op_ (3) + test_ (5) + 64 hex + _ (1) + 8 crc = 81
    expect(key.length).toBe(81);
    expect(validateKeyFormat(key)).toBe(true);
  });

  it("supports explicit live environment prefix", () => {
    const key = generateApiKey("live");
    expect(key).toMatch(API_KEY_PATTERN);
    expect(key.startsWith("op_live_")).toBe(true);
    expect(key.length).toBe(81);
    expect(validateKeyFormat(key)).toBe(true);
  });

  it("produces unique keys with high entropy", () => {
    const keys = new Set(Array.from({ length: 50 }, () => generateApiKey("test")));
    expect(keys.size).toBe(50);
  });

  it("never mints legacy oph_ formats", () => {
    const key = generateApiKey();
    expect(key.startsWith(API_KEY_LEGACY_PREFIX)).toBe(false);
  });
});

describe("validateKeyFormat & isValidApiKeyFormat", () => {
  it("accepts valid keys in test and live environments", () => {
    expect(validateKeyFormat(VALID_TEST_KEY)).toBe(true);
    expect(validateKeyFormat(VALID_LIVE_KEY)).toBe(true);
    expect(isValidApiKeyFormat(VALID_TEST_KEY)).toBe(true);
  });

  it("detects single-character corruption in the payload (CRC mismatch)", () => {
    // Flip a single hex char in the payload guaranteed to be different
    const parts = VALID_TEST_KEY.split("_");
    const firstChar = parts[2]![0];
    const replacement = firstChar === "a" ? "b" : "a";
    const corruptedPayloadHex = replacement + parts[2]!.slice(1);
    const corruptedKey = `op_test_${corruptedPayloadHex}_${parts[3]}`;
    expect(validateKeyFormat(corruptedKey)).toBe(false);
  });

  it("detects single-character corruption in the CRC checksum", () => {
    const parts = VALID_TEST_KEY.split("_");
    const lastChar = parts[3]!.slice(-1);
    const flippedCrc = parts[3]!.slice(0, -1) + (lastChar === "0" ? "1" : "0");
    const corruptedKey = `op_test_${parts[2]}_${flippedCrc}`;
    expect(validateKeyFormat(corruptedKey)).toBe(false);
  });

  it("rejects legacy keys at standard format validation", () => {
    expect(validateKeyFormat(LEGACY_24_KEY)).toBe(false);
    expect(validateKeyFormat(LEGACY_32_KEY)).toBe(false);
  });

  it.each([
    ["missing prefix", "a1b2c3d4".repeat(8) + "_12345678"],
    ["wrong prefix", "opp_test_" + "a1b2c3d4".repeat(8) + "_12345678"],
    ["unknown environment", "op_stage_" + "a1b2c3d4".repeat(8) + "_12345678"],
    ["uppercase hex in payload", "op_test_" + "A1B2C3D4".repeat(8) + "_12345678"],
    ["non-hex characters in payload", "op_test_" + "z".repeat(64) + "_12345678"],
    ["insufficient entropy (short payload)", "op_test_" + "a1b2c3d4".repeat(4) + "_12345678"],
    ["excess entropy (long payload)", "op_test_" + "a1b2c3d4".repeat(10) + "_12345678"],
    ["short checksum", "op_test_" + "a1b2c3d4".repeat(8) + "_1234"],
    ["empty string", ""],
  ])("rejects %s", (_label, value) => {
    expect(validateKeyFormat(value)).toBe(false);
  });

  it("rejects null and undefined", () => {
    expect(validateKeyFormat(null)).toBe(false);
    expect(validateKeyFormat(undefined)).toBe(false);
  });
});

describe("isLegacyApiKey", () => {
  it("recognizes legacy 24-byte (48 hex chars) and 32-byte (64 hex chars) keys", () => {
    expect(isLegacyApiKey(LEGACY_24_KEY)).toBe(true);
    expect(isLegacyApiKey(LEGACY_32_KEY)).toBe(true);
  });

  it("returns false for modern standardized keys", () => {
    expect(isLegacyApiKey(VALID_TEST_KEY)).toBe(false);
    expect(isLegacyApiKey(VALID_LIVE_KEY)).toBe(false);
  });

  it("returns false for arbitrary strings", () => {
    expect(isLegacyApiKey("not-a-key")).toBe(false);
    expect(isLegacyApiKey(null)).toBe(false);
  });
});

describe("assertValidApiKeyFormat", () => {
  it("does not throw for a valid key", () => {
    expect(() => assertValidApiKeyFormat(VALID_TEST_KEY)).not.toThrow();
  });

  it("throws on invalid key with actionable message", () => {
    expect(() => assertValidApiKeyFormat("invalid-key")).toThrow(
      /Invalid API key format/
    );
  });
});

describe("deriveKeyPrefix", () => {
  it("returns exactly 8 characters matching the index column", () => {
    expect(deriveKeyPrefix(VALID_TEST_KEY)).toBe("op_test_");
    expect(deriveKeyPrefix(VALID_LIVE_KEY)).toBe("op_live_");
    expect(deriveKeyPrefix(LEGACY_24_KEY)).toHaveLength(API_KEY_PREFIX_LENGTH);
  });
});

describe("versioned digests", () => {
  it("hashApiKeyV1 produces v1-tagged SHA-256", () => {
    expect(hashApiKeyV1(VALID_TEST_KEY)).toBe(
      `${API_KEY_DIGEST_VERSION}:${hashApiKey(VALID_TEST_KEY)}`
    );
    expect(hashApiKeyV1(VALID_TEST_KEY)).toMatch(/^v1:[a-f0-9]{64}$/);
  });

  it("apiKeyLookupHashes queries both tagged and legacy digests", () => {
    expect(apiKeyLookupHashes(VALID_TEST_KEY)).toEqual([
      hashApiKeyV1(VALID_TEST_KEY),
      hashApiKey(VALID_TEST_KEY),
    ]);
  });
});

describe("authenticateRequest", () => {
  const callWithHeader = (headers: Record<string, string>) =>
    authenticateRequest(
      new Request("http://localhost/api/payments", {
        headers,
      })
    );

  it("authenticates a standardized key and queries both digest forms", async () => {
    const row = {
      id: "key_1",
      userId: "u1",
      name: "Standard Key",
      expiresAt: null,
      scopes: ["read:payments"],
    };
    vi.mocked(prisma.apiKey.findFirst).mockResolvedValueOnce(row as never);

    const auth = await callWithHeader({ "x-api-key": VALID_TEST_KEY });
    expect(auth).toEqual({
      userId: "u1",
      keyId: "key_1",
      keyName: "Standard Key",
      scopes: ["read:payments"],
    });

    const where = vi.mocked(prisma.apiKey.findFirst).mock.calls[0]![0]!
      .where as { keyHash: { in: string[] }; prefix: string };
    expect(where.prefix).toBe("op_test_");
    expect(where.keyHash.in).toContain(hashApiKeyV1(VALID_TEST_KEY));
    expect(where.keyHash.in).toContain(hashApiKey(VALID_TEST_KEY));
  });

  it("authenticates via Authorization: Bearer header", async () => {
    const row = {
      id: "key_bearer",
      userId: "u_bearer",
      name: "Bearer Key",
      expiresAt: null,
      scopes: ["write:payments"],
    };
    vi.mocked(prisma.apiKey.findFirst).mockResolvedValueOnce(row as never);

    const auth = await callWithHeader({
      authorization: `Bearer ${VALID_LIVE_KEY}`,
    });
    expect(auth?.userId).toBe("u_bearer");
  });

  it("still authenticates legacy keys (backward compatibility)", async () => {
    vi.mocked(prisma.apiKey.findFirst).mockResolvedValueOnce({
      id: "key_legacy",
      userId: "u2",
      name: "old",
      expiresAt: null,
      scopes: null,
    } as never);

    const auth = await callWithHeader({ "x-api-key": LEGACY_24_KEY });
    expect(auth?.userId).toBe("u2");
    expect(prisma.apiKey.findFirst).toHaveBeenCalled();
  });

  it("rejects keys with invalid CRC checksum without touching the database", async () => {
    const parts = VALID_TEST_KEY.split("_");
    const badKey = `op_test_${parts[2]}_ffffffff`;

    expect(await callWithHeader({ "x-api-key": badKey })).toBeNull();
    expect(prisma.apiKey.findFirst).not.toHaveBeenCalled();
  });

  it("rejects malformed strings without touching the database", async () => {
    expect(await callWithHeader({ "x-api-key": "not-a-valid-key" })).toBeNull();
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

    expect(await callWithHeader({ "x-api-key": VALID_TEST_KEY })).toBeNull();
  });
});

describe("Edge Middleware (src/proxy.ts) key integrity rejection (#1397)", () => {
  it("rejects malformed x-api-key with 401 INVALID_API_KEY before database lookup", async () => {
    const req = new NextRequest("http://localhost/api/payments", {
      headers: { "x-api-key": "bad_key_format" },
    });
    const res = await proxy(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      error: {
        code: "INVALID_API_KEY",
        message: "Invalid API key format.",
      },
    });
    expect(res.headers.get("X-Request-Id")).toBeTruthy();
  });

  it("rejects tampered CRC in Authorization: Bearer with 401 INVALID_API_KEY", async () => {
    const parts = VALID_TEST_KEY.split("_");
    const tamperedKey = `op_test_${parts[2]}_ffffffff`;
    const req = new NextRequest("http://localhost/api/payments", {
      headers: { authorization: `Bearer ${tamperedKey}` },
    });
    const res = await proxy(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_API_KEY");
  });

  it("allows valid standardized API key to pass through", async () => {
    const req = new NextRequest("http://localhost/api/payments", {
      headers: { "x-api-key": VALID_TEST_KEY },
    });
    const res = await proxy(req);
    expect(res.status).toBe(200); // NextResponse.next() defaults to status 200 in Next.js middleware
  });

  it("allows legacy oph_ API key to pass through", async () => {
    const req = new NextRequest("http://localhost/api/payments", {
      headers: { "x-api-key": LEGACY_24_KEY },
    });
    const res = await proxy(req);
    expect(res.status).toBe(200);
  });

  it("allows requests without API key to pass through (e.g. cookie sessions)", async () => {
    const req = new NextRequest("http://localhost/api/payments");
    const res = await proxy(req);
    expect(res.status).toBe(200);
  });
});
