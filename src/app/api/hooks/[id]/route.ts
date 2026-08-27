// SPDX-License-Identifier: MIT

import prisma from "@/lib/prisma";
import {
  successResponse,
  badRequestError,
  unauthorizedError,
  handleApiError,
} from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { verifyCsrf } from "@/lib/csrf";
import { validateBody, updateHookSchema } from "@/lib/validation-schemas";
import { withRequestLogging } from "@/lib/request-logging";

// ── PATCH /api/hooks/[id] ─────────────────────────────────────

/**
 * Update a notification hook ledger row AFTER the matching on-chain
 * transition (unregister_hook) succeeded, so the list reflects deactivation.
 */
export const PATCH = withRequestLogging(async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const csrfError = verifyCsrf(request);
    if (csrfError) return csrfError;

    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedError("Authentication required.");

    const { id } = await params;
    const parsed = await validateBody(request, updateHookSchema);
    if (!parsed.success) return parsed.response;

    // Scoped update — only the owner can change their own hook row
    const result = await prisma.notificationHook.updateMany({
      where: { id, userId: auth.userId },
      data: { active: parsed.data.active },
    });
    if (result.count === 0) return badRequestError("Hook not found");

    return successResponse({ updated: true });
  } catch (err) {
    return handleApiError(err, "PATCH /api/hooks/[id]");
  }
});
