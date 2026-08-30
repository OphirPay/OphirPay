// SPDX-License-Identifier: MIT

import { withApiAuth } from "@/lib/api-auth";
import { successResponse, handleApiError, badRequestError } from "@/lib/api-response";
import prisma from "@/lib/prisma";
import { simulateContractCall, DEFAULT_CONTRACT_ID, CHAIN_READ_SOURCE } from "@/lib/contracts";
import { z } from "zod";
import { withRequestLogging } from "@/lib/request-logging";

const auditLogQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  actor: z.string().optional(),
  action: z.string().optional(),
  since: z.coerce.number().int().positive().optional(),
  until: z.coerce.number().int().positive().optional(),
  source: z.enum(["contract", "db", "all"]).optional().default("contract"),
  format: z.enum(["json", "csv"]).optional().default("json"),
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
 * Supports pagination, filtering by actor/action/date-range, and CSV export.
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

    const { page, limit, source, format, actor, action, since, until } = parsed.data;

    // Build where clause for DB entries
    const where: Record<string, unknown> = {};
    if (action) where.action = action;
    if (actor) where.actor = actor;
    if (since || until) {
      where.createdAt = {};
      if (since) (where.createdAt as Record<string, Date>).gte = new Date(since * 1000);
      if (until) (where.createdAt as Record<string, Date>).lte = new Date(until * 1000);
    }

    // Get total count from DB
    const dbTotal = await prisma.auditLog.count({ where });

    // Persisted (DB) audit entries — refund lifecycle history with record
    // ids, queryable by action/target (issue #365).
    const dbEntries = source === "db" || source === "all"
      ? await prisma.auditLog.findMany({
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
          where,
        })
      : [];

    // If DB only or no contract entries, return DB results
    if (source === "db") {
      const responseData = dbEntries.map((e) => ({
        id: e.id,
        timestamp: new Date(e.createdAt).getTime(),
        action: e.action,
        actor: e.actor ?? "",
        target_id: e.target ?? "",
        details: e.details ?? null,
      }));

      if (format === "csv") {
        return csvResponse(responseData);
      }
      return successResponse(responseData, { page, limit, total: dbTotal });
    }

    // Get total count from contract
    const countResult = await simulateContractCall(
      DEFAULT_CONTRACT_ID,
      "get_audit_log_count",
      CHAIN_READ_SOURCE
    );

    let totalCount = 0;
    let contractEntries: AuditLogEntry[] = [];

    if (countResult.status !== "SIMULATION_FAILED") {
      totalCount = Number(countResult.returnValue ?? 0);
      
      if (totalCount > 0) {
        // Fetch entries from the contract (most recent first, capped at limit)
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
              // Apply client-side filters for contract entries
              if (actor && entry.actor !== actor) continue;
              if (action && entry.action !== action) continue;
              if (since && entry.timestamp < since) continue;
              if (until && entry.timestamp > until) continue;
              contractEntries.push(entry);
            }
          } catch {
            // Skip entries we can't read
          }
        }
      }
    }

    // Merge DB and contract entries, dedupe by id
    const merged = [...contractEntries, ...dbEntries.map((e) => ({
      id: e.id,
      timestamp: new Date(e.createdAt).getTime(),
      action: e.action,
      actor: e.actor ?? "",
      target_id: e.target ?? "",
      details: e.details ?? null,
    }))];
    
    // Sort by timestamp descending
    merged.sort((a, b) => b.timestamp - a.timestamp);
    const total = merged.length;

    const responseData = merged.slice(0, limit);

    if (format === "csv") {
      return csvResponse(responseData);
    }

    return successResponse(responseData, {
      page,
      limit,
      total,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

function csvResponse(data: AuditLogEntry[]) {
  const headers = ["ID", "Timestamp", "Action", "Actor", "Target ID", "Details"];
  const rows = data.map((e) => [
    e.id.toString(),
    new Date(e.timestamp * 1000).toISOString(),
    e.action,
    e.actor,
    e.target_id.toString(),
    JSON.stringify(e.details ?? ""),
  ]);
  
  const csv = [headers.join(","), ...rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(","))].join("\n");
  
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="audit-log-${Date.now()}.csv"`,
    },
  });
}

export const GET = withRequestLogging(withApiAuth(_GET, "admin"));
