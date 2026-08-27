// SPDX-License-Identifier: MIT

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
import { deriveKeyPrefix } from "@/lib/api-auth";
import { withRequestLogging } from "@/lib/request-logging";

/**
 * GET /api/keys — list the authenticated user's API keys (no hashes).
 */
export const GET = withRequestLogging(async function GET(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedError("Authentication required.");

    const keys = await prisma.apiKey.findMany({
      where: { userId: auth.userId },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, prefix: true, lastUsed: true, createdAt: true, expiresAt: true },
    });
    return successResponse(keys);
  } catch (err) {
    return handleApiError(err, "GET /api/keys");
  }
});

/**
 * POST /api/keys — generate a new API key for the authenticated user.
 * The raw key is returned only once; only the hash is stored.
 */
export const POST = withRequestLogging(async function POST(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedError("Authentication required.");

    const { name } = await request.json() as { name?: string };
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return badRequestError("Name is required");
    }

    const rawKey = `oph_${crypto.randomBytes(24).toString("hex")}`;
    const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
    const prefix = deriveKeyPrefix(rawKey);

    const apiKey = await prisma.apiKey.create({
      data: { name: name.trim(), keyHash, prefix, userId: auth.userId },
    });

    logger.info("API key generated", { id: apiKey.id, name });

    return successResponse(
      { id: apiKey.id, name: apiKey.name, prefix, key: rawKey },
      undefined,
      201
    );
  } catch (err) {
    return handleApiError(err, "POST /api/keys");
  }
});

/**
 * DELETE /api/keys?id=... — revoke one of the authenticated user's keys.
 */
export const DELETE = withRequestLogging(async function DELETE(request: Request) {
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
});
