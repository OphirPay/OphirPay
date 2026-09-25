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

// ── Hashing & Key Format ───────────────────────────────────────

/**
 * Length of the API key prefix used for indexed lookups + display.
 * MUST be identical in key creation (src/app/api/keys/route.ts) and
 * lookup here — a mismatch silently breaks every authenticated request.
 */
export const API_KEY_PREFIX = "oph_";
export const API_KEY_PREFIX_LENGTH = 8;
export const MIN_API_KEY_ENTROPY_BYTES = 32; // Minimum 32 bytes (256 bits) of CSPRNG entropy
export const MIN_API_KEY_HEX_LENGTH = MIN_API_KEY_ENTROPY_BYTES * 2; // 64 hex characters
export const MIN_API_KEY_LENGTH = API_KEY_PREFIX.length + MIN_API_KEY_HEX_LENGTH; // 68 characters

export interface ApiKeyValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Validate that an API key conforms to the minimum entropy and prefix requirements:
 * Must start with `oph_` and contain at least 32 bytes (64 hex characters) of random material.
 */
export function validateApiKeyFormat(rawKey: string): ApiKeyValidationResult {
  if (typeof rawKey !== "string") {
    return { valid: false, reason: "API key must be a string" };
  }
  if (!rawKey.startsWith(API_KEY_PREFIX)) {
    return {
      valid: false,
      reason: `API key must start with prefix '${API_KEY_PREFIX}'`,
    };
  }
  const randomPart = rawKey.slice(API_KEY_PREFIX.length);
  if (randomPart.length < MIN_API_KEY_HEX_LENGTH) {
    return {
      valid: false,
      reason: `API key random material must be at least ${MIN_API_KEY_ENTROPY_BYTES} bytes (${MIN_API_KEY_HEX_LENGTH} hex characters); got ${randomPart.length} chars`,
    };
  }
  if (!/^[0-9a-fA-F]+$/.test(randomPart)) {
    return {
      valid: false,
      reason: "API key random material must contain only valid hexadecimal characters",
    };
  }
  return { valid: true };
}

/**
 * Generate a cryptographically secure random API key with minimum 32 bytes of CSPRNG entropy.
 */
export function generateApiKey(entropyBytes: number = MIN_API_KEY_ENTROPY_BYTES): string {
  const bytes = Math.max(entropyBytes, MIN_API_KEY_ENTROPY_BYTES);
  return `${API_KEY_PREFIX}${crypto.randomBytes(bytes).toString("hex")}`;
}

/** Derive the stable lookup prefix for a raw API key. */
export function deriveKeyPrefix(rawKey: string): string {
  return rawKey.slice(0, API_KEY_PREFIX_LENGTH);
}

/**
 * Server-side pepper for API key hashing.
 * Reads API_KEY_PEPPER or AUTH_SECRET, falling back to a deterministic dev secret.
 */
export function getApiKeyPepper(): string {
  return (
    process.env.API_KEY_PEPPER ||
    process.env.AUTH_SECRET ||
    "ophirpay-default-api-key-pepper-0000000000000000"
  );
}

/** Legacy unpeppered SHA-256 hash (backward compatibility with existing keys). */
export function hashLegacyApiKey(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

/**
 * Hash a raw API key using HMAC-SHA256 with a server-side pepper and a version tag.
 * Stored digest format: `v1$<hex>`
 */
export function hashApiKey(rawKey: string, pepper = getApiKeyPepper()): string {
  const digest = crypto.createHmac("sha256", pepper).update(rawKey).digest("hex");
  return `v1$${digest}`;
}

/**
 * Constant-time comparison between raw key and a stored hash (supporting v1$ and legacy SHA-256).
 */
export function verifyApiKeyHash(
  rawKey: string,
  storedHash: string,
  pepper = getApiKeyPepper(),
): boolean {
  if (storedHash.startsWith("v1$")) {
    const expected = hashApiKey(rawKey, pepper);
    const expectedBuf = Buffer.from(expected);
    const storedBuf = Buffer.from(storedHash);
    return (
      expectedBuf.length === storedBuf.length &&
      crypto.timingSafeEqual(expectedBuf, storedBuf)
    );
  }
  // Legacy plain SHA-256 hash
  const legacyExpected = hashLegacyApiKey(rawKey);
  const expectedBuf = Buffer.from(legacyExpected);
  const storedBuf = Buffer.from(storedHash);
  return (
    expectedBuf.length === storedBuf.length &&
    crypto.timingSafeEqual(expectedBuf, storedBuf)
  );
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
 * Uses an indexed lookup on (prefix, keyHash) supporting both v1 peppered
 * HMAC-SHA256 digests and legacy plain SHA-256 digests so existing API keys
 * keep authenticating without disruption.
 */
export async function authenticateRequest(
  request: Request
): Promise<AuthResult | null> {
  const rawKey = extractApiKey(request);
  if (!rawKey) return null;

  const prefix = deriveKeyPrefix(rawKey);
  const v1Hash = hashApiKey(rawKey);
  const legacyHash = hashLegacyApiKey(rawKey);

  try {
    const apiKey = await prisma.apiKey.findFirst({
      where: {
        prefix,
        keyHash: { in: [v1Hash, legacyHash] },
      },
      select: {
        id: true,
        userId: true,
        name: true,
        keyHash: true,
        expiresAt: true,
        scopes: true,
      },
    });

    if (!apiKey) return null;

    // Check expiration
    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) return null;

    // If key authenticated with legacy SHA-256 hash, transparently migrate to v1 peppered hash
    if (apiKey.keyHash === legacyHash) {
      prisma.apiKey
        .update({
          where: { id: apiKey.id },
          data: { keyHash: v1Hash, lastUsed: new Date() },
        })
        .catch(() => {});
    } else {
      prisma.apiKey
        .update({ where: { id: apiKey.id }, data: { lastUsed: new Date() } })
        .catch(() => {});
    }

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
