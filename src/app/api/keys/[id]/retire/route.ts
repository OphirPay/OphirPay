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
 * POST /api/keys/[id]/retire
 *
 * Explicitly retires an old API key immediately, terminating its rotation overlap window
 * ahead of schedule once the consumer has successfully deployed the new key.
 */
export const POST = withMetrics(
  "POST /api/keys/[id]/retire",
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
          supersededById: true,
          rotationExpiresAt: true,
          revokedAt: true,
        },
      });

      if (!existingKey) return badRequestError("Key not found");

      if (existingKey.revokedAt) {
        return badRequestError("Key is already retired or revoked");
      }

      const retiredAt = new Date();

      // Immediately terminate overlap window by expiring rotation and marking revoked
      await prisma.apiKey.update({
        where: { id: existingKey.id },
        data: {
          rotationExpiresAt: retiredAt,
          revokedAt: retiredAt,
        },
      });

      // Record in AuditLog
      await prisma.auditLog
        .create({
          data: {
            action: "api-key:retire-overlap",
            actor: auth.userId,
            target: existingKey.id,
            details: {
              keyId: existingKey.id,
              name: existingKey.name,
              supersededById: existingKey.supersededById,
              retiredAt: retiredAt.toISOString(),
            },
          },
        })
        .catch(() => {});

      logger.info("API key overlap retired explicitly", {
        keyId: existingKey.id,
        retiredAt: retiredAt.toISOString(),
      });

      return successResponse({
        id: existingKey.id,
        retired: true,
        retiredAt: retiredAt.toISOString(),
      });
    } catch (err) {
      return handleApiError(err, "POST /api/keys/[id]/retire");
    }
  })
);
