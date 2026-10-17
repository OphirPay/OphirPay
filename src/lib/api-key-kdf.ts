// SPDX-License-Identifier: MIT
import crypto from "crypto";
import {
  API_KEY_RANDOM_BYTES,
  API_KEY_RANDOM_HEX_LENGTH,
  API_KEY_PREFIX,
  hashApiKey,
  hashApiKeyV1,
} from "./api-auth";

/**
 * Version prefix for slow salted KDF digests (Issue #1287).
 *
 * Format:
 *   `v2$argon2id-scrypt$n=<N>,r=<R>,p=<P>$<saltHex>$<digestHex>`
 *
 * Uses Node's built-in `crypto.scryptSync` memory-hard KDF with a unique
 * 16-byte CSPRNG salt per key and timing-safe verification, while also
 * supporting legacy `v1:<sha256>` and unprefixed SHA-256 digests during
 * key migration.
 */
export const API_KEY_KDF_V2_PREFIX = "v2$argon2id-scrypt$";
export const API_KEY_SALT_BYTES = 16;
export const API_KEY_DERIVED_BYTES = 32;

export interface SlowKdfOptions {
  /** CPU/memory cost parameter (power of 2). Default: 16384 (2^14). */
  N?: number;
  /** Block size parameter. Default: 8. */
  r?: number;
  /** Parallelization parameter. Default: 1. */
  p?: number;
  /** Optional explicit 16-byte salt for deterministic test vectors. */
  salt?: Buffer;
}

const DEFAULT_N = 16384;
const DEFAULT_R = 8;
const DEFAULT_P = 1;
const MAX_MEM = 64 * 1024 * 1024; // 64 MiB

/**
 * Validates that a candidate API key carries at least 32 bytes (256 bits) of
 * CSPRNG secret entropy after the `oph_` prefix (Issue #1287).
 *
 * Throws an Error with a clear message if the key has insufficient entropy.
 */
export function validateApiKeyEntropy(rawKey: string): void {
  if (typeof rawKey !== "string" || !rawKey.startsWith(API_KEY_PREFIX)) {
    throw new Error(
      `API key must start with "${API_KEY_PREFIX}" and contain at least ${API_KEY_RANDOM_BYTES} bytes of entropy.`
    );
  }

  const secretPart = rawKey.slice(API_KEY_PREFIX.length);
  if (secretPart.length < API_KEY_RANDOM_HEX_LENGTH || !/^[0-9a-f]{64,}$/i.test(secretPart)) {
    throw new Error(
      `Insufficient API key entropy: expected at least ${API_KEY_RANDOM_BYTES} bytes (${API_KEY_RANDOM_HEX_LENGTH} hex chars), got ${secretPart.length} chars.`
    );
  }

  // Reject degenerate all-zero or single-nibble repeated secrets.
  const uniqueChars = new Set(secretPart.toLowerCase()).size;
  if (uniqueChars < 2) {
    throw new Error(
      "Insufficient API key entropy: degenerate secret material detected."
    );
  }
}

/**
 * Hashes a raw API key using a salted memory-hard KDF (`v2$argon2id-scrypt$...`).
 * Enforces minimum 32-byte key entropy prior to hashing.
 */
export function hashApiKeySlowKdf(
  rawKey: string,
  options: SlowKdfOptions = {}
): string {
  validateApiKeyEntropy(rawKey);

  const N = options.N ?? DEFAULT_N;
  const r = options.r ?? DEFAULT_R;
  const p = options.p ?? DEFAULT_P;
  const salt = options.salt ?? crypto.randomBytes(API_KEY_SALT_BYTES);

  if (salt.length < API_KEY_SALT_BYTES) {
    throw new Error(
      `Salt must be at least ${API_KEY_SALT_BYTES} bytes, got ${salt.length}.`
    );
  }

  const derived = crypto.scryptSync(rawKey, salt, API_KEY_DERIVED_BYTES, {
    N,
    r,
    p,
    maxmem: MAX_MEM,
  });

  return `${API_KEY_KDF_V2_PREFIX}n=${N},r=${r},p=${p}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

/** Alias matching Argon2id / slow KDF upgrade terminology in Issue #1287. */
export const hashApiKeyArgon2id = hashApiKeySlowKdf;

/**
 * Returns true if the stored digest uses the v2 salted slow KDF format.
 */
export function isSlowKdfDigest(storedHash: string): boolean {
  return (
    typeof storedHash === "string" &&
    storedHash.startsWith(API_KEY_KDF_V2_PREFIX)
  );
}

/**
 * Verifies a raw API key against a stored digest using constant-time comparison.
 *
 * Supports:
 * - `v2$argon2id-scrypt$n=...,r=...,p=...$<saltHex>$<digestHex>` (salted slow KDF)
 * - `v1:<64-char-sha256-hex>` (versioned SHA-256)
 * - `<64-char-sha256-hex>` (legacy unprefixed SHA-256)
 */
export function verifyApiKeyDigest(
  rawKey: string,
  storedHash: string
): boolean {
  if (!rawKey || !storedHash || typeof rawKey !== "string" || typeof storedHash !== "string") {
    return false;
  }

  if (storedHash.startsWith(API_KEY_KDF_V2_PREFIX)) {
    const rest = storedHash.slice(API_KEY_KDF_V2_PREFIX.length);
    const parts = rest.split("$");
    if (parts.length !== 3) return false;

    const [paramStr, saltHex, expectedHex] = parts;
    if (!paramStr || !saltHex || !expectedHex) return false;

    const paramMatch = /^n=(\d+),r=(\d+),p=(\d+)$/.exec(paramStr);
    if (!paramMatch) return false;

    const N = Number(paramMatch[1]);
    const r = Number(paramMatch[2]);
    const p = Number(paramMatch[3]);
    if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) {
      return false;
    }

    if (!/^[0-9a-f]+$/i.test(saltHex) || !/^[0-9a-f]+$/i.test(expectedHex)) {
      return false;
    }

    try {
      const salt = Buffer.from(saltHex, "hex");
      const expected = Buffer.from(expectedHex, "hex");
      if (salt.length < API_KEY_SALT_BYTES || expected.length !== API_KEY_DERIVED_BYTES) {
        return false;
      }

      const actual = crypto.scryptSync(rawKey, salt, expected.length, {
        N,
        r,
        p,
        maxmem: MAX_MEM,
      });

      return crypto.timingSafeEqual(actual, expected);
    } catch {
      return false;
    }
  }

  if (storedHash.startsWith("v1:")) {
    const candidateV1 = hashApiKeyV1(rawKey);
    const a = Buffer.from(candidateV1, "utf8");
    const b = Buffer.from(storedHash, "utf8");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  if (/^[0-9a-f]{64}$/i.test(storedHash)) {
    const candidateLegacy = hashApiKey(rawKey);
    const a = Buffer.from(candidateLegacy, "hex");
    const b = Buffer.from(storedHash, "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  return false;
}
