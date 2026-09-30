// SPDX-License-Identifier: MIT

import prisma from "@/lib/prisma";
import {
  badRequestError,
  handleApiError,
  successResponse,
  unauthorizedError,
} from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import {
  deriveKeyPrefix,
  generateApiKey,
  hashApiKeyV1,
} from "@/lib/api-auth";
import { verifyCsrf } from "@/lib/csrf";
import { logger } from "@/lib/logger";

const ROTATION_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * POST /api/keys/[id]/rotate
 *
 * Atomically issues a replacement key and gives the previous key a 24-hour
 * overlap so consumers can deploy without an authentication outage.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const csrfError = verifyCsrf(request);
    if (csrfError) return csrfError;

    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedError("Authentication required.");

    const { id } = await params;
    const now = new Date();
    const rawKey = generateApiKey();
    const replacementPrefix = deriveKeyPrefix(rawKey);
    const graceLimit = new Date(now.getTime() + ROTATION_GRACE_MS);

    const rotated = await prisma.$transaction(async (tx) => {
      const previous = await tx.apiKey.findFirst({
        where: {
          id,
          userId: auth.userId,
          revokedAt: null,
          rotatedAt: null,
        },
        select: {
          id: true,
          name: true,
          prefix: true,
          scopes: true,
          expiresAt: true,
        },
      });
      if (!previous || (previous.expiresAt && previous.expiresAt <= now)) {
        return null;
      }

      const graceUntil =
        previous.expiresAt && previous.expiresAt < graceLimit
          ? previous.expiresAt
          : graceLimit;
      const claimed = await tx.apiKey.updateMany({
        where: {
          id: previous.id,
          userId: auth.userId,
          revokedAt: null,
          rotatedAt: null,
        },
        data: { rotatedAt: now, expiresAt: graceUntil },
      });
      if (claimed.count !== 1) return null;

      const replacement = await tx.apiKey.create({
        data: {
          name: previous.name,
          keyHash: hashApiKeyV1(rawKey),
          prefix: replacementPrefix,
          userId: auth.userId,
          scopes: previous.scopes,
          expiresAt: previous.expiresAt,
        },
        select: { id: true },
      });

      await tx.apiKey.update({
        where: { id: previous.id },
        data: { rotatedToId: replacement.id },
      });
      await tx.auditLog.create({
        data: {
          action: "api_key:rotate",
          actor: auth.userId,
          target: previous.id,
          details: {
            replacementId: replacement.id,
            previousPrefix: previous.prefix,
            replacementPrefix,
            graceUntil: graceUntil.toISOString(),
          },
        },
      });

      return {
        id: replacement.id,
        name: previous.name,
        scopes: previous.scopes,
        previousPrefix: previous.prefix,
        graceUntil,
      };
    });

    if (!rotated) {
      return badRequestError("API key not found, expired, or already rotated");
    }

    logger.info("API key rotated", {
      previousId: id,
      replacementId: rotated.id,
      userId: auth.userId,
    });

    return successResponse(
      {
        id: rotated.id,
        name: rotated.name,
        prefix: replacementPrefix,
        scopes: rotated.scopes,
        key: rawKey,
        previousPrefix: rotated.previousPrefix,
        previousKeyValidUntil: rotated.graceUntil,
      },
      undefined,
      201,
    );
  } catch (err) {
    return handleApiError(err, "POST /api/keys/[id]/rotate");
  }
}
