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

// ── Hashing ────────────────────────────────────────────────────

/**
 * Length of the API key prefix used for indexed lookups + display.
 * MUST be identical in key creation (src/app/api/keys/route.ts) and
 * lookup here — a mismatch silently breaks every authenticated request.
 */
export const API_KEY_PREFIX_LENGTH = 8;

/** Derive the stable lookup prefix for a raw API key. */
export function deriveKeyPrefix(rawKey: string): string {
  return rawKey.slice(0, API_KEY_PREFIX_LENGTH);
}

/** Hash a raw API key using SHA-256 (sync, Node crypto). */
export function hashApiKey(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
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

export type ApiKeyAuthFailureReason =
  | "MISSING_KEY"
  | "INVALID_KEY"
  | "REVOKED_KEY"
  | "EXPIRED_KEY"
  | "ROTATION_EXPIRED_KEY"
  | "DB_UNAVAILABLE";

export interface ApiKeyAuthDetails {
  ok: boolean;
  auth?: AuthResult;
  reason?: ApiKeyAuthFailureReason;
  message?: string;
  rotationExpiresAt?: Date;
  supersededById?: string;
}

/**
 * Authenticate a request against stored API keys with detailed outcome classification.
 * Supports zero-downtime rotation overlap windows, explicit revocations, and expiry.
 */
export async function authenticateApiKeyDetails(
  request: Request
): Promise<ApiKeyAuthDetails> {
  const rawKey = extractApiKey(request);
  if (!rawKey) {
    return {
      ok: false,
      reason: "MISSING_KEY",
      message:
        "Valid API key required. Use Authorization: Bearer <key> or X-API-Key header.",
    };
  }

  const keyHash = hashApiKey(rawKey);
  const prefix = deriveKeyPrefix(rawKey);

  try {
    const apiKey = await prisma.apiKey.findFirst({
      where: { keyHash, prefix },
      select: {
        id: true,
        userId: true,
        name: true,
        expiresAt: true,
        scopes: true,
        supersededById: true,
        rotationExpiresAt: true,
        revokedAt: true,
      },
    });

    if (!apiKey) {
      return {
        ok: false,
        reason: "INVALID_KEY",
        message: "Invalid API key.",
      };
    }

    // Check explicit revocation
    if (apiKey.revokedAt) {
      return {
        ok: false,
        reason: "REVOKED_KEY",
        message: "This API key has been revoked and cannot be used.",
      };
    }

    // Check normal expiration
    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      return {
        ok: false,
        reason: "EXPIRED_KEY",
        message: "This API key has expired.",
      };
    }

    // Check rotation overlap expiration
    // While now < rotationExpiresAt, the superseded key remains valid (overlap window).
    // Once now >= rotationExpiresAt, the superseded key is rejected with a distinct reason.
    if (apiKey.rotationExpiresAt && apiKey.rotationExpiresAt < new Date()) {
      return {
        ok: false,
        reason: "ROTATION_EXPIRED_KEY",
        message: `This API key was rotated and its overlap grace period expired on ${apiKey.rotationExpiresAt.toISOString()}. Please use the replacement key.`,
        rotationExpiresAt: apiKey.rotationExpiresAt,
        supersededById: apiKey.supersededById ?? undefined,
      };
    }

    // Update lastUsed — fire-and-forget so auth latency is not gated on this write
    prisma.apiKey
      .update({ where: { id: apiKey.id }, data: { lastUsed: new Date() } })
      .catch(() => {});
    prisma.apiKeyRequestLog
      .create({ data: { keyId: apiKey.id } })
      .catch(() => {});

    return {
      ok: true,
      auth: {
        userId: apiKey.userId,
        keyId: apiKey.id,
        keyName: apiKey.name,
        scopes: apiKey.scopes ?? [],
      },
    };
  } catch {
    // DB unavailable — reject rather than fail open
    return {
      ok: false,
      reason: "DB_UNAVAILABLE",
      message: "Authentication service temporarily unavailable.",
    };
  }
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
  const result = await authenticateApiKeyDetails(request);
  return result.ok && result.auth ? result.auth : null;
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

    const details = await authenticateApiKeyDetails(request);
    if (!details.ok || !details.auth) {
      return unauthorizedError(
        details.message ||
          "Valid API key required. Use Authorization: Bearer <key> or X-API-Key header.",
        details.reason ? { reason: details.reason } : undefined
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
  const details = await authenticateApiKeyDetails(request);
  if (!details.ok || !details.auth) {
    return unauthorizedError(
      details.message ||
        "Valid API key required. Use Authorization: Bearer <key> or X-API-Key header.",
      details.reason ? { reason: details.reason } : undefined
    );
  }

  const auth = details.auth;
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
  const details = await authenticateApiKeyDetails(request);
  if (!details.ok || !details.auth) {
    return unauthorizedError(
      details.message ||
        "Valid API key required. Provide Authorization: Bearer <key> or X-API-Key header.",
      details.reason ? { reason: details.reason } : undefined
    );
  }
  return { userId: details.auth.userId, keyId: details.auth.keyId };
}
