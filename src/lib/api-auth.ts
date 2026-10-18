// SPDX-License-Identifier: MIT

import crypto from "crypto";
import argon2 from "argon2";
import prisma from "@/lib/prisma";
import { unauthorizedError, forbiddenError } from "@/lib/api-response";
import { NextResponse } from "next/server";

// ── Scopes ─────────────────────────────────────────────────────
//
// Scope constants and hasScope live in @/lib/api-scopes (client-safe — no
// server-only imports) and are re-exported here so server code keeps a single
// import site. Client components must import from @/lib/api-scopes directly.

import {
  API_SCOPES,
  ADMIN_SCOPE,
  hasScope,
  type ApiScope,
} from "@/lib/api-scopes";

export {
  API_SCOPES,
  ADMIN_SCOPE,
  hasScope,
  type ApiScope,
};

/**
 * Consolidated API authentication module — single source of truth.
 *
 * Supports:
 *   • Authorization: Bearer <api_key>
 *   • X-API-Key: <api_key>
 *
 * Uses an indexed DB lookup (hash + prefix) — O(1) regardless of key count,
 * unlike the previous pattern that fetched every key and compared in-app.
 */

// ── Key format (#1397) ─────────────────────────────────────────

export * from "@/lib/api-key-format";
import {
  API_KEY_RANDOM_BYTES,
  API_KEY_DIGEST_VERSION,
  API_KEY_LOOKUP_PATTERN,
  calculateCrc32,
  assertValidApiKeyFormat,
  validateKeyFormat,
  deriveKeyPrefix,
} from "@/lib/api-key-format";

/**
 * Generate a new standardized API key: `op_{env}_{32_hex_bytes}_{4_byte_crc}` (#1397).
 * Defaults to `live` in production and `test` in development/testing.
 */
export function generateApiKey(options?: { env?: "live" | "test" }): string {
  const env =
    options?.env ??
    (process.env.NODE_ENV === "production" ? "live" : "test");
  const randomHex = crypto
    .randomBytes(API_KEY_RANDOM_BYTES)
    .toString("hex");
  const payload = `op_${env}_${randomHex}`;
  const crc = calculateCrc32(payload);
  const rawKey = `${payload}_${crc}`;
  assertValidApiKeyFormat(rawKey);
  return rawKey;
}

// ── Hashing ────────────────────────────────────────────────────

/**
 * Standard slow KDF digest version (#1287): Argon2id.
 */
export const API_KEY_DIGEST_VERSION_V2 = "v2";

/** Minimum required entropy for API keys: 32 bytes (256-bit entropy) (#1287). */
export const MIN_API_KEY_ENTROPY_BYTES = 32;

/**
 * Legacy digest: unsalted SHA-256 hex. Retained so keys created before the
 * `v1:` tag (and before the 32-byte format) continue to authenticate.
 */
