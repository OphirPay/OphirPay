// SPDX-License-Identifier: MIT

/**
 * Standard API key format, entropy enforcement, and edge-safe verification.
 *
 * Format: op_{env}_{32_hex_bytes}_{4_byte_crc}
 * Example: op_live_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef_beea69c3
 *
 * Provides:
 *   1. Standardized environment prefixes: op_live_ and op_test_
 *   2. Cryptographically secure 256-bit entropy (32 CSPRNG bytes / 64 hex characters)
 *   3. 4-byte CRC-32 checksum (8 hex characters) for immediate client and edge integrity checks
 *   4. Zero Prisma dependencies so edge middleware (src/proxy.ts) can reject malformed keys
 *      before any database lookup.
 */

export const API_KEY_PREFIX = "op_";
export const API_KEY_LEGACY_PREFIX = "oph_";
export const API_KEY_PREFIX_LENGTH = 8;
export const API_KEY_RANDOM_BYTES = 32;
export const API_KEY_RANDOM_HEX_LENGTH = 64;
export const API_KEY_LEGACY_HEX_LENGTH = 48;
export const API_KEY_CRC_HEX_LENGTH = 8;

/**
 * Standard API key pattern: op_{env}_{32_hex_bytes}_{4_byte_crc}
 */
export const API_KEY_PATTERN = /^op_(live|test)_[0-9a-f]{64}_[0-9a-f]{8}$/;

/**
 * Shapes accepted at auth time: standard CRC format plus legacy oph_ formats.
 */
export const API_KEY_LOOKUP_PATTERN = new RegExp(
  `^(?:op_(?:live|test)_[0-9a-f]{64}_[0-9a-f]{8}|${API_KEY_LEGACY_PREFIX}(?:[0-9a-f]{${API_KEY_LEGACY_HEX_LENGTH}}|[0-9a-f]{${API_KEY_RANDOM_HEX_LENGTH}}))$`
);

// Standard IEEE 802.3 CRC32 lookup table
const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC32_TABLE[i] = c;
}

/** Compute standard CRC32 checksum as an unsigned 32-bit integer. */
export function crc32(str: string): number {
  let crc = 0xffffffff;
  for (let i = 0; i < str.length; i++) {
    const byte = str.charCodeAt(i) & 0xff;
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Compute standard 8-character lowercase hex CRC checksum. */
export function computeCrcHex(payload: string): string {
  return crc32(payload).toString(16).padStart(8, "0");
}

/**
 * Validate that an API key conforms to the standard format:
 * `op_{env}_{32_hex_bytes}_{4_byte_crc}` and has a valid CRC-32 checksum.
 */
export function validateKeyFormat(key: string | null | undefined): boolean {
  if (typeof key !== "string") return false;
  const match = key.match(API_KEY_PATTERN);
  if (!match) return false;

  const lastUnderscore = key.lastIndexOf("_");
  const payload = key.slice(0, lastUnderscore);
  const checksum = key.slice(lastUnderscore + 1);

  return computeCrcHex(payload).toLowerCase() === checksum.toLowerCase();
}

/** Check if key matches legacy format (pre-standardization). */
export function isLegacyApiKey(key: string | null | undefined): boolean {
  if (typeof key !== "string") return false;
  return new RegExp(
    `^${API_KEY_LEGACY_PREFIX}(?:[0-9a-f]{${API_KEY_LEGACY_HEX_LENGTH}}|[0-9a-f]{${API_KEY_RANDOM_HEX_LENGTH}})$`
  ).test(key);
}

/** Extract a raw API key from Authorization: Bearer or X-API-Key headers. */
export function extractApiKey(request: Request | { headers: Headers }): string | null {
  const authHeader = request.headers.get("authorization");
  if (authHeader) {
    const parts = authHeader.split(" ");
    if (parts.length === 2 && parts[0]!.toLowerCase() === "bearer") {
      return parts[1]!.trim() || null;
    }
  }
  const apiKeyHeader = request.headers.get("x-api-key");
  if (apiKeyHeader) return apiKeyHeader.trim() || null;
  return null;
}

/** Derive the stable lookup prefix for an API key (first 8 chars). */
export function deriveKeyPrefix(rawKey: string): string {
  return rawKey.slice(0, API_KEY_PREFIX_LENGTH);
}

/** True when rawKey matches either the standardized format or documented creation format. */
export function isValidApiKeyFormat(rawKey: string | null | undefined): boolean {
  return validateKeyFormat(rawKey);
}

/** Throw unless rawKey matches the documented creation format. */
export function assertValidApiKeyFormat(rawKey: string): void {
  if (!isValidApiKeyFormat(rawKey)) {
    throw new Error(
      `Invalid API key format: expected "op_{env}_{32_hex_bytes}_{4_byte_crc}" ` +
      `with valid CRC-32 checksum.`
    );
  }
}

/**
 * Generate a new API key: `op_{env}_{32_hex_bytes}_{4_byte_crc}`
 */
export function generateApiKey(
  env: "live" | "test" = process.env.NODE_ENV === "production" ? "live" : "test",
  randomBytesFn?: (n: number) => Buffer | Uint8Array
): string {
  let hex: string;
  if (randomBytesFn) {
    hex = Buffer.from(randomBytesFn(API_KEY_RANDOM_BYTES)).toString("hex");
  } else if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(API_KEY_RANDOM_BYTES);
    crypto.getRandomValues(bytes);
    hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  } else {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodeCrypto = require("crypto");
    hex = nodeCrypto.randomBytes(API_KEY_RANDOM_BYTES).toString("hex");
  }

  const payload = `op_${env}_${hex}`;
  const crc = computeCrcHex(payload);
  const key = `${payload}_${crc}`;
  assertValidApiKeyFormat(key);
  return key;
}
