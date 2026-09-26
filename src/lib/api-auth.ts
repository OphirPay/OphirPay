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

// ── Key format ─────────────────────────────────────────────────

/**
 * Length of the API key prefix used for indexed lookups + display.
 * MUST be identical in key creation (src/app/api/keys/route.ts) and
 * lookup here — a mismatch silently breaks every authenticated request.
 */
export const API_KEY_PREFIX_LENGTH = 8;

/** Prefix every OphirPay API key starts with. */
export const API_KEY_PREFIX = "oph_";

/**
 * Number of CSPRNG bytes in the random portion of a key (issue #701).
 * 32 bytes = 256 bits of entropy, which keeps the stored digest out of reach
 * of an offline brute-force even if the database leaks.
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
 * The documented key format: `oph_` + 64 lowercase hex characters
 * (32 CSPRNG bytes). Matched by the creation path.
 */
export const API_KEY_PATTERN = new RegExp(
  `^${API_KEY_PREFIX}[0-9a-f]{${API_KEY_RANDOM_HEX_LENGTH}}$`
);

/**
 * Shapes accepted at *auth* time: the current 32-byte format plus the legacy
 * 24-byte format. Anything else is rejected before touching the database.
 */
export const API_KEY_LOOKUP_PATTERN = new RegExp(
  `^${API_KEY_PREFIX}(?:[0-9a-f]{${API_KEY_LEGACY_HEX_LENGTH}}|[0-9a-f]{${API_KEY_RANDOM_HEX_LENGTH}})$`
);

/** Digests are stored version-tagged so a future KDF migration can be staged. */
export const API_KEY_DIGEST_VERSION = "v1";

/** Derive the stable lookup prefix for a raw API key. */
export function deriveKeyPrefix(rawKey: string): string {
  return rawKey.slice(0, API_KEY_PREFIX_LENGTH);
}

/** True when `rawKey` matches the documented creation format. */
export function isValidApiKeyFormat(
  rawKey: string | null | undefined
): boolean {
  return typeof rawKey === "string" && API_KEY_PATTERN.test(rawKey);
}

/** Throw unless `rawKey` matches the documented creation format. */
export function assertValidApiKeyFormat(rawKey: string): void {
  if (!isValidApiKeyFormat(rawKey)) {
    throw new Error(
      `Invalid API key format: expected "${API_KEY_PREFIX}" followed by ` +
        `${API_KEY_RANDOM_HEX_LENGTH} hex characters ` +
        `(${API_KEY_RANDOM_BYTES} CSPRNG bytes).`
    );
  }
}

/**
 * Generate a new API key: `oph_` + 32 CSPRNG bytes as lowercase hex.
 * Fails closed if the generated value ever drifts from the documented format
 * (e.g. a stubbed `crypto.randomBytes` in a test or a future refactor).
 */
export function generateApiKey(): string {
  const rawKey = `${API_KEY_PREFIX}${crypto
    .randomBytes(API_KEY_RANDOM_BYTES)
    .toString("hex")}`;
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

export type AuthRejectionReason =
  | "missing"
  | "malformed"
  | "not_found"
  | "revoked"
  | "expired"
  | "rotation_expired"
  | "db_error";

export interface DetailedAuthResult {
  ok: boolean;
  auth?: AuthResult;
  reason?: AuthRejectionReason;
  errorMessage?: string;
  keyId?: string;
  rotatedToId?: string | null;
}

/**
 * Authenticate a request against stored API keys with detailed reason tracking.
 * Supports zero-downtime key rotation: keys in their overlap grace window authenticate,
 * while expired or rotated-out keys surface the precise rejection reason.
 */
export async function authenticateRequestDetailed(
  request: Request
): Promise<DetailedAuthResult> {
  const rawKey = extractApiKey(request);
  if (!rawKey) {
    return {
      ok: false,
      reason: "missing",
      errorMessage:
        "Valid API key required. Use Authorization: Bearer <key> or X-API-Key header.",
    };
  }
  if (!API_KEY_LOOKUP_PATTERN.test(rawKey)) {
    return {
      ok: false,
      reason: "malformed",
      errorMessage: "Malformed API key format.",
    };
  }

  const prefix = deriveKeyPrefix(rawKey);
  const keyHashes = apiKeyLookupHashes(rawKey);

  try {
    const apiKey = await prisma.apiKey.findFirst({
      where: { keyHash: { in: keyHashes }, prefix },
      select: {
        id: true,
        userId: true,
        name: true,
        expiresAt: true,
        scopes: true,
        rotationExpiresAt: true,
        rotatedToId: true,
        revokedAt: true,
      },
    });

    if (!apiKey) {
      return {
        ok: false,
        reason: "not_found",
        errorMessage: "API key not found or invalid.",
      };
    }

    // Check explicit revocation
    if (apiKey.revokedAt) {
      return {
        ok: false,
        keyId: apiKey.id,
        reason: "revoked",
        errorMessage: "This API key has been revoked.",
      };
    }

    // Check normal expiration
    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      return {
        ok: false,
        keyId: apiKey.id,
        reason: "expired",
        errorMessage: "This API key has expired.",
      };
    }

    // Check rotation overlap expiration
    if (apiKey.rotationExpiresAt && apiKey.rotationExpiresAt < new Date()) {
      return {
        ok: false,
        keyId: apiKey.id,
        rotatedToId: apiKey.rotatedToId,
        reason: "rotation_expired",
        errorMessage:
          "This API key was rotated out and its overlap window has expired. Please use the replacement key.",
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
      reason: "db_error",
      errorMessage: "Authentication service temporarily unavailable.",
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
  const result = await authenticateRequestDetailed(request);
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

    const detailed = await authenticateRequestDetailed(request);
    if (!detailed.ok || !detailed.auth) {
      return unauthorizedError(
        detailed.errorMessage ||
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
  const detailed = await authenticateRequestDetailed(request);
  if (!detailed.ok || !detailed.auth) {
    return unauthorizedError(
      detailed.errorMessage ||
        "Valid API key required. Use Authorization: Bearer <key> or X-API-Key header."
    );
  }
  const auth = detailed.auth;

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
  const detailed = await authenticateRequestDetailed(request);
  if (!detailed.ok || !detailed.auth) {
    return unauthorizedError(
      detailed.errorMessage ||
        "Valid API key required. Provide Authorization: Bearer <key> or X-API-Key header."
    );
  }
  return { userId: detailed.auth.userId, keyId: detailed.auth.keyId };
}
