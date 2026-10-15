// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";

import prisma from "@/lib/prisma";
import {
  successResponse,
  badRequestError,
  unauthorizedError,
  rateLimitError,
  handleApiError,
} from "@/lib/api-response";
import {
  checkApiKeyRateLimit,
  getRetryAfterSeconds,
  API_KEY_RATE_LIMIT_OPERATIONS_PER_HOUR,
  MAX_ACTIVE_API_KEYS_PER_USER,
} from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { getAuthContext } from "@/lib/auth-session";
import {
  deriveKeyPrefix,
  generateApiKey,
  hashApiKeyV1,
  API_SCOPES,
} from "@/lib/api-auth";
import { withRequestLogging } from "@/lib/request-logging";
import { verifyCsrf } from "@/lib/csrf";

/** Validate an array of scopes against the known set. */
function parseScopes(input: unknown): {
  ok: boolean;
  scopes: string[];
  error?: string;
} {
  if (input === undefined || input === null) return { ok: true, scopes: [] };
  if (!Array.isArray(input)) {
    return { ok: false, scopes: [], error: "scopes must be an array" };
  }
  const known = new Set<string>(API_SCOPES);
  for (const s of input) {
    if (typeof s !== "string" || !known.has(s)) {
      return {
        ok: false,
        scopes: [],
        error: `Unknown scope: ${String(s)}. Allowed: ${API_SCOPES.join(", ")}`,
      };
    }
  }
  // Deduplicate while preserving order
  return { ok: true, scopes: Array.from(new Set(input as string[])) };
}

/**
 * GET /api/keys — list the authenticated user's API keys (no hashes).
 */
export const GET = withMetrics("GET /api/keys", withRequestLogging(async function GET(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedError("Authentication required.");

    const keys = await prisma.apiKey.findMany({
      where: { userId: auth.userId, revokedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        prefix: true,
        scopes: true,
        lastUsed: true,
        createdAt: true,
        expiresAt: true,
        revokedAt: true,
        rotatedAt: true,
        rotatedToId: true,
      },
    });
    return successResponse(keys);
  } catch (err) {
    return handleApiError(err, "GET /api/keys");
  }
}));

/**
 * POST /api/keys — generate a new API key for the authenticated user.
 * The raw key is returned only once; only the hash is stored.
 * Accepts an optional `scopes` array to restrict what the key can do.
 */
export const POST = withMetrics("POST /api/keys", withRequestLogging(async function POST(request: Request) {
  try {
    const csrfError = verifyCsrf(request);
    if (csrfError) return csrfError;

    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedError("Authentication required.");

    // Sliding-window rate limit (10 operations per hour per user/organization)
    const rateLimit = await checkApiKeyRateLimit(auth.userId);
    if (!rateLimit.allowed) {
      const retryAfter = getRetryAfterSeconds(rateLimit);
      return rateLimitError(
        `Rate limit exceeded: maximum ${API_KEY_RATE_LIMIT_OPERATIONS_PER_HOUR} API key operations per hour.`,
        retryAfter,
        {
          "X-RateLimit-Limit": String(API_KEY_RATE_LIMIT_OPERATIONS_PER_HOUR),
          "X-RateLimit-Remaining": String(rateLimit.remaining),
          "X-RateLimit-Reset": String(Math.ceil(rateLimit.resetAt / 1000)),
        }
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      scopes?: unknown;
    };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return badRequestError("Name is required");
    }

    const parsed = parseScopes(body.scopes);
    if (!parsed.ok) {
      return badRequestError(parsed.error ?? "Invalid scopes");
    }

    // Enforce maximum active API key count per account (max 5 active keys)
    const activeKeyCount = await prisma.apiKey.count({
      where: {
        userId: auth.userId,
        revokedAt: null,
      },
    });
    if (activeKeyCount >= MAX_ACTIVE_API_KEYS_PER_USER) {
      return badRequestError(
        `Maximum limit of ${MAX_ACTIVE_API_KEYS_PER_USER} active API keys reached. Revoke an unused key before creating a new one.`
      );
    }

    // `generateApiKey` mints 32 CSPRNG bytes (issue #701) and fails closed if
    // the result ever drifts from the documented `oph_` + 64-hex format.
    const rawKey = generateApiKey();
    const keyHash = hashApiKeyV1(rawKey);
    const prefix = deriveKeyPrefix(rawKey);

    const apiKey = await prisma.apiKey.create({
      data: {
        name,
        keyHash,
        prefix,
        userId: auth.userId,
        scopes: parsed.scopes,
      },
    });

    try {
      await prisma.auditLog.create({
        data: {
          action: "api_key:create",
          actor: auth.userId,
          target: apiKey.id,
          details: {
            name,
            prefix,
            scopes: parsed.scopes,
          },
        },
      });
    } catch (auditErr) {
      logger.warn("Failed to create audit log for api_key:create", {
        error: String(auditErr),
      });
    }

    logger.info("API key generated", {
      id: apiKey.id,
      name,
      scopes: parsed.scopes,
    });

    return successResponse(
      {
        id: apiKey.id,
        name: apiKey.name,
        prefix,
        scopes: parsed.scopes,
        key: rawKey,
      },
      undefined,
      201
    );
  } catch (err) {
    return handleApiError(err, "POST /api/keys");
  }
}));

/**
 * PATCH /api/keys — update the scopes of one of the authenticated user's keys.
 * Body: { id: string, scopes: string[] }
 */
export const PATCH = withMetrics("PATCH /api/keys", __ophir_PATCH);

async function __ophir_PATCH(request: Request) {
  try {
    const csrfError = verifyCsrf(request);
    if (csrfError) return csrfError;

    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedError("Authentication required.");

    const body = (await request.json().catch(() => ({}))) as {
      id?: string;
      scopes?: unknown;
    };
    if (!body.id || typeof body.id !== "string") {
      return badRequestError("Key ID is required");
    }

    const parsed = parseScopes(body.scopes);
    if (!parsed.ok) {
      return badRequestError(parsed.error ?? "Invalid scopes");
    }

    // Scoped update — a user can only modify their own key
    const result = await prisma.apiKey.updateMany({
      where: { id: body.id, userId: auth.userId, revokedAt: null },
      data: { scopes: parsed.scopes },
    });
    if (result.count === 0) return badRequestError("Key not found");

    return successResponse({ id: body.id, scopes: parsed.scopes });
  } catch (err) {
    return handleApiError(err, "PATCH /api/keys");
  }
}

/**
 * DELETE /api/keys?id=... — revoke one of the authenticated user's keys.
 */
export const DELETE = withMetrics("DELETE /api/keys", withRequestLogging(async function DELETE(request: Request) {
  try {
    const csrfError = verifyCsrf(request);
    if (csrfError) return csrfError;

    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedError("Authentication required.");

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return badRequestError("Key ID is required");

    // Scoped delete — a user can only revoke their own key
    const result = await prisma.apiKey.updateMany({
      where: { id, userId: auth.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count === 0) return badRequestError("Key not found");

    try {
      await prisma.auditLog.create({
        data: {
          action: "api_key:revoke",
          actor: auth.userId,
          target: id,
        },
      });
    } catch (auditErr) {
      logger.warn("Failed to create audit log for api_key:revoke", {
        error: String(auditErr),
      });
    }

    return successResponse({ deleted: true });
  } catch (err) {
    return handleApiError(err, "DELETE /api/keys");
  }
}));
