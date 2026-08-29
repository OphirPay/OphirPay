// SPDX-License-Identifier: MIT

import { withApiAuth } from "@/lib/api-auth";
import { successResponse, handleApiError, badRequestError } from "@/lib/api-response";
import { simulateContractCall, DEFAULT_CONTRACT_ID, CHAIN_READ_SOURCE } from "@/lib/contracts";
import { nativeToScVal } from "@stellar/stellar-sdk";
import { z } from "zod";
import { withRequestLogging } from "@/lib/request-logging";

const auditLogQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  actor: z.string().optional(),
  action: z.string().optional(),
  since: z.coerce.number().int().positive().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  search: z.string().optional(),
});

export type AuditLogEntry = {
  id: number;
  timestamp: number;
  action: string;
  actor: string;
  target_id: number;
  details: string;
};

function parseDateParam(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const num = Number(value);
  if (!isNaN(num) && num > 0) {
    return num > 1e11 ? Math.floor(num / 1000) : num;
  }
  const parsed = Date.parse(value);
  if (!isNaN(parsed)) {
    return Math.floor(parsed / 1000);
  }
  return undefined;
}

/**
 * GET /api/audit-log
 *
 * Returns contract audit log entries. Requires API-key authentication.
 * Queries the OphirPayContract's persistent audit ledger on-chain.
 * Supports pagination and filtering by actor, action, date range, and search.
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

    const { page, limit, actor, action, since, from, to, dateFrom, dateTo, search } = parsed.data;

    // Parse date filters
    const fromTs = since ?? parseDateParam(dateFrom ?? from);
    let toTs = parseDateParam(dateTo ?? to);
    if (dateTo && /^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
      const endOfDay = Date.parse(`${dateTo}T23:59:59.999Z`);
      if (!isNaN(endOfDay)) {
        toTs = Math.floor(endOfDay / 1000);
      }
    }

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

    // Fetch entries from contract
    const entries: AuditLogEntry[] = [];
    const maxEntriesToFetch = Math.min(totalCount, 500);
    const startId = totalCount;
    const endId = Math.max(1, totalCount - maxEntriesToFetch + 1);

    for (let id = startId; id >= endId; id--) {
      try {
        const entryResult = await simulateContractCall(
          DEFAULT_CONTRACT_ID,
          "get_audit_entry",
          CHAIN_READ_SOURCE,
          [nativeToScVal(id, { type: "u64" })]
        );
        if (entryResult.status !== "SIMULATION_FAILED" && entryResult.returnValue) {
          const rawEntry = entryResult.returnValue as Record<string, unknown>;
          const entry: AuditLogEntry = {
            id: Number(rawEntry.id ?? id),
            timestamp: Number(rawEntry.timestamp ?? 0),
            action: String(rawEntry.action ?? ""),
            actor: String(rawEntry.actor ?? ""),
            target_id: Number(rawEntry.target_id ?? 0),
            details: String(rawEntry.details ?? ""),
          };
          entries.push(entry);
        }
      } catch {
        // Skip unreadable entries
      }
    }

    // Apply filtering
    let filtered = entries;

    if (actor) {
      const qActor = actor.trim().toLowerCase();
      filtered = filtered.filter((e) => e.actor.toLowerCase().includes(qActor));
    }

    if (action) {
      const qAction = action.trim().toLowerCase();
      filtered = filtered.filter(
        (e) => e.action.toLowerCase() === qAction || e.action.toLowerCase().includes(qAction)
      );
    }

    if (fromTs !== undefined) {
      filtered = filtered.filter((e) => {
        const ts = e.timestamp > 1e11 ? Math.floor(e.timestamp / 1000) : e.timestamp;
        return ts >= fromTs;
      });
    }

    if (toTs !== undefined) {
      filtered = filtered.filter((e) => {
        const ts = e.timestamp > 1e11 ? Math.floor(e.timestamp / 1000) : e.timestamp;
        return ts <= toTs;
      });
    }

    if (search) {
      const qSearch = search.trim().toLowerCase();
      filtered = filtered.filter(
        (e) =>
          e.details.toLowerCase().includes(qSearch) ||
          e.actor.toLowerCase().includes(qSearch) ||
          e.action.toLowerCase().includes(qSearch) ||
          String(e.id).includes(qSearch) ||
          String(e.target_id).includes(qSearch)
      );
    }

    const totalMatching = filtered.length;
    const startIndex = (page - 1) * limit;
    const paginated = filtered.slice(startIndex, startIndex + limit);

    return successResponse(paginated, { page, limit, total: totalMatching });
  } catch (error) {
    return handleApiError(error);
  }
}

export const GET = withRequestLogging(withApiAuth(_GET, "admin"));
