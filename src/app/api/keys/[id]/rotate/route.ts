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
import { deriveKeyPrefix } from "@/lib/api-auth";
import { withRequestLogging } from "@/lib/request-logging";
import { verifyCsrf } from "@/lib/csrf";

export const DEFAULT_OVERLAP_WINDOW_SECONDS = 86400; // 24 hours

/**
 * POST /api/keys/[id]/rotate
 *
 * Rotates an existing API key:
 * 1. Generates a new replacement key with identical scopes.
 * 2. Sets an overlap grace window during which both the old and new keys authenticate.
 * 3. Records the superseded relationship between the old and new keys.
 * 4. Logs the rotation in the AuditLog.
 * 5. Returns the new plain text key once to the caller.
 */
export const POST = withMetrics(
  "POST /api/keys/[id]/rotate",
  withRequestLogging(async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
  ) {
    try {
      const csrfError = verifyCsrf(request);
      if (csrfError) return csrfError;

      const auth = await getAuthContext(request);
      if (!auth) return unauthorizedError("Authentication required.");

      const { id } = await params;
      if (!id) return badRequestError("Key ID is required");

      const existingKey = await prisma.apiKey.findFirst({
        where: { id, userId: auth.userId },
        select: {
          id: true,
          name: true,
          prefix: true,
          scopes: true,
          supersededById: true,
          rotationExpiresAt: true,
          revokedAt: true,
        },
      });

      if (!existingKey) return badRequestError("Key not found");

      if (existingKey.revokedAt) {
        return badRequestError("Cannot rotate a revoked API key");
      }

      if (existingKey.supersededById) {
        const isStillOverlapping =
          existingKey.rotationExpiresAt && existingKey.rotationExpiresAt > new Date();
        if (isStillOverlapping) {
          return badRequestError("Key is already undergoing an active rotation overlap");
        }
        return badRequestError("Key has already been rotated");
      }

      const body = (await request.json().catch(() => ({}))) as {
        name?: string;
        overlapWindowSeconds?: number;
      };

      let overlapWindowSeconds = DEFAULT_OVERLAP_WINDOW_SECONDS;
      if (typeof body.overlapWindowSeconds === "number") {
        if (body.overlapWindowSeconds < 60 || body.overlapWindowSeconds > 2592000) {
          return badRequestError(
            "overlapWindowSeconds must be between 60 (1 minute) and 2592000 (30 days)"
          );
        }
        overlapWindowSeconds = body.overlapWindowSeconds;
      }

      const newKeyName =
        typeof body.name === "string" && body.name.trim()
          ? body.name.trim()
          : `${existingKey.name} (rotated)`;

      const rawKey = `oph_${crypto.randomBytes(24).toString("hex")}`;
      const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
      const prefix = deriveKeyPrefix(rawKey);

      // Create new key with identical scopes
      const newKey = await prisma.apiKey.create({
        data: {
          name: newKeyName,
          keyHash,
          prefix,
          userId: auth.userId,
          scopes: existingKey.scopes,
        },
      });

      const rotationExpiresAt = new Date(Date.now() + overlapWindowSeconds * 1000);

      // Update old key to link to replacement key and set overlap expiration
      await prisma.apiKey.update({
        where: { id: existingKey.id },
        data: {
          supersededById: newKey.id,
          rotationExpiresAt,
        },
      });

      // Record in AuditLog
      await prisma.auditLog
        .create({
          data: {
            action: "api-key:rotate",
            actor: auth.userId,
            target: existingKey.id,
            details: {
              oldKeyId: existingKey.id,
              newKeyId: newKey.id,
              newKeyPrefix: prefix,
              scopes: existingKey.scopes,
              overlapWindowSeconds,
              rotationExpiresAt: rotationExpiresAt.toISOString(),
            },
          },
        })
        .catch(() => {});

      logger.info("API key rotated", {
        oldKeyId: existingKey.id,
        newKeyId: newKey.id,
        overlapExpiresAt: rotationExpiresAt.toISOString(),
      });

      return successResponse(
        {
          newKey: {
            id: newKey.id,
            name: newKey.name,
            prefix: newKey.prefix,
            scopes: newKey.scopes,
            key: rawKey,
          },
          oldKey: {
            id: existingKey.id,
            name: existingKey.name,
            prefix: existingKey.prefix,
            supersededById: newKey.id,
            rotationExpiresAt: rotationExpiresAt.toISOString(),
          },
          overlapExpiresAt: rotationExpiresAt.toISOString(),
          overlapWindowSeconds,
        },
        undefined,
        201
      );
    } catch (err) {
      return handleApiError(err, "POST /api/keys/[id]/rotate");
    }
  })
);
