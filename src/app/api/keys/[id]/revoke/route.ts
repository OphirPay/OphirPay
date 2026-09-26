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
import { withRequestLogging } from "@/lib/request-logging";
import { verifyCsrf } from "@/lib/csrf";

export async function revokeApiKey(keyId: string, userId: string) {
  const oldKey = await prisma.apiKey.findFirst({
    where: { id: keyId, userId },
  });

  if (!oldKey) {
    return { error: "Key not found", status: 404 };
  }

  const now = new Date();
  await prisma.apiKey.update({
    where: { id: oldKey.id },
    data: {
      revokedAt: now,
      rotationExpiresAt: now,
    },
  });

  await prisma.auditLog
    .create({
      data: {
        action: "api_key:revoke",
        actor: userId,
        target: oldKey.id,
        details: {
          keyId: oldKey.id,
          wasRotating: Boolean(oldKey.rotationExpiresAt),
          revokedAt: now.toISOString(),
        },
      },
    })
    .catch(() => {});

  logger.info("API key revoked", { keyId: oldKey.id, userId });

  return {
    success: true,
    data: {
      id: oldKey.id,
      revoked: true,
      revokedAt: now.toISOString(),
    },
  };
}

/**
 * POST /api/keys/[id]/revoke — immediately revoke a key and cancel any overlap.
 */
export const POST = withMetrics(
  "POST /api/keys/[id]/revoke",
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

      const result = await revokeApiKey(keyId, auth.userId);
      if (result.error) {
        return badRequestError(result.error);
      }

      return successResponse(result.data);
    } catch (err) {
      return handleApiError(err, "POST /api/keys/[id]/revoke");
    }
  })
);
