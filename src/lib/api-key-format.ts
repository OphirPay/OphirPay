// SPDX-License-Identifier: MIT
// Issue #1397 — API key minimum entropy check and cryptographically secure format.
// Edge-safe pure module: zero Node/DB dependencies so it can run on Edge middleware.

// ── CRC32 & Key format (#1397) ────────────────────────────────

// Precomputed IEEE 802.3 CRC32 lookup table (edge & node runtime safe)
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[i] = c >>> 0;
}

/**
 * Calculate IEEE 802.3 CRC32 checksum as 8 lowercase hex characters.
 * Works uniformly in Node.js and Edge runtimes without native dependencies.
 */
export function calculateCrc32(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]!) & 0xff];
  }
  const finalCrc = (crc ^ 0xffffffff) >>> 0;
  return finalCrc.toString(16).padStart(8, "0");
}

function timingSafeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Length of the API key prefix used for indexed lookups + display.
 */
export const API_KEY_PREFIX_LENGTH = 8;

/** Prefix every OphirPay API key started with (legacy compatibility). */
export const API_KEY_PREFIX = "oph_";

/** Standardized key prefix (#1397). */
export const STANDARDIZED_KEY_PREFIX = "op_";

/**
 * Number of CSPRNG bytes in the random portion of a key (issue #701, #1397).
 * 32 bytes = 256 bits of entropy.
 */
export const API_KEY_RANDOM_BYTES = 32;

/** Lowercase hex characters produced by `API_KEY_RANDOM_BYTES`. */
export const API_KEY_RANDOM_HEX_LENGTH = API_KEY_RANDOM_BYTES * 2;

/**
 * Hex length of keys minted before issue #701 (24 CSPRNG bytes / 192 bits).
 * Recognized at auth time so those keys keep working after the upgrade.
 */
export const API_KEY_LEGACY_HEX_LENGTH = 48;

/**
 * Standardized API key format (#1397):
 * `op_{env}_{32_hex_bytes}_{4_byte_crc}`
 */
export const API_KEY_PATTERN = /^op_(?:live|test)_[0-9a-f]{64}_[0-9a-f]{8}$/;

/**
 * Legacy key pattern for keys created before #1397.
 */
export const API_KEY_LEGACY_PATTERN = new RegExp(
  `^${API_KEY_PREFIX}[0-9a-f]{${API_KEY_RANDOM_HEX_LENGTH}}$`
);

/**
 * Shapes accepted at auth time: standardized format with CRC plus legacy formats.
 */
export const API_KEY_LOOKUP_PATTERN = new RegExp(
  `^(?:op_(?:live|test)_[0-9a-f]{32,64}_[0-9a-f]{8}|oph_(?:[0-9a-f]{${API_KEY_LEGACY_HEX_LENGTH}}|[0-9a-f]{${API_KEY_RANDOM_HEX_LENGTH}}))$`
);

/** Digests are stored version-tagged so a future KDF migration can be staged. */
export const API_KEY_DIGEST_VERSION = "v1";

/** Derive the stable lookup prefix for a raw API key (first 8 chars). */
export function deriveKeyPrefix(rawKey: string): string {
  return rawKey.slice(0, API_KEY_PREFIX_LENGTH);
}

export interface KeyValidationResult {
  valid: boolean;
  env?: "live" | "test";
  error?: string;
}

/**
 * Validate an API key's prefix, entropy length, and CRC checksum (#1397).
 * Fast, pure check suitable for edge middleware to reject malformed keys
 * before performing database lookups.
 */
export function validateKeyFormat(
  rawKey: string | null | undefined
): KeyValidationResult {
  if (!rawKey || typeof rawKey !== "string") {
    return { valid: false, error: "API key must be a non-empty string" };
  }

  const trimmed = rawKey.trim();
  const match = /^op_(live|test)_([0-9a-fA-F]{32,64})_([0-9a-fA-F]{8})$/.exec(trimmed);
  if (!match) {
    return {
      valid: false,
      error: 'Malformed API key: expected format "op_{env}_{32_hex_bytes}_{4_byte_crc}"',
    };
  }

  const env = match[1] as "live" | "test";
  const entropy = match[2]!.toLowerCase();
  const providedCrc = match[3]!.toLowerCase();

  // Minimum entropy verification (#1397): at least 32 hex characters (128-bit min), standard 64 hex chars (256-bit)
  if (entropy.length < 32) {
    return { valid: false, error: "API key entropy below minimum requirement" };
  }

  // Verify CRC32 checksum over payload prefix: op_{env}_{entropy}
  const payload = `op_${env}_${entropy}`;
  const expectedCrc = calculateCrc32(payload);

  if (!timingSafeHexEqual(providedCrc, expectedCrc)) {
    return { valid: false, error: "Invalid API key CRC checksum" };
  }

  return { valid: true, env };
}

/** True when `rawKey` matches the standardized creation format with valid CRC. */
export function isValidApiKeyFormat(
  rawKey: string | null | undefined
): boolean {
  return validateKeyFormat(rawKey).valid;
}

/** Throw unless `rawKey` matches the documented creation format. */
export function assertValidApiKeyFormat(rawKey: string): void {
  const result = validateKeyFormat(rawKey);
  if (!result.valid) {
    throw new Error(
      `Invalid API key format: ${result.error ?? 'expected "op_{env}_{32_hex_bytes}_{4_byte_crc}"'}`
    );
  }
}

/** Extract a raw API key from Authorization: Bearer or X-API-Key headers. */
export function extractApiKey(request: Request): string | null {
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