export function hashApiKey(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

/**
 * Previous digest: `v1:<sha256 hex>`. The version tag is stored in the same
 * `keyHash` column, so a future pepper/KDF migration has somewhere to live
 * without a schema change — older digests keep authenticating meanwhile.
 */
export function hashApiKeyV1(rawKey: string): string {
  return `${API_KEY_DIGEST_VERSION}:${hashApiKey(rawKey)}`;
}

/**
 * Derive a unique, deterministic 16-byte salt for an API key (#1287).
 * Ensures unique salt per credential while maintaining O(1) indexed database lookups.
 */
export function deriveApiKeySalt(rawKey: string): Buffer {
  return crypto
    .createHash("sha256")
    .update(`${rawKey}:ophirpay:salt:v2`)
    .digest()
    .subarray(0, 16);
}

/**
 * Current standard slow KDF digest: `v2:$argon2id$...` (#1287).
 * Uses Argon2id memory-hard hashing with a per-key salt, resistant to GPU/ASIC brute-force.
 */
export async function hashApiKeyV2(rawKey: string): Promise<string> {
  const salt = deriveApiKeySalt(rawKey);
  const digest = await argon2.hash(rawKey, {
    type: argon2.argon2id,
    salt,
    memoryCost: 4096, // 4MB RAM per hash
    timeCost: 2,      // 2 iterations
    parallelism: 1,
  });
  return `${API_KEY_DIGEST_VERSION_V2}:${digest}`;
}

/**
 * Verify a raw API key against a stored keyHash (#1287).
 * Supports:
 *   - v2 Argon2id: `v2:$argon2id$...` or `$argon2id$...`
 *   - v1 tagged SHA-256: `v1:<hex>`
 *   - legacy bare SHA-256: `<hex>`
 */
export async function verifyApiKeyDigest(
  rawKey: string,
  storedHash: string
): Promise<boolean> {
  if (!storedHash || typeof storedHash !== "string") return false;

  if (storedHash.startsWith("v2:")) {
    const rawArgon = storedHash.slice(3);
    try {
      return await argon2.verify(rawArgon, rawKey);
    } catch {
      return false;
    }
  }

  if (storedHash.startsWith("$argon2id$")) {
    try {
      return await argon2.verify(storedHash, rawKey);
    } catch {
      return false;
    }
  }

  if (storedHash.startsWith("v1:")) {
    const expected = hashApiKeyV1(rawKey);
    if (storedHash.length !== expected.length) return false;
    return crypto.timingSafeEqual(
      Buffer.from(storedHash),
      Buffer.from(expected)
    );
  }

  // Legacy bare 64-character SHA-256
  const expected = hashApiKey(rawKey);
  if (storedHash.length !== expected.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(storedHash),
    Buffer.from(expected)
  );
}

/**
 * Verify minimum entropy for an API key (#1287).
 * Standardized keys must contain at least 32 CSPRNG bytes (64 hex characters = 256 bits).
 */
export function validateKeyEntropy(rawKey: string): {
  valid: boolean;
  entropyBytes: number;
  error?: string;
} {
  if (!rawKey || typeof rawKey !== "string") {
    return { valid: false, entropyBytes: 0, error: "API key must be a non-empty string" };
  }

  const trimmed = rawKey.trim();

  // Match standardized format: op_{env}_{entropy_hex}_{crc}
  const stdMatch = /^op_(?:live|test)_([0-9a-fA-F]+)_[0-9a-fA-F]{8}$/.exec(trimmed);
  if (stdMatch && stdMatch[1]) {
    const hexLen = stdMatch[1].length;
    const bytes = hexLen / 2;
    if (bytes < MIN_API_KEY_ENTROPY_BYTES) {
      return {
        valid: false,
        entropyBytes: bytes,
        error: `API key entropy below minimum requirement: ${bytes} bytes provided, minimum ${MIN_API_KEY_ENTROPY_BYTES} bytes required`,
      };
    }
    return { valid: true, entropyBytes: bytes };
  }

  // Match legacy prefix: oph_{entropy_hex}
  const legMatch = /^oph_([0-9a-fA-F]+)$/.exec(trimmed);
  if (legMatch && legMatch[1]) {
    const hexLen = legMatch[1].length;
    const bytes = hexLen / 2;
    if (bytes < MIN_API_KEY_ENTROPY_BYTES) {
      return {
        valid: false,
        entropyBytes: bytes,
        error: `API key entropy below minimum requirement: ${bytes} bytes provided, minimum ${MIN_API_KEY_ENTROPY_BYTES} bytes required`,
      };
    }
    return { valid: true, entropyBytes: bytes };
  }

  const rawBytes = Buffer.byteLength(trimmed, "utf8");
  if (rawBytes < MIN_API_KEY_ENTROPY_BYTES) {
    return {
      valid: false,
      entropyBytes: rawBytes,
      error: `API key entropy below minimum requirement: ${rawBytes} bytes provided, minimum ${MIN_API_KEY_ENTROPY_BYTES} bytes required`,
    };
  }

  return { valid: true, entropyBytes: rawBytes };
}

/** Throw an error if rawKey does not meet the minimum entropy requirement (#1287). */
export function assertMinimumKeyEntropy(rawKey: string): void {
  const result = validateKeyEntropy(rawKey);
  if (!result.valid) {
    throw new Error(result.error);
  }
}

/**
 * Synchronous lookup hashes for backward compatibility with v1 and legacy SHA-256.
 */
export function apiKeyLookupHashes(rawKey: string): string[] {
  return [hashApiKeyV1(rawKey), hashApiKey(rawKey)];
}

/**
 * Asynchronous lookup hashes: newest Argon2id v2 format first, followed by v1 and legacy (#1287).
 */
export async function apiKeyLookupHashesV2(rawKey: string): Promise<string[]> {
  const v2 = await hashApiKeyV2(rawKey);
  return [v2, ...apiKeyLookupHashes(rawKey)];
}

/**
 * Migrate an API key to Argon2id v2 during the migration window (#1287).
 */
export async function migrateApiKeyToV2(
  keyId: string,
  rawKey: string
): Promise<string> {
  const v2Hash = await hashApiKeyV2(rawKey);
  await prisma.apiKey.update({
    where: { id: keyId },
    data: { keyHash: v2Hash },
  });
  return v2Hash;
}

// ── Header Extraction ──────────────────────────────────────────

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

// ── Core Authentication ────────────────────────────────────────

export interface AuthResult {
  userId: string;
  keyId: string;
  keyName: string;
  scopes: string[];
}

/**
 * Authenticate a request against stored API keys.
 *
 * Uses an indexed lookup on (keyHash, prefix) so the query hits an index
 * rather than scanning every row — safe at any key volume.
 */
export async function authenticateRequest(
  request: Request
): Promise<AuthResult | null> {
  const rawKey = extractApiKey(request);
  if (!rawKey) return null;
  // Reject obviously malformed material before hitting the database (#1397).
  // Accepts standardized format with verified CRC, plus legacy formats.
  const isStandardValid = validateKeyFormat(rawKey).valid;
  const isLegacyValid = API_KEY_LOOKUP_PATTERN.test(rawKey);
  if (!isStandardValid && !isLegacyValid) return null;

  const prefix = deriveKeyPrefix(rawKey);
  // Standard keys query Argon2id v2 first, then fallback to v1 & legacy SHA-256.
  // Legacy formats query existing SHA-256 digests.
  const keyHashes = isStandardValid
    ? await apiKeyLookupHashesV2(rawKey)
    : apiKeyLookupHashes(rawKey);

  try {
    const apiKey = await prisma.apiKey.findFirst({
      where: { keyHash: { in: keyHashes }, prefix, revokedAt: null },
      select: {
        id: true,
        userId: true,
        name: true,
        expiresAt: true,
        scopes: true,
      },
    });

    if (!apiKey) return null;

    // Check expiration
    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) return null;

    // Update lastUsed — fire-and-forget so auth latency is not gated on this write
    prisma.apiKey
      .update({ where: { id: apiKey.id }, data: { lastUsed: new Date() } })
      .catch(() => {});
    prisma.apiKeyRequestLog
      .create({ data: { keyId: apiKey.id } })
      .catch(() => {});

    return {
      userId: apiKey.userId,
      keyId: apiKey.id,
      keyName: apiKey.name,
      scopes: apiKey.scopes ?? [],
    };
  } catch {
    // DB unavailable — reject rather than fail open
    return null;
  }
}

