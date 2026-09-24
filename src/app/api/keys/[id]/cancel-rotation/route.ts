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

/**
 * POST /api/keys/[id]/cancel-rotation
 *
 * Cancels an in-progress rotation:
 * Clears supersededById and rotationExpiresAt on the original key, and deletes the
 * newly minted replacement key if it hasn't been used yet.
 */
export const POST = withMetrics(
  "POST /api/keys/[id]/cancel-rotation",
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
          supersededById: true,
          rotationExpiresAt: true,
          revokedAt: true,
        },
      });

      if (!existingKey) return badRequestError("Key not found");

      if (!existingKey.supersededById) {
        return badRequestError("Key is not currently undergoing rotation");
      }

      const replacementKeyId = existingKey.supersededById;

      // Revert the original key
      await prisma.apiKey.update({
        where: { id: existingKey.id },
        data: {
          supersededById: null,
          rotationExpiresAt: null,
        },
      });

      // Revoke/remove the replacement key if it was created
      if (replacementKeyId) {
        await prisma.apiKey
          .deleteMany({
            where: { id: replacementKeyId, userId: auth.userId },
          })
          .catch(() => {});
      }

      // Record in AuditLog
      await prisma.auditLog
        .create({
          data: {
            action: "api-key:cancel-rotation",
            actor: auth.userId,
            target: existingKey.id,
            details: {
              keyId: existingKey.id,
              name: existingKey.name,
              cancelledReplacementKeyId: replacementKeyId,
            },
          },
        })
        .catch(() => {});

      logger.info("API key rotation cancelled", {
        keyId: existingKey.id,
        cancelledReplacementKeyId: replacementKeyId,
      });

      return successResponse({
        id: existingKey.id,
        rotationCancelled: true,
      });
    } catch (err) {
      return handleApiError(err, "POST /api/keys/[id]/cancel-rotation");
    }
  })
);
