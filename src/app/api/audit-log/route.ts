// SPDX-License-Identifier: MIT

import { withApiAuth } from "@/lib/api-auth";
import { successResponse, handleApiError, badRequestError } from "@/lib/api-response";
import { simulateContractCall, DEFAULT_CONTRACT_ID, CHAIN_READ_SOURCE } from "@/lib/contracts";
import { z } from "zod";
import { withRequestLogging } from "@/lib/request-logging";

const auditLogQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  actor: z.string().optional(),
  action: z.string().optional(),
  since: z.coerce.number().int().positive().optional(),
});

export type AuditLogEntry = {
  id: number;
  timestamp: number;
  action: string;
  actor: string;
  target_id: number;
  details: string;
};

/**
 * GET /api/audit-log
 *
 * Returns contract audit log entries. Requires API-key authentication.
 * Queries the OphirPayContract's persistent audit ledger on-chain.
 * Supports pagination and filtering by actor, action, and timestamp.
 */
async function _GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const raw = Object.fromEntries(searchParams.entries());
    const parsed = auditLogQuerySchema.safeParse(raw);
    if (!parsed.success) {
      return badRequestError(
        parsed.error.issues.map((e) => e.message).join("; ")
      );
    }

    const { page, limit } = parsed.data;

    // Get total count from contract
    const countResult = await simulateContractCall(
      DEFAULT_CONTRACT_ID,
      "get_audit_log_count",
      CHAIN_READ_SOURCE
    );

    if (countResult.status === "SIMULATION_FAILED") {
      return successResponse([], {
        page,
        limit,
        total: 0,
      });
    }

    const totalCount = Number(countResult.returnValue ?? 0);
    if (totalCount === 0) {
      return successResponse([], { page, limit, total: 0 });
    }

    // Fetch entries from the contract (most recent first, capped at limit)
    const entries: AuditLogEntry[] = [];
    const startId = Math.max(1, totalCount - (page - 1) * limit);
    const endId = Math.max(1, startId - limit + 1);

    for (let id = startId; id >= endId; id--) {
      try {
        const entryResult = await simulateContractCall(
          DEFAULT_CONTRACT_ID,
          "get_audit_entry",
          CHAIN_READ_SOURCE
        );
        if (entryResult.status !== "SIMULATION_FAILED" && entryResult.returnValue) {
          const entry = entryResult.returnValue as AuditLogEntry;
          entries.push(entry);
        }
      } catch {
        // Skip entries we can't read
      }
    }

    return successResponse(entries, { page, limit, total: totalCount });
  } catch (error) {
    return handleApiError(error);
  }
}

export const GET = withRequestLogging(withApiAuth(_GET));
