// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";

import crypto from "crypto";
import prisma from "@/lib/prisma";
import {
  successResponse,
  badRequestError,
  unauthorizedError,
  handleApiError,
} from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { getAuthContext } from "@/lib/auth-session";
import { deriveKeyPrefix, API_SCOPES } from "@/lib/api-auth";
import { withRequestLogging } from "@/lib/request-logging";

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
      where: { userId: auth.userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        prefix: true,
        scopes: true,
        lastUsed: true,
        createdAt: true,
        expiresAt: true,
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
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedError("Authentication required.");

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

    const rawKey = `oph_${crypto.randomBytes(24).toString("hex")}`;
    const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
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
      where: { id: body.id, userId: auth.userId },
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
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedError("Authentication required.");

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return badRequestError("Key ID is required");

    // Scoped delete — a user can only revoke their own key
    const result = await prisma.apiKey.deleteMany({
      where: { id, userId: auth.userId },
    });
    if (result.count === 0) return badRequestError("Key not found");

    return successResponse({ deleted: true });
  } catch (err) {
    return handleApiError(err, "DELETE /api/keys");
  }
}));
