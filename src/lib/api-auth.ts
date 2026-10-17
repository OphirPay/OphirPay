// SPDX-License-Identifier: MIT

import crypto from "crypto";
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
 * Legacy digest: unsalted SHA-256 hex. Retained so keys created before the
 * `v1:` tag (and before the 32-byte format) continue to authenticate.
 */
export function hashApiKey(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

/**
 * Current digest: `v1:<sha256 hex>`. The version tag is stored in the same
 * `keyHash` column, so a future pepper/KDF migration has somewhere to live
 * without a schema change — older digests keep authenticating meanwhile.
 */
export function hashApiKeyV1(rawKey: string): string {
  return `${API_KEY_DIGEST_VERSION}:${hashApiKey(rawKey)}`;
}

/**
 * Every stored digest a raw key may match, newest format first. The auth
 * lookup queries `keyHash: { in: … }` with these so pre-#701 keys (bare
 * SHA-256) and post-#701 keys (`v1:` prefixed) both resolve.
 */
export function apiKeyLookupHashes(rawKey: string): string[] {
  return [hashApiKeyV1(rawKey), hashApiKey(rawKey)];
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
  const keyHashes = apiKeyLookupHashes(rawKey);

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