// ── Route Helpers ──────────────────────────────────────────────

/**
 * Middleware wrapper: gate an entire route handler behind API-key auth.
 * Use when the handler does not need to know *which* key was used.
 *
 *   export const GET = withApiAuth(async (req) => { … });
 */
export function withApiAuth(
  handler: (request: Request, ...args: unknown[]) => Promise<Response>,
  required?: ApiScope | ApiScope[]
) {
  return async (request: Request, ...args: unknown[]): Promise<Response> => {
    // Scope-enforced variant
    if (required) {
      const auth = await requireScopes(request, required);
      if (!("userId" in auth)) return auth; // auth is a 401/403 Response
      return handler(request, ...args);
    }

    const auth = await authenticateRequest(request);
    if (!auth) {
      return unauthorizedError(
        "Valid API key required. Use Authorization: Bearer <key> or X-API-Key header."
      );
    }
    return handler(request, ...args);
  };
}

/**
 * Authenticate *and* verify the request's API key carries the required scope(s).
 *
 * Returns the `AuthResult` on success, or a 401/403 `NextResponse` on failure.
 * Check the result with `if (!("userId" in auth)) return auth;` before using it.
 *
 *   const auth = await requireScopes(request, "read:payments");
 *   if (!("userId" in auth)) return auth;   // 401/403 Response
 *   // auth.userId / auth.scopes available
 */
export async function requireScopes(
  request: Request,
  required: ApiScope | ApiScope[]
): Promise<AuthResult | NextResponse> {
  const auth = await authenticateRequest(request);
  if (!auth) {
    return unauthorizedError(
      "Valid API key required. Use Authorization: Bearer <key> or X-API-Key header."
    );
  }

  const requiredList = Array.isArray(required) ? required : [required];
  if (!hasScope(auth.scopes, requiredList)) {
    return forbiddenError(
      `This API key lacks the required scope(s): ${requiredList.join(", ")}. ` +
        `Its effective scopes are: ${auth.scopes.length ? auth.scopes.join(", ") : "(none)"}`,
      { required: requiredList, has: auth.scopes }
    );
  }

  return auth;
}

/**
 * Require authentication and return user context to the caller.
 * Use inside a route handler when you need the authenticated user's identity.
 *
 *   const auth = await requireAuth(request);
 *   if (!("userId" in auth)) return auth;          // auth is an error Response
 *   const { userId } = auth;                       // auth is { userId, keyId }
 */
export async function requireAuth(
  request: Request
): Promise<{ userId: string; keyId: string } | NextResponse> {
  const auth = await authenticateRequest(request);
  if (!auth) {
    return unauthorizedError(
      "Valid API key required. Provide Authorization: Bearer <key> or X-API-Key header."
    );
  }
  return { userId: auth.userId, keyId: auth.keyId };
}
