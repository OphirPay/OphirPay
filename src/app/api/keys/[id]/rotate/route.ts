// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";
import prisma from "@/lib/prisma";
import {
  successResponse,
  badRequestError,
  unauthorizedError,
  handleApiError,
} from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { getAuthContext } from "@/lib/auth-session";
import {
  deriveKeyPrefix,
  generateApiKey,
  hashApiKeyV1,
} from "@/lib/api-auth";
import { withRequestLogging } from "@/lib/request-logging";
import { verifyCsrf } from "@/lib/csrf";

/**
 * Default overlap duration: 24 hours (in milliseconds).
 */
export const DEFAULT_ROTATION_OVERLAP_HOURS = 24;
export const MIN_ROTATION_OVERLAP_HOURS = 1;
export const MAX_ROTATION_OVERLAP_HOURS = 168; // 7 days

export async function rotateApiKey(
  keyId: string,
  userId: string,
  requestedOverlapHours?: number
) {
  let overlapHours = DEFAULT_ROTATION_OVERLAP_HOURS;
  if (typeof requestedOverlapHours === "number" && !isNaN(requestedOverlapHours)) {
    overlapHours = Math.max(
      MIN_ROTATION_OVERLAP_HOURS,
      Math.min(MAX_ROTATION_OVERLAP_HOURS, requestedOverlapHours)
    );
  }

  const oldKey = await prisma.apiKey.findFirst({
    where: { id: keyId, userId },
  });

  if (!oldKey) {
    return { error: "Key not found", status: 404 };
  }

  if (oldKey.revokedAt) {
    return { error: "Cannot rotate a revoked API key", status: 400 };
  }

  if (oldKey.rotationExpiresAt && oldKey.rotationExpiresAt < new Date()) {
    return {
      error: "Cannot rotate an API key whose rotation overlap has already expired",
      status: 400,
    };
  }

  // Generate replacement API key
  const rawKey = generateApiKey();
  const keyHash = hashApiKeyV1(rawKey);
  const prefix = deriveKeyPrefix(rawKey);
  const rotationExpiresAt = new Date(Date.now() + overlapHours * 60 * 60 * 1000);
  const now = new Date();

  // Create new key inheriting identical scopes and name
  const newKey = await prisma.apiKey.create({
    data: {
      userId,
      name: oldKey.name,
      keyHash,
      prefix,
      scopes: oldKey.scopes,
      rotatedFromId: oldKey.id,
    },
  });

  // Mark old key as rotated with overlap expiration
  await prisma.apiKey.update({
    where: { id: oldKey.id },
    data: {
      rotatedAt: now,
      rotationExpiresAt,
      rotatedToId: newKey.id,
    },
  });

  // Audit log emission
  await prisma.auditLog
    .create({
      data: {
        action: "api_key:rotate",
        actor: userId,
        target: oldKey.id,
        details: {
          oldKeyId: oldKey.id,
          newKeyId: newKey.id,
          scopes: oldKey.scopes,
          overlapHours,
          rotationExpiresAt: rotationExpiresAt.toISOString(),
        },
      },
    })
    .catch(() => {});

  logger.info("API key rotated", {
    oldKeyId: oldKey.id,
    newKeyId: newKey.id,
    overlapHours,
    rotationExpiresAt,
  });

  return {
    success: true,
    data: {
      id: newKey.id,
      name: newKey.name,
      prefix,
      scopes: newKey.scopes,
      key: rawKey,
      rotatedFromId: oldKey.id,
      oldKey: {
        id: oldKey.id,
        rotationExpiresAt: rotationExpiresAt.toISOString(),
        overlapHours,
      },
    },
  };
}

/**
 * POST /api/keys/[id]/rotate — rotate an API key by route param.
 */
export const POST = withMetrics(
  "POST /api/keys/[id]/rotate",
  withRequestLogging(async function POST(
    request: Request,
    context?: { params?: Promise<{ id?: string }> | { id?: string } }
  ) {
    try {
      const csrfError = verifyCsrf(request);
      if (csrfError) return csrfError;

      const auth = await getAuthContext(request);
      if (!auth) return unauthorizedError("Authentication required.");

      const resolvedParams = context?.params ? await context.params : {};
      const keyId = resolvedParams.id;
      if (!keyId) return badRequestError("Key ID is required");

      const body = (await request.json().catch(() => ({}))) as {
        overlapHours?: number;
      };

      const result = await rotateApiKey(keyId, auth.userId, body.overlapHours);
      if (result.error) {
        return badRequestError(result.error);
      }

      return successResponse(result.data, undefined, 201);
    } catch (err) {
      return handleApiError(err, "POST /api/keys/[id]/rotate");
    }
  })
);
