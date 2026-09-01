// SPDX-License-Identifier: MIT

import { withApiAuth } from "@/lib/api-auth";
import { successResponse, handleApiError, badRequestError } from "@/lib/api-response";
import prisma from "@/lib/prisma";
import { simulateContractCall, DEFAULT_CONTRACT_ID, CHAIN_READ_SOURCE } from "@/lib/contracts";
import { z } from "zod";
import { withRequestLogging } from "@/lib/request-logging";
import {
  auditLogQuerySchema,
  toAuditLogFilters,
  iterateAuditLogEntries,
  type AuditLogEntry,
} from "@/lib/audit-log";

const auditLogQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  actor: z.string().optional(),
  action: z.string().optional(),
  since: z.coerce.number().int().positive().optional(),
  source: z.enum(["contract", "db", "all"]).optional().default("contract"),
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
 * Returns contract audit log entries. Requires API-key authentication with the
 * `admin` scope. Supports offset pagination (`page` / `limit`) and combined
 * filters: `actor`, `action`, `resource` (matches `target_id`), a `since` /
 * `until` date range (Unix seconds or ISO 8601), and `order` (asc | desc).
 *
 * Filtering is applied server-side across the full on-chain ledger, so the
 * `total` in `meta` reflects the filtered set, not the raw contract count.
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

    const { page, limit, source } = parsed.data;

    // Persisted (DB) audit entries — refund lifecycle history with record
    // ids, queryable by action/target (issue #365).
    const dbEntries = source === "db" || source === "all"
      ? await prisma.auditLog.findMany({
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
          ...(parsed.data.action ? { where: { action: parsed.data.action } } : {}),
        })
      : [];

    if (source === "db") {
      return successResponse(
        dbEntries.map((e) => ({
          id: e.id,
          timestamp: new Date(e.createdAt).getTime(),
          action: e.action,
          actor: e.actor ?? "",
          target_id: e.target ?? "",
          details: e.details ?? null,
        })),
        { page, limit, total: 0 }
      );
    }

    const parsed = auditLogQuerySchema.safeParse({
      page: param("page"),
      limit: param("limit"),
      actor: param("actor"),
      action: param("action"),
      resource: param("resource"),
      since: param("since"),
      until: param("until"),
      order: param("order"),
    });
    if (!parsed.success) return validationError(parsed.error);

    if (countResult.status === "SIMULATION_FAILED") {
      return successResponse(dbEntries, {
        page,
        limit,
        total: 0,

      });
    }

    const totalCount = Number(countResult.returnValue ?? 0);
    if (totalCount === 0) {
      return successResponse(dbEntries, { page, limit, total: 0 });
    }

    // Fetch entries from the contract (most recent first, capped at limit)
    const entries: AuditLogEntry[] = [];
    const startId = Math.max(1, totalCount - (page - 1) * limit);
    const endId = Math.max(1, startId - limit + 1);

    // Collect the filtered set (bounded by the on-chain ledger) to compute the
    // total for offset pagination.
    const all: AuditLogEntry[] = [];
    for await (const entry of iterateAuditLogEntries(filters)) {
      all.push(entry);
    }
    const total = all.length;
    const start = (page - 1) * limit;
    const items = all.slice(start, start + limit);
    const hasMore = start + limit < total;

    return successResponse(entries, {
      page,
      limit,
      total: totalCount,
      
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export const GET = withRequestLogging(withApiAuth(_GET, "admin"));